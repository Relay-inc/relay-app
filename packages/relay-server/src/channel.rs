//! A shared vault's live channel (docs/workspaces.md, Live channel): members that keep a `vault_stream` connection
//! open get each other's frames within moments instead of at the next 10 s round. A frame is sealed on the sender's
//! Mac under the vault key; here it is only passed on, never stored: at most a short ring of the last updates per
//! vault, in memory, so a member that drops for a moment picks up what it missed. Anything older, and everything after
//! a restart of this server, comes through the rounds as before.
//!
//! The member check runs when a stream opens, on every frame it sends and every CHECK while it is open, so a member
//! removed or revoked (also by the CLI, another process) loses its stream within seconds. Each stream writes from a
//! thread of its own through a bounded queue: one member that stops reading never holds up the others.

use crate::vaults::{hex, is_member, Vaults};
use relay_remote::channel::{MAX_BODY, VERSION};
use relay_remote::proto;
use relay_remote::tls::{self, random_secret};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{self, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

/// A frame's line at most: its sealed body (relay_remote::channel::MAX_BODY) in hex, and the fields around it. A request
/// for another stream VERSION is refused, so an app and a server that disagree fall back to rounds.
const MAX_FRAME_LINE: u64 = (MAX_BODY as u64) * 2 + 4096;
/// The updates kept for a short reconnect, by count and by sealed bytes.
const RING: usize = 512;
const RING_BYTES: usize = 8 << 20;
/// Frames a connection may send: RATE a second on average, BURST at once. Past that the stream is closed.
const RATE: f64 = 100.0;
const BURST: f64 = 300.0;
/// Lines queued for a member that does not read; past that its stream is dropped.
const QUEUE: usize = 1024;
/// How often a stream's membership is checked, and how often it gets a ping (the app gives up after 3 missed).
const CHECK: Duration = Duration::from_secs(2);
const PING: Duration = Duration::from_secs(15);
/// What a frame may be: a document's update (kept in the ring) or who is where (passed on only).
const KINDS: &[&str] = &["update", "awareness"];

struct Sub { fp: String, id: u64, tx: SyncSender<String>, w: tls::Writer }
#[derive(Default)]
struct Room { seq: u64, ring: VecDeque<(u64, String)>, bytes: usize, subs: Vec<Sub> }

/// Every vault's open streams. `epoch` is new at every start of this server: a resume asked against another epoch
/// starts over (the ring went with the process).
pub struct Rooms { epoch: String, next: AtomicU64, rooms: Mutex<HashMap<String, Room>> }
impl Default for Rooms { fn default() -> Rooms { Rooms { epoch: random_secret()[..16].into(), next: AtomicU64::new(1), rooms: Mutex::default() } } }

impl Rooms {
    /// Close every stream `fp` has on vault `id`: removed or left.
    pub fn kick(&self, id: &str, fp: &str) {
        if let Some(room) = self.rooms.lock().unwrap().get_mut(id) {
            room.subs.retain(|s| if s.fp == fp { bye(s, "no longer a member"); false } else { true });
        }
    }
    fn drop_sub(&self, id: &str, sub: u64) {
        let mut rooms = self.rooms.lock().unwrap();
        if let Some(room) = rooms.get_mut(id) {
            room.subs.retain(|s| if s.id == sub { s.w.shutdown(); false } else { true });
            if room.subs.is_empty() && room.ring.is_empty() { rooms.remove(id); }
        }
    }
}
fn bye(s: &Sub, why: &str) {
    s.tx.try_send(json!({"t": "bye", "why": why}).to_string()).ok();
    // the writer thread sends the bye, then sees the queue closed; a reader blocked on this connection returns now
    let w = s.w.clone();
    thread::spawn(move || { thread::sleep(Duration::from_millis(200)); w.shutdown(); });
}

/// `vault_stream {vault, v, since, epoch}`: the hello `{ok, v, epoch, seq, resumed}`, then what was missed when
/// `resumed`, then every frame other members send. The app sends `{t:"frame", kind, doc, n, body}` and `{t:"ping"}`.
pub fn stream(vaults: &Vaults, fp: &str, id: &str, req: &Value, r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
    let refuse = |w: &mut tls::Writer, why: &str| { proto::write_json(w, &json!({"ok": false, "error": why})).ok(); w.shutdown(); Ok(()) };
    if req["v"].as_u64() != Some(VERSION) { return refuse(&mut w, "stream version not supported, update Relay"); }
    if vaults.member(id, fp).is_err() { return refuse(&mut w, "no such vault"); }
    let rooms = &vaults.rooms;
    let (tx, rx) = sync_channel::<String>(QUEUE);
    let me = rooms.next.fetch_add(1, Ordering::Relaxed);
    {
        let mut all = rooms.rooms.lock().unwrap();
        let room = all.entry(id.into()).or_default();
        let since = req["since"].as_u64().unwrap_or(0);
        let oldest = room.ring.front().map_or(room.seq + 1, |(s, _)| *s);
        // the ring still holds everything after `since`: the frames missed follow the hello
        let resumed = req["epoch"].as_str() == Some(rooms.epoch.as_str()) && since <= room.seq && since + 1 >= oldest;
        tx.try_send(json!({"ok": true, "v": VERSION, "epoch": rooms.epoch, "seq": room.seq, "resumed": resumed}).to_string()).ok();
        if resumed { for (s, line) in &room.ring { if *s > since { tx.try_send(line.clone()).ok(); } } }
        room.subs.push(Sub { fp: fp.into(), id: me, tx: tx.clone(), w: w.clone() });
    }
    // the writer: one line per write, so frames never interleave
    let mut ww = w.clone();
    thread::spawn(move || {
        for line in rx { if ww.write_all(format!("{line}\n").as_bytes()).is_err() { break; } }
        ww.shutdown();
    });
    // membership and pings while it is open
    let (data, id_check, fp_check, tx_check, w_check) = (vaults.data().to_path_buf(), id.to_string(), fp.to_string(), tx.clone(), w.clone());
    thread::spawn(move || {
        let mut last_ping = Instant::now();
        while !w_check.is_closed() {
            thread::sleep(CHECK);
            if !is_member(&data, &id_check, &fp_check) {
                tx_check.try_send(json!({"t": "bye", "why": "no longer a member"}).to_string()).ok();
                thread::sleep(Duration::from_millis(200));
                w_check.shutdown();
                return;
            }
            if last_ping.elapsed() >= PING { last_ping = Instant::now(); if tx_check.try_send(json!({"t": "ping"}).to_string()).is_err() { w_check.shutdown(); } }
        }
    });
    let res = read_frames(vaults, fp, id, me, r);
    if let Err(why) = &res { tx.try_send(json!({"t": "bye", "why": why}).to_string()).ok(); thread::sleep(Duration::from_millis(200)); }
    rooms.drop_sub(id, me);
    Ok(())
}

/// The frames a member sends, until it goes. Err: why it was cut off (too big, too many, not a member any more).
fn read_frames(vaults: &Vaults, fp: &str, id: &str, me: u64, mut r: BufReader<tls::Reader>) -> Result<(), String> {
    let (mut tokens, mut at) = (BURST, Instant::now());
    loop {
        let Ok(v) = proto::read_json(&mut r, MAX_FRAME_LINE) else { return Ok(()) };
        match v["t"].as_str() {
            Some("ping") => continue,
            Some("frame") => {}
            _ => return Err("unknown line".into()),
        }
        tokens = (tokens + at.elapsed().as_secs_f64() * RATE).min(BURST) - 1.0;
        at = Instant::now();
        if tokens < 0.0 { return Err("too many frames".into()); }
        let (kind, doc, body) = (v["kind"].as_str().unwrap_or(""), v["doc"].as_str().unwrap_or(""), v["body"].as_str().unwrap_or(""));
        let n = v["n"].as_u64().ok_or("frame without n")?;
        if !KINDS.contains(&kind) || !hex(doc, 64) { return Err("bad frame".into()); }
        if body.len() > MAX_BODY * 2 || body.len() % 2 != 0 || !body.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("frame too big or not hex".into()); }
        vaults.member(id, fp).map_err(|_| "no longer a member")?;
        // `from`: the sender's device as the TLS handshake proved it; the app binds it in the seal, so it cannot be
        // passed off as another member's
        let mut out = json!({"t": "frame", "seq": 0, "from": &fp[..16], "kind": kind, "doc": doc, "n": n, "body": body});
        let mut rooms = vaults.rooms.rooms.lock().unwrap();
        let Some(room) = rooms.get_mut(id) else { return Ok(()) };
        if kind == "update" {
            room.seq += 1;
            out["seq"] = json!(room.seq);
        }
        let line = out.to_string();
        if kind == "update" {
            room.bytes += line.len();
            room.ring.push_back((room.seq, line.clone()));
            while room.ring.len() > RING || room.bytes > RING_BYTES { if let Some((_, l)) = room.ring.pop_front() { room.bytes -= l.len(); } }
        }
        room.subs.retain(|s| {
            if s.id == me { return true; }
            match s.tx.try_send(line.clone()) {
                Ok(()) => true,
                // a member that does not read loses its stream, and catches up through the rounds
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => { s.w.shutdown(); false }
            }
        });
    }
}
