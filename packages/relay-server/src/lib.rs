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
//! Files in the data folder: identity.{crt,key}.der, clients.json, pairing.json (while a code is open), serve.json (the
//! port the running server listens on), pending/.

pub mod cli;
pub mod mirror;
#[cfg(target_os = "macos")]
pub mod ramdisk;
pub mod upgrade;

use relay_remote::broker::{self, Meta, Spec};
use relay_remote::proto::{self, Info, MAX_LINE, MAX_SESSION, PROTO};
use relay_remote::tls::{self, Acceptor, Identity};
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
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

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Client { pub name: String, pub fp: String, pub added: u64 }

pub fn clients(data: &Path) -> Vec<Client> {
    fs::read_to_string(data.join("clients.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn save_clients(data: &Path, c: &[Client]) -> io::Result<()> { write_private(&data.join("clients.json"), &serde_json::to_string_pretty(c).unwrap()) }
/// Remove the clients whose name is `who`, or whose fingerprint starts with it (at least 8 characters). Returns them.
pub fn revoke(data: &Path, who: &str) -> io::Result<Vec<Client>> {
    let who = who.trim();
    let hit = |c: &Client| c.name == who || (who.len() >= 8 && c.fp.starts_with(&who.to_lowercase()));
    let (gone, keep): (Vec<Client>, Vec<Client>) = clients(data).into_iter().partition(hit);
    if !gone.is_empty() { save_clients(data, &keep)?; }
    // a revoked device's mirror goes too; a running server also drops its key and working copy (see Server::run)
    for c in &gone { fs::remove_dir_all(data.join("mirror").join(&c.fp[..16])).ok(); }
    Ok(gone)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Pairing { secret: String, expires: u64, #[serde(default)] fails: u32 }
fn pairing(data: &Path) -> Option<Pairing> {
    let p: Pairing = serde_json::from_str(&fs::read_to_string(data.join("pairing.json")).ok()?).ok()?;
    (p.expires > now() && p.fails < PAIR_TRIES).then_some(p)
}
/// Open a pairing: a fresh code, PAIR_SECS long, replacing any earlier one. Returns the code.
pub fn open_pairing(data: &Path) -> io::Result<String> {
    let secret = tls::random_secret();
    write_private(&data.join("pairing.json"), &json!({"secret": secret, "expires": now() + PAIR_SECS}).to_string())?;
    Ok(secret)
}

fn write_private(path: &Path, text: &str) -> io::Result<()> {
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
        arch: std::env::consts::ARCH.into(), update: upgrade::CAN, ..Default::default() }
}

// ---------- serving

pub struct Server { data: PathBuf, acceptor: Acceptor, fp: String, info: Info, mirror: Arc<mirror::Mirror> }

impl Server {
    pub fn new(data: &Path) -> io::Result<Server> {
        fs::create_dir_all(data.join("pending"))?;
        fs::remove_file(data.join("perm_server.py")).ok(); // the Python tool of before
        let id = identity(data)?;
        Ok(Server { data: data.into(), acceptor: Acceptor::new(&id), fp: id.fingerprint(), info: info(data, &login_path()), mirror: mirror::Mirror::new(data) })
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
        for tcp in listener.incoming() {
            let Ok(tcp) = tcp else { continue };
            let me = me.clone();
            thread::spawn(move || { if let Err(e) = me.conn(tcp) { eprintln!("relay-server: {e}"); } });
        }
        Ok(())
    }

    fn conn(&self, tcp: TcpStream) -> io::Result<()> {
        let peer = tcp.peer_addr().map(|a| a.to_string()).unwrap_or_default();
        // inside the handshake: a known device, or any device while a pairing code is open (it may then only pair)
        let data = self.data.clone();
        let allow: Arc<dyn Fn(&str) -> bool + Send + Sync> = Arc::new(move |fp: &str| clients(&data).iter().any(|c| c.fp == fp) || pairing(&data).is_some());
        let (duplex, fp) = self.acceptor.accept(tcp, HANDSHAKE, allow).map_err(|e| io::Error::other(format!("{peer}: {e}")))?;
        let (r, mut w) = duplex.split();
        let mut r = BufReader::new(r);
        let req = proto::read_json(&mut r, MAX_LINE)?;
        let known = clients(&self.data).iter().any(|c| c.fp == fp);
        let op = req["op"].as_str().unwrap_or("");
        if !known && op != "pair" { return reply(&mut w, Err("not paired".into())); }
        // each device its own conversations and cards: two laptops may both have a conversation "Weemaes"
        let ns = &fp[..16];
        let key = |k: &Value| format!("{ns}:{}", k.as_str().unwrap_or(""));
        let pending = self.data.join("pending").join(ns);
        match op {
            "pair" => { let res = self.pair(&fp, &req); if res.is_ok() { eprintln!("relay-server: paired {} ({peer})", req["name"]); } reply(&mut w, res) }
            "info" => reply(&mut w, Ok(json!({"info": Info { pending: pending.to_string_lossy().into(), work: self.mirror.work_of(ns).to_string_lossy().into(),
                mirror_open: self.mirror.is_open(ns), in_ram: self.mirror.in_ram, ..self.info.clone() }}))),
            "unlock" => reply(&mut w, self.mirror.unlock(ns, req["key"].as_str().unwrap_or("")).map(|_| json!({"in_ram": self.mirror.in_ram}))),
            "sync_manifest" => reply(&mut w, self.mirror.manifest(ns, req["root"].as_str().unwrap_or("")).map(|m| json!({"manifest": m}))),
            "sync_get" => match self.mirror.get(ns, req["root"].as_str().unwrap_or(""), req["path"].as_str().unwrap_or("")) {
                Ok(b) => { proto::write_json(&mut w, &json!({"ok": true, "len": b.len()}))?; w.write_all(&b)?; w.shutdown(); Ok(()) }
                Err(e) => reply(&mut w, Err(e)),
            },
            "sync_put" => {
                let body = proto::read_body(&mut r, req["len"].as_u64().unwrap_or(0), mirror::MAX_FILE)?;
                reply(&mut w, self.mirror.put(ns, req["root"].as_str().unwrap_or(""), req["path"].as_str().unwrap_or(""), &body, req["mtime"].as_i64().unwrap_or(0)).map(|_| json!({})))
            }
            "sync_put_many" => {
                let root = req["root"].as_str().unwrap_or("");
                let mut errors = serde_json::Map::new();
                for f in req["files"].as_array().into_iter().flatten() {
                    let body = proto::read_body(&mut r, f["len"].as_u64().unwrap_or(0), mirror::MAX_FILE)?;
                    let path = f["path"].as_str().unwrap_or("");
                    if let Err(e) = self.mirror.put(ns, root, path, &body, f["mtime"].as_i64().unwrap_or(0)) { errors.insert(path.into(), json!(e)); }
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
            "list" => reply(&mut w, Ok(json!({"metas": metas(ns)}))),
            "kill" => reply(&mut w, kill(&key(&req["key"]), req["pid"].as_u64().unwrap_or(0) as u32)),
            "pending" => reply(&mut w, Ok(json!({"pending": agent_core::pending::list(&pending)}))),
            "answer" => reply(&mut w, agent_core::pending::answer(&pending, req["id"].as_str().unwrap_or(""), &req["decision"]).map(|_| json!({}))),
            "history" => reply(&mut w, Ok(self.history(&req))),
            "exists" => reply(&mut w, Ok(json!({"dir": req["path"].as_str().is_some_and(|p| p.starts_with('/') && Path::new(p).is_dir())}))),
            "launch" => { self.revoked_closes(&fp, &w); self.launch(ns, &req, r, w) }
            "attach" => { self.revoked_closes(&fp, &w); attach(&key(&req["key"]), r, w) }
            _ => reply(&mut w, Err(format!("unknown request {op:?}"))),
        }
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
        list.retain(|c| c.fp != fp);
        // a second device with the same name gets a number, so revoke by name stays unambiguous
        let mut n = name.clone();
        let mut i = 2;
        while list.iter().any(|c| c.name == n) { n = format!("{name} {i}"); i += 1; }
        list.push(Client { name: n.clone(), fp: fp.into(), added: now() });
        save_clients(&self.data, &list).map_err(|e| e.to_string())?;
        Ok(json!({"name": n}))
    }

    fn history(&self, req: &Value) -> Value {
        use agent_core::AgentProvider;
        let (sid, from, cwd) = (req["sid"].as_str().unwrap_or(""), req["from"].as_u64().unwrap_or(0), req["cwd"].as_str().unwrap_or(""));
        let pending = self.data.join("pending");
        let env = agent_core::Env { home: &self.info.home, vault: cwd, path: &self.info.path, bin: &self.info.claude, pending: &pending, opts: &Value::Null };
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

    fn launch(&self, ns: &str, req: &Value, r: BufReader<tls::Reader>, mut w: tls::Writer) -> io::Result<()> {
        let parsed = serde_json::from_value::<Meta>(req["meta"].clone()).and_then(|m| Ok((m, serde_json::from_value::<Spec>(req["spec"].clone())?)));
        let (mut meta, spec) = match parsed { Ok(x) => x, Err(e) => return bang(&mut w, &format!("bad launch: {e}")) };
        meta.key = format!("{ns}:{}", meta.key);
        if spec.cwd.as_deref().is_some_and(|d| Path::new(d).starts_with(self.mirror.work_of(ns))) && !self.mirror.is_open(ns) {
            return bang(&mut w, &format!("the vault on {} is locked: it opens when Relay on your laptop connects", self.info.host));
        }
        if let Some(cwd) = spec.cwd.as_deref().filter(|d| !Path::new(d).is_dir()) { return bang(&mut w, &format!("folder {cwd} does not exist on {}", self.info.host)); }
        // its broker still runs (the app asked before it had taken the conversation back after a restart): that one
        // goes on, a second agent on the same session would write the transcript twice
        if UnixStream::connect(sock_of(&meta.key)).is_ok() { return attach(&meta.key, r, w); }
        // the broker connection launch makes is dropped at once: attach takes it over with a hello of its own
        match broker::launch_spec(&meta, &spec) { Ok(_) => attach(&meta.key, r, w), Err(e) => bang(&mut w, &e) }
    }
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
    Ok(proto::PairLine { host, port, fp, code }.format())
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
