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
fn start(tag: &str) -> Server { start_on(tag, 0) }
/// On `port`: 0 is any free one, a restart of the process then takes another.
fn start_on(tag: &str, port: u16) -> Server {
    let data = std::env::temp_dir().join(format!("relay-e2e-{tag}-{}", std::process::id()));
    // short: a socket path has a 104-byte limit on macOS
    let agents = PathBuf::from(format!("/tmp/rse-{tag}-{}", std::process::id()));
    std::fs::remove_dir_all(&data).ok();
    let mut cmd = bin();
    // the mirror links transcripts into Claude Code's projects folder: a folder of the test's own, except for the real
    // Claude turn, which needs this Mac's login
    if tag != "claude" { cmd.env("CLAUDE_CONFIG_DIR", data.join("claude")); }
    // a stand-in for claude that says how it was started (start_builds_claude_from_the_laptops_profile)
    if tag == "start" || tag == "notify" { cmd.env("RELAY_CLAUDE", data.join("fake-claude")); }
    let child = cmd.args(["serve", "--port", &port.to_string(), "--bind", "127.0.0.1"]).env("RELAY_SERVER_DATA", &data).env("RELAY_AGENTS_DIR", &agents)
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
fn meta(key: &str) -> Meta { Meta { key: key.into(), provider: "claude".into(), model: String::new(), effort: String::new(), tainted: false, pid: 0, account: String::new(), turns: 0 } }
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

    // its cards: the permission tool writes them in this device's own pending folder
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
fn the_server_keeps_its_own_claude_config_dir() {
    let s = start("cfg");
    let c = paired(&s, "laptop");
    let tmp = std::env::temp_dir().to_string_lossy().into_owned();
    // what the laptop sends: removed for its default account, or a folder of its own
    for (i, env) in [vec![("CLAUDE_CONFIG_DIR".to_string(), None)], vec![("CLAUDE_CONFIG_DIR".to_string(), Some("/Users/me/.claude-work".to_string()))]].into_iter().enumerate() {
        let sp = Spec { program: "/bin/sh".into(), args: vec!["-c".into(), "read -r l; echo \"dir $CLAUDE_CONFIG_DIR\"".into()], env, cwd: Some(tmp.clone()) };
        let mut conn = c.launch(&meta(&format!("cfg:{i}")), &sp).unwrap();
        writeln!(conn.stdin, "x").unwrap();
        conn.stdin.flush().unwrap();
        assert_eq!(next(&mut conn.frames), format!("dir {}", s.data.join("claude").display()));
        assert_eq!(next(&mut conn.frames), "exit");
    }
}

#[test]
fn update_goes_on_in_the_binary_sent() {
    // a fixed port, as on a real machine: the server goes on with the arguments it started with
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let s = start_on("update", port);
    let c = paired(&s, "laptop");
    let me = env!("CARGO_PKG_VERSION");
    // a stand-in that is relay-server of this version: it answers `version` and runs the real binary for the rest
    let real = env!("CARGO_BIN_EXE_relay-server");
    let script = format!("#!/bin/sh\nif [ \"$1\" = version ]; then echo {me}; exit 0; fi\nexec {real} \"$@\"\n");
    if cfg!(target_os = "macos") {
        assert!(c.update(me, script.as_bytes()).unwrap_err().contains("Relay on a Mac"));
        return;
    }
    assert!(c.update("9.9.9", script.as_bytes()).unwrap_err().contains("not relay-server 9.9.9"), "a binary of another version is refused");
    assert!(!s.data.join("bin/relay-server").exists());
    std::fs::remove_file(s.data.join("serve.json")).unwrap();
    c.update(me, script.as_bytes()).unwrap();
    assert!(s.data.join("bin/relay-server").exists());
    // it restarted: serve writes serve.json again at its start, and answers on the same connection details
    let t = Instant::now();
    while !s.data.join("serve.json").exists() { assert!(t.elapsed() < Duration::from_secs(10), "no restart"); std::thread::sleep(Duration::from_millis(50)); }
    let t = Instant::now();
    while c.info().is_err() { assert!(t.elapsed() < Duration::from_secs(10), "not back after the update"); std::thread::sleep(Duration::from_millis(100)); }
    assert!(c.info().unwrap().update);
}

/// A phone of `parent`: the laptop opens a pairing for it, the phone pairs with that line like with any.
fn linked(parent: &Client, tag: &str) -> Client {
    let code = parent.pair_device().unwrap();
    let (host, port) = parent.addr.rsplit_once(':').unwrap();
    let line = relay_remote::proto::PairLine { host: host.into(), port: port.parse().unwrap(), fp: parent.fp.clone(), code, key: None }.format();
    let id = device(tag);
    let (l, _) = client::pair(&line, &id, tag).unwrap();
    Client::new(&l.host, l.port, &l.fp, id)
}

#[test]
fn start_builds_claude_from_the_laptops_profile() {
    let s = start("start");
    let fake = s.data.join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\necho \"args $*\"\npwd\nwhile IFS= read -r l; do echo \"in $l\"; done\n").unwrap();
    std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let laptop = paired(&s, "laptop");
    let phone = linked(&laptop, "phone");

    // nothing to start from before the laptop sent its profile, and only the laptop sends one
    assert!(phone.start("p:1", "Phone", "", "", None).err().unwrap().contains("open Relay on the laptop"));
    let profile = serde_json::json!({"opts": {}, "args": ["--add-dir", "/ctx"], "env": [["CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "1"]]});
    assert!(phone.profile_put(&profile).unwrap_err().contains("not allowed from a linked device"));
    laptop.profile_put(&profile).unwrap();
    // the vault there is the mirror's: locked until a key opens it
    assert!(phone.start("p:1", "Phone", "", "", None).err().unwrap().contains("locked"));
    phone.unlock(&relay_remote::tls::random_key()).unwrap();

    let mut c = phone.start("p:1", "Phone", "", "", None).unwrap();
    let args = next(&mut c.frames);
    assert!(args.starts_with("args ") && args.contains("--add-dir /ctx") && args.contains("stream-json"), "{args}");
    assert!(next(&mut c.frames).ends_with("/vault"));
    assert!(next(&mut c.frames).contains("\"initialize\""));
    writeln!(c.stdin, "hi").unwrap();
    c.stdin.flush().unwrap();
    assert_eq!(next(&mut c.frames), "in hi");
    // the laptop sees the conversation its phone started
    assert_eq!(laptop.list().unwrap().iter().map(|m| m.key.as_str()).collect::<Vec<_>>(), ["p:1"]);
}

/// A stand-in ntfy server: the body of each POST it gets.
fn fake_ntfy() -> (String, std::sync::mpsc::Receiver<String>) {
    use std::io::Read;
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/relay-topic", l.local_addr().unwrap());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || for mut c in l.incoming().map_while(Result::ok) {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        let body = loop {
            let n = c.read(&mut chunk).unwrap_or(0);
            if n == 0 { break String::new(); }
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).to_string();
            let Some((head, body)) = text.split_once("\r\n\r\n") else { continue };
            let len = head.lines().find_map(|h| h.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
            if body.len() >= len { break body[..len].to_string(); }
        };
        c.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").ok();
        tx.send(body).ok();
    });
    (url, rx)
}

#[test]
fn a_waiting_conversation_nobody_follows_goes_to_ntfy() {
    let s = start("notify");
    let fake = s.data.join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nwhile IFS= read -r l; do case \"$l\" in\n *initialize*) echo '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"0b1e2c3d-0000-4000-8000-000000000001\"}';;\n name) echo '{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Check the   portal  redirect\"}]}}';;\n ask) echo '{\"type\":\"control_request\",\"request_id\":\"r1\",\"request\":{\"subtype\":\"can_use_tool\",\"tool_name\":\"Bash\"}}';;\n later) sleep 1; echo '{\"type\":\"result\",\"subtype\":\"success\"}';;\nesac; done\n").unwrap();
    std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let (url, posts) = fake_ntfy();
    let laptop = paired(&s, "laptop");
    laptop.unlock(&relay_remote::tls::random_key()).unwrap();
    laptop.profile_put(&serde_json::json!({"opts": {}, "args": [], "env": [], "notify": url})).unwrap();

    // a card while the laptop follows the conversation: it sees it, no notification
    let mut c = laptop.start("n:1", "N", "", "", None).unwrap();
    assert!(next(&mut c.frames).contains("session_id"));
    // the server saw the session too: a device that comes later (a phone) gets it with the list
    assert_eq!(laptop.list_sessions().unwrap().1.get("n:1").map(String::as_str), Some("0b1e2c3d-0000-4000-8000-000000000001"));
    // and its first message names it, on one line
    writeln!(c.stdin, "name").unwrap();
    c.stdin.flush().unwrap();
    assert!(next(&mut c.frames).contains("\"user\""));
    let t = Instant::now();
    let title = loop {
        let title = laptop.list_named().unwrap().2.remove("n:1");
        if title.is_some() || t.elapsed() > Duration::from_secs(2) { break title; }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(title.as_deref(), Some("Check the portal redirect"));
    writeln!(c.stdin, "ask").unwrap();
    c.stdin.flush().unwrap();
    assert!(next(&mut c.frames).contains("can_use_tool"));
    assert!(posts.recv_timeout(Duration::from_millis(2500)).is_err());

    // the laptop goes mid-turn: the turn's end is a notification, with nothing of the conversation in it
    writeln!(c.stdin, "later").unwrap();
    c.stdin.flush().unwrap();
    drop(c);
    let body = posts.recv_timeout(Duration::from_secs(8)).expect("a notification");
    assert!(body.starts_with("Claude finished on "), "{body}");
}

#[test]
fn a_linked_device_shares_its_devices_conversations_and_nothing_more() {
    let s = start("link");
    let laptop = paired(&s, "laptop");
    let other = paired(&s, "other");
    let tmp = std::env::temp_dir().to_string_lossy().into_owned();
    let mut conn = laptop.launch(&meta("c:1"), &spec(&tmp)).unwrap();
    writeln!(conn.stdin, "one").unwrap();
    conn.stdin.flush().unwrap();
    assert_eq!(next(&mut conn.frames), "got one");
    drop(conn);

    let phone = linked(&laptop, "phone");

    // it sees the laptop's conversation; the other device's walls still stand
    assert_eq!(phone.list().unwrap().iter().map(|m| m.key.as_str()).collect::<Vec<_>>(), ["c:1"]);
    assert!(other.list().unwrap().is_empty());

    // both follow it at once: what either sends, both see, and neither takes it from the other
    let mut lap = laptop.attach("c:1").unwrap().unwrap();
    assert_eq!(lap.backlog, 0);
    let mut ph = phone.attach("c:1").unwrap().unwrap();
    // what came before it joined ("got one") the laptop already had, so it is gone: a phone reads that from `history`
    assert_eq!(ph.backlog, 0);
    writeln!(ph.stdin, "two").unwrap();
    ph.stdin.flush().unwrap();
    assert_eq!(next(&mut ph.frames), "got two");
    assert_eq!(next(&mut lap.frames), "got two");
    writeln!(lap.stdin, "three").unwrap();
    lap.stdin.flush().unwrap();
    assert_eq!(next(&mut lap.frames), "got three");
    assert_eq!(next(&mut ph.frames), "got three");

    // the laptop away while the phone goes on: it gets exactly what it missed, the phone keeps its stream
    drop(lap);
    std::thread::sleep(Duration::from_millis(200));
    writeln!(ph.stdin, "four").unwrap();
    ph.stdin.flush().unwrap();
    assert_eq!(next(&mut ph.frames), "got four");
    let mut lap = laptop.attach("c:1").unwrap().unwrap();
    assert_eq!(lap.backlog, 1);
    assert_eq!(next(&mut lap.frames), "got four");
    writeln!(lap.stdin, "five").unwrap();
    lap.stdin.flush().unwrap();
    assert_eq!(next(&mut ph.frames), "got five");
    drop((lap, ph));

    // conversations only: not the mirror, not the server, no further devices
    for e in [phone.wipe().err(), phone.pair_device().err(), phone.update("0", b"x").err()] { assert!(e.unwrap().contains("not allowed from a linked device")); }
    let out = bin().args(["clients"]).env("RELAY_SERVER_DATA", &s.data).output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("linked to laptop"));

    // the laptop's mirror: locked after a restart, the phone opens it with the key from its pairing line, for both
    let key = relay_remote::tls::random_key();
    laptop.unlock(&key).unwrap();
    let s = restart(s);
    assert!(!phone.info().unwrap().mirror_open);
    assert!(phone.unlock(&relay_remote::tls::random_key()).unwrap_err().contains("another key"));
    phone.unlock(&key).unwrap();
    assert!(laptop.info().unwrap().mirror_open);

    // the laptop goes, its phone with it
    let out = bin().args(["revoke", "laptop"]).env("RELAY_SERVER_DATA", &s.data).output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("Revoked phone"));
    assert!(phone.info().is_err());
    assert!(other.info().is_ok());
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
    let opts = json!({});
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

    // the card: the request comes over the pipe, answered through the provider as the app does
    let (mut result, mut sid, mut tool) = (Value::Null, String::new(), None::<String>);
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(150) {
        let mut line = String::new();
        if conn.frames.read_line(&mut line).unwrap() == 0 { break; }
        let Frame::Out(o) = frame(line.trim_end()) else { continue };
        let v: Value = serde_json::from_str(&o).unwrap_or_default();
        if v["type"] == "system" && v["session_id"].is_string() { sid = v["session_id"].as_str().unwrap().into(); }
        if let Some(r) = agent_claude::permission::card("c:claude", &v) {
            tool = Some(r.tool_name.clone());
            let line = agent_claude::PROVIDER.respond(&r, &json!({"behavior": "allow", "updatedInput": r.input})).unwrap();
            writeln!(conn.stdin, "{line}").unwrap();
            conn.stdin.flush().unwrap();
        }
        if v["type"] == "result" { result = v; break; }
    }
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

/// The mirror: sealed on disk, open only with this device's key, gone after a restart until the key comes back, a
/// sync round both ways, and a wipe.
#[test]
fn mirror_sealed_locked_and_synced() {
    use relay_remote::sync::{self, Filter, Mode, Remote, Walker};
    let mut s = start("mirror");
    let c = paired(&s, "laptop");
    let tmp = std::env::temp_dir().to_string_lossy().into_owned();
    let _live = c.launch(&meta("c:before-restart"), &spec(&tmp)).unwrap();
    let key = relay_remote::tls::random_key();
    let vault = c.root("vault");
    assert!(vault.manifest().unwrap_err().contains("locked"), "no key, no mirror");
    c.unlock(&key).unwrap();

    // a sync round from a local folder
    let local = std::env::temp_dir().join(format!("relay-e2e-mirror-local-{}", std::process::id()));
    std::fs::remove_dir_all(&local).ok();
    std::fs::create_dir_all(local.join("Notes")).unwrap();
    std::fs::write(local.join("Notes/Klant.md"), "geheime klantnotitie").unwrap();
    std::fs::write(local.join("MEMORY.md"), "- [a](a.md)\n").unwrap();
    let mut w = Walker::default();
    let copy = |p: &str| sync::conflict_copy(p, "server", "2026-10-02 1200");
    let merge = |p: &str| p.ends_with("MEMORY.md");
    let (base, r) = sync::run(Mode::TwoWay, &local, &Default::default(), &mut w, &Filter::default(), &vault, &copy, &merge, &|_, _| {});
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert_eq!(r.pushed.len(), 2);
    assert_eq!(vault.get("Notes/Klant.md").unwrap(), b"geheime klantnotitie");

    // on the server's disk: ciphertext only, no file names either
    let store = s.data.join("mirror");
    let mut plain = false;
    for e in walk(&store) {
        let b = std::fs::read(&e).unwrap();
        if b.windows(8).any(|x| x == b"geheime ") || e.to_string_lossy().contains("Klant") { plain = true; }
    }
    assert!(!plain, "plaintext or a file name in the store");

    // an agent there writes: the next round brings it here
    let info = c.info().unwrap();
    std::fs::write(PathBuf::from(&info.work).join("vault/Notes/Nieuw.md"), "van de server").unwrap();
    let (base, r) = sync::run(Mode::TwoWay, &local, &base, &mut w, &Filter::default(), &vault, &copy, &merge, &|_, _| {});
    assert_eq!(r.pulled, vec!["Notes/Nieuw.md".to_string()], "{r:?}");
    assert_eq!(std::fs::read_to_string(local.join("Notes/Nieuw.md")).unwrap(), "van de server");

    // the server restarts: locked, the working copy is not trusted, a wrong key is refused, the right one opens it
    std::thread::sleep(Duration::from_secs(6)); // a flush round seals the agent's file
    s = restart(s);
    assert!(c.root("vault").manifest().unwrap_err().contains("locked"));
    assert!(c.unlock(&relay_remote::tls::random_key()).unwrap_err().contains("another key"));
    c.unlock(&key).unwrap();
    let m = c.root("vault").manifest().unwrap();
    assert!(m.contains_key("Notes/Klant.md") && m.contains_key("Notes/Nieuw.md"), "{:?}", m.keys());
    let (_, r) = sync::run(Mode::TwoWay, &local, &base, &mut w, &Filter::default(), &c.root("vault"), &copy, &merge, &|_, _| {});
    assert!(r.pushed.is_empty() && r.pulled.is_empty() && r.errors.is_empty(), "nothing to do after the restart: {r:?}");

    // another device has no access to it
    let other = paired(&s, "kristof");
    assert!(other.root("vault").manifest().unwrap_err().contains("locked"));
    // a conversation's broker that died with the server is not listed as running after the restart
    assert!(c.list().unwrap().is_empty(), "stale brokers listed after a restart");

    // wipe: gone there, also after a new unlock
    c.wipe().unwrap();
    c.unlock(&relay_remote::tls::random_key()).unwrap();
    assert!(c.root("vault").manifest().unwrap().is_empty());
    std::fs::remove_dir_all(&local).ok();
}

fn walk(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() { out.extend(walk(&p)); } else { out.push(p); }
    }
    out
}
/// Stop the server and start it again on the same data and port, as a reboot would (the working copy is wiped too,
/// like a RAM disk).
fn restart(mut s: Server) -> Server {
    s.child.kill().ok();
    s.child.wait().ok();
    // a reboot takes the brokers along (a plain process restart would not): their sockets stay behind, stale
    Command::new("pkill").args(["-9", "-f", &s.agents.to_string_lossy()]).status().ok();
    std::thread::sleep(Duration::from_millis(300));
    let port: u16 = serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(s.data.join("serve.json")).unwrap()).unwrap()["port"].as_u64().unwrap() as u16;
    std::fs::remove_dir_all(s.data.join("work")).ok();
    std::fs::remove_file(s.data.join("serve.json")).ok();
    s.child = bin().args(["serve", "--port", &port.to_string(), "--bind", "127.0.0.1"]).env("RELAY_SERVER_DATA", &s.data).env("RELAY_AGENTS_DIR", &s.agents)
        .env("CLAUDE_CONFIG_DIR", s.data.join("claude"))
        .stderr(Stdio::null()).spawn().unwrap();
    let t = Instant::now();
    while !s.data.join("serve.json").exists() { assert!(t.elapsed() < Duration::from_secs(10)); std::thread::sleep(Duration::from_millis(50)); }
    s
}
