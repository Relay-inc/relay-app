//! The app's side of a work machine: pairing once, then one TLS connection per request (proto.rs). Each call opens
//! its own connection, so a server that hangs costs that call its timeout and nothing else; on a LAN a handshake is
//! a few milliseconds.

use crate::broker::{self, Conn, Meta, Spec, Stop};
use crate::proto::{self, Info, PairLine, MAX_REPLY, MAX_SESSION, PROTO};
use crate::sync::{self, Manifest};
use crate::tls::{self, Identity};
use serde_json::{json, Value};
use std::io::BufReader;
use std::sync::mpsc;
use std::time::Duration;

/// Connecting and the handshake; a work machine is in the LAN, so this is generous.
const CONNECT: Duration = Duration::from_secs(4);
/// A request's answer (history reads a transcript, which can take a moment).
const ANSWER: Duration = Duration::from_secs(10);

/// A paired machine: where it is and the certificate it must show.
#[derive(Clone)]
pub struct Client { pub addr: String, pub fp: String, id: Identity }

/// Pair with the line `relay-server pair` printed: connect, check the server's certificate against the line, prove
/// the code. Returns the line and what the server says about itself, for the settings.
pub fn pair(line: &str, id: &Identity, name: &str) -> Result<(PairLine, Info), String> {
    let l = PairLine::parse(line).ok_or("not a pairing line (relay://host:port#fp=…&code=…)")?;
    let c = Client { addr: l.addr(), fp: l.fp.clone(), id: id.clone() };
    let proof = tls::proof(&l.code, &id.fingerprint(), &l.fp);
    c.call(json!({"op": "pair", "name": name, "proof": proof}))?;
    let info = c.info()?;
    Ok((l, info))
}

impl Client {
    pub fn new(host: &str, port: u16, fp: &str, id: Identity) -> Client { Client { addr: proto::addr(host, port), fp: fp.to_lowercase(), id } }

    fn open(&self) -> Result<(BufReader<tls::Reader>, tls::Writer), String> {
        let d = tls::connect(&self.addr, &self.id, &self.fp, CONNECT).map_err(|e| format!("{}: {e}", self.addr))?;
        let (r, w) = d.split();
        Ok((BufReader::new(r), w))
    }

    /// One request and its answer, given up after ANSWER. The work runs on its own thread so a hung server never
    /// holds the caller longer than that.
    pub fn call(&self, req: Value) -> Result<Value, String> { self.call_bin(req, None, None, Duration::ZERO).map(|(v, _)| v) }
    /// The same with raw bytes: `body` sent after the request line (`sync_put`), or the reply's `len` bytes read after
    /// its line, at most `want_body` (`sync_get`). Files take longer than a request, so the wait grows with their size.
    /// `longer`: on top of the usual wait, for a request that is slow there.
    fn call_bin(&self, req: Value, body: Option<Vec<u8>>, want_body: Option<u64>, longer: Duration) -> Result<(Value, Vec<u8>), String> {
        let (tx, rx) = mpsc::channel();
        let me = self.clone();
        let wait = ANSWER + CONNECT + longer + Duration::from_secs(body.as_ref().map_or(0, |b| b.len() as u64 >> 20));
        std::thread::spawn(move || {
            let res = (|| {
                let (mut r, mut w) = me.open()?;
                proto::write_json(&mut w, &req).map_err(|e| e.to_string())?;
                if let Some(b) = &body { std::io::Write::write_all(&mut w, b).map_err(|e| e.to_string())?; }
                let v = proto::read_json(&mut r, MAX_REPLY).map_err(|e| e.to_string())?;
                let data = match want_body { Some(max) if v["ok"] == true => proto::read_body(&mut r, v["len"].as_u64().unwrap_or(0), max).map_err(|e| e.to_string())?, _ => vec![] };
                w.shutdown();
                Ok::<(Value, Vec<u8>), String>((v, data))
            })();
            tx.send(res).ok();
        });
        let (v, data) = rx.recv_timeout(wait).map_err(|_| format!("{}: no answer", self.addr))??;
        if v["ok"] == true { Ok((v, data)) } else { Err(v["error"].as_str().unwrap_or("refused").to_string()) }
    }

    // ---------- the mirror (relay-server mirror.rs): this device's copies there, sealed with a key only it holds
    /// The first unlock of a big mirror converts or unpacks thousands of files there: it may take a minute.
    pub fn unlock(&self, key_hex: &str) -> Result<(), String> {
        self.call_bin(json!({"op": "unlock", "key": key_hex}), None, None, Duration::from_secs(120)).map(|_| ())
    }
    pub fn wipe(&self) -> Result<(), String> { self.call(json!({"op": "wipe"})).map(|_| ()) }
    /// A Claude session's transcript there, to move its conversation to another place.
    pub fn session_get(&self, sid: &str) -> Result<Vec<u8>, String> {
        self.call_bin(json!({"op": "session_get", "sid": sid}), None, Some(MAX_SESSION), Duration::ZERO).map(|(_, b)| b)
    }
    /// Put a session's transcript there, for a conversation that moves there and goes on in `cwd`.
    pub fn session_put(&self, sid: &str, cwd: &str, data: &[u8]) -> Result<(), String> {
        self.call_bin(json!({"op": "session_put", "sid": sid, "cwd": cwd, "len": data.len()}), Some(data.to_vec()), None, Duration::ZERO).map(|_| ())
    }
    /// One mirrored folder there, as the other side of a sync round.
    pub fn root(&self, root: &str) -> RemoteRoot { RemoteRoot { c: self.clone(), root: root.into() } }

    pub fn info(&self) -> Result<Info, String> {
        let info = self.info_any()?;
        if info.proto != PROTO { return Err(format!("relay-server {} speaks protocol {}, this Relay {PROTO}: update one of them", info.version, info.proto)); }
        Ok(info)
    }
    /// What the server says about itself, also when it speaks another protocol (to say which side to update).
    pub fn info_any(&self) -> Result<Info, String> {
        serde_json::from_value(self.call(json!({"op": "info"}))?["info"].clone()).map_err(|e| e.to_string())
    }
    /// The brokers that run there, to take their conversations back after the app restarts.
    pub fn list(&self) -> Result<Vec<Meta>, String> {
        serde_json::from_value(self.call(json!({"op": "list"}))?["metas"].clone()).map_err(|e| e.to_string())
    }
    pub fn kill(&self, key: &str, pid: u32) -> Result<(), String> { self.call(json!({"op": "kill", "key": key, "pid": pid})).map(|_| ()) }
    pub fn pending(&self) -> Result<Vec<Value>, String> {
        Ok(self.call(json!({"op": "pending"}))?["pending"].as_array().cloned().unwrap_or_default())
    }
    pub fn answer(&self, id: &str, decision: &Value) -> Result<(), String> { self.call(json!({"op": "answer", "id": id, "decision": decision})).map(|_| ()) }
    /// A Claude session's messages there, from byte offset `from`: (items, next offset).
    pub fn history(&self, sid: &str, from: u64, cwd: &str) -> Result<(Value, u64), String> {
        let v = self.call(json!({"op": "history", "sid": sid, "from": from, "cwd": cwd}))?;
        Ok((v["items"].clone(), v["next"].as_u64().unwrap_or(0)))
    }
    pub fn is_dir(&self, path: &str) -> Result<bool, String> { Ok(self.call(json!({"op": "exists", "path": path}))?["dir"] == true) }

    /// Start a broker there for `spec` and connect to it: the same Conn a local broker gives, its agent stopped
    /// through the server.
    pub fn launch(&self, meta: &Meta, spec: &Spec) -> Result<Conn, String> {
        self.stream(json!({"op": "launch", "meta": meta, "spec": spec}), &meta.key)?.ok_or_else(|| "relay-server: no broker".into())
    }
    /// Take back a conversation whose broker runs there. None when there is none any more.
    pub fn attach(&self, key: &str) -> Result<Option<Conn>, String> { self.stream(json!({"op": "attach", "key": key}), key) }

    fn stream(&self, req: Value, key: &str) -> Result<Option<Conn>, String> {
        let (r, mut w) = self.open()?;
        proto::write_json(&mut w, &req).map_err(|e| e.to_string())?;
        match broker::open(Box::new(w), Box::new(r)).map_err(|e| e.to_string())? {
            Ok(mut c) => { c.agent = broker::Agent::remote(c.agent.id(), self.stop(key)); Ok(Some(c)) }
            Err(e) if e == "gone" => Ok(None),
            Err(e) => Err(e),
        }
    }
    fn stop(&self, key: &str) -> Stop {
        let (me, key) = (self.clone(), key.to_string());
        std::sync::Arc::new(move |pid| me.kill(&key, pid).map_err(std::io::Error::other))
    }
}

/// A mirrored folder on the server, for sync::run.
pub struct RemoteRoot { c: Client, root: String }
impl sync::Remote for RemoteRoot {
    fn manifest(&self) -> Result<Manifest, String> {
        serde_json::from_value(self.c.call(json!({"op": "sync_manifest", "root": self.root}))?["manifest"].clone()).map_err(|e| e.to_string())
    }
    fn get(&self, path: &str) -> Result<Vec<u8>, String> {
        self.c.call_bin(json!({"op": "sync_get", "root": self.root, "path": path}), None, Some(MAX_REPLY), Duration::ZERO).map(|(_, b)| b)
    }
    fn put(&self, path: &str, data: &[u8], mtime: i64) -> Result<(), String> {
        self.c.call_bin(json!({"op": "sync_put", "root": self.root, "path": path, "len": data.len(), "mtime": mtime}), Some(data.to_vec()), None, Duration::ZERO).map(|_| ())
    }
    fn put_many(&self, files: &[(String, Vec<u8>, i64)]) -> Result<Vec<Option<String>>, String> {
        let head: Vec<Value> = files.iter().map(|(p, d, m)| json!({"path": p, "len": d.len(), "mtime": m})).collect();
        let body: Vec<u8> = files.iter().flat_map(|(_, d, _)| d.iter().copied()).collect();
        let (v, _) = self.c.call_bin(json!({"op": "sync_put_many", "root": self.root, "files": head}), Some(body), None, Duration::ZERO)?;
        Ok(files.iter().map(|(p, ..)| v["errors"][p].as_str().map(String::from)).collect())
    }
    fn delete(&self, path: &str, hash: &str) -> Result<(), String> {
        self.c.call(json!({"op": "sync_delete", "root": self.root, "path": path, "hash": hash})).map(|_| ())
    }
}
