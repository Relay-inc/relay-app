// `relay-serve`: the agents of a server, for a Relay app on another machine. It starts each conversation's agent
// under a broker (broker.rs) the way the app does, stays connected to every broker itself, and numbers the frames, so
// an app that drops off reattaches from the last frame it saw. The app keeps doing what it does for a local agent:
// parse the stream, answer relay-mail, draw. This side only runs things and reads the server's disk (transcripts,
// the pending folder).
//
// Not on a machine where the Relay app runs too: both keep their brokers in the same folder (broker::dir()) and
// would take each other's conversations at start. The tests set TMPDIR to keep them apart.
//
// Protocol: TCP, one JSON object per line. Requests carry an `id` and get `{id, ok: true, result}` or
// `{id, ok: false, error}`. The first request must be `hello` with the token. Frames of an attached conversation
// come unasked as `{ev: "frame", key, seq, f}`, where `f` is the broker's frame (`o <line>`, `e <line>`, `x <code>`),
// and `{ev: "ping"}` every 20 s. `seq` counts per run of the daemon: hello's `epoch` changes when it restarts.
//
//   hello {token}                                  -> {version, epoch, vault, providers: [{id, name, caps, detect}]}
//   spawn {key, provider, name, model?, effort?, resume?, fork?, mail?}  -> {pid}
//   attach {key, from}                             -> {next, replay}; then the `replay` buffered frames with
//                                                     seq >= from, then live
//   input {key, line} | kill {key} | running       -> running: [{key, provider, model, effort, pid, next, done}]
//   pending | answer {request, decision}      (request: the pending id)
//   history {provider, sid, from} | subagents {provider, sid} | agent_log {provider, sid, agent} | commands {provider}

use crate::{agents, broker};
use agent_core::{pending, AgentProvider, Env, Launch};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::{fs, thread};

// frames kept per conversation for a reattaching app, at most this many bytes (the broker's own bound)
const MAX_BUFFER: usize = 4 << 20;

/// `~/.config/relay/serve.json`: `{listen, token, vault, agents?}`; `agents` as in the app's settings.
pub struct Config { pub epoch: u64, pub listen: String, pub token: String, pub vault: String, pub settings: Value, pub pending: PathBuf, pub path: String, pub home: String }
impl Config {
    pub fn load(file: &str) -> Result<Config, String> {
        let mut v: Value = serde_json::from_str(&fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?).map_err(|e| format!("{file}: {e}"))?;
        let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
        let (listen, token, vault) = (s("listen"), s("token"), s("vault"));
        if listen.is_empty() || token.len() < 16 || vault.is_empty() { return Err(format!("{file}: needs listen, vault and a token of 16+ characters")); }
        agents::migrate(&mut v);
        let pending = PathBuf::from(file).parent().unwrap_or(std::path::Path::new(".")).join("pending");
        fs::create_dir_all(&pending).map_err(|e| e.to_string())?;
        let epoch = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
        Ok(Config { epoch, listen, token, vault, settings: v, pending, path: crate::login_path(), home: crate::home() })
    }
    fn opts(&self, p: &dyn AgentProvider, mail: bool) -> Value {
        let mut o = self.settings["agents"]["providers"][p.id()].clone();
        if p.id() == "claude" && o.is_object() { o["mail"] = json!(mail); }
        o
    }
    fn with_env<T>(&self, p: &dyn AgentProvider, mail: bool, f: impl FnOnce(&Env) -> T) -> T {
        let (bin, opts) = (agents::bin(&self.settings, p, &self.home, &self.path), self.opts(p, mail));
        f(&Env { home: &self.home, vault: &self.vault, path: &self.path, bin: &bin, pending: &self.pending, opts: &opts })
    }
}

type Client = Arc<Mutex<TcpStream>>;
struct Conv { stdin: UnixStream, pid: u32, provider: String, model: String, effort: String, buf: VecDeque<(u64, String)>, bytes: usize, next: u64, done: bool, subs: Vec<(u64, Client)> }
#[derive(Default)]
struct Hub { convs: HashMap<String, Conv> }

fn send(c: &Client, v: &Value) -> bool { let mut s = c.lock().unwrap(); writeln!(s, "{v}").and_then(|_| s.flush()).is_ok() }

/// Hold a broker connection: every frame numbered, buffered and passed to the attached clients.
fn follow(hub: &Arc<Mutex<Hub>>, key: String, pid: u32, frames: BufReader<UnixStream>) {
    let hub = hub.clone();
    thread::spawn(move || {
        for f in frames.lines().map_while(Result::ok) {
            let exit = matches!(broker::frame(&f), broker::Frame::Exit);
            let mut h = hub.lock().unwrap();
            let Some(c) = h.convs.get_mut(&key).filter(|c| c.pid == pid) else { return };
            let seq = c.next;
            c.next += 1;
            c.bytes += f.len();
            // ponytail: a slow client holds the hub lock while it is written to; a queue per client if that bites
            c.subs.retain(|(_, cl)| send(cl, &json!({"ev": "frame", "key": key, "seq": seq, "f": f})));
            c.buf.push_back((seq, f));
            while c.bytes > MAX_BUFFER { if let Some((_, f)) = c.buf.pop_front() { c.bytes -= f.len(); } else { break; } }
            if exit { c.done = true; broker::forget(&key, pid); return; }
        }
    });
}

fn add(hub: &Arc<Mutex<Hub>>, key: &str, provider: &str, model: &str, effort: &str, c: broker::Conn) -> u32 {
    let pid = c.agent.id();
    hub.lock().unwrap().convs.insert(key.into(), Conv { stdin: c.stdin, pid, provider: provider.into(), model: model.into(), effort: effort.into(),
        buf: VecDeque::new(), bytes: 0, next: 0, done: false, subs: vec![] });
    follow(hub, key.into(), pid, c.frames);
    pid
}

/// The brokers that outlived a previous run of this daemon.
fn reattach(hub: &Arc<Mutex<Hub>>) {
    let Ok(dir) = fs::read_dir(broker::dir()) else { return };
    for m in dir.flatten().filter_map(|e| broker::load_meta(&e.path())) {
        if let Some(c) = broker::reattach(&m.key) { add(hub, &m.key, &m.provider, &m.model, &m.effort, c); }
    }
}

fn kill(pid: u32) { std::process::Command::new("/bin/kill").args(["-9", &pid.to_string()]).status().ok(); }

fn spawn(cfg: &Config, hub: &Arc<Mutex<Hub>>, r: &Value) -> Result<Value, String> {
    let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
    let key = s("key");
    if key.is_empty() { return Err("no key".into()); }
    let p = agents::find(&s("provider")).ok_or("unknown provider")?;
    let (model, effort) = (s("model"), s("effort"));
    if !model.is_empty() && !agent_core::safe_model(&model) { return Err("bad model".into()); }
    if !effort.is_empty() && !p.efforts().iter().any(|c| c.id == effort) { return Err("bad effort".into()); }
    let (resume, fork) = (s("resume"), s("fork"));
    let ok = |id: &String| !id.is_empty() && p.valid_session(id);
    let name = Some(s("name")).filter(|n| !n.is_empty()).unwrap_or_else(|| key.clone());
    let l = Launch { key: &key, name: &name, model: &model, effort: &effort, resume: Some(&resume).filter(|x| ok(x)).map(|x| x.as_str()),
        fork: Some(&fork).filter(|x| ok(x) && resume.is_empty() && p.caps().fork).map(|x| x.as_str()), turn: None };
    let mut cmd = cfg.with_env(p, r["mail"] == true, |env| p.command(env, &l))?;
    // ponytail: no `relay` actions on the PATH yet (phase 4 forwards them to the app)
    cmd.current_dir(&cfg.vault).env("PATH", &cfg.path).env("RELAY_CONVERSATION", &key);
    if let Some(old) = hub.lock().unwrap().convs.remove(&key) { if !old.done { kill(old.pid); } }
    let meta = broker::Meta { key: key.clone(), provider: p.id().into(), model: model.clone(), effort: effort.clone(), tainted: false, pid: 0 };
    let c = broker::launch(&meta, &cmd).map_err(|e| format!("{} start: {e}", p.id()))?;
    Ok(json!({"pid": add(hub, &key, p.id(), &model, &effort, c)}))
}

fn handle(cfg: &Config, hub: &Arc<Mutex<Hub>>, me: (u64, &Client), r: &Value) -> Result<Value, String> {
    let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
    let provider = || agents::find(&s("provider")).ok_or_else(|| "unknown provider".to_string());
    let sid = |p: &dyn AgentProvider| Some(s("sid")).filter(|x| p.valid_session(x)).ok_or_else(|| "bad session".to_string());
    match s("cmd").as_str() {
        "spawn" => spawn(cfg, hub, r),
        "attach" => {
            let mut h = hub.lock().unwrap();
            let c = h.convs.get_mut(&s("key")).ok_or("not running")?;
            let from = r["from"].as_u64().unwrap_or(0);
            c.subs.retain(|(id, _)| *id != me.0);
            // the reply and the buffered frames go out under the lock, so a live frame cannot overtake them
            let replay = c.buf.iter().filter(|(seq, _)| *seq >= from).count();
            send(me.1, &json!({"id": r["id"], "ok": true, "result": {"next": c.next, "replay": replay}}));
            for (seq, f) in c.buf.iter().filter(|(seq, _)| *seq >= from) { send(me.1, &json!({"ev": "frame", "key": s("key"), "seq": seq, "f": f})); }
            c.subs.push((me.0, me.1.clone()));
            Err(String::new()) // already answered
        }
        "input" => {
            let mut h = hub.lock().unwrap();
            let c = h.convs.get_mut(&s("key")).filter(|c| !c.done).ok_or("not running")?;
            writeln!(c.stdin, "{}", s("line")).and_then(|_| c.stdin.flush()).map_err(|e| e.to_string())?;
            Ok(json!(null))
        }
        "kill" => { if let Some(c) = hub.lock().unwrap().convs.get(&s("key")).filter(|c| !c.done) { kill(c.pid); } Ok(json!(null)) }
        "running" => Ok(hub.lock().unwrap().convs.iter().map(|(k, c)| json!({"key": k, "provider": c.provider, "model": c.model, "effort": c.effort,
            "pid": c.pid, "next": c.next, "done": c.done})).collect()),
        "pending" => Ok(json!(pending::list(&cfg.pending))),
        "answer" => {
            let id = s("request");
            if !pending::valid_id(&id) { return Err("bad id".into()); }
            pending::answer(&cfg.pending, &id, &r["decision"]).map(|_| json!(null))
        }
        "history" => { let p = provider()?; let sid = sid(p)?;
            let (items, next) = cfg.with_env(p, false, |env| p.history(env, &sid, r["from"].as_u64().unwrap_or(0)));
            Ok(json!({"items": items, "next": next})) }
        "subagents" => { let p = provider()?; let sid = sid(p)?; Ok(json!(cfg.with_env(p, false, |env| p.subagents(env, &sid)))) }
        "agent_log" => { let p = provider()?; let sid = sid(p)?; Ok(json!(cfg.with_env(p, false, |env| p.agent_log(env, &sid, &s("agent"))))) }
        "commands" => { let p = provider()?; Ok(cfg.with_env(p, false, |env| p.commands(env))) }
        other => Err(format!("unknown cmd {other:?}")),
    }
}

fn hello(cfg: &Config, r: &Value) -> Result<Value, String> {
    let t = r["token"].as_str().unwrap_or("").as_bytes();
    // the same time for every wrong token of the right length
    if t.len() != cfg.token.len() || t.iter().zip(cfg.token.as_bytes()).fold(0, |a, (x, y)| a | (x ^ y)) != 0 { return Err("bad token".into()); }
    let providers: Vec<Value> = agents::enabled(&cfg.settings).into_iter()
        .map(|p| json!({"id": p.id(), "name": p.name(), "caps": p.caps(), "detect": cfg.with_env(p, false, |env| p.detect(env))})).collect();
    Ok(json!({"version": env!("CARGO_PKG_VERSION"), "epoch": cfg.epoch, "vault": cfg.vault, "providers": providers}))
}

fn client(cfg: Arc<Config>, hub: Arc<Mutex<Hub>>, id: u64, s: TcpStream) {
    let Ok(w) = s.try_clone() else { return };
    let me: Client = Arc::new(Mutex::new(w));
    // a ping every 20 s, so the app notices a dead connection (remote.rs reads with a timeout)
    let ping = me.clone();
    thread::spawn(move || while send(&ping, &json!({"ev": "ping"})) { thread::sleep(std::time::Duration::from_secs(20)); });
    let mut authed = false;
    for line in BufReader::new(s).lines().map_while(Result::ok) {
        let r: Value = match serde_json::from_str(&line) { Ok(r) => r, Err(_) => break };
        let res = if r["cmd"] == "hello" { hello(&cfg, &r) } else if !authed { Err("hello first".into()) } else { handle(&cfg, &hub, (id, &me), &r) };
        let reply = match res {
            Ok(v) => { authed |= r["cmd"] == "hello"; json!({"id": r["id"], "ok": true, "result": v}) }
            Err(e) if e.is_empty() => continue,
            Err(e) => json!({"id": r["id"], "ok": false, "error": e}),
        };
        if !send(&me, &reply) || (!authed && r["cmd"] == "hello") { break; }
    }
    for c in hub.lock().unwrap().convs.values_mut() { c.subs.retain(|(i, _)| *i != id); }
}

pub fn main(file: &str) -> Result<(), String> {
    let cfg = Arc::new(Config::load(file)?);
    let hub = Arc::new(Mutex::new(Hub::default()));
    reattach(&hub);
    let l = TcpListener::bind(&cfg.listen).map_err(|e| format!("{}: {e}", cfg.listen))?;
    eprintln!("relay-serve {} on {}, vault {}", env!("CARGO_PKG_VERSION"), cfg.listen, cfg.vault);
    for (id, s) in l.incoming().flatten().enumerate() {
        let (cfg, hub) = (cfg.clone(), hub.clone());
        thread::spawn(move || client(cfg, hub, id as u64, s));
    }
    Ok(())
}
