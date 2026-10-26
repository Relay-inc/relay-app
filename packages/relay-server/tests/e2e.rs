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
    let line = relay_remote::proto::PairLine { host: host.into(), port: port.parse().unwrap(), fp: parent.fp.clone(), code, key: None, link: None }.format();
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
    let guard = sync::Guard { allow_deletes: false, keep: &|_, _| Ok(()) };
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

/// One request with `body` after its line, and the reply with the bytes after it when it has a `len` (vault_get): the
/// raw protocol, the client's vault calls are relay-remote's.
fn raw(c: &Client, id: &Identity, req: serde_json::Value, body: &[u8]) -> (serde_json::Value, Vec<u8>) {
    use relay_remote::proto;
    let (r, mut w) = relay_remote::tls::connect(&c.addr, id, &c.fp, Duration::from_secs(5)).unwrap().split();
    let mut r = std::io::BufReader::new(r);
    proto::write_json(&mut w, &req).unwrap();
    w.write_all(body).unwrap();
    w.flush().unwrap();
    let v = proto::read_json(&mut r, proto::MAX_LINE).unwrap();
    let b = match v["len"].as_u64() { Some(n) if v["ok"] == true => proto::read_body(&mut r, n, n).unwrap(), _ => vec![] };
    (v, b)
}

#[test]
fn a_shared_vault_invite_join_put_get_and_walls() {
    use serde_json::json;
    let s = start("vaults");
    // identities of this test's own: the other tests make their own "laptop" and "stranger" at the same time
    let lid = device("vault-laptop");
    let (l, _) = client::pair(&pair_line(&s), &lid, "laptop").unwrap();
    let laptop = Client::new(&l.host, l.port, &l.fp, lid.clone());
    let port: u16 = laptop.addr.rsplit(':').next().unwrap().parse().unwrap();
    let id = laptop.call(json!({"op": "vault_create", "name": "Team"})).unwrap()["vault"]["id"].as_str().unwrap().to_string();
    let inv = laptop.call(json!({"op": "vault_invite", "vault": id, "role": "member", "wrapped": "ab".repeat(32)})).unwrap();
    assert_eq!(inv["fp"].as_str(), Some(laptop.fp.as_str()));
    let (invite, code) = (inv["invite"]["id"].as_str().unwrap(), inv["invite"]["code"].as_str().unwrap());

    // a stranger with a wrong code gets through the handshake (an invite is open) and no further
    let sid = device("vault-stranger");
    let stranger = Client::new("127.0.0.1", port, &laptop.fp, sid.clone());
    let wrong = relay_remote::tls::proof(&"0".repeat(32), &sid.fingerprint(), &laptop.fp);
    assert!(stranger.call(json!({"op": "vault_join", "vault": id, "invite": invite, "name": "stranger", "proof": wrong})).unwrap_err().contains("wrong invite code"));
    assert!(stranger.call(json!({"op": "vault_list"})).unwrap_err().contains("not paired"));

    // the colleague joins with the link's code and becomes a vault-only client
    let cid = device("vault-colleague");
    let colleague = Client::new("127.0.0.1", port, &laptop.fp, cid.clone());
    let proof = relay_remote::tls::proof(code, &cid.fingerprint(), &laptop.fp);
    let j = colleague.call(json!({"op": "vault_join", "vault": id, "invite": invite, "name": "colleague", "proof": proof})).unwrap();
    assert_eq!((j["role"].as_str(), j["wrapped"].as_str()), (Some("member"), Some("ab".repeat(32).as_str())));
    let out = bin().arg("clients").env("RELAY_SERVER_DATA", &s.data).output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("colleague"));

    // a record: fake ciphertext behind a valid header, the server never opens it
    let record = [&3u32.to_be_bytes()[..], b"metciphertext"].concat();
    let name = "1".repeat(64);
    let (v, _) = raw(&colleague, &cid, json!({"op": "vault_put", "vault": id, "name": name, "len": record.len(), "expect": ""}), &record);
    assert_eq!(v["ok"], true, "{v}");
    let etag = v["etag"].as_str().unwrap().to_string();
    let (v, b) = raw(&laptop, &lid, json!({"op": "vault_get", "vault": id, "name": name}), &[]);
    assert_eq!((v["etag"].as_str(), b), (Some(etag.as_str()), record.clone()));
    let m = laptop.call(json!({"op": "vault_manifest", "vault": id})).unwrap();
    assert_eq!(m["blobs"], json!([{"name": name, "etag": etag, "size": record.len(), "meta": "6d6574"}]));
    let two = [&0u32.to_be_bytes()[..], b"x"].concat();
    let (v, _) = raw(&colleague, &cid, json!({"op": "vault_put_many", "vault": id, "files": [{"name": name, "len": 1, "expect": ""}, {"name": "2".repeat(64), "len": two.len(), "expect": ""}]}), &[&b"z"[..], &two].concat());
    assert_eq!(v["errors"].as_object().unwrap().len(), 1, "{v}");
    assert_eq!(v["etags"].as_object().unwrap().len(), 1, "{v}");
    assert!(colleague.call(json!({"op": "vault_delete", "vault": id, "name": name, "expect": "00"})).unwrap_err().contains("changed meanwhile"));

    // a vault-only device: nothing else here, and no vaults of its own
    for op in ["list", "sync_manifest", "launch", "pair_device", "vault_create"] {
        assert!(colleague.call(json!({"op": op, "name": "Mine"})).unwrap_err().contains("not allowed"), "{op}");
    }
    // the invite is used up: a third device with the right code is refused, and fails in the handshake now
    let tid = device("vault-third");
    let third = Client::new("127.0.0.1", port, &laptop.fp, tid.clone());
    assert!(third.call(json!({"op": "vault_join", "vault": id, "invite": invite, "name": "third", "proof": relay_remote::tls::proof(code, &tid.fingerprint(), &laptop.fp)})).is_err());
    // another paired laptop is no member, a phone gets no vault ops
    let other = paired(&s, "vault-other");
    assert_eq!(other.call(json!({"op": "vault_info", "vault": id})).unwrap_err(), "no such vault");
    assert!(linked(&laptop, "vault-phone").call(json!({"op": "vault_list"})).unwrap_err().contains("not allowed from a linked device"));

    let out = String::from_utf8_lossy(&bin().arg("vaults").env("RELAY_SERVER_DATA", &s.data).output().unwrap().stdout).into_owned();
    assert!(out.contains("Team") && out.contains("laptop  admin") && out.contains("colleague  member"), "{out}");
    // revoked: out of the vault, and the next connection fails
    assert!(bin().args(["revoke", "colleague"]).env("RELAY_SERVER_DATA", &s.data).output().unwrap().status.success());
    assert_eq!(laptop.call(json!({"op": "vault_list"})).unwrap()["vaults"][0]["members"], 1);
    assert!(colleague.call(json!({"op": "vault_list"})).is_err());
}
