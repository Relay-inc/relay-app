//! A shared vault's live channel (docs/workspaces.md, Live channel): members that keep a `vault_stream` connection
//! open get each other's frames within moments instead of at the next 10 s round. A frame is sealed on the sender's
//! Mac under the vault key; here it is only passed on, never stored: at most a short ring of the last updates per
//! vault, in memory, so a member that drops for a moment picks up what it missed. Anything older, and everything after
//! a restart of this server, comes through the rounds as before.
//!
//! A room per vault: its streams, its ring, and its members as vault.json last said (re-read when that file changes).
//! A thread per room checks every CHECK: members (a removal by the CLI, another process, counts within seconds),
//! pings, streams gone silent, and frees the room once nobody has been there for a while. Each stream writes through
//! a queue of its own, bounded in bytes, from a thread of its own with a write timeout: a member that stops reading is
//! dropped and never holds up the others. Connections are shut down only after the rooms' lock is let go.

use crate::vaults::{hex, Vaults};
use relay_remote::channel::{MAX_BODY, VERSION};
use relay_remote::proto;
use relay_remote::tls::{self, random_secret};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

/// A frame's line at most: its sealed body (relay_remote::channel::MAX_BODY) in hex, and the fields around it. A request
/// for another stream VERSION is refused, so an app and a server that disagree fall back to rounds.
const MAX_FRAME_LINE: u64 = (MAX_BODY as u64) * 2 + 4096;
/// The updates kept for a short reconnect, by count and by bytes; well under QUEUE_BYTES, so a resume always fits.
const RING: usize = 512;
const RING_BYTES: usize = 2 << 20;
/// Lines a connection may send (frames and pings): RATE a second on average, BURST at once. Past that it is closed.
const RATE: f64 = 100.0;
const BURST: f64 = 300.0;
/// Bytes queued for a member that does not read; past that its stream is dropped (it catches up through rounds).
const QUEUE_BYTES: usize = 4 << 20;
/// Streams one device may keep open on one vault (an app has one); a new one past that closes the oldest.
const PER_MEMBER: usize = 4;
/// The room's checks; pings out; a stream that sent nothing (the app pings every 15 s) for SILENT is closed; a write
/// to a member that takes longer than WRITE fails; a room nobody used for IDLE is freed, its ring with it.
const CHECK: Duration = Duration::from_secs(2);
const PING: Duration = Duration::from_secs(15);
const SILENT: Duration = Duration::from_secs(45);
const WRITE: Duration = Duration::from_secs(10);
const IDLE: Duration = Duration::from_secs(600);
/// What a frame may be: a document's update (kept in the ring) or who is where (passed on only).
const KINDS: &[&str] = &["update", "awareness"];

type Line = Arc<str>;
/// One open stream: its queue (and the bytes in it), its connection, when it last sent a line (ms since `start`).
struct Sub { fp: String, id: u64, tx: SyncSender<Line>, queued: Arc<AtomicUsize>, w: tls::Writer, heard: Arc<AtomicU64> }
impl Sub {
    /// Queue a line; false when it does not fit (the caller drops this stream).
    fn send(&self, line: &Line) -> bool {
        if self.queued.fetch_add(line.len(), Ordering::SeqCst) + line.len() > QUEUE_BYTES { return false; }
        self.tx.try_send(line.clone()).is_ok()
    }
}
#[derive(Default)]
struct Room {
    seq: u64, ring: VecDeque<(u64, Line)>, bytes: usize, subs: Vec<Sub>,
    /// vault.json's mtime when `members` was read; the fingerprints that may stream
    stamp: Option<SystemTime>, members: HashSet<String>, idle_since: Option<Instant>,
    /// the vault's key epoch as vault.json said: a frame under an older key is dropped (a removed member holds it)
    epoch: u64,
}
impl Room {
    fn push(&mut self, seq: u64, line: Line) {
        self.bytes += line.len();
        self.ring.push_back((seq, line));
        while self.ring.len() > RING || self.bytes > RING_BYTES { if let Some((_, l)) = self.ring.pop_front() { self.bytes -= l.len(); } }
    }
    /// Take the streams `drop` says go; the caller shuts them down once the lock is let go.
    fn take(&mut self, drop: impl Fn(&Sub) -> bool) -> Vec<Sub> {
        let (gone, keep) = std::mem::take(&mut self.subs).into_iter().partition(|s| drop(s));
        self.subs = keep;
        gone
    }
}
/// Shut down streams taken out of a room, with a last line that says why: outside the rooms' lock, never waiting.
fn close(subs: Vec<Sub>, why: &str) {
    let bye: Line = json!({"t": "bye", "why": why}).to_string().into();
    for s in subs {
        s.tx.try_send(bye.clone()).ok();
        let w = s.w;
        // the writer thread sends the bye first if it can; a reader blocked on this connection returns then
        thread::spawn(move || { thread::sleep(Duration::from_millis(200)); w.shutdown(); });
    }
}

/// Every vault's open streams. `epoch` is new at every start of this server: a resume asked against another epoch
/// starts over (the ring went with the process).
pub struct Rooms { epoch: String, next: AtomicU64, start: Instant, rooms: Arc<Mutex<HashMap<String, Room>>> }
impl Default for Rooms {
    fn default() -> Rooms { Rooms { epoch: random_secret()[..16].into(), next: AtomicU64::new(1), start: Instant::now(), rooms: Arc::default() } }
}
impl Rooms {
    fn now_ms(&self) -> u64 { self.start.elapsed().as_millis() as u64 }
    /// `fp` is out of vault `id` (removed or left): its streams close now, and it may open none until vault.json says
    /// otherwise.
    pub fn kick(&self, id: &str, fp: &str) {
        let gone = self.rooms.lock().unwrap().get_mut(id).map(|room| { room.members.remove(fp); room.take(|s| s.fp == fp) }).unwrap_or_default();
        close(gone, "no longer a member");
    }
}

fn vault_file(data: &Path, id: &str) -> PathBuf { data.join("vaults").join(id).join("vault.json") }
/// The room's members as vault.json says now, re-read only when the file changed. None: the vault is gone.
fn refresh(data: &Path, id: &str, room: &mut Room) -> Option<()> {
    let stamp = std::fs::metadata(vault_file(data, id)).and_then(|m| m.modified()).ok()?;
    if room.stamp != Some(stamp) {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(vault_file(data, id)).ok()?).ok()?;
        room.members = v["members"].as_array().into_iter().flatten().filter_map(|m| m["fp"].as_str().map(String::from)).collect();
        room.epoch = v["epoch"].as_u64().unwrap_or(0);
        room.stamp = Some(stamp);
    }
    Some(())
}

/// The room's thread: every CHECK the members (from vault.json), pings, silent streams; gone with the room.
fn watch(rooms: Arc<Mutex<HashMap<String, Room>>>, data: PathBuf, id: String, start: Instant) {
    thread::spawn(move || {
        let ping: Line = json!({"t": "ping"}).to_string().into();
        let mut last_ping = Instant::now();
        loop {
            thread::sleep(CHECK);
            let now = start.elapsed().as_millis() as u64;
            let pinging = last_ping.elapsed() >= PING;
            if pinging { last_ping = Instant::now(); }
            let (out, silent, full, done) = {
                let mut all = rooms.lock().unwrap();
                let Some(room) = all.get_mut(&id) else { return };
                if refresh(&data, &id, room).is_none() {
                    // the vault is gone (its last member left): everyone out, the room with it
                    let gone = room.take(|_| true);
                    all.remove(&id);
                    drop(all);
                    close(gone, "no such vault");
                    return;
                }
                let members = room.members.clone();
                let out = room.take(|s| !members.contains(&s.fp));
                let silent = room.take(|s| now.saturating_sub(s.heard.load(Ordering::SeqCst)) > SILENT.as_millis() as u64);
                let full = if pinging { room.take(|s| !s.send(&ping)) } else { vec![] };
                if room.subs.is_empty() { room.idle_since.get_or_insert_with(Instant::now); } else { room.idle_since = None; }
                let done = room.idle_since.is_some_and(|t| t.elapsed() >= IDLE);
                if done { all.remove(&id); }
                (out, silent, full, done)
            };
            close(out, "no longer a member");
            close(silent, "silent too long");
            close(full, "not reading");
            if done { return; }
        }
    });
}

/// `vault_stream {vault, v, since, epoch}`: the hello `{ok, v, epoch, seq, resumed}`, then what was missed when
/// `resumed`, then every frame other members send. The app sends `{t:"frame", kind, doc, n, body}` and `{t:"ping"}`.
pub fn stream(vaults: &Vaults, fp: &str, id: &str, req: &Value, r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
    let refuse = |w: &mut tls::Writer, why: &str| { proto::write_json(w, &json!({"ok": false, "error": why})).ok(); w.shutdown(); Ok(()) };
    if req["v"].as_u64() != Some(VERSION) { return refuse(&mut w, "stream version not supported, update Relay"); }
    if !hex(id, 16) || vaults.member(id, fp).is_err() { return refuse(&mut w, "no such vault"); }
    w.set_write_timeout(WRITE).ok();
    let rooms = &vaults.rooms;
    let (tx, rx) = sync_channel::<Line>(4096);
    let queued = Arc::new(AtomicUsize::new(0));
    let heard = Arc::new(AtomicU64::new(rooms.now_ms()));
    let me = rooms.next.fetch_add(1, Ordering::Relaxed);
    let (oldest_out, new_room) = {
        let mut all = rooms.rooms.lock().unwrap();
        let new_room = !all.contains_key(id);
        let room = all.entry(id.into()).or_default();
        // the members under the same lock as kick: a removal between the check above and here is seen
        if refresh(vaults.data(), id, room).is_none() || !room.members.contains(fp) {
            if new_room { all.remove(id); }
            drop(all);
            return refuse(&mut w, "no such vault");
        }
        let since = req["since"].as_u64().unwrap_or(0);
        let oldest = room.ring.front().map_or(room.seq + 1, |(s, _)| *s);
        // the ring still holds everything after `since`: the frames missed follow the hello
        let resumed = req["epoch"].as_str() == Some(rooms.epoch.as_str()) && since <= room.seq && since + 1 >= oldest;
        let sub = Sub { fp: fp.into(), id: me, tx, queued: queued.clone(), w: w.clone(), heard: heard.clone() };
        sub.send(&json!({"ok": true, "v": VERSION, "epoch": rooms.epoch, "seq": room.seq, "resumed": resumed}).to_string().into());
        if resumed { for (s, line) in &room.ring { if *s > since { sub.send(line); } } }
        // one device, a few streams at most: the oldest goes
        let mine: Vec<u64> = room.subs.iter().filter(|s| s.fp == fp).map(|s| s.id).collect();
        let over: HashSet<u64> = mine.iter().take((mine.len() + 1).saturating_sub(PER_MEMBER)).copied().collect();
        let oldest_out = room.take(|s| over.contains(&s.id));
        room.subs.push(sub);
        room.idle_since = None;
        (oldest_out, new_room)
    };
    close(oldest_out, "too many streams");
    if new_room { watch(rooms.rooms.clone(), vaults.data().to_path_buf(), id.into(), rooms.start); }
    write_out(rx, queued, w.clone());
    let res = read_frames(vaults, fp, id, me, &heard, r);
    let gone = rooms.rooms.lock().unwrap().get_mut(id).map(|room| room.take(|s| s.id == me)).unwrap_or_default();
    close(gone, res.as_ref().err().map_or("closed", |e| e.as_str()));
    Ok(())
}

/// The stream's writer: one line per write, so frames never interleave; a write that fails (the write timeout on a
/// member that stopped reading) ends the connection.
fn write_out(rx: Receiver<Line>, queued: Arc<AtomicUsize>, mut w: tls::Writer) {
    thread::spawn(move || {
        for line in rx {
            let ok = w.write_all(format!("{line}\n").as_bytes()).is_ok();
            queued.fetch_sub(line.len(), Ordering::SeqCst);
            if !ok { break; }
        }
        w.shutdown();
    });
}

/// The lines a member sends, until it goes. Err: why it was cut off (too big, too many, not a member any more).
fn read_frames(vaults: &Vaults, fp: &str, id: &str, me: u64, heard: &AtomicU64, mut r: BufReader<tls::Reader>) -> Result<(), String> {
    let rooms = &vaults.rooms;
    let (mut tokens, mut at) = (BURST, Instant::now());
    loop {
        let Ok(v) = proto::read_json(&mut r, MAX_FRAME_LINE) else { return Ok(()) };
        heard.store(rooms.now_ms(), Ordering::SeqCst);
        tokens = (tokens + at.elapsed().as_secs_f64() * RATE).min(BURST) - 1.0;
        at = Instant::now();
        if tokens < 0.0 { return Err("too many frames".into()); }
        match v["t"].as_str() {
            Some("ping") => continue,
            Some("frame") => {}
            _ => return Err("unknown line".into()),
        }
        let (kind, doc, body) = (v["kind"].as_str().unwrap_or(""), v["doc"].as_str().unwrap_or(""), v["body"].as_str().unwrap_or(""));
        let n = v["n"].as_u64().ok_or("frame without n")?;
        if !KINDS.contains(&kind) || !hex(doc, 64) { return Err("bad frame".into()); }
        if body.len() > MAX_BODY * 2 || body.len() % 2 != 0 || !body.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("frame too big or not hex".into()); }
        // `from`: the sender's device as the TLS handshake proved it; the app binds it in the seal, so the server
        // cannot pass a frame off as another member's (a member, holding the key, could)
        let mut out = json!({"t": "frame", "seq": 0, "from": &fp[..16], "e": v["e"].as_u64().unwrap_or(0), "kind": kind, "doc": doc, "n": n, "body": body});
        let full = {
            let mut all = rooms.rooms.lock().unwrap();
            let Some(room) = all.get_mut(id) else { return Ok(()) };
            if !room.members.contains(fp) { return Err("no longer a member".into()); }
            if out["e"].as_u64().unwrap_or(0) < room.epoch { continue; }
            if kind == "update" { room.seq += 1; out["seq"] = json!(room.seq); }
            let line: Line = out.to_string().into();
            if kind == "update" { room.push(room.seq, line.clone()); }
            // a member that does not read loses its stream, and catches up through the rounds
            room.take(|s| s.id != me && !s.send(&line))
        };
        close(full, "not reading");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_ring_keeps_the_last_updates_by_count_and_by_bytes() {
        let mut room = Room::default();
        for s in 1..=(RING as u64 + 10) { room.push(s, "x".into()); }
        assert_eq!((room.ring.len(), room.ring.front().unwrap().0), (RING, 11), "by count: the oldest go first");
        let big: Line = "y".repeat(RING_BYTES / 3).into();
        for s in 1000..1004 { room.push(s, big.clone()); }
        assert!(room.bytes <= RING_BYTES && room.ring.front().unwrap().0 >= 1001, "by bytes: {} bytes, from {}", room.bytes, room.ring.front().unwrap().0);
        assert_eq!(room.bytes, room.ring.iter().map(|(_, l)| l.len()).sum::<usize>());
    }
}
