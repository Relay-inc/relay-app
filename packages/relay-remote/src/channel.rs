//! A shared vault's live channel on this side (docs/workspaces.md, Live channel; the server's side is relay-server's
//! channel.rs). One `Channel` per vault keeps a `vault_stream` connection open, sends frames sealed under the vault key
//! and hands the ones other members send to `on`, opened. It reconnects with a growing pause and asks the server for
//! what it missed; when that is gone (a long gap, a restart there) it says so (`Live { resumed: false }`), and the
//! rounds bring the rest. A server without the stream (`unknown request`) leaves the vault on rounds only.

use crate::client::Client;
use crate::tls::{self, hex, unhex};
use crate::vault::Keys;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// The stream's version, the same on both sides.
pub const VERSION: u64 = 1;
/// A frame's sealed body at most; the server refuses (and closes on) a bigger one.
pub const MAX_BODY: usize = 256 << 10;
const PING: Duration = Duration::from_secs(15);
/// No line from the server for this long (it pings every 15 s): the connection is dead, start over.
const SILENT: Duration = Duration::from_secs(45);
const BACKOFF_MAX: Duration = Duration::from_secs(60);
/// A server that does not know the stream is asked again this much later (it may have been updated).
const OLD_SERVER: Duration = Duration::from_secs(300);
/// A write to the server that takes longer fails: a send never holds its caller for long.
const WRITE: Duration = Duration::from_secs(10);

/// A frame from another member, opened. `seq` is the server's order of updates (0 for awareness), `n` the sender's
/// own counter. `from` is the sender as the server's handshake saw it, bound in the seal: the server cannot change it,
/// another member (who holds the key too) could.
#[derive(Debug, Clone, PartialEq)]
/// `list`: the member list head its sender had seen (`<length>:<hash>`, bound in the seal), to compare with this Mac's.
pub struct Frame { pub seq: u64, pub n: u64, pub from: String, pub kind: String, pub doc: String, pub body: Vec<u8>, pub list: String }
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Frame(Frame),
    /// Connected. `resumed`: everything since the last connection followed; false: some may be missing (a round
    /// catches up).
    Live { resumed: bool },
    /// Not connected, and why.
    Down(String),
}
type On = Arc<dyn Fn(Event) + Send + Sync>;

struct Inner {
    client: Client, vault: String, key: Keys, me: String, on: On,
    n: AtomicU64, w: Mutex<Option<tls::Writer>>, live: AtomicBool, stop: AtomicBool,
    /// the last `n` seen per (sender, doc, kind): a frame the server plays again is dropped
    last: Mutex<HashMap<(String, String, String), u64>>,
}
#[derive(Clone)]
pub struct Channel(Arc<Inner>);

impl Channel {
    /// Start keeping vault `vault`'s stream open on `client`'s server, on a thread of its own, until `stop`.
    pub fn start(client: Client, vault: &str, key: impl Into<Keys>, on: impl Fn(Event) + Send + Sync + 'static) -> Channel {
        let key = key.into();
        let me = client.me()[..16].to_string();
        // the counter starts at the time, so frames of a restarted app never repeat an `n` of before
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_micros() as u64);
        Channel::spawn(Inner { client, vault: vault.into(), key, me, on: Arc::new(on), n: AtomicU64::new(n), w: Mutex::default(), live: AtomicBool::new(false), stop: AtomicBool::new(false), last: Mutex::default() })
    }
    fn spawn(inner: Inner) -> Channel {
        let c = Channel(Arc::new(inner));
        let c2 = c.clone();
        thread::spawn(move || c2.run());
        c
    }
    /// This channel again with newer keys (a rotation): it stops, and the new one goes on with its counter and with
    /// the last `n` it took from each sender, so a frame seen before the restart is still dropped after it.
    pub fn renew(&self, key: impl Into<Keys>) -> Channel {
        let i = &self.0;
        self.stop();
        Channel::spawn(Inner { client: i.client.clone(), vault: i.vault.clone(), key: key.into(), me: i.me.clone(), on: i.on.clone(), n: AtomicU64::new(i.n.load(Ordering::SeqCst)),
            w: Mutex::default(), live: AtomicBool::new(false), stop: AtomicBool::new(false), last: Mutex::new(i.last.lock().unwrap().clone()) })
    }
    pub fn live(&self) -> bool { self.0.live.load(Ordering::SeqCst) }
    /// Stop for good; `on` gets `Down` once more. Never waits on the connection.
    pub fn stop(&self) {
        self.0.stop.store(true, Ordering::SeqCst);
        self.0.live.store(false, Ordering::SeqCst);
        if let Some(w) = self.0.w.lock().unwrap().take() { w.shutdown(); }
        (self.0.on)(Event::Down("stopped".into()));
    }
    /// Send a frame to the other members: `kind` "update" or "awareness", `doc` a record name (64 hex). Err when not
    /// connected; the caller keeps it for the round (an update) or drops it (awareness).
    pub fn send(&self, kind: &str, doc: &str, plain: &[u8]) -> Result<(), String> {
        let i = &self.0;
        let n = i.n.fetch_add(1, Ordering::SeqCst);
        // under the newest key here; its epoch goes along so the others open it with the same one
        let (e, l, body) = i.key.seal_frame(&i.vault, kind, doc, &i.me, n, plain)?;
        if body.len() > MAX_BODY { return Err("frame too big".into()); }
        let line = json!({"t": "frame", "e": e, "l": l, "kind": kind, "doc": doc, "n": n, "body": hex(&body)}).to_string() + "\n";
        let mut w = i.w.lock().unwrap().clone().ok_or("not connected")?;
        w.write_all(line.as_bytes()).map_err(|e| e.to_string())
    }

    fn run(&self) {
        let i = &self.0;
        let (mut since, mut epoch, mut pause) = (0u64, String::new(), Duration::from_secs(1));
        while !i.stop.load(Ordering::SeqCst) {
            match i.client.vault_stream(&i.vault, since, &epoch) {
                Ok((hello, mut r, w)) => {
                    let resumed = hello["resumed"] == true;
                    if !resumed { since = hello["seq"].as_u64().unwrap_or(0); }
                    epoch = hello["epoch"].as_str().unwrap_or("").to_string();
                    w.set_write_timeout(WRITE).ok();
                    *i.w.lock().unwrap() = Some(w.clone());
                    i.live.store(true, Ordering::SeqCst);
                    pause = Duration::from_secs(1);
                    (i.on)(Event::Live { resumed });
                    let why = self.read(&mut r, &w, &mut since);
                    i.live.store(false, Ordering::SeqCst);
                    i.w.lock().unwrap().take();
                    w.shutdown();
                    if !i.stop.load(Ordering::SeqCst) { (i.on)(Event::Down(why)); }
                }
                Err(e) => {
                    // an older server: it does not know the op, or (to a device that only shares vaults) does not allow it
                    let old = e.contains("unknown request") || e.contains("only shares vaults");
                    (i.on)(Event::Down(if old { "the server has no live channel yet".into() } else { e }));
                    if old { pause = OLD_SERVER; } else if pause == OLD_SERVER { pause = Duration::from_secs(1); }
                }
            }
            let until = Instant::now() + pause;
            while Instant::now() < until && !i.stop.load(Ordering::SeqCst) { thread::sleep(Duration::from_millis(200)); }
            if pause < OLD_SERVER { pause = (pause * 2).min(BACKOFF_MAX); }
        }
    }

    /// Lines from the server until the connection ends; why it ended.
    fn read(&self, r: &mut impl BufRead, w: &tls::Writer, since: &mut u64) -> String {
        let i = &self.0;
        let heard = Arc::new(Mutex::new(Instant::now()));
        // pings out, and a connection that went quiet shut, so the read below returns
        let (h2, mut w2) = (heard.clone(), w.clone());
        thread::spawn(move || {
            let mut last = Instant::now();
            while !w2.is_closed() {
                thread::sleep(Duration::from_secs(1));
                if h2.lock().unwrap().elapsed() > SILENT { w2.shutdown(); return; }
                if last.elapsed() >= PING { last = Instant::now(); if w2.write_all(b"{\"t\":\"ping\"}\n").is_err() { w2.shutdown(); return; } }
            }
        });
        loop {
            let v: Value = match crate::proto::read_json(r, (MAX_BODY as u64) * 2 + 4096) { Ok(v) => v, Err(e) => return e.to_string() };
            *heard.lock().unwrap() = Instant::now();
            match v["t"].as_str() {
                Some("ping") => {}
                Some("bye") => return v["why"].as_str().unwrap_or("closed by the server").to_string(),
                Some("frame") => {
                    let (kind, doc, from) = (v["kind"].as_str().unwrap_or(""), v["doc"].as_str().unwrap_or(""), v["from"].as_str().unwrap_or(""));
                    let (seq, n) = (v["seq"].as_u64().unwrap_or(0), v["n"].as_u64().unwrap_or(0));
                    if seq > *since { *since = seq; }
                    // never this device's own (reflected back), never one it saw already (played again)
                    if from == i.me { continue; }
                    // one that does not open (another key, tampered with) is dropped, not passed on
                    let Some(body) = v["body"].as_str().and_then(unhex).and_then(|b| i.key.open_frame(v["e"].as_u64().unwrap_or(0) as u32, v["l"].as_str().unwrap_or(""), &i.vault, kind, doc, from, n, &b).ok()) else { continue };
                    {
                        let mut last = i.last.lock().unwrap();
                        let seen = last.entry((from.into(), doc.into(), kind.into())).or_insert(0);
                        if n <= *seen { continue; }
                        *seen = n;
                    }
                    (i.on)(Event::Frame(Frame { seq, n, from: from.into(), kind: kind.into(), doc: doc.into(), body, list: v["l"].as_str().unwrap_or("").into() }));
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::vault::VaultKey;
    #[test]
    fn a_frame_opens_only_as_what_it_was_sealed_as() {
        let k = VaultKey::generate();
        let doc = "d".repeat(64);
        let sealed = k.seal_frame("0123456789abcdef", "update", &doc, "aaaaaaaaaaaaaaaa", 7, b"hello").unwrap();
        assert_eq!(k.open_frame("0123456789abcdef", "update", &doc, "aaaaaaaaaaaaaaaa", 7, &sealed).unwrap(), b"hello");
        // each bound part changed: refused
        assert!(k.open_frame("fedcba9876543210", "update", &doc, "aaaaaaaaaaaaaaaa", 7, &sealed).is_err(), "another vault");
        assert!(k.open_frame("0123456789abcdef", "awareness", &doc, "aaaaaaaaaaaaaaaa", 7, &sealed).is_err(), "another kind");
        assert!(k.open_frame("0123456789abcdef", "update", &"e".repeat(64), "aaaaaaaaaaaaaaaa", 7, &sealed).is_err(), "another doc");
        assert!(k.open_frame("0123456789abcdef", "update", &doc, "bbbbbbbbbbbbbbbb", 7, &sealed).is_err(), "another member");
        assert!(k.open_frame("0123456789abcdef", "update", &doc, "aaaaaaaaaaaaaaaa", 8, &sealed).is_err(), "another n");
        assert!(VaultKey::generate().open_frame("0123456789abcdef", "update", &doc, "aaaaaaaaaaaaaaaa", 7, &sealed).is_err(), "another key");
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(k.open_frame("0123456789abcdef", "update", &doc, "aaaaaaaaaaaaaaaa", 7, &bad).is_err(), "tampered");
    }
}
