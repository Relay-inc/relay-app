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

struct Server { child: Child, data: PathBuf, agents: PathBuf, env: Vec<(String, String)> }
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
fn start_on(tag: &str, port: u16) -> Server { start_env(tag, port, vec![]) }
/// With `env` on the server's process, kept for a restart.
fn start_env(tag: &str, port: u16, env: Vec<(String, String)>) -> Server {
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
        .envs(env.iter().cloned()).stderr(Stdio::null()).spawn().unwrap();
    let t = Instant::now();
    while !data.join("serve.json").exists() { assert!(t.elapsed() < Duration::from_secs(10), "server did not start"); std::thread::sleep(Duration::from_millis(50)); }
    Server { child, data, agents, env }
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
        assert!(c.update(me, script.as_bytes(), None).unwrap_err().contains("Relay on a Mac"));
        return;
    }
    assert!(c.update("9.9.9", script.as_bytes(), None).unwrap_err().contains("not relay-server 9.9.9"), "a binary of another version is refused");
    assert!(!s.data.join("bin/relay-server").exists());
    std::fs::remove_file(s.data.join("serve.json")).unwrap();
    c.update(me, script.as_bytes(), None).unwrap();
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
    let line = relay_remote::proto::PairLine { host: host.into(), port: port.parse().unwrap(), fp: parent.fp.clone(), code, key: None, link: None, ..Default::default() }.format();
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

/// One HTTP request off a connection: its head and its body.
fn read_http(c: &mut std::net::TcpStream) -> (String, String) {
    use std::io::Read;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = c.read(&mut chunk).unwrap_or(0);
        if n == 0 { return (String::new(), String::new()); }
        buf.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&buf).to_string();
        let Some((head, body)) = text.split_once("\r\n\r\n") else { continue };
        let len = head.lines().find_map(|h| h.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
        if body.len() >= len { return (head.to_string(), body[..len].to_string()); }
    }
}
/// A stand-in ntfy server: the headers and the body of each POST it gets.
fn fake_ntfy() -> (String, std::sync::mpsc::Receiver<(String, String)>) {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/relay-topic", l.local_addr().unwrap());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || for mut c in l.incoming().map_while(Result::ok) {
        let got = read_http(&mut c);
        c.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").ok();
        tx.send(got).ok();
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
    let (head, body) = posts.recv_timeout(Duration::from_secs(8)).expect("a notification");
    assert!(body.starts_with("Claude finished on "), "{body}");
    // tapped on the phone, it opens the conversation: its key, without the device's namespace
    assert!(head.lines().any(|h| h == "Click: relay://conversation/n%3A1"), "{head}");
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
    for e in [phone.wipe().err(), phone.pair_device().err(), phone.update("0", b"x", None).err()] { assert!(e.unwrap().contains("not allowed from a linked device")); }
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

/// The laptop's own Mac in the share tests: one stand-in agent per attach that answers `got <line>`, the phones it
/// trusts, and what was stopped.
struct Mac { shared: Vec<String>, phones: std::sync::Mutex<relay_remote::share::Phones>, killed: std::sync::Mutex<Vec<String>> }
impl relay_remote::share::Local for Mac {
    fn shared(&self, key: &str) -> bool { self.shared.iter().any(|k| k == key) }
    fn attach(&self, _key: &str) -> Result<relay_remote::broker::Conn, String> {
        let (a, b) = std::os::unix::net::UnixStream::pair().map_err(|e| e.to_string())?;
        std::thread::spawn(move || {
            let mut out = b.try_clone().unwrap();
            for l in std::io::BufReader::new(b).lines().map_while(Result::ok) { if writeln!(out, "o got {l}").is_err() { break; } }
        });
        Ok(relay_remote::broker::Conn { agent: 42.into(), stdin: Box::new(a.try_clone().unwrap()), frames: Box::new(std::io::BufReader::new(a)), backlog: 0 })
    }
    fn kill(&self, key: &str, pid: u32) -> Result<(), String> {
        if pid != 42 { return Err("not that conversation's agent".into()); }
        self.killed.lock().unwrap().push(key.into());
        Ok(())
    }
    fn history(&self, key: &str) -> Result<serde_json::Value, String> { Ok(serde_json::json!({"items": [format!("said in {key}")], "next": 7})) }
    fn admit(&self, pk: &str, proof: &str) -> bool { self.phones.lock().unwrap().admit(pk, proof) }
}

#[test]
fn a_phone_continues_a_conversation_shared_from_the_mac_and_only_that() {
    use relay_remote::share::{self, Phones};
    let s = start("share");
    let laptop = paired(&s, "laptop");
    let link = relay_remote::tls::random_key();
    let phone = linked(&laptop, "phone").with_link(Some(link.clone()));

    // the Mac offers c:mac (and the server is told about c:unshared too, which the Mac itself does not share)
    let mac = std::sync::Arc::new(Mac { shared: vec!["c:mac".into()], phones: std::sync::Mutex::new(Phones { keys: vec![], links: vec![link] }), killed: Default::default() });
    let convs = serde_json::json!([{"key": "c:mac", "title": "On the Mac", "provider": "claude"}, {"key": "c:unshared", "title": "", "provider": "claude"}]);
    let (r, offer) = laptop.share(&convs).unwrap();
    let (lap, m2) = (laptop.clone(), mac.clone());
    std::thread::spawn(move || for l in r.lines().map_while(Result::ok) {
        let token = serde_json::from_str::<serde_json::Value>(&l).unwrap()["open"].as_str().unwrap().to_string();
        let (lap, m) = (lap.clone(), m2.clone());
        std::thread::spawn(move || { let (r, w) = lap.share_open(&token).unwrap(); share::serve(r, w, m).ok(); });
    });

    // the phone lists it, with its title; the laptop's own list does not
    let (metas, _, titles, shared) = phone.listing().unwrap();
    assert!(metas.iter().any(|m| m.key == "c:mac"));
    assert_eq!(titles["c:mac"], "On the Mac");
    assert_eq!(shared, ["c:mac", "c:unshared"]);
    assert!(laptop.listing().unwrap().0.is_empty());

    // it follows it and writes to it: signed on the phone, checked on the Mac, the first request pins the phone's key
    let mut c = phone.attach("c:mac").unwrap().expect("the Mac's agent");
    assert_eq!(c.agent.id(), 42);
    writeln!(c.stdin, "hello").unwrap();
    c.stdin.flush().unwrap();
    assert_eq!(next(&mut c.frames), "got hello");
    assert_eq!(mac.phones.lock().unwrap().links.len(), 0, "the link is used up, the key pinned");
    assert_eq!(phone.history_key("c:mac").unwrap(), (serde_json::json!(["said in c:mac"]), 7));
    phone.kill("c:mac", 42).unwrap();
    assert_eq!(*mac.killed.lock().unwrap(), ["c:mac"]);
    // the phone never forks it onto the server
    assert!(phone.start("c:mac", "x", "", "", None).err().unwrap().contains("runs on the Mac"));

    // what the Mac does not share is not reachable, also when the server forwards it
    assert_eq!(phone.attach("c:unshared").err().unwrap(), "not shared with the phone");
    assert!(phone.history_key("c:unshared").unwrap_err().contains("not shared"));
    // and what nobody shares goes nowhere near the Mac
    assert!(phone.attach("c:other").unwrap().is_none());

    // another phone of the same laptop, with a link the Mac never made, or with none at all
    let stranger = linked(&laptop, "phone2").with_link(Some(relay_remote::tls::random_key()));
    assert!(stranger.attach("c:mac").err().unwrap().contains("not a phone this Mac paired"));
    assert!(linked(&laptop, "phone3").attach("c:mac").err().unwrap().contains("pair it again"));

    // the Mac gone: the phone hears so instead of waiting forever
    offer.shutdown();
    std::thread::sleep(Duration::from_millis(300));
    assert!(phone.attach("c:mac").unwrap().is_none());
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
    let guard = sync::Guard { allow_deletes: false, allowed: &[], keep: &|_, _| Ok(()) };
    let (base, r) = sync::run(Mode::TwoWay, &local, &Default::default(), &mut w, &Filter::default(), &vault, &copy, &merge, &guard, &|_, _| {});
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
    let (base, r) = sync::run(Mode::TwoWay, &local, &base, &mut w, &Filter::default(), &vault, &copy, &merge, &guard, &|_, _| {});
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
    let (_, r) = sync::run(Mode::TwoWay, &local, &base, &mut w, &Filter::default(), &c.root("vault"), &copy, &merge, &guard, &|_, _| {});
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
        .env("CLAUDE_CONFIG_DIR", s.data.join("claude")).envs(s.env.iter().cloned())
        .stderr(Stdio::null()).spawn().unwrap();
    let t = Instant::now();
    while !s.data.join("serve.json").exists() { assert!(t.elapsed() < Duration::from_secs(10)); std::thread::sleep(Duration::from_millis(50)); }
    s
}

/// A stand-in GitHub: the device flow (one `authorization_pending`, then the token) and `/user` for that token.
fn fake_github(token: &'static str) -> String {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    std::thread::spawn(move || {
        let mut polls = 0;
        for mut c in l.incoming().map_while(Result::ok) {
            let (head, body) = read_http(&mut c);
            let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
            let answer = match path.as_str() {
                "/login/device/code" if body.contains("client_id=test-client") => serde_json::json!({"device_code": "dc-1", "user_code": "WDJB-MJHT",
                    "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 1}),
                "/login/oauth/access_token" if body.contains("device_code=dc-1") => {
                    polls += 1;
                    if polls == 1 { serde_json::json!({"error": "authorization_pending"}) } else { serde_json::json!({"access_token": token, "token_type": "bearer", "scope": "repo,read:user"}) }
                }
                "/user" if head.lines().any(|h| h == format!("Authorization: Bearer {token}")) => serde_json::json!({"login": "octo-test"}),
                _ => serde_json::json!({"error": "not_found", "path": path}),
            }.to_string();
            write!(c, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}", answer.len()).ok();
        }
    });
    url
}
/// A git config of the test's own for the server (none of this Mac's helpers or settings), with `extra` in it.
fn git_config(dir: &std::path::Path, extra: &str) -> Vec<(String, String)> {
    std::fs::create_dir_all(dir).unwrap();
    let f = dir.join("gitconfig");
    std::fs::write(&f, format!("[init]\n\tdefaultBranch = main\n[user]\n\tname = Test\n\temail = test@example.com\n{extra}")).unwrap();
    vec![("GIT_CONFIG_GLOBAL".into(), f.to_string_lossy().into()), ("GIT_CONFIG_NOSYSTEM".into(), "1".into())]
}

/// GitHub there: the device flow against a stand-in, the token sealed (not readable in the data folder), locked after
/// a restart and back after the unlock, an agent that gets the helper and the identity but not the token, a logout,
/// and a phone that may do none of it.
#[test]
fn github_device_flow_sealed_token_and_agent_git() {
    const TOKEN: &str = "gho_e2eTokenValue0123456789abcdef";
    let tmp = std::env::temp_dir().join(format!("relay-e2e-ghcfg-{}", std::process::id()));
    std::fs::remove_dir_all(&tmp).ok();
    let mut env = git_config(&tmp, "");
    let gh = fake_github(TOKEN);
    env.extend([("RELAY_GITHUB_URL".into(), gh.clone()), ("RELAY_GITHUB_API".into(), gh), ("RELAY_GITHUB_CLIENT_ID".into(), "test-client".into())]);
    let s = start_env("github", 0, env);
    let c = paired(&s, "laptop");

    assert_eq!(c.github().unwrap().state, "off");
    assert_eq!(c.github_login().unwrap_err(), "locked: opens when Relay on the laptop connects");
    let key = relay_remote::tls::random_key();
    c.unlock(&key).unwrap();
    let dc = c.github_login().unwrap();
    assert_eq!((dc.user_code.as_str(), dc.interval), ("WDJB-MJHT", 1));
    assert_eq!(c.github_poll().unwrap().state, "pending");
    let t = Instant::now();
    let on = loop {
        let g = c.github_poll().unwrap();
        if g.state != "pending" { break g; }
        assert!(t.elapsed() < Duration::from_secs(10), "no token after {:?}", t.elapsed());
        std::thread::sleep(Duration::from_millis(200));
    };
    assert_eq!((on.state.as_str(), on.login.as_str(), on.email.as_str()), ("on", "octo-test", "octo-test@users.noreply.github.com"), "{on:?}");
    assert!(on.name.starts_with("Relay (") && on.since.len() == 10, "{on:?}");
    assert_eq!(c.github().unwrap(), on);

    // on the data volume the token is nowhere readable; the working copy (a RAM disk on a real machine) has the copy
    // for the helper
    let in_ram = s.data.join("work");
    for f in walk(&s.data).into_iter().filter(|f| !f.starts_with(&in_ram)) {
        assert!(!std::fs::read(&f).unwrap().windows(TOKEN.len()).any(|w| w == TOKEN.as_bytes()), "the token in plaintext in {}", f.display());
    }

    // an agent of this device: the helper and the identity in its git, the token in no variable
    let sp = Spec { program: "/bin/sh".into(), args: vec!["-c".into(),
        "read -r l; env; echo \"name $(git config user.name)\"; printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill; echo end".into()],
        env: vec![], cwd: Some(std::env::temp_dir().to_string_lossy().into()) };
    let mut conn = c.launch(&meta("gh:1"), &sp).unwrap();
    writeln!(conn.stdin, "go").unwrap();
    conn.stdin.flush().unwrap();
    let mut out = vec![];
    loop { let l = next(&mut conn.frames); if l == "end" || l == "exit" { break; } out.push(l); }
    let name_at = out.iter().position(|l| l.starts_with("name ")).expect("git config ran");
    assert_eq!(out[name_at], format!("name {}", on.name));
    assert!(out[..name_at].iter().all(|l| !l.contains(TOKEN)), "the token in the agent's environment");
    assert!(out[..name_at].iter().any(|l| l.starts_with("GIT_CONFIG_VALUE_1=!") && l.contains("git-credential")), "{out:?}");
    assert!(out[name_at..].iter().any(|l| l == &format!("password={TOKEN}")), "the helper did not answer: {out:?}");

    // a restart (the RAM disk goes too): locked until the laptop's key comes, then on again
    drop(conn);
    let _s = restart(s);
    assert_eq!(c.github().unwrap().state, "locked");
    assert!(!PathBuf::from(c.info().unwrap().work).join(".github").exists());
    c.unlock(&key).unwrap();
    assert_eq!(c.github().unwrap(), on);
    assert!(PathBuf::from(c.info().unwrap().work).join(".github").exists(), "the helper's copy is back after the unlock");

    // a phone of the laptop may do none of it
    let phone = linked(&c, "phone");
    for e in [phone.github().err(), phone.github_login().err(), phone.github_logout().err(), phone.repos().err(), phone.repo_ensure("acme/shop").err(),
              phone.repo_push("shop").err(), phone.repo_snapshot("shop", "relay/x").err()] {
        assert!(e.unwrap().contains("not allowed from a linked device"));
    }

    c.github_logout().unwrap();
    assert_eq!(c.github().unwrap().state, "off");
    assert_eq!(c.github_poll().unwrap().state, "off");
    std::fs::remove_dir_all(&tmp).ok();
}

/// The repos folder: a clone from "GitHub" (a local bare repo behind url.insteadOf), its state with a change, a new
/// file and a commit not pushed, a snapshot that leaves the working tree and index alone, a push, and the walls.
#[test]
fn repos_clone_snapshot_and_push() {
    let tmp = std::env::temp_dir().join(format!("relay-e2e-git-{}", std::process::id()));
    std::fs::remove_dir_all(&tmp).ok();
    let origin = tmp.join("origin");
    let env = git_config(&tmp, &format!("[url \"file://{}/\"]\n\tinsteadOf = https://github.com/\n", origin.display()));
    let git = |dir: &std::path::Path, args: &[&str]| -> String {
        let o = Command::new("git").args(args).current_dir(dir).envs(env.iter().cloned()).output().unwrap();
        assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).into_owned()
    };
    // acme/shop with one commit, acme/empty without any
    std::fs::create_dir_all(origin.join("acme")).unwrap();
    git(&origin.join("acme"), &["init", "-q", "--bare", "shop.git"]);
    git(&origin.join("acme"), &["init", "-q", "--bare", "empty.git"]);
    let seed = tmp.join("seed");
    git(&tmp, &["clone", "-q", "https://github.com/acme/shop.git", "seed"]);
    std::fs::write(seed.join("a.txt"), "one\n").unwrap();
    std::fs::write(seed.join(".gitignore"), "secret.env\n").unwrap();
    git(&seed, &["add", "-A"]);
    git(&seed, &["commit", "-qm", "first"]);
    git(&seed, &["push", "-q", "origin", "main"]);

    let repos = tmp.join("repos");
    let mut env2 = env.clone();
    env2.push(("RELAY_SERVER_REPOS".into(), repos.to_string_lossy().into()));
    let s = start_env("repos", 0, env2);
    let c = paired(&s, "laptop");
    assert_eq!(c.info().unwrap().repos, repos.to_string_lossy());
    assert!(c.repos().unwrap().is_empty(), "no folder yet");
    c.unlock(&relay_remote::tls::random_key()).unwrap();
    assert!(c.github_login().unwrap_err().contains("RELAY_GITHUB_CLIENT_ID"));

    let shop = c.repo_ensure("acme/shop").unwrap();
    assert_eq!((shop.name.as_str(), shop.repo.as_str(), shop.branch.as_str(), shop.dirty, shop.unpushed), ("shop", "acme/shop", "main", false, 0), "{shop:?}");
    assert_eq!(c.repo_ensure("acme/shop").unwrap(), shop, "a second time is a fetch");
    let clone = repos.join("shop");

    // the walls: names, branches, a folder with another origin, a repo GitHub does not have
    for bad in ["../x", "acme/.hidden", "acme", "acme/a/b"] { assert!(c.repo_ensure(bad).unwrap_err().contains("not a GitHub repo"), "{bad}"); }
    assert!(c.repo_push("../shop").is_err() && c.repo_push("nope").is_err());
    for b in ["main", "relay/bad..name", "relay/x y", "refs/heads/relay/x"] { assert!(c.repo_snapshot("shop", b).unwrap_err().contains("not a snapshot branch"), "{b}"); }
    git(&tmp, &["init", "-q", "repos/other"]);
    git(&repos.join("other"), &["remote", "add", "origin", "https://github.com/acme/else.git"]);
    assert!(c.repo_ensure("acme/other").unwrap_err().contains("another origin (acme/else)"));
    assert!(c.repo_ensure("acme/missing").unwrap_err().contains("connect this machine to GitHub first"));

    // a commit not pushed, a change, a new file and an ignored one
    std::fs::write(clone.join("b.txt"), "two\n").unwrap();
    git(&clone, &["add", "b.txt"]);
    git(&clone, &["commit", "-qm", "second"]);
    std::fs::write(clone.join("a.txt"), "one, changed\n").unwrap();
    std::fs::write(clone.join("new.txt"), "new\n").unwrap();
    std::fs::write(clone.join("secret.env"), "KEY=1\n").unwrap();
    let list = c.repos().unwrap();
    assert_eq!(list.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["other", "shop"]);
    assert!(list[1].dirty && list[1].unpushed == 1, "{:?}", list[1]);

    let before = (git(&clone, &["status", "--porcelain"]), git(&clone, &["ls-files", "-s"]));
    let snap = c.repo_snapshot("shop", "relay/test").unwrap();
    assert_eq!(before, (git(&clone, &["status", "--porcelain"]), git(&clone, &["ls-files", "-s"])), "the working tree or index changed");
    let bare = origin.join("acme/shop.git");
    assert_eq!(git(&bare, &["rev-parse", "relay/test"]).trim(), snap.commit);
    assert_eq!(git(&bare, &["show", "relay/test:a.txt"]), "one, changed\n");
    assert_eq!(git(&bare, &["show", "relay/test:new.txt"]), "new\n");
    assert_eq!(git(&bare, &["show", "relay/test:b.txt"]), "two\n");
    assert!(!git(&bare, &["ls-tree", "--name-only", "relay/test"]).contains("secret.env"), "an ignored file went along");
    assert_eq!(git(&bare, &["rev-parse", "relay/test^"]).trim(), git(&clone, &["rev-parse", "HEAD"]).trim());
    assert!(git(&bare, &["log", "-1", "--format=%s", "relay/test"]).starts_with("Relay snapshot "));
    // the snapshot branch does not count as pushed
    assert_eq!(c.repos().unwrap()[1].unpushed, 1);
    let pushed = c.repo_push("shop").unwrap();
    assert_eq!((pushed.unpushed, pushed.dirty), (0, true));
    assert_eq!(git(&bare, &["rev-parse", "main"]), git(&clone, &["rev-parse", "HEAD"]));

    // a repo without commits: a snapshot without a parent, and a push that sets the upstream
    let empty = c.repo_ensure("acme/empty").unwrap();
    assert_eq!((empty.branch.as_str(), empty.unpushed, empty.dirty), ("main", 0, false), "{empty:?}");
    std::fs::write(repos.join("empty/first.txt"), "hi\n").unwrap();
    let snap = c.repo_snapshot("empty", "relay/test").unwrap();
    let bare = origin.join("acme/empty.git");
    assert_eq!(git(&bare, &["rev-list", "--count", "relay/test"]).trim(), "1");
    assert_eq!(git(&bare, &["rev-parse", "relay/test"]).trim(), snap.commit);
    git(&repos.join("empty"), &["add", "-A"]);
    git(&repos.join("empty"), &["commit", "-qm", "first"]);
    assert_eq!(c.repo_push("empty").unwrap().unpushed, 0);
    assert!(git(&repos.join("empty"), &["rev-parse", "--abbrev-ref", "@{u}"]).trim() == "origin/main");
    std::fs::remove_dir_all(&tmp).ok();
}

/// The walls around a shared vault on the real binary: the handshake while an invite is open, a vault-only device,
/// a linked one, and the CLI. What the records do over the wire is `two_macs_share_a_vault_through_the_server`.
#[test]
fn a_shared_vault_invite_join_and_walls() {
    use serde_json::json;
    let s = start("vaults");
    // identities of this test's own: the other tests make their own "laptop" and "stranger" at the same time
    let lid = device("vault-laptop");
    let (l, _) = client::pair(&pair_line(&s), &lid, "laptop").unwrap();
    let laptop = Client::new(&l.host, l.port, &l.fp, lid);
    let port: u16 = laptop.addr.rsplit(':').next().unwrap().parse().unwrap();
    let id = laptop.call(json!({"op": "vault_create", "name": "Team"})).unwrap()["vault"]["id"].as_str().unwrap().to_string();
    let inv = laptop.call(json!({"op": "vault_invite", "vault": id, "role": "member", "wrapped": "ab".repeat(32)})).unwrap();
    let (invite, code) = (inv["invite"]["id"].as_str().unwrap(), inv["invite"]["code"].as_str().unwrap());

    // a stranger with a wrong code gets through the handshake (an invite is open) and no further
    let sid = device("vault-stranger");
    let stranger = Client::new("127.0.0.1", port, &laptop.fp, sid.clone());
    let wrong = relay_remote::tls::proof(&"0".repeat(32), &sid.fingerprint(), &laptop.fp);
    assert!(stranger.call(json!({"op": "vault_join", "vault": id, "invite": invite, "name": "stranger", "proof": wrong})).unwrap_err().contains("wrong invite code"));
    assert!(stranger.call(json!({"op": "vault_info", "vault": id})).unwrap_err().contains("not paired"));

    // the colleague joins with the link's code and becomes a vault-only client
    let cid = device("vault-colleague");
    let colleague = Client::new("127.0.0.1", port, &laptop.fp, cid.clone());
    let proof = relay_remote::tls::proof(code, &cid.fingerprint(), &laptop.fp);
    let j = colleague.call(json!({"op": "vault_join", "vault": id, "invite": invite, "name": "colleague", "proof": proof})).unwrap();
    assert_eq!((j["role"].as_str(), j["wrapped"].as_str()), (Some("member"), Some("ab".repeat(32).as_str())));
    let out = bin().arg("clients").env("RELAY_SERVER_DATA", &s.data).output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("colleague"));

    // a vault-only device: nothing else here, and no vaults of its own
    for op in ["list", "sync_manifest", "launch", "pair_device", "vault_create"] {
        assert!(colleague.call(json!({"op": op, "name": "Mine"})).unwrap_err().contains("not allowed"), "{op}");
    }
    assert!(colleague.info_any().unwrap_err().contains("not allowed"), "a member does not see the server");
    // made admin with a second link: it keeps the server now, it sees and could update it, and still runs nothing here
    let inv2 = laptop.call(json!({"op": "vault_invite", "vault": id, "role": "admin", "wrapped": "ab".repeat(32)})).unwrap();
    let proof2 = relay_remote::tls::proof(inv2["invite"]["code"].as_str().unwrap(), &cid.fingerprint(), &laptop.fp);
    colleague.call(json!({"op": "vault_join", "vault": id, "invite": inv2["invite"]["id"], "name": "colleague", "proof": proof2})).unwrap();
    assert_eq!(colleague.info().unwrap().version, laptop.info().unwrap().version);
    // past the wall, but only to an official release: unsigned or badly signed is refused before anything is written or run
    assert!(colleague.update("0.0.0", b"no binary", None).unwrap_err().contains("not signed"));
    assert!(colleague.update("0.0.0", b"no binary", Some("bm90IGEgc2lnbmF0dXJl")).unwrap_err().contains("does not check out"));
    assert!(!s.data.join("bin").exists());
    for op in ["list", "sync_manifest", "launch", "pair_device", "vault_create", "github_status"] {
        assert!(colleague.call(json!({"op": op, "name": "Mine"})).unwrap_err().contains("not allowed"), "{op}");
    }
    // the invite is used up: a third device with the right code is refused, and fails in the handshake now
    let tid = device("vault-third");
    let third = Client::new("127.0.0.1", port, &laptop.fp, tid.clone());
    assert!(third.call(json!({"op": "vault_join", "vault": id, "invite": invite, "name": "third", "proof": relay_remote::tls::proof(code, &tid.fingerprint(), &laptop.fp)})).is_err());
    // another paired laptop is no member, a phone gets no vault ops
    let other = paired(&s, "vault-other");
    assert_eq!(other.call(json!({"op": "vault_info", "vault": id})).unwrap_err(), "no such vault");
    assert!(linked(&laptop, "vault-phone").call(json!({"op": "vault_info", "vault": id})).unwrap_err().contains("not allowed from a linked device"));

    let out = String::from_utf8_lossy(&bin().arg("vaults").env("RELAY_SERVER_DATA", &s.data).output().unwrap().stdout).into_owned();
    assert!(out.contains("Team") && out.contains("laptop  admin") && out.contains("colleague  admin"), "{out}");
    // revoked: out of the vault, and the next connection fails
    assert!(bin().args(["revoke", "colleague"]).env("RELAY_SERVER_DATA", &s.data).output().unwrap().status.success());
    assert_eq!(laptop.call(json!({"op": "vault_info", "vault": id})).unwrap()["vault"]["members"].as_array().unwrap().len(), 1);
    assert!(colleague.call(json!({"op": "vault_info", "vault": id})).is_err());
}

/// The whole way a team shares a vault, with the app's own calls against the real binary: the laptop makes a vault
/// and an invite link, a colleague joins with the link alone, and two folders stay the same through the server, which
/// holds only ciphertext. Then the colleague is removed and syncs no more.
#[test]
fn two_macs_share_a_vault_through_the_server() {
    use relay_remote::sync::{self, Filter, Guard, Mode, Walker};
    use relay_remote::vault::VaultKey;
    let s = start("vaultsync");
    let lid = device("share-laptop");
    let (l, _) = client::pair(&pair_line(&s), &lid, "laptop").unwrap();
    let laptop = Client::new(&l.host, l.port, &l.fp, lid);
    let vault = laptop.vault_create("Team").unwrap().id;
    let key = VaultKey::generate();
    let (link, _) = laptop.vault_invite(&vault, "member", &key, &l.host, l.port).unwrap();
    let cid = device("share-colleague");
    let (line, joined, theirs) = client::vault_join(&link, &cid, "colleague").unwrap();
    assert_eq!((joined.id.as_str(), joined.role.as_str(), theirs.to_hex()), (vault.as_str(), "member", key.to_hex()));
    let colleague = Client::new(&line.host, line.port, &line.fp, cid.clone());
    assert!(client::vault_join(&link, &device("share-late"), "late").is_err(), "a link works once");

    let dir = |t: &str| { let d = std::env::temp_dir().join(format!("relay-share-{t}-{}", std::process::id())); std::fs::remove_dir_all(&d).ok(); std::fs::create_dir_all(&d).unwrap(); d };
    let (a, b) = (dir("a"), dir("b"));
    let keep = |_: &str, _: &[u8]| Ok(());
    let guard = Guard { allow_deletes: false, allowed: &[], keep: &keep };
    let round = |c: &Client, k: &VaultKey, root: &std::path::Path, base: &mut sync::Manifest, w: &mut Walker| {
        let (next, r) = sync::run(Mode::TwoWay, root, base, w, &Filter::vault_default(), &c.sealed(&vault, k.clone()), &|p| sync::conflict_copy(p, "mac", "now"), &|_| false, &guard, &|_, _| {});
        *base = next;
        r
    };
    let (mut ba, mut bb, mut wa, mut wb) = (sync::Manifest::new(), sync::Manifest::new(), Walker::default(), Walker::default());
    std::fs::create_dir_all(a.join("Projects")).unwrap();
    std::fs::write(a.join("Projects/Acme.md"), "secret plan").unwrap();
    assert_eq!(round(&laptop, &key, &a, &mut ba, &mut wa).pushed, vec!["Projects/Acme.md"]);
    // on the server's disk: neither the path nor the content
    for e in std::fs::read_dir(s.data.join("vaults").join(&vault).join("blobs")).unwrap().flatten() {
        let b = std::fs::read(e.path()).unwrap();
        assert!(!String::from_utf8_lossy(&b).contains("secret") && !String::from_utf8_lossy(&b).contains("Acme"));
    }
    assert_eq!(round(&colleague, &theirs, &b, &mut bb, &mut wb).pulled, vec!["Projects/Acme.md"]);
    assert_eq!(std::fs::read_to_string(b.join("Projects/Acme.md")).unwrap(), "secret plan");
    // both edit the same note: both versions stay, on both Macs
    std::fs::write(a.join("Projects/Acme.md"), "laptop's version").unwrap();
    std::fs::write(b.join("Projects/Acme.md"), "colleague's version").unwrap();
    round(&laptop, &key, &a, &mut ba, &mut wa);
    let r = round(&colleague, &theirs, &b, &mut bb, &mut wb);
    assert_eq!(r.conflicts.len(), 1, "{r:?}");
    // the laptop gets both, deletes the copy, and the delete reaches the colleague
    let copy = r.conflicts[0].clone();
    assert_eq!(round(&laptop, &key, &a, &mut ba, &mut wa).pulled.len(), 2);
    std::fs::remove_file(a.join(&copy)).unwrap();
    assert_eq!(round(&laptop, &key, &a, &mut ba, &mut wa).deleted_remote, vec![copy.clone()]);
    assert_eq!(round(&colleague, &theirs, &b, &mut bb, &mut wb).deleted_local, vec![copy]);
    // the server breaks a record both Macs have: it still lists it, and no Mac deletes the note
    std::fs::write(s.data.join("vaults").join(&vault).join("blobs").join(key.name("Projects/Acme.md")), b"garbage").unwrap();
    let (ra, rb) = (round(&laptop, &key, &a, &mut ba, &mut wa), round(&colleague, &theirs, &b, &mut bb, &mut wb));
    assert!([&ra, &rb].iter().all(|r| r.deleted_local.is_empty() && r.deleted_remote.is_empty()), "{ra:?} {rb:?}");
    assert!(a.join("Projects/Acme.md").is_file() && b.join("Projects/Acme.md").is_file());

    // removed: the server refuses the colleague's next round, their folder stays as it was
    laptop.vault_remove(&vault, &cid.fingerprint()).unwrap();
    let r = round(&colleague, &theirs, &b, &mut bb, &mut wb);
    assert!(!r.errors.is_empty(), "{r:?}");
    assert!(b.join("Projects/Acme.md").is_file());
    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(&b).ok();
}

/// A shared vault's live channel against the real binary (docs/workspaces.md, Live channel): two members get each
/// other's sealed frames within moments, a short drop resumes from where it was, a restart of the server starts over
/// and the rounds catch up, the walls hold (an outsider, another version, a frame too big), and a member removed loses
/// its stream at once.
#[test]
fn a_shared_vaults_live_channel() {
    use relay_remote::channel::{Channel, Event};
    use relay_remote::vault::VaultKey;
    use serde_json::json;
    use std::sync::mpsc;
    let s = start("channel");
    let lid = device("chan-laptop");
    let (l, _) = client::pair(&pair_line(&s), &lid, "laptop").unwrap();
    let laptop = Client::new(&l.host, l.port, &l.fp, lid.clone());
    let vault = laptop.vault_create("Team").unwrap().id;
    let key = VaultKey::generate();
    let (link, _) = laptop.vault_invite(&vault, "member", &key, &l.host, l.port).unwrap();
    let cid = device("chan-colleague");
    let (line, _, theirs) = client::vault_join(&link, &cid, "colleague").unwrap();
    let colleague = Client::new(&line.host, line.port, &line.fp, cid.clone());
    let doc = key.name("Projects/Acme.md");

    // the walls: another paired device is no member, a stranger gets no further than the handshake, another version
    // of the stream is refused
    assert_eq!(paired(&s, "chan-other").vault_stream(&vault, 0, "").err().unwrap(), "no such vault");
    assert!(laptop.call(json!({"op": "vault_stream", "vault": vault, "v": 2})).unwrap_err().contains("version"));
    // a phone (a linked device) gets no vault ops at all
    assert!(linked(&laptop, "chan-phone").vault_stream(&vault, 0, "").err().unwrap().contains("not allowed"));

    // a raw stream read below never waits forever: shut after 10 s, the read returns and the test fails instead
    let deadline = |w: &relay_remote::tls::Writer| { let w = w.clone(); std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(10)); w.shutdown(); }); };
    let chan = |c: &Client, k: &VaultKey| {
        let (tx, rx) = mpsc::channel();
        let ch = Channel::start(c.clone(), &vault, k.clone(), move |e| { tx.send(e).ok(); });
        (ch, rx)
    };
    let wait = |rx: &mpsc::Receiver<Event>, f: &dyn Fn(&Event) -> bool, secs: u64| -> Event {
        let until = Instant::now() + Duration::from_secs(secs);
        loop {
            let left = until.saturating_duration_since(Instant::now());
            let e = rx.recv_timeout(left).unwrap_or_else(|_| panic!("nothing within {secs} s"));
            if f(&e) { return e; }
        }
    };
    let live = |e: &Event| matches!(e, Event::Live { .. });
    let (a, ra) = chan(&laptop, &key);
    let (b, rb) = chan(&colleague, &theirs);
    wait(&ra, &live, 10);
    wait(&rb, &live, 10);

    // an update from the laptop reaches the colleague, opened, within a moment; the laptop does not get its own back
    let t = Instant::now();
    a.send("update", &doc, b"first edit").unwrap();
    let Event::Frame(f) = wait(&rb, &|e| matches!(e, Event::Frame(_)), 5) else { unreachable!() };
    assert!(t.elapsed() < Duration::from_millis(500), "{:?}", t.elapsed());
    assert_eq!((f.kind.as_str(), f.doc.as_str(), f.body.as_slice(), f.seq, f.from.as_str()), ("update", doc.as_str(), &b"first edit"[..], 1, &lid.fingerprint()[..16]));
    b.send("awareness", &doc, b"cursor 12").unwrap();
    let Event::Frame(f) = wait(&ra, &|e| matches!(e, Event::Frame(_)), 5) else { unreachable!() };
    assert_eq!((f.kind.as_str(), f.seq, f.body.as_slice()), ("awareness", 0, &b"cursor 12"[..]));
    assert!(ra.try_recv().is_err(), "nothing else, and never its own frame");
    // the server keeps none of it on disk
    let on_disk = |needle: &str| walk(&s.data).iter().any(|p| std::fs::read(p).is_ok_and(|b| String::from_utf8_lossy(&b).contains(needle)));
    assert!(!on_disk("first edit") && !on_disk(&doc), "frames are never stored");
    // the one-request mode goes on next to a stream: a round's manifest still answers
    colleague.call(json!({"op": "vault_manifest", "vault": vault})).unwrap();

    // a short drop: a stream opened again with what it saw last gets what it missed, in order
    let (hello, _r, w) = colleague.vault_stream(&vault, 0, "").unwrap();
    let (seq, epoch) = (hello["seq"].as_u64().unwrap(), hello["epoch"].as_str().unwrap().to_string());
    w.shutdown();
    a.send("update", &doc, b"second").unwrap();
    a.send("update", &doc, b"third").unwrap();
    let (hello, mut r, w) = colleague.vault_stream(&vault, seq, &epoch).unwrap();
    deadline(&w);
    assert_eq!(hello["resumed"], true);
    let mut got = vec![];
    for _ in 0..2 { let mut l = String::new(); r.read_line(&mut l).unwrap(); let v: serde_json::Value = serde_json::from_str(&l).expect("a missed frame within 10 s"); got.push(v["seq"].as_u64().unwrap()); }
    assert_eq!(got, vec![seq + 1, seq + 2]);
    w.shutdown();
    // another epoch (a server restarted since) does not resume
    assert_eq!(colleague.vault_stream(&vault, seq, "0000000000000000").unwrap().0["resumed"], false);

    // a frame over the limit closes that stream with the reason, the others go on
    let (_, mut r, mut w) = colleague.vault_stream(&vault, 0, "").unwrap();
    deadline(&w);
    w.write_all(format!("{}\n", json!({"t": "frame", "kind": "update", "doc": doc, "n": 1, "body": "ab".repeat(relay_remote::channel::MAX_BODY + 1)})).as_bytes()).unwrap();
    let mut l = String::new();
    while r.read_line(&mut l).is_ok_and(|n| n > 0) && !l.contains("bye") { l.clear(); }
    assert!(l.contains("too big"), "{l}");
    a.send("update", &doc, b"still live").unwrap();
    wait(&rb, &|e| matches!(e, Event::Frame(f) if f.body == b"still live"), 5);

    // the server restarts: both come back by themselves, told some may be missing, and frames flow again
    let s = restart(s);
    wait(&ra, &|e| matches!(e, Event::Live { resumed: false }), 30);
    wait(&rb, &|e| matches!(e, Event::Live { resumed: false }), 30);
    a.send("update", &doc, b"after restart").unwrap();
    wait(&rb, &|e| matches!(e, Event::Frame(f) if f.body == b"after restart" && f.seq == 1), 5);

    // removed: the colleague's stream ends at once, and a new one is refused
    laptop.vault_remove(&vault, &cid.fingerprint()).unwrap();
    let Event::Down(why) = wait(&rb, &|e| matches!(e, Event::Down(_)), 5) else { unreachable!() };
    assert!(why.contains("no longer a member"), "{why}");
    // (a device that only came in for this vault is not paired here any more at all)
    assert!(colleague.vault_stream(&vault, 0, "").is_err());
    assert!(a.live());
    a.stop();
    b.stop();
    drop(s);
}


/// A team for the live channel tests: the laptop (admin) and a colleague who joined with a link, and the vault key.
struct Team { s: Server, laptop: Client, lid: Identity, colleague: Client, cid: Identity, vault: String, key: relay_remote::vault::VaultKey }
fn team(tag: &str) -> Team {
    use relay_remote::vault::VaultKey;
    let s = start(tag);
    let lid = device(&format!("{tag}-laptop"));
    let (l, _) = client::pair(&pair_line(&s), &lid, "laptop").unwrap();
    let laptop = Client::new(&l.host, l.port, &l.fp, lid.clone());
    let vault = laptop.vault_create("Team").unwrap().id;
    let key = VaultKey::generate();
    let (link, _) = laptop.vault_invite(&vault, "member", &key, &l.host, l.port).unwrap();
    let cid = device(&format!("{tag}-colleague"));
    let (line, _, _) = client::vault_join(&link, &cid, "colleague").unwrap();
    let colleague = Client::new(&line.host, line.port, &line.fp, cid.clone());
    Team { s, laptop, lid, colleague, cid, vault, key }
}
/// A raw stream's connection is shut after `secs`: a read on it never waits longer, the test fails instead of hanging.
fn deadline(w: &relay_remote::tls::Writer, secs: u64) { let w = w.clone(); std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(secs)); w.shutdown(); }); }
/// Lines of a raw stream until it ends: (frames read, the bye's reason if one came).
fn drain(r: &mut impl BufRead) -> (usize, String) {
    let (mut frames, mut l) = (0, String::new());
    loop {
        l.clear();
        if !r.read_line(&mut l).is_ok_and(|n| n > 0) { return (frames, String::new()); }
        let v: serde_json::Value = serde_json::from_str(&l).unwrap_or_default();
        match v["t"].as_str() { Some("frame") => frames += 1, Some("bye") => return (frames, v["why"].as_str().unwrap_or("").into()), _ => {} }
    }
}
fn events(c: &Client, vault: &str, key: &relay_remote::vault::VaultKey) -> (relay_remote::channel::Channel, std::sync::mpsc::Receiver<relay_remote::channel::Event>) {
    let (tx, rx) = std::sync::mpsc::channel();
    (relay_remote::channel::Channel::start(c.clone(), vault, key.clone(), move |e| { tx.send(e).ok(); }), rx)
}
fn wait_for(rx: &std::sync::mpsc::Receiver<relay_remote::channel::Event>, secs: u64, f: impl Fn(&relay_remote::channel::Event) -> bool) -> relay_remote::channel::Event {
    let until = Instant::now() + Duration::from_secs(secs);
    loop {
        let e = rx.recv_timeout(until.saturating_duration_since(Instant::now())).unwrap_or_else(|_| panic!("nothing within {secs} s"));
        if f(&e) { return e; }
    }
}

/// A member whose Relay stops reading while another sends a lot: it loses its stream (its queue is bounded in bytes),
/// the others keep getting every frame, and the server stays responsive (a removal answers at once).
#[test]
fn a_live_channel_survives_a_member_that_stops_reading() {
    use relay_remote::channel::Event;
    let t = team("stall");
    let doc = t.key.name("Big.md");
    // the colleague's second stream: opened, never read
    let (_, mut stalled, sw) = t.colleague.vault_stream(&t.vault, 0, "").unwrap();
    deadline(&sw, 60);
    let (b, rb) = events(&t.colleague, &t.vault, &t.key);
    let (a, ra) = events(&t.laptop, &t.vault, &t.key);
    wait_for(&rb, 10, |e| matches!(e, Event::Live { .. }));
    wait_for(&ra, 10, |e| matches!(e, Event::Live { .. }));
    // 250 frames of 200 KB: some 100 MB in hex, far past what a socket and the queue of the stream nobody reads hold
    let big = vec![7u8; 200 << 10];
    for _ in 0..250 { a.send("update", &doc, &big).unwrap(); }
    let mut got = 0;
    while got < 250 { if let Event::Frame(f) = wait_for(&rb, 60, |e| matches!(e, Event::Frame(_))) { assert_eq!(f.body.len(), big.len()); got += 1; } }
    // the stalled stream was dropped: what was in flight, then the end, well before its own deadline
    let t0 = Instant::now();
    let (frames, _) = drain(&mut stalled);
    assert!(frames < 250 && t0.elapsed() < Duration::from_secs(30), "{frames} frames, {:?}", t0.elapsed());
    // and the server answers at once
    let t0 = Instant::now();
    t.laptop.vault_remove(&t.vault, &t.cid.fingerprint()).unwrap();
    assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
    wait_for(&rb, 5, |e| matches!(e, Event::Down(why) if why.contains("no longer a member")));
    a.stop();
    b.stop();
}

/// The walls of the live channel: a few streams per device, a rate limit, no stream before joining, a frame played
/// again or reflected is not passed on twice, and a revoke by the CLI (another process) closes a stream within seconds.
#[test]
fn a_live_channel_walls() {
    use relay_remote::channel::Event;
    use relay_remote::tls::hex;
    use serde_json::json;
    let t = team("chanwall");
    let doc = t.key.name("Notes.md");
    let port: u16 = t.laptop.addr.rsplit(':').next().unwrap().parse().unwrap();

    // a fifth stream of one device closes its first
    let mut first = t.colleague.vault_stream(&t.vault, 0, "").unwrap();
    deadline(&first.2, 20);
    let rest: Vec<_> = (0..4).map(|_| t.colleague.vault_stream(&t.vault, 0, "").unwrap()).collect();
    assert_eq!(drain(&mut first.1).1, "too many streams");
    for (_, _, w) in &rest { w.shutdown(); }

    // more lines than the rate allows (pings count too): closed with the reason
    let (_, mut r, mut w) = t.colleague.vault_stream(&t.vault, 0, "").unwrap();
    deadline(&w, 20);
    for _ in 0..400 { if w.write_all(b"{\"t\":\"ping\"}\n").is_err() { break; } }
    assert_eq!(drain(&mut r).1, "too many frames");

    // a device let through the handshake by an open invite, that has not joined: no stream
    let (_, _) = t.laptop.vault_invite(&t.vault, "member", &t.key, "127.0.0.1", port).unwrap();
    let sid = device("chanwall-stranger");
    let stranger = Client::new("127.0.0.1", port, &t.laptop.fp, sid);
    assert!(stranger.vault_stream(&t.vault, 0, "").err().unwrap().contains("not paired"));

    // played again (same n) or reflected (this device's own): passed on once, and never to itself
    let (a, ra) = events(&t.laptop, &t.vault, &t.key);
    wait_for(&ra, 10, |e| matches!(e, Event::Live { .. }));
    let (_, _r2, mut w2) = t.colleague.vault_stream(&t.vault, 0, "").unwrap();
    let me = &t.cid.fingerprint()[..16];
    let frame = |n: u64, body: &[u8], from: &str| format!("{}\n", json!({"t": "frame", "kind": "update", "doc": doc, "n": n, "body": hex(&t.key.seal_frame(&t.vault, "update", &doc, from, n, body).unwrap())}));
    w2.write_all(frame(5, b"once", me).as_bytes()).unwrap();
    w2.write_all(frame(5, b"once", me).as_bytes()).unwrap();
    w2.write_all(frame(4, b"older", me).as_bytes()).unwrap();
    w2.write_all(frame(6, b"next", me).as_bytes()).unwrap();
    let Event::Frame(f) = wait_for(&ra, 5, |e| matches!(e, Event::Frame(_))) else { unreachable!() };
    assert_eq!((f.n, f.body.as_slice()), (5, &b"once"[..]));
    let Event::Frame(f) = wait_for(&ra, 5, |e| matches!(e, Event::Frame(_))) else { unreachable!() };
    assert_eq!((f.n, f.body.as_slice()), (6, &b"next"[..]), "the repeat and the older one were dropped");
    // a second stream of the laptop's own device sends: the laptop's channel does not take it as another member's
    let (_, _r3, mut w3) = t.laptop.vault_stream(&t.vault, 0, "").unwrap();
    w3.write_all(frame(9, b"mine", &t.lid.fingerprint()[..16]).as_bytes()).unwrap();
    std::thread::sleep(Duration::from_millis(500));
    assert!(!ra.try_iter().any(|e| matches!(e, Event::Frame(_))), "its own frame came back");
    w2.shutdown();
    w3.shutdown();

    // revoked by the CLI, another process: the colleague's stream closes within a few seconds
    let (b, rb) = events(&t.colleague, &t.vault, &t.key);
    wait_for(&rb, 10, |e| matches!(e, Event::Live { .. }));
    let t0 = Instant::now();
    assert!(bin().args(["revoke", "colleague"]).env("RELAY_SERVER_DATA", &t.s.data).output().unwrap().status.success());
    wait_for(&rb, 10, |e| matches!(e, Event::Down(why) if why.contains("no longer a member")));
    assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    a.stop();
    b.stop();
}
