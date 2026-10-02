// relay-serve end to end: the real binary, Claude replaced by a shell script that echoes its stdin.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::process::Command;
use std::time::Duration;

struct C { w: TcpStream, r: BufReader<TcpStream>, n: u64 }
impl C {
    fn open(addr: &str) -> C {
        for _ in 0..100 {
            if let Ok(s) = TcpStream::connect(addr) {
                s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                return C { r: BufReader::new(s.try_clone().unwrap()), w: s, n: 0 };
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("relay-serve did not listen");
    }
    fn read(&mut self) -> Value { let mut l = String::new(); self.r.read_line(&mut l).unwrap(); serde_json::from_str(&l).unwrap_or(Value::Null) }
    fn call(&mut self, mut r: Value) -> Value {
        self.n += 1;
        r["id"] = json!(self.n);
        writeln!(self.w, "{r}").unwrap();
        loop { let v = self.read(); if v["id"] == json!(self.n) || v.is_null() { return v; } }
    }
    fn frame(&mut self) -> Value { loop { let v = self.read(); if v["ev"] == "frame" { return v; } } }
}

#[test]
fn runs_an_agent_and_replays_it_to_a_second_connection() {
    let dir = std::env::temp_dir().join(format!("relay-serve-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let agent = dir.join("agent.sh");
    std::fs::write(&agent, "#!/bin/sh\nwhile read l; do echo \"got:$l\"; done\n").unwrap();
    Command::new("chmod").arg("+x").arg(&agent).status().unwrap();
    let addr = format!("127.0.0.1:{}", 20000 + std::process::id() % 20000);
    let token = "test-token-0123456789";
    let cfg = dir.join("serve.json");
    std::fs::write(&cfg, json!({"listen": addr, "token": token, "vault": dir, "agents": {"providers": {"claude": {"on": true, "bin": agent}}}}).to_string()).unwrap();
    // its own broker folder: the brokers of a Relay app on this machine stay untouched
    let mut d = Command::new(env!("CARGO_BIN_EXE_relay-serve")).arg(&cfg).env("TMPDIR", &dir).spawn().unwrap();

    let mut bad = C::open(&addr);
    assert_eq!(bad.call(json!({"cmd": "running"}))["error"], "hello first");
    assert_eq!(bad.call(json!({"cmd": "hello", "token": "test-token-WRONG-6789"}))["error"], "bad token");

    let mut a = C::open(&addr);
    let h = a.call(json!({"cmd": "hello", "token": token}));
    assert_eq!(h["result"]["providers"][0]["id"], "claude", "{h}");
    let key = "c:test";
    assert!(a.call(json!({"cmd": "spawn", "key": key, "provider": "claude"}))["result"]["pid"].as_u64().unwrap() > 0);
    assert_eq!(a.call(json!({"cmd": "attach", "key": key, "from": 0}))["ok"], true);
    a.call(json!({"cmd": "input", "key": key, "line": "hi"}));
    let f = a.frame();
    assert_eq!((f["seq"].as_u64(), f["f"].as_str()), (Some(0), Some("o got:hi")));

    // the app comes back on another connection: what it saw is replayed from its seq, then it runs live
    drop(a);
    let mut b = C::open(&addr);
    b.call(json!({"cmd": "hello", "token": token}));
    assert_eq!(b.call(json!({"cmd": "attach", "key": key, "from": 0}))["result"]["next"], 1);
    assert_eq!(b.frame()["f"], "o got:hi");
    b.call(json!({"cmd": "input", "key": key, "line": "again"}));
    assert_eq!(b.frame()["f"], "o got:again");
    assert_eq!(b.call(json!({"cmd": "running"}))["result"][0]["next"], 2);

    assert_eq!(b.call(json!({"cmd": "answer", "request": "not-hex", "decision": {}}))["error"], "bad id");
    assert_eq!(b.call(json!({"cmd": "pending"}))["result"], json!([]));
    b.call(json!({"cmd": "kill", "key": key}));
    assert!(b.frame()["f"].as_str().unwrap().starts_with('x'));
    assert_eq!(b.call(json!({"cmd": "input", "key": key, "line": "x"}))["error"], "not running");

    d.kill().ok();
    d.wait().ok();
    std::fs::remove_dir_all(&dir).ok();
}
