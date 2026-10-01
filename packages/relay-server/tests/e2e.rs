// The whole path against the real binary: pair with the printed line, start an agent (a shell loop standing in for
// claude), talk to it, drop the connection, take it back with what it said meanwhile, and the walls around it: an
// unpaired device, another device's conversations, a revoked device, a wrong code.

use relay_remote::broker::{frame, Frame, Meta, Spec};
use relay_remote::client::{self, Client};
use relay_remote::tls::Identity;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Server { child: Child, data: PathBuf, agents: PathBuf }
impl Drop for Server {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
        std::fs::remove_dir_all(&self.data).ok();
        std::fs::remove_dir_all(&self.agents).ok();
    }
}
fn bin() -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_relay-server"));
    c.stdin(Stdio::null());
    c
}
fn start(tag: &str) -> Server {
    let data = std::env::temp_dir().join(format!("relay-e2e-{tag}-{}", std::process::id()));
    // short: a socket path has a 104-byte limit on macOS
    let agents = PathBuf::from(format!("/tmp/rse-{tag}-{}", std::process::id()));
    std::fs::remove_dir_all(&data).ok();
    let child = bin().args(["serve", "--port", "0", "--bind", "127.0.0.1"]).env("RELAY_SERVER_DATA", &data).env("RELAY_AGENTS_DIR", &agents)
        .stderr(Stdio::null()).spawn().unwrap();
    let t = Instant::now();
    while !data.join("serve.json").exists() { assert!(t.elapsed() < Duration::from_secs(10), "server did not start"); std::thread::sleep(Duration::from_millis(50)); }
    Server { child, data, agents }
}
fn pair_line(s: &Server) -> String {
    let out = bin().args(["pair", "--host", "127.0.0.1"]).env("RELAY_SERVER_DATA", &s.data).output().unwrap();
    String::from_utf8_lossy(&out.stdout).lines().find(|l| l.starts_with("relay://")).unwrap().to_string()
}
fn device(tag: &str) -> Identity {
    let d = std::env::temp_dir().join(format!("relay-e2e-dev-{tag}-{}", std::process::id()));
    std::fs::remove_dir_all(&d).ok();
    Identity::load_or_create(&d, "id").unwrap()
}
fn paired(s: &Server, tag: &str) -> Client {
    let id = device(tag);
    let (l, info) = client::pair(&pair_line(s), &id, tag).unwrap();
    assert_eq!(info.proto, relay_remote::proto::PROTO);
    Client::new(&l.host, l.port, &l.fp, id)
}
/// A stand-in agent: echoes each line, `later` answers after a second.
fn spec(cwd: &str) -> Spec {
    Spec { program: "/bin/sh".into(), args: vec!["-c".into(), "while IFS= read -r l; do if [ \"$l\" = later ]; then sleep 1; echo late; else echo \"got $l\"; fi; done".into()],
        env: vec![], cwd: Some(cwd.into()) }
}
fn meta(key: &str) -> Meta { Meta { key: key.into(), provider: "claude".into(), model: String::new(), effort: String::new(), tainted: false, pid: 0 } }
fn next(frames: &mut dyn BufRead) -> String {
    let mut l = String::new();
    frames.read_line(&mut l).unwrap();
    match frame(l.trim_end()) { Frame::Out(o) => o, Frame::Err(e) => format!("stderr {e}"), Frame::Exit => "exit".into() }
}

#[test]
fn pair_launch_reattach_and_walls() {
    let s = start("main");
    let c = paired(&s, "laptop");
    let tmp = std::env::temp_dir().to_string_lossy().into_owned();

    // talk to an agent there
    let mut conn = c.launch(&meta("c:1"), &spec(&tmp)).unwrap();
    let pid0 = conn.agent.id();
    assert!(pid0 > 0);
    writeln!(conn.stdin, "hello").unwrap();
    conn.stdin.flush().unwrap();
    assert_eq!(next(&mut conn.frames), "got hello");

    // gone mid-turn: the answer waits in the broker and comes with the next attach
    writeln!(conn.stdin, "later").unwrap();
    conn.stdin.flush().unwrap();
    drop(conn);
    std::thread::sleep(Duration::from_millis(1600));
    let mut back = c.attach("c:1").unwrap().expect("still running");
    assert_eq!(back.backlog, 1);
    assert_eq!(next(&mut back.frames), "late");
    writeln!(back.stdin, "again").unwrap();
    back.stdin.flush().unwrap();
    assert_eq!(next(&mut back.frames), "got again");
    // a launch for a conversation whose broker still runs takes that one over, it never starts a second agent
    drop(back);
    let mut again = c.launch(&meta("c:1"), &spec(&tmp)).unwrap();
    assert_eq!(again.agent.id(), pid0);
    writeln!(again.stdin, "still").unwrap();
    again.stdin.flush().unwrap();
    assert_eq!(next(&mut again.frames), "got still");
    let mut back = again;
    let list = c.list().unwrap();
    assert_eq!(list.iter().map(|m| m.key.as_str()).collect::<Vec<_>>(), ["c:1"]);
    let pid = list[0].pid;

    // another paired device sees none of it, and cannot take it over or stop it
    let other = paired(&s, "kristof");
    assert!(other.list().unwrap().is_empty());
    assert!(other.attach("c:1").unwrap().is_none());
    assert!(other.kill("c:1", pid).is_err());

    // a device that never paired fails in the handshake
    let stranger = Client::new("127.0.0.1", c.addr.rsplit(':').next().unwrap().parse().unwrap(), &c.fp, device("stranger"));
    assert!(stranger.info().is_err());

    // its cards: perm_server.py writes them in this device's own pending folder
    let info = c.info().unwrap();
    assert_ne!(info.pending, other.info().unwrap().pending, "a pending folder per device");
    std::fs::create_dir_all(&info.pending).unwrap();
    std::fs::write(PathBuf::from(&info.pending).join("abc123.json"), r#"{"id":"abc123","project":"c:1","tool_name":"Bash","input":{},"at":1.0}"#).unwrap();
    assert_eq!(c.pending().unwrap()[0]["id"], "abc123");
    assert!(other.pending().unwrap().is_empty());
    c.answer("abc123", &serde_json::json!({"behavior": "allow"})).unwrap();
    assert!(PathBuf::from(&info.pending).join("abc123.answer.json").exists());

    // stop it: the frames end with the exit
    c.kill("c:1", pid).unwrap();
    let mut end = String::new();
    for _ in 0..5 { end = next(&mut back.frames); if end == "exit" { break; } }
    assert_eq!(end, "exit");
    assert!(c.attach("c:1").unwrap().is_none());

    // a folder that is not there is refused before anything starts
    let e = c.launch(&meta("c:2"), &spec("/no/such/dir")).err().unwrap();
    assert!(e.contains("does not exist"), "{e}");

    // revoked: an open stream of that device ends within seconds, and the next connection fails
    let mut open = other.launch(&meta("k:1"), &spec(&tmp)).unwrap();
    let out = bin().args(["revoke", "kristof"]).env("RELAY_SERVER_DATA", &s.data).output().unwrap();
    assert!(out.status.success());
    let t = Instant::now();
    let mut rest = String::new();
    while open.frames.read_line(&mut rest).map(|n| n > 0).unwrap_or(false) { rest.clear(); }
    assert!(t.elapsed() < Duration::from_secs(5), "the revoked stream took {:?}", t.elapsed());
    assert!(other.info().is_err());
    assert!(c.info().is_ok());
}

#[test]
fn a_wrong_code_closes_the_pairing_after_five_tries() {
    let s = start("code");
    let line = pair_line(&s);
    let wrong = format!("{}{}", &line[..line.len() - 32], "0".repeat(32));
    for _ in 0..5 { assert!(client::pair(&wrong, &device("guess"), "x").is_err()); }
    // the right code no longer works either: a new one is needed
    let e = client::pair(&line, &device("late"), "x").err().unwrap();
    assert!(!e.is_empty());
    assert!(client::pair(&pair_line(&s), &device("fresh"), "x").is_ok());
}


/// The real thing, on this Mac's own Claude login: `claude -p` through the server, the way the app builds it, with a
/// permission card answered over the network and the transcript read back through `history`. Costs one small Haiku
/// turn, so it only runs on request: `cargo test -p relay-server -- --ignored`.
#[test]
#[ignore]
fn real_claude_through_the_server() {
    use agent_core::{AgentProvider, Env, Launch, Turn};
    use serde_json::{json, Value};
    let s = start("claude");
    let c = paired(&s, "laptop");
    let info = c.info().unwrap();
    let cwd = std::env::temp_dir().join(format!("relay-e2e-claude-{}", std::process::id()));
    std::fs::create_dir_all(&cwd).unwrap();
    let cwd = std::fs::canonicalize(&cwd).unwrap().to_string_lossy().into_owned();
    let pending = PathBuf::from(&info.pending);
    let opts = json!({"perm_server": info.perm});
    let env = Env { home: &info.home, vault: &cwd, path: &info.path, bin: &info.claude, pending: &pending, opts: &opts };
    let l = Launch { key: "c:claude", name: "relay e2e", model: "haiku", effort: "", resume: None, fork: None, turn: None };
    let mut cmd = agent_claude::PROVIDER.command(&env, &l).unwrap();
    cmd.current_dir(&cwd).env("PATH", &info.path);
    let mut conn = c.launch(&meta("c:claude"), &Spec::of(&cmd)).unwrap();
    let send = |w: &mut Box<dyn Write + Send>, v: Value| { writeln!(w, "{v}").unwrap(); w.flush().unwrap(); };
    send(&mut conn.stdin, json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": []}}));
    // default mode, so the Write below asks first, whatever this Mac's own settings allow
    send(&mut conn.stdin, json!({"type": "control_request", "request_id": "mode", "request": {"subtype": "set_permission_mode", "mode": "default"}}));
    let text = "Use the Write tool to create the file note.txt in the current directory, containing the single word relay. Then answer with only: done";
    send(&mut conn.stdin, agent_claude::stream::user_message(&Turn { text: text.into(), images: vec![] }));

    // the card: perm_server.py's file there, seen and answered over the network
    let c2 = c.clone();
    let answered = std::thread::spawn(move || {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(120) {
            if let Some(r) = c2.pending().unwrap_or_default().into_iter().next() {
                c2.answer(r["id"].as_str().unwrap(), &json!({"behavior": "allow", "updatedInput": r["input"]})).unwrap();
                return Some(r["tool_name"].as_str().unwrap_or("").to_string());
            }
            std::thread::sleep(Duration::from_millis(300));
        }
        None
    });
    let (mut result, mut sid) = (Value::Null, String::new());
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(150) {
        let mut line = String::new();
        if conn.frames.read_line(&mut line).unwrap() == 0 { break; }
        let Frame::Out(o) = frame(line.trim_end()) else { continue };
        let v: Value = serde_json::from_str(&o).unwrap_or_default();
        if v["type"] == "system" && v["session_id"].is_string() { sid = v["session_id"].as_str().unwrap().into(); }
        if v["type"] == "result" { result = v; break; }
    }
    let tool = answered.join().unwrap();
    assert_eq!(result["subtype"], "success", "{result}");
    assert_eq!(tool.as_deref(), Some("Write"), "the Write call went through a card");
    assert_eq!(std::fs::read_to_string(PathBuf::from(&cwd).join("note.txt")).unwrap().trim(), "relay");
    let (items, next) = c.history(&sid, 0, &cwd).unwrap();
    assert!(next > 0 && items.as_array().unwrap().iter().any(|e| e["type"] == "user"), "{items}");

    let pid = c.list().unwrap()[0].pid;
    c.kill("c:claude", pid).unwrap();
    std::fs::remove_dir_all(&cwd).ok();
    std::fs::remove_dir_all(format!("{}/.claude/projects/{}", info.home, agent_claude::slug(&cwd))).ok();
}
