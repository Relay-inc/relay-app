// The app's side of relay-serve (serve.rs). A conversation on the server is made to look like a local broker
// connection (broker::Conn): frames come out of one end of a socket pair, stdin lines go into it, and two threads
// carry them over TCP. So the app reads and writes a server conversation the way it does a local one.
//
// The TCP connection may drop (laptop asleep, server rebooting, Wi-Fi). The frames thread then reconnects with
// backoff and reattaches from the frame after the last one it passed on, so the app neither misses nor repeats a
// frame; lines typed meanwhile wait. When the server no longer runs the conversation (relay-serve restarted after
// the agent ended), the app gets an exit frame. The threads stop once the app drops the conversation.

use crate::broker::{Agent, Conn};
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::Duration;

/// Where relay-serve listens, and its token.
#[derive(Clone)]
pub struct Server { pub addr: String, pub token: String }

/// The live connection of one server conversation, held by the app's Agent; `w` is None while reconnecting.
pub struct Link { key: String, w: Mutex<Option<TcpStream>> }
impl Link {
    fn send(&self, mut v: Value) -> io::Result<()> {
        v["id"] = json!(0);
        let mut w = self.w.lock().unwrap();
        let s = w.as_mut().ok_or_else(|| io::Error::from(io::ErrorKind::NotConnected))?;
        writeln!(s, "{v}").and_then(|_| s.flush())
    }
    pub fn kill(&self) -> io::Result<()> { self.send(json!({"cmd": "kill", "key": self.key})) }
}

type Dial = (TcpStream, BufReader<TcpStream>);
/// A connection that said hello, and the server's epoch (a new one each time relay-serve starts).
fn dial(s: &Server) -> Result<(Dial, u64), String> {
    let addr = s.addr.to_socket_addrs().map_err(|e| format!("{}: {e}", s.addr))?.next().ok_or_else(|| format!("{}: no address", s.addr))?;
    let w = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|e| format!("{}: {e}", s.addr))?;
    // relay-serve pings every 20 s: a minute of silence is a dead connection (a laptop that slept)
    w.set_read_timeout(Some(Duration::from_secs(60))).ok();
    let mut d = (w.try_clone().map_err(|e| e.to_string())?, BufReader::new(w));
    let epoch = request(&mut d, json!({"cmd": "hello", "token": s.token}))?["epoch"].as_u64().unwrap_or(0);
    Ok((d, epoch))
}
/// One request on a connection, its answer; frames that arrive in between are skipped.
fn request(d: &mut Dial, mut v: Value) -> Result<Value, String> {
    v["id"] = json!(1);
    writeln!(d.0, "{v}").and_then(|_| d.0.flush()).map_err(|e| e.to_string())?;
    loop {
        let mut l = String::new();
        if d.1.read_line(&mut l).map_err(|e| e.to_string())? == 0 { return Err("connection closed".into()); }
        let r: Value = serde_json::from_str(&l).map_err(|e| e.to_string())?;
        if r["id"] == 1 { return if r["ok"] == true { Ok(r["result"].clone()) } else { Err(r["error"].as_str().unwrap_or("error").to_string()) }; }
    }
}

/// One request on its own connection: hello (status), pending, answer, history, subagents, commands.
pub fn call(s: &Server, v: Value) -> Result<Value, String> {
    let (mut d, _) = dial(s)?;
    if v["cmd"] == "hello" { return request(&mut d, json!({"cmd": "hello", "token": s.token})); }
    request(&mut d, v)
}

/// Start a conversation on the server (`spawn`: the spawn request without cmd and key) or take back the one it
/// runs under `key`. The first `backlog` frames of a taken-back conversation are what it buffered.
pub fn open(s: &Server, key: &str, spawn: Option<Value>) -> Result<Conn, String> {
    let (mut d, epoch) = dial(s)?;
    let fresh = spawn.is_some();
    let pid = match spawn {
        Some(mut v) => { v["cmd"] = json!("spawn"); v["key"] = json!(key); request(&mut d, v)?["pid"].as_u64().unwrap_or(0) }
        None => request(&mut d, json!({"cmd": "running"}))?.as_array().into_iter().flatten()
            .find(|c| c["key"] == key && c["done"] != true).and_then(|c| c["pid"].as_u64()).ok_or("not running")?,
    } as u32;
    let a = request(&mut d, json!({"cmd": "attach", "key": key, "from": 0}))?;
    let backlog = if fresh { 0 } else { a["replay"].as_u64().unwrap_or(0) as usize };
    let (app, bridge) = UnixStream::pair().map_err(|e| e.to_string())?;
    let link = Arc::new(Link { key: key.into(), w: Mutex::new(Some(d.0.try_clone().map_err(|e| e.to_string())?)) });
    let (out, inp) = (bridge.try_clone().map_err(|e| e.to_string())?, bridge);
    frames(s.clone(), key.into(), epoch, Arc::downgrade(&link), d.1, out);
    stdin(key.into(), Arc::downgrade(&link), inp);
    Ok(Conn { agent: Agent::remote(pid, link), stdin: app.try_clone().map_err(|e| e.to_string())?, frames: BufReader::new(app), backlog })
}

// server -> app: each frame of this conversation as the broker's line; reconnect from the next seq when TCP drops
fn frames(s: Server, key: String, mut epoch: u64, link: Weak<Link>, mut r: BufReader<TcpStream>, mut out: UnixStream) {
    thread::spawn(move || {
        let mut next = 0u64;
        loop {
            let mut l = String::new();
            while r.read_line(&mut l).is_ok_and(|n| n > 0) {
                let v: Value = serde_json::from_str(&l).unwrap_or_default();
                l.clear();
                if v["ev"] != "frame" || v["key"] != key.as_str() { continue; }
                let (seq, f) = (v["seq"].as_u64().unwrap_or(0), v["f"].as_str().unwrap_or(""));
                if seq < next { continue; }
                next = seq + 1;
                if writeln!(out, "{f}").is_err() || f.starts_with('x') { return; }
            }
            // dropped: reconnect until it works, the server says the conversation is gone, or the app let go of it
            let mut wait = 1;
            loop {
                let Some(l) = link.upgrade() else { return };
                *l.w.lock().unwrap() = None;
                drop(l);
                thread::sleep(Duration::from_secs(wait));
                wait = (wait * 2).min(30);
                let Ok((mut d, e)) = dial(&s) else { continue };
                // relay-serve restarted: it counts from 0 again, and what it has is what the app did not see yet
                if e != epoch { (epoch, next) = (e, 0); }
                match request(&mut d, json!({"cmd": "attach", "key": key, "from": next})) {
                    Ok(_) => {
                                            let Some(l) = link.upgrade() else { return };
                        *l.w.lock().unwrap() = d.0.try_clone().ok();
                        r = d.1;
                        break;
                    }
                    Err(e) if e == "not running" => { writeln!(out, "x gone").ok(); return; }
                    Err(_) => {}
                }
            }
        }
    });
}

// app -> server: each stdin line as `input`, held back while reconnecting
fn stdin(key: String, link: Weak<Link>, inp: UnixStream) {
    thread::spawn(move || {
        for line in BufReader::new(inp).lines().map_while(Result::ok) {
            loop {
                let Some(l) = link.upgrade() else { return };
                if l.send(json!({"cmd": "input", "key": key, "line": line})).is_ok() { break; }
                drop(l);
                thread::sleep(Duration::from_millis(500));
            }
        }
    });
}
