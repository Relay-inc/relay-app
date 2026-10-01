// The broker end to end: the real binary as `relay --broker`, an agent that is a shell script.
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::process::Command;
use std::time::Duration;

fn connect(sock: &std::path::Path) -> (UnixStream, BufReader<UnixStream>, String) {
    for _ in 0..100 {
        if let Ok(s) = UnixStream::connect(sock) {
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut hello = String::new();
            r.read_line(&mut hello).unwrap();
            return (s, r, hello.trim_end().to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("no broker socket");
}
fn line(r: &mut BufReader<UnixStream>) -> String { let mut l = String::new(); r.read_line(&mut l).unwrap(); l.trim_end().to_string() }

#[test]
fn survives_the_app_and_replays_what_it_missed() {
    let sock = std::env::temp_dir().join(format!("relay-broker-test-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&sock);
    let script = "read l; echo got:$l; echo oops >&2; sleep 1; echo late; read x";
    let spec = serde_json::json!({"program": "/bin/sh", "args": ["-c", script], "env": [], "cwd": null}).to_string();
    let mut b = Command::new(env!("CARGO_BIN_EXE_relay")).arg("--broker").arg(&sock).arg(spec).spawn().unwrap();

    // the app: hello, a line in, the answer out
    let (mut w, mut r, hello) = connect(&sock);
    let pid: u32 = hello.strip_prefix("p ").unwrap().split(' ').next().unwrap().parse().unwrap();
    assert!(hello.ends_with(" 0"), "{hello}");
    writeln!(w, "hi").unwrap();
    let mut got = vec![line(&mut r), line(&mut r)];
    got.sort();
    assert_eq!(got, ["e oops", "o got:hi"]);
    // the app quits; the agent writes on
    drop((w, r));
    std::thread::sleep(Duration::from_millis(1500));

    // the app is back: the line it missed, then the agent is stopped and the broker says so
    let (_w, mut r, hello) = connect(&sock);
    assert_eq!(hello, format!("p {pid} 1"));
    assert_eq!(line(&mut r), "o late");
    Command::new("/bin/kill").args(["-9", &pid.to_string()]).status().unwrap();
    assert!(line(&mut r).starts_with("x "));
    assert!(b.wait().unwrap().success());
    assert!(!sock.exists(), "the broker removes its socket");
}
