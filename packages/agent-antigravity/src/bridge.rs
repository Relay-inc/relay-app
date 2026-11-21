//! The app's stdin/stdout to `agy acp` (the Agent Client Protocol: JSON-RPC 2.0, one JSON object per line), for one
//! conversation. Run as `relay --antigravity-bridge <agy-bin> '<config json>'`; config: {cwd, model, mode, resume,
//! instructions, log}.
//!
//! It does the handshake the app cannot (initialize, then session/resume or session/new, which gives the session id,
//! then the model and the mode) and passes lines both ways: every line the agent writes goes to stdout unchanged, every
//! prompt the app writes goes to the agent with the session id and a request id filled in. A request from the agent
//! that the app has no card for is declined here, so a turn never waits on an answer nobody can give. When the app
//! closes stdin (or is gone) the agent is stopped.
//!
//! It also keeps the conversation's log, `<log>/<session id>.jsonl`: the session line, the app's prompts and the agent's
//! lines, as they passed. That log is the history and the token usage (lib.rs): Antigravity's own store is a database
//! per conversation that only its CLI reads.

use agent_core::usage::{now_ms, rfc3339};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

/// The one request of the agent the Rust side turns into a card (src/acp.rs).
const ASK: &str = "session/request_permission";
/// The modes a conversation can be put in; without one it stays in the agent's own default, which asks before every
/// edit and command.
pub const MODES: [&str; 2] = ["accept-edits", "auto"];

/// `main(bin, config json)`: the exit code.
pub fn main(bin: &str, cfg: &str) -> i32 {
    let Ok(cfg) = serde_json::from_str::<Value>(cfg) else { return 1 };
    run(bin, &cfg, std::io::stdin().lock(), std::io::stdout(), |c| std::process::exit(c))
}

const EOF: i32 = i32::MIN; // the agent ended during the handshake

fn text(v: &Value, k: &str) -> Option<String> { v[k].as_str().filter(|s| !s.is_empty()).map(String::from) }

/// The log line of a prompt or a turn's end: the line with its time, and for a turn's end the model and the folder
/// it ran in, which the usage is counted by.
fn stamped(m: &Value, model: &str, cwd: &str) -> String {
    let mut m = m.clone();
    m["at"] = rfc3339(now_ms(), true).into();
    if m["result"]["stopReason"].is_string() { (m["model"], m["cwd"]) = (model.into(), cwd.into()); }
    m.to_string()
}

/// The bridge on `input`/`out`; `gone(code)` is called (from a thread) when the agent ends by itself, the process exit
/// in the app. Returns the exit code.
pub fn run<W: Write + Send + 'static>(bin: &str, cfg: &Value, input: impl BufRead, out: W, gone: fn(i32)) -> i32 {
    let mut cmd = Command::new(bin);
    cmd.arg("acp").stdin(Stdio::piped()).stdout(Stdio::piped());
    #[cfg(unix)]
    let Ok(mut agent) = cmd.spawn() else { return 1 };
    // Windows: the agent and the commands it runs in a Job Object, ended when this bridge goes
    #[cfg(windows)]
    let Some((_job, mut agent)) = agent_core::job::Job::new().ok().and_then(|j| j.spawn(&mut cmd).ok().map(|c| (j, c))) else { return 1 };
    let pid = agent.id();
    let cin = Arc::new(Mutex::new(agent.stdin.take().unwrap()));
    let mut cout = BufReader::new(agent.stdout.take().unwrap());
    let out = Arc::new(Mutex::new(out));
    let send = |cin: &Mutex<ChildStdin>, m: &Value| -> std::io::Result<()> {
        let mut w = cin.lock().unwrap();
        writeln!(w, "{m}")?;
        w.flush()
    };
    let emit = |out: &Mutex<W>, line: &str| {
        let mut w = out.lock().unwrap();
        let _ = w.write_all(line.trim_end_matches('\n').as_bytes());
        let _ = w.write_all(b"\n");
        let _ = w.flush();
    };
    // pass the agent's lines on until the response to request `rid`, and return that one (not passed on)
    let until = |cout: &mut BufReader<_>, rid: i64| -> Result<Value, i32> {
        let mut line = String::new();
        loop {
            line.clear();
            if read_line(cout, &mut line) == 0 { return Err(EOF); }
            let m: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
            if m["id"] == rid && m.get("method").is_none() { return Ok(m); }
            emit(&out, &line);
        }
    };
    let cwd = text(cfg, "cwd").unwrap_or_else(|| std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default());
    let hs = (|| -> Result<(String, String, Value), i32> {
        let io = |_| 0;
        let call = |cout: &mut BufReader<_>, id: i64, method: &str, params: Value| -> Result<Value, i32> {
            send(&cin, &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).map_err(io)?;
            until(cout, id)
        };
        // no file access through the client: the agent reads and writes the folder itself, and asks first
        let init = call(&mut cout, 0, "initialize", json!({"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": false, "writeTextFile": false}},
            "clientInfo": {"name": "relay", "title": "Relay", "version": env!("CARGO_PKG_VERSION")}}))?;
        let mut open = json!({"cwd": cwd, "mcpServers": []});
        let mut r = None;
        if let Some(id) = text(cfg, "resume") {
            let mut p = open.clone();
            p["sessionId"] = id.into();
            r = Some(call(&mut cout, 1, "session/resume", p)?);
        }
        if r.as_ref().is_none_or(|r| r.get("error").is_some()) { // nothing to resume, or the agent no longer has it: a new session
            if let (Some(i), true) = (text(cfg, "instructions"), init["result"]["agentCapabilities"]["_meta"]["antigravity"]["systemPrompt"]["append"] == true) {
                open["_meta"] = json!({"antigravity": {"systemPrompt": {"append": i}}});
            }
            r = Some(call(&mut cout, 2, "session/new", open)?);
        }
        let mut r = r.unwrap();
        let Some(session) = text(&r["result"], "sessionId").or_else(|| r.get("error").is_none().then(|| text(cfg, "resume")).flatten()) else {
            emit(&out, &r.to_string()); // the Rust side shows the error (not signed in, a folder it cannot open)
            agent_core::terminate(pid);
            return Err(1);
        };
        r["result"]["sessionId"] = session.clone().into();
        let mut model = r["result"]["models"]["currentModelId"].as_str().unwrap_or("").to_string();
        if let Some(m) = text(cfg, "model").filter(|m| *m != model) {
            if call(&mut cout, 3, "session/set_model", json!({"sessionId": session, "modelId": m}))?.get("error").is_none() {
                r["result"]["models"]["currentModelId"] = m.clone().into();
                model = m;
            }
        }
        if let Some(mode) = text(cfg, "mode").filter(|m| MODES.contains(&m.as_str())) {
            call(&mut cout, 4, "session/set_mode", json!({"sessionId": session, "modeId": mode}))?;
        }
        Ok((session, model, r))
    })();
    let (session, model, opened) = match hs { Ok(h) => h, Err(EOF) => return code(&mut agent), Err(c) => return c };

    let log: Arc<Mutex<Option<File>>> = Arc::new(Mutex::new(text(cfg, "log").and_then(|dir| {
        std::fs::create_dir_all(&dir).ok()?;
        File::options().create(true).append(true).open(Path::new(&dir).join(format!("{session}.jsonl"))).ok()
    })));
    let keep = |log: &Mutex<Option<File>>, line: &str| {
        if let Some(f) = log.lock().unwrap().as_mut() { let _ = writeln!(f, "{}", line.trim_end_matches('\n')); }
    };
    emit(&out, &opened.to_string()); // the Rust side reads the session id and the model from it
    keep(&log, &opened.to_string());

    let pump = {
        let (cin, out, log, model, cwd) = (cin.clone(), out.clone(), log.clone(), model.clone(), cwd.clone());
        std::thread::spawn(move || {
            let mut line = String::new();
            loop {
                line.clear();
                if read_line(&mut cout, &mut line) == 0 { break; }
                emit(&out, &line);
                let Ok(m) = serde_json::from_str::<Value>(&line) else { continue };
                // the command list is long and comes with every turn: not history
                if m["params"]["update"]["sessionUpdate"] == "available_commands_update" { continue; }
                if m["result"]["stopReason"].is_string() { keep(&log, &stamped(&m, &model, &cwd)); } else { keep(&log, &line); }
                if m.get("id").is_some() && m["method"].as_str().is_some_and(|x| x != ASK) {
                    let _ = send(&cin, &json!({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32601, "message": "not supported by Relay"}}));
                }
            }
            let c = code(&mut agent);
            gone(c); // the agent is gone: so is the conversation's process
            c
        })
    };
    let mut n = 10;
    for line in input.lines() {
        let Ok(line) = line else { break };
        let Ok(mut m) = serde_json::from_str::<Value>(&line) else { continue };
        if !m.is_object() { continue; }
        if m["method"] == "session/prompt" {
            n += 1;
            m["id"] = n.into();
            m["params"]["sessionId"] = session.clone().into();
            keep(&log, &stamped(&m, &model, &cwd));
        }
        if send(&cin, &m).is_err() { break; }
    }
    agent_core::terminate(pid);
    pump.join().unwrap_or(1)
}

fn read_line<R: BufRead>(r: &mut R, line: &mut String) -> usize {
    let mut buf = vec![];
    let n = r.read_until(b'\n', &mut buf).unwrap_or(0);
    line.push_str(&String::from_utf8_lossy(&buf));
    n
}

fn code(c: &mut Child) -> i32 { c.wait().ok().and_then(|s| s.code()).unwrap_or(1) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turns_end_is_logged_with_its_time_model_and_folder() {
        let end: Value = serde_json::from_str(&stamped(&json!({"id": 11, "result": {"stopReason": "end_turn"}}), "m1", "/v")).unwrap();
        assert_eq!((end["model"].as_str(), end["cwd"].as_str()), (Some("m1"), Some("/v")));
        assert!(agent_core::usage::parse_ts(end["at"].as_str().unwrap()).is_some());
        let prompt: Value = serde_json::from_str(&stamped(&json!({"id": 11, "method": "session/prompt", "params": {}}), "m1", "/v")).unwrap();
        assert!(prompt["at"].is_string() && prompt.get("model").is_none());
    }
}
