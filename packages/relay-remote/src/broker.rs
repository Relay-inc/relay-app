// The broker: one small process per conversation that holds the agent's pipes, so the conversation survives the app
// quitting. It is this same binary started as `relay --broker <socket> <spec>` (main.rs), about 2 MB of its own
// memory, idle while it waits. The app talks to it over a Unix socket and gets the agent back after a restart.
//
// Socket, one line each. Broker: `p <pid> ?` first (the agent's pid), or `! <error>` when the agent did not start. App:
// `i <id>`, who is connecting (`app` for this Mac's app, a device's fingerprint over a relay-server, empty for a
// connection that only waits for the start). Broker: `n <count>`, how many lines follow that this id has not had yet;
// then `o <line>` for the agent's stdout, `e <line>` for its stderr, `x <code>` when it exited. App to broker: raw lines
// for the agent's stdin. A broker from before ids (the app updated while it ran) says `p <pid> <count>` and takes no id.
//
// Several apps may follow one conversation (the laptop and its phone): every line goes to each, and each id gets what
// it missed when it comes back, without taking the conversation from the others. A second connection with the same id
// replaces the first. Without any app the broker buffers the agent's output and replays it on reconnect. After its grace without the app it
// closes the agent's stdin and removes its socket: the agent finishes its turn and exits, as it did before brokers,
// so nothing lingers when the app stays closed.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::sync::OnceLock;
use std::os::unix::net::{UnixListener, UnixStream};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::{fs, thread};

// how long a broker waits for the app before it winds its agent down; a relay-server sets RELAY_BROKER_GRACE_SECS
// for its brokers, so a conversation there keeps its process while the laptop is closed for the night
fn grace() -> Duration {
    static G: OnceLock<Duration> = OnceLock::new();
    *G.get_or_init(|| Duration::from_secs(std::env::var("RELAY_BROKER_GRACE_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(15 * 60)))
}
// output buffered while the app is away, at most this many bytes; the oldest lines go first (one Claude line can
// carry a whole file, so a line count would not bound the memory)
const MAX_BACKLOG: usize = 4 << 20;
// how long a new connection has to say who it is, and how long one line to an app may block before that app is dropped
const HELLO: Duration = Duration::from_secs(10);
const STALL: Duration = Duration::from_secs(30);
// the broker's threads only shuttle lines, their stacks stay small
const STACK: usize = 128 << 10;
fn spawn<F: FnOnce() + Send + 'static>(f: F) -> thread::JoinHandle<()> { thread::Builder::new().stack_size(STACK).spawn(f).expect("broker thread") }

/// The provider's command, owned, so it crosses into the broker process (and over the wire to a relay-server).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Spec { pub program: String, pub args: Vec<String>, pub env: Vec<(String, Option<String>)>, pub cwd: Option<String> }
impl Spec {
    pub fn of(cmd: &Command) -> Spec {
        let s = |o: &std::ffi::OsStr| o.to_string_lossy().into_owned();
        Spec { program: s(cmd.get_program()), args: cmd.get_args().map(s).collect(),
            env: cmd.get_envs().map(|(k, v)| (s(k), v.map(s))).collect(), cwd: cmd.get_current_dir().map(|d| d.to_string_lossy().into_owned()) }
    }
    fn command(&self) -> Command {
        let mut c = Command::new(&self.program);
        c.args(&self.args);
        for (k, v) in &self.env { match v { Some(v) => { c.env(k, v); } None => { c.env_remove(k); } } }
        if let Some(d) = &self.cwd { c.current_dir(d); }
        c
    }
}

/// What the app keeps next to the socket, to take a conversation back after a restart.
#[derive(Serialize, Deserialize, Clone)]
/// `pid`: the agent's, so the end of one process never removes the file of the one that replaced it.
/// `turns`: the turns running (see Proc in lib.rs), so a restart only shows the ones that really are; a file from
/// before it was kept counts one, as every reattached agent did.
pub struct Meta { pub key: String, pub provider: String, pub model: String, pub effort: String, pub tainted: bool, #[serde(default)] pub pid: u32, #[serde(default)] pub account: String,
    #[serde(default = "one")] pub turns: u32 }
fn one() -> u32 { 1 }

/// The folder with the sockets: short, because a socket path has a 104-byte limit on macOS. A relay-server keeps its
/// own (RELAY_AGENTS_DIR), so an app on the same Mac never takes over the server's conversations.
pub fn dir() -> PathBuf { std::env::var_os("RELAY_AGENTS_DIR").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("relay-agents")) }
fn base(key: &str) -> PathBuf { dir().join(&sha1_smol::Sha1::from(key).digest().to_string()[..12]) }
pub fn meta_path(key: &str) -> PathBuf { base(key).with_extension("json") }
fn sock_path(key: &str) -> PathBuf { base(key).with_extension("sock") }
pub fn save_meta(m: &Meta) { fs::write(meta_path(&m.key), serde_json::to_string(m).unwrap()).ok(); }
pub fn load_meta(path: &Path) -> Option<Meta> { serde_json::from_str(&fs::read_to_string(path).ok()?).ok() }
/// The turns the agent with this pid has running, for after a restart.
pub fn save_turns(key: &str, pid: u32, turns: u32) {
    if let Some(m) = load_meta(&meta_path(key)).filter(|m| m.pid == pid) { save_meta(&Meta { turns, ..m }); }
}
/// The agent with this pid is gone: its file goes, unless a newer process of the conversation already wrote its own.
pub fn forget(key: &str, pid: u32) { if load_meta(&meta_path(key)).is_some_and(|m| m.pid == pid) { fs::remove_file(meta_path(key)).ok(); } }

/// How to stop an agent that runs on another machine: its relay-server kills it by pid.
pub type Stop = std::sync::Arc<dyn Fn(u32) -> std::io::Result<()> + Send + Sync>;
/// The agent a broker runs: its pid, for the app's "is this still the same process" checks, and to stop it.
pub struct Agent { pid: u32, stop: Option<Stop> }
impl From<u32> for Agent { fn from(pid: u32) -> Self { Agent { pid, stop: None } } }
impl Agent {
    /// An agent on a work machine, stopped through its server.
    pub fn remote(pid: u32, stop: Stop) -> Self { Agent { pid, stop: Some(stop) } }
    pub fn id(&self) -> u32 { self.pid }
    /// Stops the agent; its broker then reports the exit and quits too.
    pub fn kill(&mut self) -> std::io::Result<()> {
        match &self.stop {
            Some(f) => f(self.pid),
            // the system call, not /bin/kill: a minimal Linux install has no such file
            None => if self.pid > 0 && unsafe { libc::kill(self.pid as libc::pid_t, libc::SIGKILL) } == 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) },
        }
    }
}
/// A connection to a broker: the agent, where its stdin goes, and the frames to read (the first `backlog` were
/// buffered while the app was away). Local brokers are a Unix socket, a work machine's a TLS stream.
pub struct Conn { pub agent: Agent, pub stdin: Box<dyn Write + Send>, pub frames: Box<dyn BufRead + Send>, pub backlog: usize }

/// The id this Mac's app connects to its own brokers with.
pub const APP: &str = "app";
/// Start a broker for `cmd` and connect to it, as the app.
pub fn launch(meta: &Meta, cmd: &Command) -> Result<Conn, String> { launch_as(meta, &Spec::of(cmd), APP) }
/// Start a broker for a Spec, the way a relay-server gets it from the app, and wait until it runs. The connection
/// takes no lines: the device that asked attaches with its own id and gets them all.
pub fn launch_spec(meta: &Meta, spec: &Spec) -> Result<Conn, String> { launch_as(meta, spec, "") }
fn launch_as(meta: &Meta, spec: &Spec, id: &str) -> Result<Conn, String> {
    fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let sock = sock_path(&meta.key);
    fs::remove_file(&sock).ok();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let spec = serde_json::to_string(spec).unwrap();
    // its own process group, so a Ctrl-C on `tauri dev` does not reach it; waited for, so it leaves no zombie
    let mut b = Command::new(exe).arg("--broker").arg(&sock).arg(spec).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .process_group(0).spawn().map_err(|e| format!("broker: {e}"))?;
    spawn(move || { b.wait().ok(); });
    for _ in 0..100 {
        if let Ok(c) = connect(&sock, id) {
            if let Ok(c) = &c { save_meta(&Meta { pid: c.agent.id(), ..meta.clone() }); }
            return c;
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err("broker: no socket".into())
}
/// Take back a conversation whose broker outlived the app. None when there is none (it ended, or its grace ran out).
pub fn reattach(key: &str) -> Option<Conn> { connect(&sock_path(key), APP).ok()?.ok() }
/// Follow a conversation as `id` beside the apps (a relay-server's notifications): every line from now on, and what
/// that id missed. None when its broker is gone.
pub fn follow(key: &str, id: &str) -> Option<Conn> { connect(&sock_path(key), id).ok()?.ok() }

fn connect(sock: &Path, id: &str) -> std::io::Result<Result<Conn, String>> {
    let s = UnixStream::connect(sock)?;
    let frames = BufReader::new(s.try_clone()?);
    open(Box::new(s), Box::new(frames), id)
}
/// Say hello to a broker over any stream as `id`: the agent and the lines this id missed, or why it did not start.
pub fn open(mut stdin: Box<dyn Write + Send>, mut frames: Box<dyn BufRead + Send>, id: &str) -> std::io::Result<Result<Conn, String>> {
    let mut hello = String::new();
    frames.read_line(&mut hello)?;
    let mut w = hello.trim_end().splitn(3, ' ');
    Ok(match (w.next(), w.next(), w.next()) {
        (Some("p"), Some(pid), Some("?")) => {
            writeln!(stdin, "i {id}")?;
            stdin.flush()?;
            let mut n = String::new();
            frames.read_line(&mut n)?;
            let backlog = n.trim_end().strip_prefix("n ").and_then(|n| n.parse().ok()).ok_or_else(|| std::io::Error::other(format!("broker: {}", n.trim())))?;
            Ok(Conn { agent: Agent::from(pid.parse::<u32>().unwrap_or(0)), stdin, frames, backlog })
        }
        (Some("p"), Some(pid), Some(n)) => Ok(Conn { agent: Agent::from(pid.parse::<u32>().unwrap_or(0)), stdin, frames, backlog: n.parse().unwrap_or(0) }),
        (Some("!"), ..) => Err(hello.get(2..).unwrap_or("").trim().to_string()),
        _ => Err(format!("broker: {}", hello.trim())),
    })
}

/// One frame from a broker.
pub enum Frame { Out(String), Err(String), Exit }
pub fn frame(line: &str) -> Frame {
    match line.split_at(line.len().min(2)) { ("o ", l) => Frame::Out(l.into()), ("e ", l) => Frame::Err(l.into()), _ => Frame::Exit }
}

// ---------- the broker process

// A connected app: gen tells two connections of the same id apart, so an old one ending does not drop a newer one.
struct Client { id: String, gen: u64, s: UnixStream }
// ring: the lines some id that connected before has not had yet, the first numbered `first`; seen: per id, the number
// of the next line it gets. winding: stdin closed after GRACE, no more connections.
struct State { clients: Vec<Client>, seen: HashMap<String, u64>, ring: VecDeque<String>, first: u64, bytes: usize, gen: u64, away: Option<Instant>, winding: bool }
impl State {
    fn next(&self) -> u64 { self.first + self.ring.len() as u64 }
    // to every app; kept until every id that came before has it
    fn send(&mut self, frame: String) {
        let n = self.next();
        let State { clients, seen, .. } = self;
        clients.retain_mut(|c| {
            let ok = writeln!(c.s, "{frame}").is_ok();
            if ok { seen.insert(c.id.clone(), n + 1); } else { c.s.shutdown(std::net::Shutdown::Both).ok(); }
            ok
        });
        if self.clients.is_empty() && self.away.is_none() { self.away = Some(Instant::now()); }
        self.bytes += frame.len();
        self.ring.push_back(frame);
        self.trim();
    }
    // what every id has goes; past MAX_BACKLOG the oldest goes anyway
    fn trim(&mut self) {
        let low = self.seen.values().min().copied().unwrap_or(self.first);
        while self.first < low || self.bytes > MAX_BACKLOG {
            let Some(f) = self.ring.pop_front() else { break };
            self.bytes -= f.len();
            self.first += 1;
        }
    }
    fn gone(&mut self, gen: u64) {
        self.clients.retain(|c| c.gen != gen);
        if self.clients.is_empty() && self.away.is_none() { self.away = Some(Instant::now()); }
    }
}

pub fn main(sock: &str, spec: &str) {
    let listener = UnixListener::bind(sock).unwrap_or_else(|_| std::process::exit(1));
    let child = serde_json::from_str::<Spec>(spec).map_err(|e| e.to_string())
        .and_then(|s| s.command().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string()));
    let mut child = match child {
        Ok(c) => c,
        Err(e) => { // tell the app why, then go
            if let Ok((mut c, _)) = listener.accept() { writeln!(c, "! {e}").ok(); }
            fs::remove_file(sock).ok(); return;
        }
    };
    let pid = child.id();
    let st = Arc::new(Mutex::new(State { clients: Vec::new(), seen: HashMap::new(), ring: VecDeque::new(), first: 0, bytes: 0, gen: 0, away: Some(Instant::now()), winding: false }));
    // its own lock: a write that blocks on a full pipe must not hold up the output threads
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let pipe = |r: Box<dyn std::io::Read + Send>, tag: &'static str| {
        let st = st.clone();
        spawn(move || for l in BufReader::new(r).lines().map_while(Result::ok) { st.lock().unwrap().send(format!("{tag} {l}")); })
    };
    let out = pipe(Box::new(child.stdout.take().unwrap()), "o");
    let err = pipe(Box::new(child.stderr.take().unwrap()), "e");
    // the agent ends: the rest of its output, its exit code, then the broker goes
    let (st2, sock2) = (st.clone(), sock.to_string());
    spawn(move || {
        out.join().ok(); err.join().ok();
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        st2.lock().unwrap().send(format!("x {code}"));
        fs::remove_file(&sock2).ok();
        std::process::exit(0);
    });
    // the app away longer than GRACE: close the agent's stdin and the socket, the agent winds down on its own
    let (st3, in3, sock3) = (st.clone(), stdin.clone(), sock.to_string());
    spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let mut s = st3.lock().unwrap();
        if s.clients.is_empty() && s.away.is_some_and(|t| t.elapsed() > grace()) { s.winding = true; *in3.lock().unwrap() = None; fs::remove_file(&sock3).ok(); return; }
    });
    for conn in listener.incoming() {
        let Ok(c) = conn else { continue };
        if st.lock().unwrap().winding { continue; } // winding down: the app follows the transcript instead
        // its own thread: waiting for an app's id must not hold up the others
        let (st4, in4) = (st.clone(), stdin.clone());
        spawn(move || {
            let Ok(mut c2) = c.try_clone() else { return };
            if writeln!(c2, "p {pid} ?").is_err() { return; }
            let mut r = BufReader::new(c);
            let mut hello = String::new();
            r.get_ref().set_read_timeout(Some(HELLO)).ok();
            if r.read_line(&mut hello).is_err() { return; }
            r.get_ref().set_read_timeout(None).ok();
            let Some(id) = hello.strip_prefix("i ").map(|i| i.trim_end().to_string()) else { return };
            // a stalled app (a phone gone out of range) must not hold up the agent or the others: it is dropped, and
            // gets the lines again when it comes back
            c2.set_write_timeout(Some(STALL)).ok();
            let mut s = st4.lock().unwrap();
            // no id: a connection that waited for the start (and may write a first line), it gets no output
            let gen = if id.is_empty() {
                if writeln!(c2, "n 0").is_err() { return; }
                None
            } else {
                let from = s.seen.get(&id).copied().unwrap_or(s.first).max(s.first);
                let skip = (from - s.first) as usize;
                let sent = writeln!(c2, "n {}", s.ring.len() - skip).is_ok() && s.ring.iter().skip(skip).all(|f| writeln!(c2, "{f}").is_ok());
                if !sent { return; } // the lines stay for its next connection
                // a new connection of the same app replaces the old one
                s.clients.retain(|o| { let same = o.id == id; if same { o.s.shutdown(std::net::Shutdown::Both).ok(); } !same });
                s.gen += 1;
                let gen = s.gen;
                let next = s.next();
                s.seen.insert(id.clone(), next);
                s.clients.push(Client { id, gen, s: c2 });
                s.away = None;
                s.trim();
                Some(gen)
            };
            drop(s);
            // the app's lines go to the agent's stdin; when the app goes, the agent keeps running
            for l in r.lines().map_while(Result::ok) {
                if let Some(i) = &mut *in4.lock().unwrap() { if writeln!(i, "{l}").and_then(|_| i.flush()).is_err() { break; } }
            }
            if let Some(gen) = gen { st4.lock().unwrap().gone(gen); }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn turns_survive_a_restart() {
        // a file from before turns were kept: one running, as before
        let old: Meta = serde_json::from_str(r#"{"key":"k","provider":"claude","model":"","effort":"","tainted":false,"pid":7}"#).unwrap();
        assert_eq!(old.turns, 1);
        fs::create_dir_all(dir()).unwrap();
        let key = format!("test-turns-{}", std::process::id());
        save_meta(&Meta { key: key.clone(), provider: "claude".into(), model: String::new(), effort: String::new(), tainted: false, pid: 7, account: String::new(), turns: 1 });
        save_turns(&key, 7, 0);
        assert_eq!(load_meta(&meta_path(&key)).unwrap().turns, 0);
        save_turns(&key, 8, 3); // another process of the conversation: not this file
        assert_eq!(load_meta(&meta_path(&key)).unwrap().turns, 0);
        fs::remove_file(meta_path(&key)).ok();
    }
}
