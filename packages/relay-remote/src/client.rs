//! The app's side of a work machine: pairing once, then one TLS connection per request (proto.rs). Each call opens
//! its own connection, so a server that hangs costs that call its timeout and nothing else; on a LAN a handshake is
//! a few milliseconds.

use crate::broker::{self, Conn, Meta, Spec, Stop};
use crate::proto::{self, DeviceCode, Github, Info, PairLine, RepoStatus, Snapshot, MAX_REPLY, MAX_SESSION, PROTO};
use crate::share;
use crate::sync::{self, Manifest};
use crate::tls::{self, Identity};
use crate::vault::{self, SealedRemote, VaultKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc;
use std::time::Duration;

/// Connecting and the handshake; a work machine is in the LAN, so this is generous.
const CONNECT: Duration = Duration::from_secs(4);
/// A request's answer (history reads a transcript, which can take a moment).
const ANSWER: Duration = Duration::from_secs(10);

/// A paired machine: where it is and the certificate it must show. `link`: a phone's secret from the laptop's QR, to
/// sign what it sends to the laptop's shared conversations (share.rs); without one a phone cannot reach them.
#[derive(Clone)]
pub struct Client { pub addr: String, pub fp: String, id: Identity, link: Option<String> }

/// Join a shared vault with an invite link (docs/shared-vaults.md): connect pinned to the link's server with this
/// device's identity, prove the link's code, and unwrap the vault key the server kept for the invite with the link's
/// secret, which never went to the server. Returns the line, the vault and the role, and the key.
pub fn vault_join(line: &str, id: &Identity, name: &str) -> Result<(PairLine, Joined, VaultKey), String> {
    let l = PairLine::parse(line).filter(PairLine::is_invite).ok_or("not an invite link (relay://host:port#fp=…&vault=…&invite=…&secret=…)")?;
    let (vault, invite, secret) = (l.vault.clone().unwrap_or_default(), l.invite.clone().unwrap_or_default(), l.secret.clone().unwrap_or_default());
    let c = Client { addr: l.addr(), fp: l.fp.clone(), id: id.clone(), link: None };
    let proof = tls::proof(&l.code, &id.fingerprint(), &l.fp);
    let v = c.call(json!({"op": "vault_join", "vault": vault, "invite": invite, "name": name, "proof": proof}))?;
    let r: VaultRef = field(v.clone(), "vault")?;
    if r.id != vault { return Err("the server answered for another vault".into()); }
    let key = vault::unwrap(v["wrapped"].as_str().unwrap_or_default(), &secret, &vault)?;
    Ok((l, Joined { id: r.id, name: r.name, role: v["role"].as_str().unwrap_or_default().into() }, key))
}

/// A shared vault: its id (16 hex) and name.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct VaultRef { pub id: String, pub name: String }
/// A shared vault in full: its members and, for an admin, the invites still open.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct VaultInfo { pub id: String, pub name: String, pub role: String, pub members: Vec<Member>, pub invites: Vec<Invite> }
/// A device in a shared vault: its name, its certificate's fingerprint, its role and when it was added (unix seconds).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Member { pub name: String, pub fp: String, pub role: String, pub added: u64 }
/// An open invite: the role it gives and when it expires (unix seconds).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Invite { pub id: String, pub role: String, pub expires: u64 }
/// The vault an invite joined, and the role it gave.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Joined { pub id: String, pub name: String, pub role: String }

/// Pair with the line `relay-server pair` printed: connect, check the server's certificate against the line, prove
/// the code. Returns the line and what the server says about itself, for the settings.
pub fn pair(line: &str, id: &Identity, name: &str) -> Result<(PairLine, Info), String> {
    let l = PairLine::parse(line).ok_or("not a pairing line (relay://host:port#fp=…&code=…)")?;
    // an invite would burn one of the owner's pairing tries and answer with a meaningless error
    if l.is_invite() { return Err("this is an invite to a shared vault: use Join with a link under Settings › General › Shared vaults".into()); }
    let c = Client { addr: l.addr(), fp: l.fp.clone(), id: id.clone(), link: None };
    let proof = tls::proof(&l.code, &id.fingerprint(), &l.fp);
    c.call(json!({"op": "pair", "name": name, "proof": proof}))?;
    let info = c.info()?;
    Ok((l, info))
}

impl Client {
    pub fn new(host: &str, port: u16, fp: &str, id: Identity) -> Client { Client { addr: proto::addr(host, port), fp: fp.to_lowercase(), id, link: None } }
    pub fn with_link(self, link: Option<String>) -> Client { Client { link, ..self } }

    /// A request answered by the laptop of a shared conversation starts with its challenge instead of the answer:
    /// the request again, signed for that challenge (share.rs), and what signs this connection's next lines.
    fn sign(&self, challenge: &str, req: &Value, w: &mut tls::Writer) -> Result<share::Signer, String> {
        let link = self.link.as_deref().ok_or("this phone cannot reach the Mac's conversations yet: pair it again from the Mac (Settings › Machines › Add phone)")?;
        let mut s = share::Signer::new(&self.id, link, challenge, req["key"].as_str().unwrap_or(""))?;
        proto::write_json(w, &s.envelope(&req.to_string())).map_err(|e| e.to_string())?;
        Ok(s)
    }

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
                let mut v = proto::read_json(&mut r, MAX_REPLY).map_err(|e| e.to_string())?;
                if let Some(ch) = v["challenge"].as_str() {
                    me.sign(ch, &req, &mut w)?;
                    v = proto::read_json(&mut r, MAX_REPLY).map_err(|e| e.to_string())?;
                }
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
    /// Open a pairing for a device linked to this one (a phone): the code, for a line with the address that device
    /// reaches the server at. It works once, for 10 minutes; the device then shares this one's conversations.
    pub fn pair_device(&self) -> Result<String, String> {
        Ok(self.call(json!({"op": "pair_device"}))?["code"].as_str().unwrap_or_default().to_string())
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
    /// Send relay-server's binary of `version` there, with the release's `.sig` of it when there is one (a vault admin's
    /// update needs it): it checks it and goes on in it once it has answered.
    pub fn update(&self, version: &str, data: &[u8], signature: Option<&str>) -> Result<(), String> {
        let req = json!({"op": "update", "version": version, "sha256": crate::sync::sha256_hex(data), "signature": signature, "len": data.len()});
        self.call_bin(req, Some(data.to_vec()), None, Duration::from_secs(60)).map(|_| ())
    }
    // ---------- GitHub there (github.rs on the server): its token is sealed like the mirror, so it works once unlocked
    pub fn github(&self) -> Result<Github, String> { field(self.call(json!({"op": "github_status"}))?, "github") }
    /// Start a device flow there: the code for the user to type on GitHub. The server waits for GitHub itself.
    pub fn github_login(&self) -> Result<DeviceCode, String> { field(self.call(json!({"op": "github_login_start"}))?, "device") }
    /// Where the device flow stands: `pending` until the code is typed, then `on` (or `expired`, `denied`, `error`).
    pub fn github_poll(&self) -> Result<Github, String> { field(self.call(json!({"op": "github_login_poll"}))?, "github") }
    pub fn github_logout(&self) -> Result<(), String> { self.call(json!({"op": "github_logout"})).map(|_| ()) }
    pub fn repos(&self) -> Result<Vec<RepoStatus>, String> { field(self.call(json!({"op": "repos"}))?, "repos") }
    /// `owner/repo` cloned there (a fetch when it is there already). A clone may take minutes.
    pub fn repo_ensure(&self, repo: &str) -> Result<RepoStatus, String> { self.slow(json!({"op": "repo_ensure", "repo": repo}), "repo") }
    /// Push the branch checked out in the repo folder `name`.
    pub fn repo_push(&self, name: &str) -> Result<RepoStatus, String> { self.slow(json!({"op": "repo_push", "name": name}), "repo") }
    /// The work in `name` (commits, changes, new files) as one commit, force-pushed to `branch` (`relay/…`); the
    /// working tree and index there stay as they are.
    pub fn repo_snapshot(&self, name: &str, branch: &str) -> Result<Snapshot, String> {
        self.slow(json!({"op": "repo_snapshot", "name": name, "branch": branch}), "snapshot")
    }
    fn slow<T: serde::de::DeserializeOwned>(&self, req: Value, key: &str) -> Result<T, String> {
        field(self.call_bin(req, None, None, Duration::from_secs(300))?.0, key)
    }

    /// One mirrored folder there, as the other side of a sync round.
    pub fn root(&self, root: &str) -> RemoteRoot { RemoteRoot { c: self.clone(), root: root.into() } }

    // ---------- shared vaults there (docs/shared-vaults.md): ciphertext only, the key stays with the members
    /// A new shared vault there, with this device as its admin.
    pub fn vault_create(&self, name: &str) -> Result<VaultRef, String> { field(self.call(json!({"op": "vault_create", "name": name}))?, "vault") }
    pub fn vault_info(&self, vault: &str) -> Result<VaultInfo, String> { field(self.call(json!({"op": "vault_info", "vault": vault}))?, "vault") }
    /// An invite to `vault` with `role` (`admin` or `member`): the link to hand over, for the server at `host:port` as the
    /// other device reaches it. The vault key goes to the server wrapped under a fresh secret that only the link holds.
    pub fn vault_invite(&self, vault: &str, role: &str, key: &VaultKey, host: &str, port: u16) -> Result<(String, Invite), String> {
        let secret = tls::random_key();
        let v = self.call(json!({"op": "vault_invite", "vault": vault, "role": role, "wrapped": vault::wrap(key, &secret, vault)?}))?;
        // the link pins the certificate this connection checked
        let inv = &v["invite"];
        let s = |k: &str| inv[k].as_str().map(String::from);
        let l = PairLine { host: host.into(), port, fp: self.fp.clone(), code: s("code").unwrap_or_default(), vault: Some(vault.into()), invite: s("id"), secret: Some(secret), ..Default::default() };
        // parsed back, so a malformed id or code from the server never makes a link that cannot be joined
        let line = l.format();
        PairLine::parse(&line).filter(|p| p.is_invite() && *p == l).ok_or("the server's invite is malformed")?;
        Ok((line, Invite { id: s("id").unwrap_or_default(), role: role.into(), expires: inv["expires"].as_u64().unwrap_or_default() }))
    }
    pub fn vault_invite_revoke(&self, vault: &str, invite: &str) -> Result<(), String> {
        self.call(json!({"op": "vault_invite_revoke", "vault": vault, "invite": invite})).map(|_| ())
    }
    /// Take the device `fp` out of `vault` (an admin), or leave it (`fp` this device's own).
    pub fn vault_remove(&self, vault: &str, fp: &str) -> Result<(), String> { self.call(json!({"op": "vault_remove", "vault": vault, "fp": fp})).map(|_| ()) }
    /// A shared vault there, as the other side of a sync round. A record (up to 64 MiB) or a manifest after a restart
    /// there (every record hashed again) comes back with no body to size the wait by, so those two wait `longer`, as
    /// long as `slow`: the usual wait fails them every round over a slow link. A put's wait already grows with its body.
    pub fn sealed(&self, vault: &str, key: VaultKey) -> SealedRemote {
        let c = self.clone();
        SealedRemote::new(vault, key, Box::new(move |req, body, want| {
            let longer = if matches!(req["op"].as_str(), Some("vault_get" | "vault_manifest")) { Duration::from_secs(300) } else { Duration::ZERO };
            c.call_bin(req, body, want, longer)
        }))
    }

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
    /// The same with each one's Claude session id where the server saw it: (metas, key -> session id).
    pub fn list_sessions(&self) -> Result<(Vec<Meta>, std::collections::HashMap<String, String>), String> {
        self.list_named().map(|(m, s, _)| (m, s))
    }
    /// The same with each one's title too, the first thing said in it (key -> title), where the server saw it.
    pub fn list_named(&self) -> Result<(Vec<Meta>, std::collections::HashMap<String, String>, std::collections::HashMap<String, String>), String> {
        self.listing().map(|(m, s, t, _)| (m, s, t))
    }
    /// The same, and for a phone the conversations among them that run on its laptop (shared from there, share.rs).
    #[allow(clippy::type_complexity)]
    pub fn listing(&self) -> Result<(Vec<Meta>, std::collections::HashMap<String, String>, std::collections::HashMap<String, String>, Vec<String>), String> {
        let v = self.call(json!({"op": "list"}))?;
        let metas = serde_json::from_value(v["metas"].clone()).map_err(|e| e.to_string())?;
        Ok((metas, serde_json::from_value(v["sids"].clone()).unwrap_or_default(), serde_json::from_value(v["titles"].clone()).unwrap_or_default(),
            serde_json::from_value(v["shared"].clone()).unwrap_or_default()))
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
    /// A shared conversation's messages, from its laptop: (items, next offset).
    pub fn history_key(&self, key: &str) -> Result<(Value, u64), String> {
        let v = self.call(json!({"op": "history", "key": key}))?;
        Ok((v["items"].clone(), v["next"].as_u64().unwrap_or(0)))
    }
    pub fn is_dir(&self, path: &str) -> Result<bool, String> { Ok(self.call(json!({"op": "exists", "path": path}))?["dir"] == true) }

    /// Start a broker there for `spec` and connect to it: the same Conn a local broker gives, its agent stopped
    /// through the server.
    pub fn launch(&self, meta: &Meta, spec: &Spec) -> Result<Conn, String> {
        self.stream(json!({"op": "launch", "meta": meta, "spec": spec}), &meta.key)?.ok_or_else(|| "relay-server: no broker".into())
    }
    /// How this Mac starts Claude there, for a phone that starts conversations while this Mac is closed: its Claude
    /// settings (`opts`) and the mirror's flags (`args`, `env`).
    pub fn profile_put(&self, profile: &Value) -> Result<(), String> { self.call(json!({"op": "profile_put", "profile": profile})).map(|_| ()) }
    /// Start a Claude conversation there, built by the server from the laptop's profile, in the mirrored vault.
    pub fn start(&self, key: &str, name: &str, model: &str, effort: &str, resume: Option<&str>) -> Result<Conn, String> {
        self.stream(json!({"op": "start", "key": key, "name": name, "model": model, "effort": effort, "resume": resume}), key)?.ok_or_else(|| "relay-server: no broker".into())
    }
    /// Offer this laptop's shared conversations to its phone there (`convs`: [{key, title, provider}]). The connection
    /// stays open: the server writes `{"open": token}` on it for each request of the phone, answered with share_open.
    pub fn share(&self, convs: &Value) -> Result<(BufReader<tls::Reader>, tls::Writer), String> {
        let (mut r, mut w) = self.open()?;
        proto::write_json(&mut w, &json!({"op": "share", "convs": convs})).map_err(|e| e.to_string())?;
        let v = proto::read_json(&mut r, MAX_REPLY).map_err(|e| e.to_string())?;
        if v["ok"] != true { return Err(v["error"].as_str().unwrap_or("refused").to_string()); }
        Ok((r, w))
    }
    /// The connection for one request of the phone (share::serve): the server passes it through from here.
    pub fn share_open(&self, token: &str) -> Result<(BufReader<tls::Reader>, tls::Writer), String> {
        let (r, mut w) = self.open()?;
        proto::write_json(&mut w, &json!({"op": "share_open", "token": token})).map_err(|e| e.to_string())?;
        Ok((r, w))
    }
    /// Take back a conversation whose broker runs there. None when there is none any more.
    pub fn attach(&self, key: &str) -> Result<Option<Conn>, String> { self.stream(json!({"op": "attach", "key": key}), key) }

    fn stream(&self, req: Value, key: &str) -> Result<Option<Conn>, String> {
        let (mut r, mut w) = self.open()?;
        proto::write_json(&mut w, &req).map_err(|e| e.to_string())?;
        // a shared conversation of the laptop: a challenge first, then every line to it signed
        let mut first = String::new();
        r.read_line(&mut first).map_err(|e| e.to_string())?;
        let challenge = serde_json::from_str::<Value>(&first).ok().and_then(|v| v["challenge"].as_str().map(String::from));
        let (stdin, frames): (Box<dyn std::io::Write + Send>, Box<dyn BufRead + Send>) = match challenge {
            Some(ch) => { let s = self.sign(&ch, &req, &mut w)?; (Box::new(share::SignedLines::new(w, s)), Box::new(r)) }
            None => (Box::new(w), Box::new(BufReader::new(std::io::Cursor::new(first).chain(r)))),
        };
        // this device's own id at the broker: the laptop and its phone each get what they missed
        match broker::open(stdin, frames, &self.id.fingerprint()[..16]).map_err(|e| e.to_string())? {
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
    fn put(&self, path: &str, data: &[u8], mtime: i64, expect: &str) -> Result<(), String> {
        self.c.call_bin(json!({"op": "sync_put", "root": self.root, "path": path, "len": data.len(), "mtime": mtime, "expect": expect}), Some(data.to_vec()), None, Duration::ZERO).map(|_| ())
    }
    fn put_many(&self, files: &[(String, Vec<u8>, i64, String)]) -> Result<Vec<Option<String>>, String> {
        let head: Vec<Value> = files.iter().map(|(p, d, m, x)| json!({"path": p, "len": d.len(), "mtime": m, "expect": x})).collect();
        let body: Vec<u8> = files.iter().flat_map(|(_, d, ..)| d.iter().copied()).collect();
        let (v, _) = self.c.call_bin(json!({"op": "sync_put_many", "root": self.root, "files": head}), Some(body), None, Duration::ZERO)?;
        Ok(files.iter().map(|(p, ..)| v["errors"][p].as_str().map(String::from)).collect())
    }
    fn delete(&self, path: &str, hash: &str) -> Result<(), String> {
        self.c.call(json!({"op": "sync_delete", "root": self.root, "path": path, "hash": hash})).map(|_| ())
    }
}

/// A reply's `key`, as T.
fn field<T: serde::de::DeserializeOwned>(v: Value, key: &str) -> Result<T, String> { serde_json::from_value(v[key].clone()).map_err(|e| format!("{key}: {e}")) }
