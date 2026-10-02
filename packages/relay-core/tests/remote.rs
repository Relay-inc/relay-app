// The app's side of relay-serve: a server conversation read and written like a local broker connection, also
// across a restart of the daemon.
use relay_core::remote::{self, Server};
use serde_json::json;
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Child, Command};
use std::time::Duration;

fn daemon(dir: &Path, cfg: &Path) -> Child { Command::new(env!("CARGO_BIN_EXE_relay-serve")).arg(cfg).env("TMPDIR", dir).spawn().unwrap() }
fn wait_for(addr: &str) { for _ in 0..100 { if std::net::TcpStream::connect(addr).is_ok() { return; } std::thread::sleep(Duration::from_millis(50)); } panic!("no daemon"); }

#[test]
fn a_server_conversation_reads_like_a_broker_and_survives_a_daemon_restart() {
    let dir = std::env::temp_dir().join(format!("relay-remote-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let agent = dir.join("agent.sh");
    std::fs::write(&agent, "#!/bin/sh\nwhile read l; do echo \"got:$l\"; done\n").unwrap();
    Command::new("chmod").arg("+x").arg(&agent).status().unwrap();
    let addr = format!("127.0.0.1:{}", 40000 + std::process::id() % 20000);
    let token = "test-token-0123456789";
    let cfg = dir.join("serve.json");
    std::fs::write(&cfg, json!({"listen": addr, "token": token, "vault": dir, "agents": {"providers": {"claude": {"on": true, "bin": agent}}}}).to_string()).unwrap();
    let mut d = daemon(&dir, &cfg);
    wait_for(&addr);
    let s = Server { addr: addr.clone(), token: token.into() };
    assert_eq!(remote::call(&Server { token: "nope".into(), ..s.clone() }, json!({"cmd": "hello"})).unwrap_err(), "bad token");
    assert!(remote::call(&s, json!({"cmd": "hello"})).unwrap()["epoch"].as_u64().is_some());

    let mut c = remote::open(&s, "c:remote", Some(json!({"provider": "claude"}))).unwrap();
    assert!(c.agent.is_remote() && c.backlog == 0);
    c.frames.get_ref().set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let line = |c: &mut relay_core::broker::Conn| { let mut l = String::new(); c.frames.read_line(&mut l).unwrap(); l.trim_end().to_string() };
    writeln!(c.stdin, "hi").unwrap();
    assert_eq!(line(&mut c), "o got:hi");

    // the daemon restarts; the broker kept the agent, the connection comes back by itself
    d.kill().ok();
    d.wait().ok();
    let mut d = daemon(&dir, &cfg);
    writeln!(c.stdin, "again").unwrap();
    assert_eq!(line(&mut c), "o got:again");

    // another app run takes the conversation back
    let mut b = remote::open(&s, "c:remote", None).unwrap();
    assert!(b.backlog >= 1);
    b.frames.get_ref().set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    assert_eq!(line(&mut b), "o got:again");
    drop(b);

    c.agent.kill().unwrap();
    assert!(line(&mut c).starts_with('x'));
    assert!(remote::open(&s, "c:remote", None).is_err());
    d.kill().ok();
    d.wait().ok();
    std::fs::remove_dir_all(&dir).ok();
}
