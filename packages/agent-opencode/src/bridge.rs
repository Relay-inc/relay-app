//! The app's stdin/stdout to `opencode serve` (HTTP + server-sent events), for one conversation.
//! Run as `relay --opencode-bridge <opencode-bin> '<config json>'`; config: {cwd, model, variant, resume, fork, ask, system}.
//!
//! It starts a private server in the vault (127.0.0.1, a free port, a random password), opens or makes the session
//! (resume: GET /session/<id>, fork: POST /session/<id>/fork, else POST /session) and, once subscribed to
//! its events, writes `{"type":"bridge.session","id":…}`. Then it passes the server's events of that session to stdout, one JSON object per
//! line, as they come from GET /event, and turns the app's stdin lines into requests:
//!
//! ```text
//!     {"type":"prompt","parts":[…]}                      POST /session/<id>/prompt_async (model, variant and system filled in)
//!     {"type":"permission","id":"per…","reply":"once"|"reject","message"?}   POST /permission/<id>/reply
//!     {"type":"question","id":"que…","answers":[[label…]…]} | {…,"reject":true}  POST /question/<id>/reply | reject
//!     {"type":"abort"}                                   POST /session/<id>/abort
//! ```
//!
//! A request that fails is written as `{"type":"bridge.error","message":…}`. When the app closes stdin (or is gone) the
//! server is stopped. With `ask`, edits and commands ask first (permission "ask" through OPENCODE_CONFIG_CONTENT, on top
//! of the user's own config), so they come to the app's permission cards.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// `bridge_main(bin, config json)`: the exit code.
pub fn main(bin: &str, cfg: &str) -> i32 {
    let Ok(cfg) = serde_json::from_str::<Value>(cfg) else { return 1 };
    run(bin, &cfg, std::io::stdin().lock(), std::io::stdout(), |c| std::process::exit(c))
}

fn text(v: &Value, k: &str) -> Option<String> { v[k].as_str().filter(|s| !s.is_empty()).map(String::from) }

fn base64(b: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    b.chunks(3).map(|c| {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        (0..4).map(|i| if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' }).collect::<String>()
    }).collect()
}

/// A failed request: its message, and whether the server answered with an error status.
struct Fail { status: bool, msg: String }

struct Http { agent: ureq::Agent, url: String, auth: String }

impl Http {
    fn call(&self, method: &str, path: &str, body: Option<&Value>, timeout: u64) -> Result<Value, Fail> {
        let url = format!("{}{path}", self.url);
        let fail = |e: ureq::Error| Fail { status: false, msg: e.to_string() };
        let mut resp = if method == "GET" {
            self.agent.get(&url).config().timeout_global(Some(Duration::from_secs(timeout))).build().header("Authorization", &self.auth).call()
        } else {
            self.agent.post(&url).config().timeout_global(Some(Duration::from_secs(timeout))).build().header("Authorization", &self.auth)
                .header("Content-Type", "application/json").send(body.map_or(String::new(), |b| b.to_string()))
        }.map_err(fail)?;
        let code = resp.status().as_u16();
        let s = resp.body_mut().read_to_string().unwrap_or_default();
        if code >= 400 { return Err(Fail { status: true, msg: format!("HTTP Error {code} {}", s.chars().take(500).collect::<String>()).trim().into() }); }
        Ok(if s.trim().is_empty() { Value::Null } else { serde_json::from_str(&s).map_err(|e| Fail { status: false, msg: e.to_string() })? })
    }
}

/// SIGTERM, then SIGKILL after 5 s.
fn stop_server(srv: &Mutex<Child>) {
    let mut c = srv.lock().unwrap();
    crate_terminate(c.id());
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end {
        if c.try_wait().ok().flatten().is_some() { return; }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = c.kill();
    let _ = c.wait();
}
fn crate_terminate(pid: u32) { unsafe { libc::kill(pid as i32, libc::SIGTERM); } }

/// The bridge on `input`/`out`; `gone(code)` is called (from a thread) when the server ends by itself, the process
/// exit in the app. Returns the exit code.
pub fn run<W: Write + Send + 'static>(bin: &str, cfg: &Value, input: impl BufRead, out: W, gone: fn(i32)) -> i32 {
    let out = Arc::new(Mutex::new(out));
    let emit = |out: &Mutex<W>, m: &Value| {
        let mut w = out.lock().unwrap();
        let _ = writeln!(w, "{m}");
        let _ = w.flush();
    };
    let mut raw = [0u8; 16];
    if std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut raw)).is_err() { return 1; }
    let pw: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    let auth = format!("Basic {}", base64(format!("opencode:{pw}").as_bytes()));
    let mut cmd = Command::new(bin);
    cmd.args(["serve", "--hostname", "127.0.0.1", "--port", "0"]).env("OPENCODE_SERVER_PASSWORD", &pw).stdin(Stdio::null());
    if let Some(cwd) = text(cfg, "cwd") { cmd.current_dir(cwd); }
    if cfg["ask"].as_bool().unwrap_or(false) || cfg["ask"].as_str().is_some_and(|s| !s.is_empty()) {
        cmd.env("OPENCODE_CONFIG_CONTENT", json!({"permission": {"edit": "ask", "bash": "ask", "webfetch": "ask"}}).to_string());
    }
    let Ok((log_r, log_w)) = std::io::pipe() else { return 1 };
    cmd.stdout(log_w.try_clone().unwrap()).stderr(log_w);
    let Ok(child) = cmd.spawn() else { return 1 };
    drop(cmd); // the write ends: the log ends with the server
    let srv = Arc::new(Mutex::new(child));
    let mut log = BufReader::new(log_r);
    let mut url = None;
    loop { // "opencode server listening on http://127.0.0.1:4096"
        let mut buf = vec![];
        if log.read_until(b'\n', &mut buf).unwrap_or(0) == 0 { break; }
        let line = String::from_utf8_lossy(&buf).into_owned();
        if line.contains("listening") {
            if let Some(at) = line.find("http") .filter(|_| line.contains("://")) {
                let end = line[at..].find("://").map_or(0, |i| at + i + 3);
                url = Some(line[at..end].to_string() + &line[end..].chars().take_while(|c| c.is_alphanumeric() || "_.:[]-".contains(*c)).collect::<String>());
                break;
            }
        }
        eprint!("{line}");
    }
    let Some(url) = url else {
        emit(&out, &json!({"type": "bridge.error", "message": "opencode serve did not start"}));
        return srv.lock().unwrap().wait().ok().and_then(|s| s.code()).filter(|c| *c != 0).unwrap_or(1);
    };
    // the rest of the server's log goes to stderr
    std::thread::spawn(move || { let _ = std::io::copy(&mut log, &mut std::io::stderr()); });

    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let http = Arc::new(Http { agent, url, auth });
    let commands: HashSet<String> = http.call("GET", "/command", None, 60).ok().and_then(|v| v.as_array().map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect())).unwrap_or_default();
    let stopping = Arc::new(AtomicBool::new(false));
    let stop = |code: i32| { stopping.store(true, SeqCst); stop_server(&srv); code };

    let made = (|| -> Result<String, Fail> {
        let id = |v: Value| v["id"].as_str().map(String::from);
        let mut sid = None;
        if let Some(r) = text(cfg, "resume") {
            match http.call("GET", &format!("/session/{r}"), None, 60) {
                Ok(v) => sid = id(v), // else opencode no longer has it: a new session
                Err(f) if f.status => {}
                Err(f) => return Err(f),
            }
        }
        if sid.is_none() {
            if let Some(f) = text(cfg, "fork") { sid = id(http.call("POST", &format!("/session/{f}/fork"), Some(&json!({})), 60)?); }
        }
        if sid.is_none() { sid = id(http.call("POST", "/session", Some(&json!({})), 60)?); }
        sid.ok_or(Fail { status: false, msg: "no session id".into() })
    })();
    let sid = match made {
        Ok(s) => s,
        Err(f) => { emit(&out, &json!({"type": "bridge.error", "message": format!("opencode session: {}", f.msg)})); return stop(1); }
    };

    let (ready_tx, ready) = mpsc::channel::<()>();
    {
        let (http, out, stopping, srv, sid) = (http.clone(), out.clone(), stopping.clone(), srv.clone(), sid.clone());
        std::thread::spawn(move || {
            let ours = |p: &Value| [&p["sessionID"], &p["part"]["sessionID"], &p["info"]["sessionID"]].iter().any(|v| v.as_str() == Some(&sid));
            let res = (|| -> Result<(), String> {
                let resp = http.agent.get(format!("{}/event", http.url)).header("Authorization", &http.auth).header("Accept", "text/event-stream").call().map_err(|e| e.to_string())?;
                if resp.status().as_u16() >= 400 { return Err(format!("HTTP Error {}", resp.status().as_u16())); }
                let _ = ready_tx.send(()); // subscribed: nothing of the first turn is missed
                let mut r = BufReader::new(resp.into_body().into_reader());
                let mut buf = vec![];
                loop {
                    buf.clear();
                    if r.read_until(b'\n', &mut buf).map_err(|e| e.to_string())? == 0 { return Ok(()); }
                    let l = String::from_utf8_lossy(&buf);
                    let Some(data) = l.trim_end_matches(['\r', '\n']).strip_prefix("data:").map(String::from) else { continue };
                    let Ok(ev) = serde_json::from_str::<Value>(&data) else { continue };
                    if ours(&ev["properties"]) { emit(&out, &ev); }
                }
            })();
            if let Err(e) = res { if !stopping.load(SeqCst) { emit(&out, &json!({"type": "bridge.error", "message": format!("opencode events: {e}")})); } }
            let _ = ready_tx.send(());
            if !stopping.swap(true, SeqCst) {
                stop_server(&srv);
                gone(1); // the server is gone: so is the conversation's process
            }
        });
    }
    let _ = ready.recv();
    emit(&out, &json!({"type": "bridge.session", "id": sid}));

    for line in input.lines() {
        let Ok(line) = line else { break };
        let res = (|| -> Result<(), String> {
            let m: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            let call = |method: &str, path: &str, body: Value| http.call(method, path, Some(&body), 60).map(|_| ()).map_err(|f| f.msg);
            let id = || m["id"].as_str().map(String::from).ok_or_else(|| "'id'".to_string());
            match m["type"].as_str() {
                Some("prompt") => {
                    let parts = m["parts"].as_array().cloned().unwrap_or_default();
                    let mut body = json!({"parts": parts});
                    let model = text(cfg, "model");
                    if let Some((p, mid)) = model.as_deref().and_then(|m| m.split_once('/')) { body["model"] = json!({"providerID": p, "modelID": mid}); }
                    if let Some(v) = text(cfg, "variant") { body["variant"] = v.into(); }
                    if let Some(s) = text(cfg, "system") { body["system"] = s.into(); }
                    let first = parts.iter().find(|p| p["type"] == "text").and_then(|p| p["text"].as_str().or(Some(""))).unwrap_or("");
                    let t = first.trim_start();
                    let (word, args) = t.split_once(char::is_whitespace).map_or((t, ""), |(w, a)| (w, a.trim_start()));
                    if word.starts_with('/') && commands.contains(&word[1..]) {
                        let mut cb = json!({"command": &word[1..], "arguments": args});
                        if body.get("model").is_some() { cb["model"] = cfg["model"].clone(); }
                        if let Some(v) = body.get("variant") { cb["variant"] = v.clone(); }
                        let files: Vec<&Value> = parts.iter().filter(|p| p["type"] == "file").collect();
                        if !files.is_empty() { cb["parts"] = json!(files); }
                        // /command waits for the turn: keep stdin free for permission/question replies
                        let (http, out, path) = (http.clone(), out.clone(), format!("/session/{sid}/command"));
                        std::thread::spawn(move || {
                            if let Err(f) = http.call("POST", &path, Some(&cb), 86400) { emit(&out, &json!({"type": "bridge.error", "message": f.msg})); }
                        });
                    } else {
                        call("POST", &format!("/session/{sid}/prompt_async"), body)?;
                    }
                }
                Some("permission") => {
                    let mut body = json!({"reply": text(&m, "reply").unwrap_or("reject".into())});
                    if let Some(msg) = text(&m, "message") { body["message"] = msg.into(); }
                    call("POST", &format!("/permission/{}/reply", id()?), body)?;
                }
                Some("question") if m["reject"].as_bool().unwrap_or(false) => call("POST", &format!("/question/{}/reject", id()?), json!({}))?,
                Some("question") => call("POST", &format!("/question/{}/reply", id()?), json!({"answers": m["answers"].as_array().cloned().unwrap_or_default()}))?,
                Some("abort") => call("POST", &format!("/session/{sid}/abort"), json!({}))?,
                _ => {}
            }
            Ok(())
        })();
        if let Err(e) = res { emit(&out, &json!({"type": "bridge.error", "message": e})); } // a bad line or a failed request, the conversation goes on
    }
    stop(0)
}
