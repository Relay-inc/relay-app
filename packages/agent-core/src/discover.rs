//! Command discovery without an inference turn: start the provider, ask for its commands, kill it. One deadline
//! covers startup and every request, and every child (with its process group) is killed and reaped.

use crate::Env;
use base64::Engine;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

type R<T> = Result<T, String>;

struct Session { child: Child, stdin: ChildStdin, stdout: Option<BufReader<ChildStdout>> }

/// The children of one discovery, addressed by the index [`Probe::start`] returns.
pub struct Probe<'a> { env: &'a Env<'a>, sessions: Vec<Session>, pids: Arc<Mutex<Vec<i32>>> }

fn kill_group(pid: i32) { unsafe { libc::killpg(pid, libc::SIGKILL); } }

impl Probe<'_> {
    /// Spawns `cmd` in its own process group, with the login PATH and without stdin/stdout of ours.
    pub fn start(&mut self, mut cmd: Command) -> R<usize> {
        let mut child = cmd.env("PATH", self.env.path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .process_group(0).spawn().map_err(|e| e.to_string())?;
        self.pids.lock().unwrap().push(child.id() as i32);
        let (stdin, stdout) = (child.stdin.take().unwrap(), BufReader::new(child.stdout.take().unwrap()));
        self.sessions.push(Session { child, stdin, stdout: Some(stdout) });
        Ok(self.sessions.len() - 1)
    }
    pub fn send(&mut self, p: usize, value: Value) -> R<()> {
        let stdin = &mut self.sessions[p].stdin;
        writeln!(stdin, "{value}").and_then(|_| stdin.flush()).map_err(|e| e.to_string())
    }
    /// The first line of JSON on stdout that `matches`; other lines are skipped.
    pub fn receive(&mut self, p: usize, matches: impl Fn(&Value) -> bool) -> R<Value> {
        let out = self.sessions[p].stdout.as_mut().ok_or("Provider output is taken")?;
        let mut line = String::new();
        loop {
            line.clear();
            if out.read_line(&mut line).map_err(|e| e.to_string())? == 0 { return Err("Provider exited before answering".into()); }
            if let Ok(v) = serde_json::from_str::<Value>(&line) { if matches(&v) { return Ok(v); } }
        }
    }
    /// A JSON-RPC style request: the answer with the same id and no method.
    pub fn rpc(&mut self, p: usize, id: i64, method: &str, params: Value) -> R<Value> {
        self.send(p, json!({"id": id, "method": method, "params": params}))?;
        let v = self.receive(p, |v| v["id"] == id && v.get("method").is_none())?;
        if v.get("error").is_some() { return Err("Provider rejected metadata request".into()); }
        Ok(v["result"].clone())
    }
    /// `bin serve` on a free local port behind a random password; returns the (host:port, auth header) to `http_get`.
    pub fn http_server(&mut self, bin: &str, cwd: &str) -> R<(String, String)> {
        let mut random = [0u8; 24];
        std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut random)).map_err(|e| e.to_string())?;
        let password: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let mut cmd = Command::new(bin);
        cmd.args(["serve", "--hostname", "127.0.0.1", "--port", "0"]).current_dir(cwd).env("OPENCODE_SERVER_PASSWORD", &password);
        let p = self.start(cmd)?;
        let mut out = self.sessions[p].stdout.take().unwrap();
        let mut line = String::new();
        let addr = loop {
            line.clear();
            if out.read_line(&mut line).map_err(|e| e.to_string())? == 0 { return Err("Provider server did not start".into()); }
            if let Some(a) = line.contains("listening").then(|| url_host(&line)).flatten() { break a; }
        };
        std::thread::spawn(move || { let _ = std::io::copy(&mut out, &mut std::io::sink()); });
        let auth = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("opencode:{password}")));
        Ok((addr, auth))
    }
}

/// The host:port of the first http:// URL in `line` (what the python regex `https?://[\w.:\[\]-]+` matched).
fn url_host(line: &str) -> Option<String> {
    let rest = &line[line.find("http://")? + 7..];
    let end = rest.find(|c: char| !(c.is_alphanumeric() || "_.:[]-".contains(c))).unwrap_or(rest.len());
    Some(rest[..end].to_string()).filter(|a| !a.is_empty())
}

/// GET `path` with basic auth, the JSON body of a 2xx answer. Plain HTTP; handles chunked bodies.
pub fn http_get(addr: &str, auth: &str, path: &str) -> R<Value> {
    let mut s = TcpStream::connect(addr).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
    s.write_all(format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nAuthorization: {auth}\r\nAccept: application/json\r\nConnection: close\r\n\r\n").as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let at = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("Malformed response")?;
    let head = String::from_utf8_lossy(&raw[..at]).to_lowercase();
    if head.split_whitespace().nth(1).map_or(true, |c| !c.starts_with('2')) { return Err("Provider request failed".into()); }
    let mut body = &raw[at + 4..];
    let mut decoded = Vec::new();
    if head.contains("transfer-encoding: chunked") {
        loop {
            let eol = body.windows(2).position(|w| w == b"\r\n").ok_or("Malformed chunk")?;
            let size = usize::from_str_radix(String::from_utf8_lossy(&body[..eol]).split(';').next().unwrap().trim(), 16).map_err(|e| e.to_string())?;
            if size == 0 { break; }
            decoded.extend_from_slice(body.get(eol + 2..eol + 2 + size).ok_or("Truncated chunk")?);
            body = body.get(eol + 4 + size..).ok_or("Truncated chunk")?;
        }
        body = &decoded;
    }
    serde_json::from_slice(body).map_err(|e| e.to_string())
}

/// Runs `probe` under a 15 second deadline. Null when there is nothing to run; `{}` when the probe fails or
/// times out (no configuration, auth details or CLI output goes to the webview).
pub fn discover_commands(env: &Env, probe: impl FnOnce(&mut Probe) -> R<Value>) -> Value {
    if env.vault.is_empty() || !Path::new(env.bin).is_file() { return Value::Null; }
    discover_within(env, Duration::from_secs(15), probe)
}

fn discover_within(env: &Env, limit: Duration, probe: impl FnOnce(&mut Probe) -> R<Value>) -> Value {
    let pids = Arc::new(Mutex::new(Vec::new()));
    let (done, wait) = mpsc::channel::<()>();
    let watchdog = { let pids = pids.clone(); std::thread::spawn(move || {
        // killing the children makes the probe's blocked reads see EOF
        if wait.recv_timeout(limit) == Err(mpsc::RecvTimeoutError::Timeout) { pids.lock().unwrap().iter().for_each(|&p| kill_group(p)); }
    }) };
    let mut p = Probe { env, sessions: Vec::new(), pids };
    let result = probe(&mut p);
    drop(done);
    let _ = watchdog.join();
    for s in &mut p.sessions { kill_group(s.child.id() as i32); let _ = s.child.wait(); }
    result.unwrap_or_else(|_| json!({}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::time::Instant;

    fn env<'a>(pending: &'a Path) -> Env<'a> { Env { home: "", vault: "/tmp", path: "/usr/bin:/bin", bin: "/bin/sh", pending, opts: &Value::Null } }

    #[test]
    fn times_out_and_reaps_a_provider_that_never_answers() {
        let pending = PathBuf::new();
        let pid = Arc::new(Mutex::new(0));
        let seen = pid.clone();
        let t = Instant::now();
        let out = discover_within(&env(&pending), Duration::from_millis(300), |p| {
            let mut cmd = Command::new("/bin/sleep");
            cmd.arg("60");
            let i = p.start(cmd)?;
            *seen.lock().unwrap() = p.sessions[i].child.id() as i32;
            p.receive(i, |_| true)
        });
        assert_eq!(out, json!({}));
        assert!(t.elapsed() < Duration::from_secs(5));
        let pid = *pid.lock().unwrap();
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "child is gone");
    }

    #[test]
    fn rpc_skips_noise_and_requests() {
        let pending = PathBuf::new();
        let out = discover_within(&env(&pending), Duration::from_secs(5), |p| {
            let mut cmd = Command::new("/bin/sh");
            cmd.args(["-c", r#"read l; echo junk; echo '{"id":9,"result":1}'; echo '{"id":3,"method":"x"}'; echo '{"id":3,"result":{"ok":true}}'"#]);
            let i = p.start(cmd)?;
            p.rpc(i, 3, "m", json!({}))
        });
        assert_eq!(out, json!({"ok": true}));
    }

    #[test]
    fn http_get_reads_plain_and_chunked_bodies() {
        for chunked in [false, true] {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = l.local_addr().unwrap().to_string();
            std::thread::spawn(move || {
                let (mut s, _) = l.accept().unwrap();
                let mut buf = [0; 1024];
                let n = s.read(&mut buf).unwrap();
                assert!(String::from_utf8_lossy(&buf[..n]).contains("Authorization: Basic x\r\n"));
                let body = if chunked { "Transfer-Encoding: chunked\r\n\r\n4\r\n[{\"a\r\n5\r\n\":1}]\r\n0\r\n\r\n" } else { "\r\n[{\"a\":1}]" };
                write!(s, "HTTP/1.1 200 OK\r\n{body}").unwrap();
            });
            assert_eq!(http_get(&addr, "Basic x", "/command").unwrap(), json!([{"a": 1}]));
        }
    }

    #[test]
    fn finds_the_url_in_the_listening_line() {
        assert_eq!(url_host("opencode server listening on http://127.0.0.1:4096\n").as_deref(), Some("127.0.0.1:4096"));
        assert_eq!(url_host("no url"), None);
    }
}
