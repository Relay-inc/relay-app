// The broker: one small process per conversation that holds the agent's pipes, so the conversation survives the app
// quitting. It is this same binary started as `relay --broker <socket> <spec>` (main.rs), about 2 MB of its own
// memory, idle while it waits. The app talks to it over a Unix socket and gets the agent back after a restart.
//
// Socket, broker to app, one line each: `p <pid> <backlog>` first (the agent's pid, how many buffered lines follow),
// or `! <error>` when the agent did not start; then `o <line>` for the agent's stdout, `e <line>` for its stderr,
// `x <code>` when it exited. App to broker: raw lines for the agent's stdin.
//
// Without the app the broker buffers the agent's output and replays it on reconnect. After GRACE without the app it
// closes the agent's stdin and removes its socket: the agent finishes its turn and exits, as it did before brokers,
// so nothing lingers when the app stays closed.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::{fs, thread};

const GRACE: Duration = Duration::from_secs(15 * 60);
// ponytail: output buffered without the app is capped by line count; the oldest lines go first
const MAX_BACKLOG: usize = 20_000;

/// The provider's command, owned, so it crosses into the broker process.
#[derive(Serialize, Deserialize)]
struct Spec { program: String, args: Vec<String>, env: Vec<(String, Option<String>)>, cwd: Option<String> }
impl Spec {
    fn of(cmd: &Command) -> Spec {
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
pub struct Meta { pub key: String, pub provider: String, pub model: String, pub effort: String, pub tainted: bool, #[serde(default)] pub pid: u32 }

/// The folder with the sockets: short, because a socket path has a 104-byte limit on macOS.
pub fn dir() -> PathBuf { std::env::temp_dir().join("relay-agents") }
fn base(key: &str) -> PathBuf { dir().join(&sha1_smol::Sha1::from(key).digest().to_string()[..12]) }
pub fn meta_path(key: &str) -> PathBuf { base(key).with_extension("json") }
fn sock_path(key: &str) -> PathBuf { base(key).with_extension("sock") }
pub fn save_meta(m: &Meta) { fs::write(meta_path(&m.key), serde_json::to_string(m).unwrap()).ok(); }
pub fn load_meta(path: &Path) -> Option<Meta> { serde_json::from_str(&fs::read_to_string(path).ok()?).ok() }
/// The agent with this pid is gone: its file goes, unless a newer process of the conversation already wrote its own.
pub fn forget(key: &str, pid: u32) { if load_meta(&meta_path(key)).is_some_and(|m| m.pid == pid) { fs::remove_file(meta_path(key)).ok(); } }

/// The agent a broker runs: its pid, for the app's "is this still the same process" checks, and to stop it.
pub struct Agent { pid: u32 }
impl From<u32> for Agent { fn from(pid: u32) -> Self { Agent { pid } } }
impl Agent {
    pub fn id(&self) -> u32 { self.pid }
    /// Stops the agent; its broker then reports the exit and quits too.
    pub fn kill(&mut self) -> std::io::Result<()> { Command::new("/bin/kill").args(["-9", &self.pid.to_string()]).status().map(|_| ()) }
}
/// A connection to a broker: the agent, where its stdin goes, and the frames to read (the first `backlog` were
/// buffered while the app was away).
pub struct Conn { pub agent: Agent, pub stdin: UnixStream, pub frames: BufReader<UnixStream>, pub backlog: usize }

/// Start a broker for `cmd` and connect to it.
pub fn launch(meta: &Meta, cmd: &Command) -> Result<Conn, String> {
    fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let sock = sock_path(&meta.key);
    fs::remove_file(&sock).ok();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let spec = serde_json::to_string(&Spec::of(cmd)).unwrap();
    // its own process group, so a Ctrl-C on `tauri dev` does not reach it; waited for, so it leaves no zombie
    let mut b = Command::new(exe).arg("--broker").arg(&sock).arg(spec).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .process_group(0).spawn().map_err(|e| format!("broker: {e}"))?;
    thread::spawn(move || { b.wait().ok(); });
    for _ in 0..100 {
        if let Ok(c) = connect(&sock) {
            if let Ok(c) = &c { save_meta(&Meta { pid: c.agent.id(), ..meta.clone() }); }
            return c;
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err("broker: no socket".into())
}
/// Take back a conversation whose broker outlived the app. None when there is none (it ended, or its grace ran out).
pub fn reattach(key: &str) -> Option<Conn> { connect(&sock_path(key)).ok()?.ok() }

fn connect(sock: &Path) -> std::io::Result<Result<Conn, String>> {
    let s = UnixStream::connect(sock)?;
    let mut frames = BufReader::new(s.try_clone()?);
    let mut hello = String::new();
    frames.read_line(&mut hello)?;
    let mut w = hello.trim_end().splitn(3, ' ');
    Ok(match (w.next(), w.next(), w.next()) {
        (Some("p"), Some(pid), Some(n)) => Ok(Conn { agent: Agent { pid: pid.parse().unwrap_or(0) }, stdin: s, frames, backlog: n.parse().unwrap_or(0) }),
        (Some("!"), ..) => Err(hello[2..].trim().to_string()),
        _ => Err(format!("broker: {}", hello.trim())),
    })
}

/// One frame from a broker.
pub enum Frame { Out(String), Err(String), Exit }
pub fn frame(line: &str) -> Frame {
    match line.split_at(line.len().min(2)) { ("o ", l) => Frame::Out(l.into()), ("e ", l) => Frame::Err(l.into()), _ => Frame::Exit }
}

// ---------- the broker process

// gen: which app connection is current, so an old one ending does not mark a newer one gone
// winding: stdin closed after GRACE, no more connections
struct State { client: Option<UnixStream>, gen: u64, away: Option<Instant>, backlog: VecDeque<String>, winding: bool }
impl State {
    // to the app, or into the backlog while it is away
    fn send(&mut self, frame: String) {
        if let Some(c) = &mut self.client {
            if writeln!(c, "{frame}").is_ok() { return; }
            self.client = None; self.away = Some(Instant::now());
        }
        if self.backlog.len() == MAX_BACKLOG { self.backlog.pop_front(); }
        self.backlog.push_back(frame);
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
    let st = Arc::new(Mutex::new(State { client: None, gen: 0, away: Some(Instant::now()), backlog: VecDeque::new(), winding: false }));
    // its own lock: a write that blocks on a full pipe must not hold up the output threads
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let pipe = |r: Box<dyn std::io::Read + Send>, tag: &'static str| {
        let st = st.clone();
        thread::spawn(move || for l in BufReader::new(r).lines().map_while(Result::ok) { st.lock().unwrap().send(format!("{tag} {l}")); })
    };
    let out = pipe(Box::new(child.stdout.take().unwrap()), "o");
    let err = pipe(Box::new(child.stderr.take().unwrap()), "e");
    // the agent ends: the rest of its output, its exit code, then the broker goes
    let (st2, sock2) = (st.clone(), sock.to_string());
    thread::spawn(move || {
        out.join().ok(); err.join().ok();
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        st2.lock().unwrap().send(format!("x {code}"));
        fs::remove_file(&sock2).ok();
        std::process::exit(0);
    });
    // the app away longer than GRACE: close the agent's stdin and the socket, the agent winds down on its own
    let (st3, in3, sock3) = (st.clone(), stdin.clone(), sock.to_string());
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let mut s = st3.lock().unwrap();
        if s.client.is_none() && s.away.is_some_and(|t| t.elapsed() > GRACE) { s.winding = true; *in3.lock().unwrap() = None; fs::remove_file(&sock3).ok(); return; }
    });
    for conn in listener.incoming() {
        let Ok(c) = conn else { continue };
        let mut s = st.lock().unwrap();
        if s.winding { continue; } // winding down: the app follows the transcript instead
        let mut c2 = match c.try_clone() { Ok(x) => x, Err(_) => continue };
        // a new app connection replaces the old one and gets what it missed
        if let Some(old) = s.client.take() { old.shutdown(std::net::Shutdown::Both).ok(); }
        let sent = writeln!(c2, "p {pid} {}", s.backlog.len()).is_ok() && s.backlog.iter().all(|f| writeln!(c2, "{f}").is_ok());
        if !sent { continue; } // the backlog stays for the next connection
        s.backlog.clear();
        s.client = Some(c2); s.away = None; s.gen += 1;
        let gen = s.gen;
        drop(s);
        // the app's lines go to the agent's stdin; when the app goes, the agent keeps running
        let (st4, in4) = (st.clone(), stdin.clone());
        thread::spawn(move || {
            for l in BufReader::new(c).lines().map_while(Result::ok) {
                if let Some(i) = &mut *in4.lock().unwrap() { if writeln!(i, "{l}").and_then(|_| i.flush()).is_err() { break; } }
            }
            let mut s = st4.lock().unwrap();
            if s.gen == gen { s.client = None; s.away = Some(Instant::now()); }
        });
    }
}
