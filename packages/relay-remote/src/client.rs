//! The app's side of a work machine: pairing once, then one TLS connection per request (proto.rs). Each call opens
//! its own connection, so a server that hangs costs that call its timeout and nothing else; on a LAN a handshake is
//! a few milliseconds.

use crate::broker::{self, Conn, Meta, Spec, Stop};
use crate::proto::{self, Info, PairLine, MAX_LINE, PROTO};
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
    pub fn call(&self, req: Value) -> Result<Value, String> {
        let (tx, rx) = mpsc::channel();
        let me = self.clone();
        std::thread::spawn(move || {
            let res = (|| {
                let (mut r, mut w) = me.open()?;
                proto::write_json(&mut w, &req).map_err(|e| e.to_string())?;
                let v = proto::read_json(&mut r, MAX_LINE).map_err(|e| e.to_string())?;
                w.shutdown();
                Ok::<Value, String>(v)
            })();
            tx.send(res).ok();
        });
        let v = rx.recv_timeout(ANSWER + CONNECT).map_err(|_| format!("{}: no answer", self.addr))??;
        if v["ok"] == true { Ok(v) } else { Err(v["error"].as_str().unwrap_or("refused").to_string()) }
    }

    pub fn info(&self) -> Result<Info, String> {
        let info: Info = serde_json::from_value(self.call(json!({"op": "info"}))?["info"].clone()).map_err(|e| e.to_string())?;
        if info.proto != PROTO { return Err(format!("relay-server {} speaks protocol {}, this Relay {PROTO}: update one of them", info.version, info.proto)); }
        Ok(info)
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
