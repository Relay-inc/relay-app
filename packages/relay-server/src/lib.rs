//! relay-server: runs Relay's agent conversations on a machine in the LAN, so they keep going while the laptop is
//! closed. The app reaches it over mutual TLS with pinned certificates (relay_remote::tls): a device whose
//! certificate is not in clients.json fails in the handshake, before a byte of a request is read. A device pairs once
//! with the code `relay-server pair` prints (10 minutes, one use, 5 tries).
//!
//! The server stays dumb: the app builds each agent's command with this machine's paths (Info) and sends it; the
//! server starts a broker for it, the same one the app uses locally, and passes the broker's frames through. The
//! agents' permission requests travel over their own pipe to the app (agent-claude's permission.rs); the cards in this
//! machine's pending folder, from before that, are listed and answered on request.
//!
//! Shared vaults (vaults.rs) live here too, as ciphertext only: a device that joined one through an invite link is a
//! vault-only client, it may only work with its vaults.
//!
//! Files in the data folder: identity.{crt,key}.der, clients.json, pairing.json (while a code is open), serve.json (the
//! port the running server listens on), pending/, per device its sealed mirror and GitHub token (mirror/<device>/), and
//! per shared vault its members, invites and records (vaults/<id>/).

pub mod cli;
pub mod github;
pub mod mirror;
#[cfg(target_os = "macos")]
pub mod ramdisk;
pub mod upgrade;
pub mod vaults;

use relay_remote::broker::{self, Meta, Spec};
use relay_remote::proto::{self, Info, MAX_LINE, MAX_SESSION, PROTO};
use relay_remote::tls::{self, Acceptor, Identity};
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fs, thread};

/// How long a pairing code stays open, and how many wrong proofs it takes.
const PAIR_SECS: u64 = 600;
const PAIR_TRIES: u32 = 5;
const HANDSHAKE: Duration = Duration::from_secs(10);
/// A broker here keeps its agent this long without the app (the app's own brokers: 15 minutes). A turn always
/// finishes; this is how long an idle conversation keeps its process for the next message.
pub const GRACE_SECS: u64 = 24 * 3600;

pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

/// The data folder: RELAY_SERVER_DATA, else the platform's application data folder.
pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("RELAY_SERVER_DATA") { return d.into(); }
    let home = std::env::var("HOME").unwrap_or_default();
    if cfg!(target_os = "macos") { return PathBuf::from(home).join("Library/Application Support/relay-server"); }
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(&home).join(".local/share")).join("relay-server")
}

/// The brokers' folder and grace, set for this process before any thread starts, so the brokers it spawns inherit
/// them and an app on the same machine never sees them.
pub fn set_broker_env() {
    if std::env::var_os("RELAY_AGENTS_DIR").is_none() { std::env::set_var("RELAY_AGENTS_DIR", std::env::temp_dir().join("relay-server-agents")); }
    if std::env::var_os("RELAY_BROKER_GRACE_SECS").is_none() { std::env::set_var("RELAY_BROKER_GRACE_SECS", GRACE_SECS.to_string()); }
}

pub fn identity(data: &Path) -> io::Result<Identity> { Identity::load_or_create(data, "identity") }

// ---------- clients and pairing

/// A paired device. `parent`: a linked device (a phone), paired through the device it belongs to; it shares that
/// device's conversations, cards and mirror, may only work with conversations (LINKED_OPS), and goes when that one does.
/// `vaults_only`: a device that came in through a shared vault's invite, not a pairing code (VAULT_OPS).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Client { pub name: String, pub fp: String, pub added: u64, #[serde(default, skip_serializing_if = "Option::is_none")] pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")] pub vaults_only: bool }

/// What a linked device may ask: its conversations and their cards, and opening the mirror with the key it was given.
/// Not the mirror's files, moving sessions, updating the server or pairing further devices.
const LINKED_OPS: &[&str] = &["info", "unlock", "list", "kill", "pending", "answer", "history", "exists", "launch", "attach", "start"];
/// What a vault-only device may ask: its shared vaults, nothing else. It never runs agents, reads a mirror or pairs
/// further devices, and makes no vaults of its own.
const VAULT_OPS: &[&str] = &["info", "vault_list", "vault_info", "vault_invite", "vault_invite_revoke", "vault_join", "vault_remove", "vault_manifest",
    "vault_get", "vault_put", "vault_put_many", "vault_delete"];
/// Held around every read-modify-write of clients.json in this process (pair, a vault's join and leave).
static CLIENTS: Mutex<()> = Mutex::new(());

pub fn clients(data: &Path) -> Vec<Client> {
    fs::read_to_string(data.join("clients.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn save_clients(data: &Path, c: &[Client]) -> io::Result<()> { write_private(&data.join("clients.json"), &serde_json::to_string_pretty(c).unwrap()) }
/// Remove the clients whose name is `who`, or whose fingerprint starts with it (at least 8 characters), and the devices
/// linked to them, with their memberships of shared vaults. Returns them.
pub fn revoke(data: &Path, who: &str) -> io::Result<Vec<Client>> {
    let who = who.trim();
    let all = clients(data);
    let hit: Vec<String> = all.iter().filter(|c| c.name == who || (who.len() >= 8 && c.fp.starts_with(&who.to_lowercase()))).map(|c| c.fp.clone()).collect();
    let (gone, keep): (Vec<Client>, Vec<Client>) = all.into_iter().partition(|c| hit.contains(&c.fp) || c.parent.as_ref().is_some_and(|p| hit.contains(p)));
    if !gone.is_empty() { save_clients(data, &keep)?; }
    vaults::forget(data, &gone.iter().map(|c| c.fp.clone()).collect::<Vec<_>>());
    // a revoked device's mirror goes too (a linked one has none of its own); a running server also drops its key and
    // working copy (see Server::run)
    for c in gone.iter().filter(|c| c.parent.is_none()) { fs::remove_dir_all(data.join("mirror").join(&c.fp[..16])).ok(); }
    Ok(gone)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Pairing { secret: String, expires: u64, #[serde(default)] fails: u32, #[serde(default)] parent: Option<String> }
fn pairing(data: &Path) -> Option<Pairing> {
    let p: Pairing = serde_json::from_str(&fs::read_to_string(data.join("pairing.json")).ok()?).ok()?;
    (p.expires > now() && p.fails < PAIR_TRIES).then_some(p)
}
/// Open a pairing: a fresh code, PAIR_SECS long, replacing any earlier one. Returns the code.
pub fn open_pairing(data: &Path) -> io::Result<String> { open_pairing_for(data, None) }
/// The same, for a device linked to `parent` (pair_device): the device that pairs with it gets that parent.
fn open_pairing_for(data: &Path, parent: Option<&str>) -> io::Result<String> {
    let secret = tls::random_secret();
    write_private(&data.join("pairing.json"), &json!({"secret": secret, "expires": now() + PAIR_SECS, "parent": parent}).to_string())?;
    Ok(secret)
}

pub(crate) fn write_private(path: &Path, text: &str) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(d) = path.parent() { fs::create_dir_all(d)?; }
    let tmp = path.with_extension("tmp");
    let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
    f.write_all(text.as_bytes())?;
    fs::rename(tmp, path)
}

// ---------- this machine, as the app needs it to build commands

pub fn login_path() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let out = std::process::Command::new(&shell).args(["-lc", "printf %s \"$PATH\""]).stdin(std::process::Stdio::null()).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|p| !p.is_empty());
    let path = out.or_else(|| std::env::var("PATH").ok()).unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".into());
    // `claude` installs itself in ~/.local/bin, which a non-interactive login shell does not always have
    let local = format!("{}/.local/bin", std::env::var("HOME").unwrap_or_default());
    if path.split(':').any(|d| d == local) { path } else { format!("{local}:{path}") }
}
fn hostname() -> String {
    // /etc/hostname on Linux (a slim install has no `hostname`), the command on a Mac
    fs::read_to_string("/etc/hostname").ok().map(|h| h.trim().to_string()).filter(|h| !h.is_empty())
        .or_else(|| std::process::Command::new("hostname").arg("-s").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|h| !h.is_empty()))
        .unwrap_or_else(|| "relay-server".into())
}
pub fn info(data: &Path, path: &str) -> Info {
    let home = std::env::var("HOME").unwrap_or_default();
    let claude = std::env::var("RELAY_CLAUDE").ok().filter(|c| !c.is_empty()).unwrap_or_else(|| {
        let def = format!("{home}/.local/bin/claude");
        if Path::new(&def).is_file() { def } else { agent_core::which("claude", path).unwrap_or(def) }
    });
    Info { host: hostname(), os: std::env::consts::OS.into(), version: env!("CARGO_PKG_VERSION").into(), proto: PROTO, home, path: path.into(), claude,
        pending: data.join("pending").to_string_lossy().into(),
        arch: std::env::consts::ARCH.into(), update: upgrade::CAN, repos: github::repos_dir().to_string_lossy().into(), ..Default::default() }
}

// ---------- serving

/// `attached`: per conversation, how many devices follow it now (no notification then); `watching`: the conversations
/// the server follows itself; `sids`: the Claude session of each, for a device that joins after it started (a phone).
/// `shares`: per laptop (ns), the conversations it shares with its phone from its own Mac and the connection it waits
/// on; `opens`: a phone's request waiting for that laptop's connection, by token (see share_forward).
pub struct Server { data: PathBuf, acceptor: Acceptor, fp: String, info: Info, mirror: Arc<mirror::Mirror>, github: Arc<github::Hub>, vaults: vaults::Vaults,
    attached: Mutex<HashMap<String, usize>>, watching: Mutex<HashSet<String>>, sids: Mutex<HashMap<String, String>>,
    titles: Mutex<HashMap<String, String>>, shares: Mutex<HashMap<String, Share>>, opens: Mutex<HashMap<String, Open>> }

/// A laptop's shared conversations (`share`): [{key, title, provider}], and the connection to ask it for a stream on.
/// `gen` tells two registrations apart, so the end of an older one never removes a newer one.
struct Share { convs: Vec<Value>, w: tls::Writer, gen: u64 }
/// A phone's request for a shared conversation, waiting for its laptop's `share_open`: the laptop's ns, and where the
/// laptop's connection goes.
type Open = (String, std::sync::mpsc::Sender<(BufReader<tls::Reader>, tls::Writer)>);
/// How long a phone's request waits for its laptop to connect back.
const OPEN_WAIT: Duration = Duration::from_secs(10);

impl Server {
    pub fn new(data: &Path) -> io::Result<Server> {
        fs::create_dir_all(data.join("pending"))?;
        fs::remove_file(data.join("perm_server.py")).ok(); // the Python tool of before
        let id = identity(data)?;
        let (info, mirror) = (info(data, &login_path()), mirror::Mirror::new(data));
        let github = github::Hub::new(mirror.clone(), &info.host);
        Ok(Server { data: data.into(), acceptor: Acceptor::new(&id), fp: id.fingerprint(), info, mirror, github, vaults: vaults::Vaults::new(data, &id.fingerprint()),
            attached: Mutex::default(), watching: Mutex::default(),
            sids: Mutex::new(fs::read_to_string(data.join("sids.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()),
            titles: Mutex::default(), shares: Mutex::default(), opens: Mutex::default() })
    }
    pub fn fingerprint(&self) -> &str { &self.fp }

    /// Accept forever, a thread per connection. Writes serve.json with the port, for `relay-server pair`.
    pub fn run(self, listener: TcpListener) -> io::Result<()> {
        let port = listener.local_addr()?.port();
        sweep_brokers();
        fs::write(self.data.join("serve.json"), json!({"port": port}).to_string())?;
        let me = Arc::new(self);
        let m2 = me.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            let known: Vec<String> = clients(&m2.data).iter().map(|c| c.fp[..16].to_string()).collect();
            m2.mirror.drop_unknown(&known);
        });
        let m3 = me.clone();
        thread::spawn(move || loop { m3.watch_all(); thread::sleep(Duration::from_secs(2)); });
        for tcp in listener.incoming() {
            let Ok(tcp) = tcp else { continue };
            let me = me.clone();
            thread::spawn(move || { if let Err(e) = me.conn(tcp) { eprintln!("relay-server: {e}"); } });
        }
        Ok(())
    }

    fn conn(self: &Arc<Self>, tcp: TcpStream) -> io::Result<()> {
        let peer = tcp.peer_addr().map(|a| a.to_string()).unwrap_or_default();
        // inside the handshake: a known device, or any device while a pairing code or a vault's invite is open (it may
        // then only pair or join)
        let data = self.data.clone();
        let allow: Arc<dyn Fn(&str) -> bool + Send + Sync> = Arc::new(move |fp: &str| clients(&data).iter().any(|c| c.fp == fp) || pairing(&data).is_some() || vaults::invite_open(&data));
        let (duplex, fp) = self.acceptor.accept(tcp, HANDSHAKE, allow).map_err(|e| io::Error::other(format!("{peer}: {e}")))?;
        let (r, mut w) = duplex.split();
        let mut r = BufReader::new(r);
        let req = proto::read_json(&mut r, MAX_LINE)?;
        let me = clients(&self.data).into_iter().find(|c| c.fp == fp);
        let op = req["op"].as_str().unwrap_or("");
        if me.is_none() && op != "pair" && op != "vault_join" { return reply(&mut w, Err("not paired".into())); }
        if me.as_ref().is_some_and(|c| c.vaults_only) && !VAULT_OPS.contains(&op) { return reply(&mut w, Err(format!("{op:?} is not allowed from a device that only shares vaults"))); }
        let my_name = me.as_ref().map(|c| c.name.clone()).unwrap_or_default();
        let parent = me.and_then(|c| c.parent);
        if parent.is_some() && !LINKED_OPS.contains(&op) { return reply(&mut w, Err(format!("{op:?} is not allowed from a linked device"))); }
        // each device its own conversations and cards: two laptops may both have a conversation "Weemaes"; a linked
        // device works in the one it belongs to
        let ns = &parent.as_deref().unwrap_or(&fp)[..16];
        let key = |k: &Value| format!("{ns}:{}", k.as_str().unwrap_or(""));
        let pending = self.data.join("pending").join(ns);
        // a phone's request for a conversation its laptop shares from its own Mac: the laptop answers it, and checks
        // the phone's signature itself (relay_remote::share); this server only passes the bytes
        if parent.is_some() && ["attach", "kill", "history"].contains(&op) && self.is_shared(ns, req["key"].as_str().unwrap_or("")) {
            self.revoked_closes(&fp, &w);
            return self.share_forward(ns, &req, r, w);
        }
        let s = |k: &str| req[k].as_str().unwrap_or("");
        match op {
            "pair_device" => reply(&mut w, open_pairing_for(&self.data, Some(&fp)).map(|code| json!({"code": code, "fp": self.fp})).map_err(|e| e.to_string())),
            "pair" => { let res = self.pair(&fp, &req); if res.is_ok() { eprintln!("relay-server: paired {} ({peer})", req["name"]); } reply(&mut w, res) }
            "info" => reply(&mut w, Ok(json!({"info": Info { pending: pending.to_string_lossy().into(), work: self.mirror.work_of(ns).to_string_lossy().into(),
                mirror_open: self.mirror.is_open(ns), in_ram: self.mirror.in_ram, ..self.info.clone() }}))),
            // the GitHub token's RAM copy comes back with the rest of the working copy
            "unlock" => reply(&mut w, self.mirror.unlock(ns, req["key"].as_str().unwrap_or("")).map(|_| { self.github.materialise(ns); json!({"in_ram": self.mirror.in_ram}) })),
            "sync_manifest" => reply(&mut w, self.mirror.manifest(ns, req["root"].as_str().unwrap_or("")).map(|m| json!({"manifest": m}))),
            "sync_get" => match self.mirror.get(ns, req["root"].as_str().unwrap_or(""), req["path"].as_str().unwrap_or("")) {
                Ok(b) => { proto::write_json(&mut w, &json!({"ok": true, "len": b.len()}))?; w.write_all(&b)?; w.shutdown(); Ok(()) }
                Err(e) => reply(&mut w, Err(e)),
            },
            "sync_put" => {
                let body = proto::read_body(&mut r, req["len"].as_u64().unwrap_or(0), mirror::MAX_FILE)?;
                reply(&mut w, self.mirror.put(ns, req["root"].as_str().unwrap_or(""), req["path"].as_str().unwrap_or(""), &body, req["mtime"].as_i64().unwrap_or(0), req["expect"].as_str()).map(|_| json!({})))
            }
            "sync_put_many" => {
                let root = req["root"].as_str().unwrap_or("");
                let mut errors = serde_json::Map::new();
                for f in req["files"].as_array().into_iter().flatten() {
                    let body = proto::read_body(&mut r, f["len"].as_u64().unwrap_or(0), mirror::MAX_FILE)?;
                    let path = f["path"].as_str().unwrap_or("");
                    if let Err(e) = self.mirror.put(ns, root, path, &body, f["mtime"].as_i64().unwrap_or(0), f["expect"].as_str()) { errors.insert(path.into(), json!(e)); }
                }
                reply(&mut w, Ok(json!({"errors": errors})))
            }
            "sync_delete" => reply(&mut w, self.mirror.delete(ns, req["root"].as_str().unwrap_or(""), req["path"].as_str().unwrap_or(""), req["hash"].as_str().unwrap_or("")).map(|_| json!({}))),
            "wipe" => { self.mirror.wipe(ns); reply(&mut w, Ok(json!({}))) }
            "session_get" => match self.session_find(req["sid"].as_str().unwrap_or("")).ok_or("no such session here").and_then(|p| fs::read(p).map_err(|_| "no such session here")) {
                Ok(b) => { proto::write_json(&mut w, &json!({"ok": true, "len": b.len()}))?; w.write_all(&b)?; w.shutdown(); Ok(()) }
                Err(e) => reply(&mut w, Err(e.into())),
            },
            "session_put" => {
                let body = proto::read_body(&mut r, req["len"].as_u64().unwrap_or(0), MAX_SESSION)?;
                reply(&mut w, self.session_put(ns, &req, &body))
            }
            "update" => {
                let body = proto::read_body(&mut r, req["len"].as_u64().unwrap_or(0), proto::MAX_BINARY)?;
                let done = upgrade::install(&self.data, req["version"].as_str().unwrap_or(""), req["sha256"].as_str().unwrap_or(""), &body);
                let ok = done.is_ok();
                reply(&mut w, done.map(|_| json!({})))?;
                // after the reply is out: the app waits for it, then sees the new version once the server is back
                if ok { let data = self.data.clone(); thread::spawn(move || { thread::sleep(Duration::from_millis(300)); upgrade::restart(&data) }); }
                Ok(())
            }
            // GitHub there (github.rs), not from a linked device: the token, and the repos cloned with it
            "github_status" => reply(&mut w, Ok(json!({"github": self.github.status(ns)}))),
            "github_login_start" => reply(&mut w, self.github.login_start(ns).map(|d| json!({"device": d}))),
            "github_login_poll" => reply(&mut w, Ok(json!({"github": self.github.login_poll(ns)}))),
            "github_logout" => { self.github.logout(ns); reply(&mut w, Ok(json!({}))) }
            "repos" => reply(&mut w, Ok(json!({"repos": self.github.repos()}))),
            "repo_ensure" => reply(&mut w, self.github.ensure(ns, req["repo"].as_str().unwrap_or("")).map(|r| json!({"repo": r}))),
            "repo_push" => reply(&mut w, self.github.push(ns, req["name"].as_str().unwrap_or("")).map(|r| json!({"repo": r}))),
            "repo_snapshot" => reply(&mut w, self.github.snapshot(ns, req["name"].as_str().unwrap_or(""), req["branch"].as_str().unwrap_or("")).map(|s| json!({"snapshot": s}))),
            "list" => {
                let metas = metas(ns);
                let sids = self.sids.lock().unwrap();
                let of: serde_json::Map<String, Value> = metas.iter().filter_map(|m| sids.get(&format!("{ns}:{}", m.key)).map(|s| (m.key.clone(), json!(s)))).collect();
                // a title kept in memory only: after a restart it comes from the session's transcript (once)
                let mut titles = self.titles.lock().unwrap();
                for m in &metas {
                    let k = format!("{ns}:{}", m.key);
                    if titles.contains_key(&k) { continue; }
                    if let Some(t) = sids.get(&k).and_then(|sid| self.session_find(sid)).and_then(|p| transcript_title(&p)) { titles.insert(k, t); }
                }
                let named: serde_json::Map<String, Value> = metas.iter().filter_map(|m| titles.get(&format!("{ns}:{}", m.key)).map(|s| (m.key.clone(), json!(s)))).collect();
                let mut v = json!({"metas": metas, "sids": of, "titles": named});
                if parent.is_some() { self.list_shared(ns, &mut v); }
                reply(&mut w, Ok(v))
            }
            "kill" => reply(&mut w, kill(&key(&req["key"]), req["pid"].as_u64().unwrap_or(0) as u32)),
            "pending" => reply(&mut w, Ok(json!({"pending": agent_core::pending::list(&pending)}))),
            "answer" => reply(&mut w, agent_core::pending::answer(&pending, req["id"].as_str().unwrap_or(""), &req["decision"]).map(|_| json!({}))),
            "history" => reply(&mut w, Ok(self.history(&req))),
            "exists" => reply(&mut w, Ok(json!({"dir": req["path"].as_str().is_some_and(|p| p.starts_with('/') && Path::new(p).is_dir())}))),
            "launch" => { self.revoked_closes(&fp, &w); let _a = self.attach_guard(&key(&req["meta"]["key"])); self.launch(ns, &req, None, r, w) }
            "profile_put" => reply(&mut w, write_private(&self.profile_path(ns), &req["profile"].to_string()).map(|_| json!({})).map_err(|e| e.to_string())),
            // a conversation of the laptop's Mac never forks onto this machine from the phone
            "start" if self.is_shared(ns, req["key"].as_str().unwrap_or("")) => bang(&mut w, "this conversation runs on the Mac: open Relay there"),
            "start" => { self.revoked_closes(&fp, &w); let _a = self.attach_guard(&key(&req["key"])); self.start(ns, &req, r, w) }
            "attach" => { self.revoked_closes(&fp, &w); let _a = self.attach_guard(&key(&req["key"])); attach(&key(&req["key"]), r, w) }
            "share" => self.share(ns, &req, r, w),
            // shared vaults (vaults.rs): only ciphertext passes here, by member
            "vault_create" => reply(&mut w, self.vaults.create(&fp, &my_name, s("name"))),
            "vault_list" => reply(&mut w, Ok(self.vaults.list(&fp))),
            "vault_info" => reply(&mut w, self.vaults.info(&fp, s("vault"))),
            "vault_invite" => reply(&mut w, self.vaults.invite(&fp, s("vault"), s("role"), s("wrapped"))),
            "vault_invite_revoke" => reply(&mut w, self.vaults.invite_revoke(&fp, s("vault"), s("invite")).map(|_| json!({}))),
            "vault_join" => {
                let res = self.vaults.join(&fp, s("vault"), s("invite"), s("name"), s("proof"));
                if res.is_ok() { eprintln!("relay-server: {} joined a shared vault ({peer})", req["name"]); }
                reply(&mut w, res)
            }
            "vault_remove" => reply(&mut w, self.vaults.remove(&fp, s("vault"), s("fp")).map(|_| json!({}))),
            "vault_manifest" => reply(&mut w, self.vaults.manifest(&fp, s("vault")).map(|b| json!({"blobs": b}))),
            "vault_get" => match self.vaults.get(&fp, s("vault"), s("name")) {
                Ok((b, etag)) => { proto::write_json(&mut w, &json!({"ok": true, "len": b.len(), "etag": etag}))?; w.write_all(&b)?; w.shutdown(); Ok(()) }
                Err(e) => reply(&mut w, Err(e)),
            },
            "vault_put" => {
                let body = proto::read_body(&mut r, req["len"].as_u64().unwrap_or(0), vaults::MAX_RECORD)?;
                reply(&mut w, self.vaults.put(&fp, s("vault"), s("name"), &body, req["expect"].as_str()).map(|etag| json!({"etag": etag})))
            }
            "vault_put_many" => {
                let (mut etags, mut errors) = (serde_json::Map::new(), serde_json::Map::new());
                for f in req["files"].as_array().into_iter().flatten() {
                    let body = proto::read_body(&mut r, f["len"].as_u64().unwrap_or(0), vaults::MAX_RECORD)?;
                    let name = f["name"].as_str().unwrap_or("");
                    match self.vaults.put(&fp, s("vault"), name, &body, f["expect"].as_str()) { Ok(e) => { etags.insert(name.into(), json!(e)); } Err(e) => { errors.insert(name.into(), json!(e)); } }
                }
                reply(&mut w, Ok(json!({"etags": etags, "errors": errors})))
            }
            "vault_delete" => reply(&mut w, self.vaults.delete(&fp, s("vault"), s("name"), req["expect"].as_str()).map(|_| json!({}))),
            "share_open" => {
                let token = req["token"].as_str().unwrap_or("");
                let open = self.opens.lock().unwrap().remove(token);
                match open {
                    Some((owner, tx)) if owner == ns => { tx.send((r, w)).ok(); Ok(()) }
                    _ => reply(&mut w, Err("no such request".into())),
                }
            }
            _ => reply(&mut w, Err(format!("unknown request {op:?}"))),
        }
    }

    fn is_shared(&self, ns: &str, key: &str) -> bool {
        !key.is_empty() && self.shares.lock().unwrap().get(ns).is_some_and(|s| s.convs.iter().any(|c| c["key"] == key))
    }
    /// A laptop offers its shared conversations: kept until this connection ends or the laptop offers again. The laptop
    /// reads `{"open": token}` lines on it, one per request of its phone.
    fn share(&self, ns: &str, req: &Value, mut r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
        // what a phone's list shows of them: a key, a title and the agent, nothing that runs anything here
        let convs: Vec<Value> = req["convs"].as_array().into_iter().flatten().filter_map(|c| {
            let k = c["key"].as_str().filter(|k| !k.is_empty() && k.len() <= 200)?;
            let s = |f: &str| c[f].as_str().unwrap_or("").chars().take(200).collect::<String>();
            Some(json!({"key": k, "title": s("title"), "provider": s("provider")}))
        }).take(500).collect();
        proto::write_json(&mut w, &json!({"ok": true}))?;
        let gen = { let mut sh = self.shares.lock().unwrap(); let gen = sh.get(ns).map_or(0, |s| s.gen + 1);
            if let Some(old) = sh.insert(ns.into(), Share { convs, w: w.clone(), gen }) { old.w.shutdown(); } gen };
        // the laptop sends nothing more: its end (or a newer offer, which shuts this one) ends the offer
        io::copy(&mut r, &mut io::sink()).ok();
        let mut sh = self.shares.lock().unwrap();
        if sh.get(ns).is_some_and(|s| s.gen == gen) { sh.remove(ns); }
        w.shutdown();
        Ok(())
    }
    /// A phone's request for a shared conversation: its laptop is asked for a connection of its own (`open` on the
    /// share connection), which gets the phone's request line, then the two pass through each other until either goes.
    fn share_forward(&self, ns: &str, req: &Value, r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
        let refuse = |w: &mut tls::Writer, why: &str| if req["op"] == "attach" { bang(w, why) } else { reply(w, Err(why.into())) };
        let token = tls::random_secret();
        let (tx, rx) = std::sync::mpsc::channel();
        self.opens.lock().unwrap().insert(token.clone(), (ns.into(), tx));
        // one write per line: several phones' requests may go to the same connection at once
        let asked = self.shares.lock().unwrap().get(ns).map(|s| s.w.clone()).is_some_and(|mut sw| sw.write_all(format!("{}\n", json!({"open": token})).as_bytes()).is_ok());
        let got = if asked { rx.recv_timeout(OPEN_WAIT).ok() } else { None };
        self.opens.lock().unwrap().remove(&token);
        let Some((mr, mut mw)) = got else { return refuse(&mut w, "the Mac does not answer: is Relay open on it?") };
        proto::write_json(&mut mw, req)?;
        splice(r, w, mr, mw);
        Ok(())
    }
    /// A phone's list: its laptop's shared conversations too (no pid, they do not run here), and which ones they are.
    fn list_shared(&self, ns: &str, v: &mut Value) {
        let convs = self.shares.lock().unwrap().get(ns).map(|s| s.convs.clone()).unwrap_or_default();
        for c in &convs {
            let k = c["key"].as_str().unwrap_or("");
            if v["metas"].as_array().is_some_and(|m| m.iter().any(|m| m["key"] == k)) { continue; }
            let meta = Meta { key: k.into(), provider: c["provider"].as_str().unwrap_or("claude").into(), model: String::new(), effort: String::new(), tainted: false, pid: 0, account: String::new(), turns: 0 };
            if let (Some(m), Ok(meta)) = (v["metas"].as_array_mut(), serde_json::to_value(meta)) { m.push(meta); }
            if c["title"].as_str().is_some_and(|t| !t.is_empty()) { v["titles"][k] = c["title"].clone(); }
        }
        v["shared"] = json!(convs.iter().map(|c| c["key"].clone()).collect::<Vec<_>>());
    }
    /// A conversation's stream lasts as long as the conversation: once its device is revoked, it ends within seconds,
    /// not at the next connection.
    fn revoked_closes(&self, fp: &str, w: &tls::Writer) {
        let (data, fp, w) = (self.data.clone(), fp.to_string(), w.clone());
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(2));
            if w.is_closed() { return; }
            if !clients(&data).iter().any(|c| c.fp == fp) { eprintln!("relay-server: closing a revoked device's stream"); w.shutdown(); return; }
        });
    }

    fn pair(&self, fp: &str, req: &Value) -> Result<Value, String> {
        let _c = CLIENTS.lock().unwrap_or_else(|e| e.into_inner());
        let Some(mut p) = pairing(&self.data) else { return Err("no pairing code open, run `relay-server pair` on the server".into()) };
        let name: String = req["name"].as_str().unwrap_or("").trim().chars().filter(|c| !c.is_control()).take(60).collect();
        let name = if name.is_empty() { format!("device-{}", &fp[..8]) } else { name };
        if !tls::verify_proof(&p.secret, fp, &self.fp, req["proof"].as_str().unwrap_or("")) {
            p.fails += 1;
            write_private(&self.data.join("pairing.json"), &serde_json::to_string(&p).unwrap()).ok();
            return Err("wrong pairing code".into());
        }
        fs::remove_file(self.data.join("pairing.json")).ok();
        let mut list = clients(&self.data);
        // the device that opened the pairing was revoked meanwhile: nothing to link to
        if p.parent.as_ref().is_some_and(|pf| !list.iter().any(|c| &c.fp == pf)) { return Err("the device this pairing was for is no longer paired".into()); }
        list.retain(|c| c.fp != fp);
        // a second device with the same name gets a number, so revoke by name stays unambiguous
        let mut n = name.clone();
        let mut i = 2;
        while list.iter().any(|c| c.name == n) { n = format!("{name} {i}"); i += 1; }
        // a vault-only device that pairs becomes a full one
        list.push(Client { name: n.clone(), fp: fp.into(), added: now(), parent: p.parent, vaults_only: false });
        save_clients(&self.data, &list).map_err(|e| e.to_string())?;
        Ok(json!({"name": n}))
    }

    fn history(&self, req: &Value) -> Value {
        use agent_core::AgentProvider;
        let (sid, from, cwd) = (req["sid"].as_str().unwrap_or(""), req["from"].as_u64().unwrap_or(0), req["cwd"].as_str().unwrap_or(""));
        let pending = self.data.join("pending");
        // Claude files a session under the folder as it resolves it (/tmp is /private/tmp on a Mac)
        let cwd = fs::canonicalize(cwd).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| cwd.to_string());
        let env = agent_core::Env { home: &self.info.home, vault: &cwd, path: &self.info.path, bin: &self.info.claude, pending: &pending, opts: &Value::Null };
        let (items, next) = agent_claude::PROVIDER.history(&env, sid, from);
        json!({"items": items, "next": next})
    }

    /// Claude Code's transcripts here, one folder per working directory.
    fn projects(&self) -> PathBuf { mirror::claude_projects() }
    /// A session's transcript here, the newest when Claude Code left copies in several folders. None for a bad id.
    fn session_find(&self, sid: &str) -> Option<PathBuf> {
        if !sid_ok(sid) { return None; }
        fs::read_dir(self.projects()).ok()?.flatten().map(|d| d.path().join(format!("{sid}.jsonl")))
            .filter_map(|p| Some((fs::metadata(&p).ok()?.modified().ok()?, p))).max().map(|(_, p)| p)
    }
    /// A conversation moves here: its transcript goes where Claude Code looks for a session started in `cwd`, and any
    /// older copy of it here goes, so `--resume` finds this one.
    fn session_put(&self, ns: &str, req: &Value, body: &[u8]) -> Result<Value, String> {
        let (sid, cwd) = (req["sid"].as_str().unwrap_or(""), req["cwd"].as_str().unwrap_or(""));
        if !sid_ok(sid) { return Err("bad session id".into()); }
        if !cwd.starts_with('/') || !Path::new(cwd).is_dir() { return Err(format!("folder {cwd} does not exist on {}", self.info.host)); }
        if Path::new(cwd).starts_with(self.mirror.work_of(ns)) && !self.mirror.is_open(ns) {
            return Err(format!("the vault on {} is locked: it opens when Relay on your laptop connects", self.info.host));
        }
        while let Some(old) = self.session_find(sid) { fs::remove_file(old).map_err(|e| e.to_string())?; }
        let to = self.projects().join(agent_claude::slug(cwd)).join(format!("{sid}.jsonl"));
        relay_remote::sync::write_atomic(&to, body, None).map_err(|e| e.to_string())?;
        Ok(json!({}))
    }

    /// A device follows a conversation while this lives.
    fn attach_guard(&self, key: &str) -> Attached<'_> {
        *self.attached.lock().unwrap().entry(key.into()).or_default() += 1;
        Attached { s: self, key: key.into() }
    }
    /// Follow every running conversation (watch), also the ones from before this process.
    fn watch_all(self: &Arc<Self>) {
        for m in fs::read_dir(broker::dir()).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).filter_map(|p| broker::load_meta(&p)) {
            if m.key.contains(':') { self.watch_key(&m.key); }
        }
    }
    /// Follow a conversation unless it is followed already: connected here, read on a thread of its own.
    fn watch_key(self: &Arc<Self>, key: &str) {
        if !self.watching.lock().unwrap().insert(key.into()) { return; }
        let Some(c) = broker::follow(key, "notify") else { self.watching.lock().unwrap().remove(key); return };
        let (me, key) = (self.clone(), key.to_string());
        thread::spawn(move || { me.watch(&key, c); me.watching.lock().unwrap().remove(&key); });
    }
    /// Follow one conversation as `notify`: its Claude session (for `list`), and, when the device's laptop gave an ntfy
    /// topic (in its profile), a permission card or a turn that ended while no device follows it goes there. Nothing of
    /// the conversation goes along (ntfy.sh is a public server), only that something waits.
    fn watch(&self, key: &str, c: broker::Conn) {
        let _stdin = c.stdin;
        let ns = key.split_once(':').map_or("", |x| x.0);
        for l in c.frames.lines().map_while(Result::ok) {
            let broker::Frame::Out(o) = broker::frame(&l) else { if l.starts_with('x') { break } else { continue } };
            let Ok(ev) = serde_json::from_str::<Value>(&o) else { continue };
            if let Some(sid) = ev["session_id"].as_str().filter(|s| agent_core::safe_id(s)) { self.set_sid(key, Some(sid)); }
            // the first thing said in it names it in a phone's list
            if !self.titles.lock().unwrap().contains_key(key) {
                if let Some(t) = title_of(&ev) { self.titles.lock().unwrap().insert(key.into(), t); }
            }
            let what = if ev["type"] == "control_request" && ev["request"]["subtype"] == "can_use_tool" { "Claude is waiting for your answer" }
                else if ev["type"] == "result" { "Claude finished" } else { continue };
            if self.attached.lock().unwrap().get(key).copied().unwrap_or(0) > 0 { continue; }
            let url = fs::read_to_string(self.profile_path(ns)).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|p| p["notify"].as_str().map(String::from));
            // tapped on the phone: relay://conversation/<key>, the key without the device's namespace (no content)
            let click = format!("relay://conversation/{}", percent(key.split_once(':').map_or(key, |x| x.1)));
            if let Some(url) = url.filter(|u| u.starts_with("https://") || u.starts_with("http://")) { notify(&url, &format!("{what} on {}", self.info.host), &click); }
        }
        self.set_sid(key, None);
        self.titles.lock().unwrap().remove(key);
    }
    /// A conversation's session, kept in sids.json too: after a restart its broker still runs, the line is long gone.
    fn set_sid(&self, key: &str, sid: Option<&str>) {
        let mut sids = self.sids.lock().unwrap();
        let changed = match sid { Some(s) => sids.insert(key.into(), s.into()).as_deref() != Some(s), None => sids.remove(key).is_some() };
        if changed { write_private(&self.data.join("sids.json"), &serde_json::to_string(&*sids).unwrap()).ok(); }
    }

    /// What the laptop sends about how it starts Claude here (profile_put): its Claude settings and the mirror's flags.
    fn profile_path(&self, ns: &str) -> PathBuf { self.data.join("profiles").join(format!("{ns}.json")) }

    /// Start a Claude conversation in the device's mirrored vault without the laptop (a phone): the command is built
    /// here with the provider's own code, the way the laptop builds it, from the laptop's last profile. `resume` goes on
    /// with a session. No mail tools: those are answered by the laptop.
    fn start(self: &Arc<Self>, ns: &str, req: &Value, r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
        use agent_core::AgentProvider;
        let Some(profile) = fs::read_to_string(self.profile_path(ns)).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else {
            return bang(&mut w, "no way to start Claude here yet: open Relay on the laptop once while this machine is online");
        };
        let s = |k: &str| req[k].as_str().unwrap_or("");
        let cwd = self.mirror.work_of(ns).join("vault").to_string_lossy().into_owned();
        let pending = self.data.join("pending").join(ns);
        let mut opts = profile["opts"].clone();
        if opts.is_object() { opts["mail"] = json!(false); }
        let env = agent_core::Env { home: &self.info.home, vault: &cwd, path: &self.info.path, bin: &self.info.claude, pending: &pending, opts: &opts };
        let launch = agent_core::Launch { key: s("key"), name: s("name"), model: s("model"), effort: s("effort"), resume: Some(s("resume")).filter(|x| !x.is_empty()), fork: None, turn: None };
        let mut cmd = match agent_claude::PROVIDER.command(&env, &launch) { Ok(c) => c, Err(e) => return bang(&mut w, &e) };
        cmd.current_dir(&cwd).env("PATH", &self.info.path);
        cmd.args(profile["args"].as_array().into_iter().flatten().filter_map(Value::as_str));
        for kv in profile["env"].as_array().into_iter().flatten() { if let (Some(k), Some(v)) = (kv[0].as_str(), kv[1].as_str()) { cmd.env(k, v); } }
        let meta = Meta { key: s("key").into(), provider: "claude".into(), model: s("model").into(), effort: s("effort").into(), tainted: false, pid: 0, account: String::new(), turns: 0 };
        self.launch(ns, &json!({"meta": meta, "spec": Spec::of(&cmd)}), agent_claude::PROVIDER.control_init(&[]), r, w)
    }

    /// `init`: a first line for a new agent's stdin (Claude's initialize), not sent to one that already runs.
    fn launch(self: &Arc<Self>, ns: &str, req: &Value, init: Option<String>, r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
        let parsed = serde_json::from_value::<Meta>(req["meta"].clone()).and_then(|m| Ok((m, serde_json::from_value::<Spec>(req["spec"].clone())?)));
        let (mut meta, mut spec) = match parsed { Ok(x) => x, Err(e) => return bang(&mut w, &format!("bad launch: {e}")) };
        meta.key = format!("{ns}:{}", meta.key);
        // the server's own Claude config folder wins: the laptop's (a path there, or removed for ~/.claude) would send
        // Claude here to ~/.claude.json, outside the volume, gone with every new container
        spec.env.retain(|(k, _)| k != "CLAUDE_CONFIG_DIR");
        // git with this device's GitHub token: the credential helper and the commit identity, never the token itself
        for (k, v) in self.github.agent_env(ns) { spec.env.retain(|(x, _)| *x != k); spec.env.push((k, Some(v))); }
        if spec.cwd.as_deref().is_some_and(|d| Path::new(d).starts_with(self.mirror.work_of(ns))) && !self.mirror.is_open(ns) {
            return bang(&mut w, &format!("the vault on {} is locked: it opens when Relay on your laptop connects", self.info.host));
        }
        if let Some(cwd) = spec.cwd.as_deref().filter(|d| !Path::new(d).is_dir()) { return bang(&mut w, &format!("folder {cwd} does not exist on {}", self.info.host)); }
        // its broker still runs (the app asked before it had taken the conversation back after a restart): that one
        // goes on, a second agent on the same session would write the transcript twice
        if UnixStream::connect(sock_of(&meta.key)).is_ok() { return attach(&meta.key, r, w); }
        // the broker connection launch makes is dropped at once: attach takes it over with a hello of its own
        match broker::launch_spec(&meta, &spec) {
            Ok(mut c) => {
                // followed before any device: the session line at the start goes nowhere else first
                self.watch_key(&meta.key);
                if let Some(l) = init { writeln!(c.stdin, "{l}").and_then(|_| c.stdin.flush()).ok(); }
                attach(&meta.key, r, w)
            }
            Err(e) => bang(&mut w, &e),
        }
    }
}

/// A conversation's title from one of its lines: the text of a user message, on one line, at most 80 characters. A
/// tool result (also a user message) has no text block and names nothing.
fn title_of(ev: &Value) -> Option<String> {
    if ev["type"] != "user" { return None; }
    let c = &ev["message"]["content"];
    let text = c.as_str().map(String::from).or_else(|| c.as_array()?.iter().find(|b| b["type"] == "text").and_then(|b| b["text"].as_str()).map(String::from))?;
    let one = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!one.is_empty()).then(|| one.chars().take(80).collect())
}
/// The title in a Claude transcript: its first user message with text.
fn transcript_title(path: &Path) -> Option<String> {
    let f = fs::File::open(path).ok()?;
    BufReader::new(f).lines().map_while(Result::ok).take(2000).filter_map(|l| serde_json::from_str::<Value>(&l).ok()).find_map(|ev| title_of(&ev))
}

struct Attached<'a> { s: &'a Server, key: String }
impl Drop for Attached<'_> {
    fn drop(&mut self) {
        let mut a = self.s.attached.lock().unwrap();
        if let Some(n) = a.get_mut(&self.key) { *n -= 1; if *n == 0 { a.remove(&self.key); } }
    }
}

/// A conversation key in a URL path: letters, digits and -._~ as they are, every other byte as %XX.
pub(crate) fn percent(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// One notification to an ntfy topic, with curl (on a Mac and in the image): no HTTP client in this binary for it.
fn notify(url: &str, text: &str, click: &str) {
    let ok = std::process::Command::new("curl").args(["-fsS", "-m", "10", "-H", "Title: Relay", "-H", &format!("Click: {click}"), "-d", text, url])
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success());
    if !ok { eprintln!("relay-server: a notification to {url} failed"); }
}

fn reply(w: &mut tls::Writer, res: Result<Value, String>) -> io::Result<()> {
    let v = match res { Ok(mut v) => { v["ok"] = json!(true); v } Err(e) => json!({"ok": false, "error": e}) };
    proto::write_json(w, &v)?;
    w.shutdown();
    Ok(())
}
/// A broker-protocol refusal (`! why`), what the app reads where it expected the broker's hello.
fn bang(w: &mut tls::Writer, why: &str) -> io::Result<()> {
    writeln!(w, "! {}", why.replace('\n', " "))?;
    w.flush()?;
    w.shutdown();
    Ok(())
}

/// A device's running brokers: the conversations it can take back, under its own keys.
fn metas(ns: &str) -> Vec<Meta> {
    let Ok(dir) = fs::read_dir(broker::dir()) else { return vec![] };
    let pre = format!("{ns}:");
    dir.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).filter_map(|p| broker::load_meta(&p))
        .filter(|m| m.key.starts_with(&pre) && UnixStream::connect(sock_of(&m.key)).is_ok())
        .map(|m| Meta { key: m.key[pre.len()..].to_string(), ..m }).collect()
}
/// A Claude session id: a UUID, so it is safe in a file name.
fn sid_ok(s: &str) -> bool { s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-') }
fn sock_of(key: &str) -> PathBuf { broker::meta_path(key).with_extension("sock") }
/// After a crash or a restart the brokers are gone but their files are not: a socket nobody answers on, and its
/// meta, would list a dead conversation as running. Swept at start.
pub fn sweep_brokers() {
    for f in fs::read_dir(broker::dir()).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")) {
        let sock = f.with_extension("sock");
        if UnixStream::connect(&sock).is_err() { fs::remove_file(&sock).ok(); fs::remove_file(&f).ok(); }
    }
}

/// Stop a conversation's agent: only the pid its broker file names, so a stale request never kills another process.
fn kill(key: &str, pid: u32) -> Result<Value, String> {
    let m = broker::load_meta(&broker::meta_path(key)).ok_or("no such conversation")?;
    if pid == 0 || m.pid != pid { return Err("not that conversation's agent".into()); }
    broker::Agent::from(pid).kill().map_err(|e| e.to_string())?;
    broker::forget(key, pid);
    Ok(json!({}))
}

/// Pass a broker's frames through, both ways, until either side goes. The broker sends its hello (`p <pid>
/// <backlog>`, then the backlog) to every new connection, so the app reads exactly what a local broker would send.
fn attach(key: &str, mut r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
    let Ok(sock) = UnixStream::connect(sock_of(key)) else { return bang(&mut w, "gone") };
    let mut from_broker = sock.try_clone()?;
    let w2 = w.clone();
    let out = thread::spawn(move || { io::copy(&mut from_broker, &mut w).ok(); w.shutdown(); });
    // what the app writes goes to the agent's stdin, through the broker; the app gone closes our side of the socket
    let mut to_broker = sock.try_clone()?;
    let buffered = r.buffer().to_vec();
    to_broker.write_all(&buffered).ok();
    r.consume(buffered.len());
    io::copy(r.get_mut(), &mut to_broker).ok();
    sock.shutdown(std::net::Shutdown::Both).ok();
    w2.shutdown();
    out.join().ok();
    Ok(())
}

/// Two TLS connections through each other, both ways, until either side goes: a phone and its laptop (share_forward).
/// What the phone sent after its request line, still in its reader's buffer, goes first.
fn splice(mut r: BufReader<tls::Reader>, w: tls::Writer, mut mr: BufReader<tls::Reader>, mut mw: tls::Writer) {
    let (mut w2, mw2) = (w.clone(), mw.clone());
    let out = thread::spawn(move || { io::copy(&mut mr, &mut w2).ok(); w2.shutdown(); mw2.shutdown(); });
    let buffered = r.buffer().to_vec();
    mw.write_all(&buffered).ok();
    r.consume(buffered.len());
    io::copy(r.get_mut(), &mut mw).ok();
    mw.shutdown();
    w.shutdown();
    out.join().ok();
}

/// The LAN address other devices reach this machine at: the source address of a route out (no packet is sent).
pub fn lan_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

/// For `relay-server pair`: open a code and the line to paste in Relay.
pub fn pair_line(data: &Path, host: Option<String>, port: Option<u16>) -> io::Result<String> {
    let port = port.or_else(|| fs::read_to_string(data.join("serve.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["port"].as_u64()).map(|p| p as u16)).unwrap_or(proto::PORT);
    let host = host.or_else(lan_ip).ok_or_else(|| io::Error::other("no LAN address found, pass --host"))?;
    let fp = identity(data)?.fingerprint();
    let code = open_pairing(data)?;
    Ok(proto::PairLine { host, port, fp, code, key: None, link: None }.format())
}


/// The label of relay-server's LaunchAgent, also the one the Relay app installs for "this Mac as a machine".
pub const LAUNCH_LABEL: &str = "be.laurentmeersman.relay-server";

/// A LaunchAgent that runs `args` (the program first) at login and restarts it when it stops.
pub fn launch_agent(args: &[String]) -> String {
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let args: String = args.iter().map(|a| format!("<string>{}</string>", esc(a))).collect();
    format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LAUNCH_LABEL}</string>
  <key>ProgramArguments</key><array>{args}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/relay-server.err</string>
</dict></plist>
"#)
}

/// A service definition that keeps `relay-server serve` running and restarts it: a LaunchAgent on a Mac (the working
/// copy on a RAM disk), a systemd user unit on Linux, with the steps to install it.
pub fn service_file() -> String {
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "relay-server".into());
    if cfg!(target_os = "macos") {
        let agent = launch_agent(&[exe, "serve".into(), "--ram-disk".into()]);
        format!("# ~/Library/LaunchAgents/{LAUNCH_LABEL}.plist, then:\n#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/{LAUNCH_LABEL}.plist\n\n{agent}")
    } else {
        format!("# ~/.config/systemd/user/relay-server.service, then:\n#   systemctl --user enable --now relay-server\n#   loginctl enable-linger $USER   (keeps it running without a login)\n\
[Unit]\nDescription=Relay server\nAfter=network-online.target\n\n[Service]\nExecStart={exe} serve\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n")
    }
}

#[cfg(test)]
mod title_tests {
    use super::*;
    #[test]
    fn a_title_is_the_first_thing_said() {
        let p = std::env::temp_dir().join(format!("relay-title-{}.jsonl", std::process::id()));
        let lines = [
            json!({"type": "system", "subtype": "init"}),
            json!({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "x"}]}}),
            json!({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "Check  the\nportal redirect"}]}}),
            json!({"type": "user", "message": {"role": "user", "content": "later"}}),
        ];
        fs::write(&p, lines.iter().map(|l| l.to_string() + "\n").collect::<String>()).unwrap();
        assert_eq!(transcript_title(&p).as_deref(), Some("Check the portal redirect"));
        assert_eq!(title_of(&json!({"type": "user", "message": {"content": "x".repeat(100)}})).unwrap().len(), 80);
        fs::remove_file(p).ok();
    }
}
