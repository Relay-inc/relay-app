//! The app's stdin/stdout to `codex app-server` (JSON-RPC 2.0, one JSON object per line), for one conversation.
//! Run as `relay --codex-bridge <codex-bin> '<config json>'`; config: {cwd, model, effort, sandbox, approval, resume, instructions}.
//!
//! It does the handshake the app cannot (initialize, initialized, thread/start or thread/resume, which gives the thread id)
//! and then passes lines both ways: every line codex writes goes to stdout unchanged, every line the app writes goes to
//! codex with the thread id, model and effort filled in (the Rust side writes `turn/start` without them). Server requests
//! the app has no card for are declined here, so a turn never waits on an answer nobody can give. When the app closes
//! stdin (or is gone) codex is stopped.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

// server requests the Rust side turns into permission cards (src/app_server.rs)
const ASKS: [&str; 4] = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "execCommandApproval", "applyPatchApproval"];

/// `bridge_main(bin, config json)`: the exit code.
pub fn main(bin: &str, cfg: &str) -> i32 {
    let Ok(cfg) = serde_json::from_str::<Value>(cfg) else { return 1 };
    run(bin, &cfg, std::io::stdin().lock(), std::io::stdout(), |c| std::process::exit(c))
}

const EOF: i32 = i32::MIN; // codex ended during the handshake

fn text(v: &Value, k: &str) -> Option<String> { v[k].as_str().filter(|s| !s.is_empty()).map(String::from) }

/// Slash UI commands become protocol operations, skills become explicit skill input items.
fn prepare_turn(message: &Value, skills: &HashMap<String, Value>) -> Result<Value, String> {
    let mut message = message.clone();
    let empty = vec![];
    let inputs = message["params"]["input"].as_array().unwrap_or(&empty);
    let Some(first) = inputs.iter().find(|i| i["type"] == "text") else { return Ok(message) };
    let t = first["text"].as_str().unwrap_or("").to_string();
    if !t.starts_with('/') { return Ok(message); }
    let (command, args) = match t.split_once(char::is_whitespace) { Some((c, a)) => (c, a.trim_start()), None => (t.as_str(), "") };
    if command == "/compact" || command == "/review" {
        if inputs.iter().any(|i| i["type"] != "text") { return Err("This command does not accept attachments".into()); }
        if command == "/compact" && !args.is_empty() { return Err("/compact does not accept arguments".into()); }
        let mut params = Map::new();
        params.insert("threadId".into(), message["params"]["threadId"].clone());
        let mut method = "thread/compact/start";
        if command == "/review" {
            method = "review/start";
            params.insert("delivery".into(), "inline".into());
            params.insert("target".into(), if args.is_empty() { json!({"type": "uncommittedChanges"}) } else { json!({"type": "custom", "instructions": args}) });
        }
        return Ok(json!({"id": message["id"], "method": method, "params": params}));
    }
    if let Some(name) = command.strip_prefix("/skill:") {
        let skill = skills.get(name).ok_or_else(|| format!("Skill is unavailable or disabled: {name}"))?;
        let inputs = message["params"]["input"].as_array_mut().unwrap();
        let first = inputs.iter_mut().find(|i| i["type"] == "text").unwrap();
        first["text"] = format!("${name}{}", if args.is_empty() { String::new() } else { format!(" {args}") }).into();
        first.as_object_mut().unwrap().remove("text_elements");
        inputs.push(json!({"type": "skill", "name": name, "path": skill["path"]}));
    }
    Ok(message)
}

/// SIGTERM, as the python bridge did: codex cleans up its own children.
pub fn terminate(pid: u32) { unsafe { libc::kill(pid as i32, libc::SIGTERM); } }

/// The bridge on `input`/`out`; `gone(code)` is called (from a thread) when codex ends by itself, the process exit in
/// the app. Returns the exit code.
pub fn run<W: Write + Send + 'static>(bin: &str, cfg: &Value, input: impl BufRead, out: W, gone: fn(i32)) -> i32 {
    let Ok(mut codex) = Command::new(bin).arg("app-server").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn() else { return 1 };
    let pid = codex.id();
    let cin = Arc::new(Mutex::new(codex.stdin.take().unwrap()));
    let mut cout = BufReader::new(codex.stdout.take().unwrap());
    let out = Arc::new(Mutex::new(out));
    let send = |cin: &Mutex<ChildStdin>, m: &Value| -> std::io::Result<()> {
        let mut w = cin.lock().unwrap();
        writeln!(w, "{m}")?;
        w.flush()
    };
    let emit = |out: &Mutex<W>, line: &str| {
        let mut w = out.lock().unwrap();
        let _ = w.write_all(line.as_bytes());
        if !line.ends_with('\n') { let _ = w.write_all(b"\n"); }
        let _ = w.flush();
    };
    // pass codex's lines on until the response to request `rid`, and return that one (not passed on)
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
    let hs = (|| -> Result<(String, HashMap<String, Value>), i32> {
        let io = |_| 0;
        send(&cin, &json!({"id": 0, "method": "initialize", "params": {"clientInfo": {"name": "relay", "title": "Relay", "version": "0.1.0"}, "capabilities": null}})).map_err(io)?;
        until(&mut cout, 0)?;
        send(&cin, &json!({"method": "initialized"})).map_err(io)?;
        let mut opts = json!({"cwd": cfg["cwd"], "approvalPolicy": text(cfg, "approval").unwrap_or("on-request".into()), "sandbox": text(cfg, "sandbox").unwrap_or("workspace-write".into())});
        if let Some(m) = text(cfg, "model") { opts["model"] = m.into(); }
        if let Some(e) = text(cfg, "effort") { opts["config"] = json!({"model_reasoning_effort": e}); }
        if let Some(i) = text(cfg, "instructions") { opts["developerInstructions"] = i.into(); }
        let mut r = None;
        if let Some(id) = text(cfg, "resume") {
            let mut p = opts.clone();
            p["threadId"] = id.into();
            send(&cin, &json!({"id": 1, "method": "thread/resume", "params": p})).map_err(io)?;
            r = Some(until(&mut cout, 1)?);
        }
        if r.as_ref().is_none_or(|r| r.get("error").is_some()) { // nothing to resume, or codex no longer has it: a new thread
            send(&cin, &json!({"id": 2, "method": "thread/start", "params": opts})).map_err(io)?;
            r = Some(until(&mut cout, 2)?);
        }
        let r = r.unwrap();
        emit(&out, &r.to_string()); // the Rust side reads the thread id (or the error) from it
        let Some(thread) = r["result"]["thread"]["id"].as_str().filter(|s| !s.is_empty()).map(String::from) else {
            terminate(pid);
            return Err(1);
        };
        let cwd = cfg["cwd"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default());
        send(&cin, &json!({"id": 3, "method": "skills/list", "params": {"cwds": [cwd], "forceReload": true}})).map_err(io)?;
        let mut skills = HashMap::new();
        for group in until(&mut cout, 3)?["result"]["data"].as_array().into_iter().flatten() {
            for skill in group["skills"].as_array().into_iter().flatten() {
                if skill["enabled"].as_bool().unwrap_or(true) && skill["path"].as_str().is_some_and(|p| !p.is_empty()) {
                    skills.entry(skill["name"].as_str().unwrap_or("").to_string()).or_insert_with(|| skill.clone());
                }
            }
        }
        Ok((thread, skills))
    })();
    let (thread, skills) = match hs { Ok(h) => h, Err(EOF) => return codex_code(&mut codex), Err(c) => return c };

    let pump = {
        let (cin, out) = (cin.clone(), out.clone());
        std::thread::spawn(move || {
            let mut line = String::new();
            loop {
                line.clear();
                if read_line(&mut cout, &mut line) == 0 { break; }
                emit(&out, &line);
                let Ok(m) = serde_json::from_str::<Value>(&line) else { continue };
                if m.get("id").is_some() && m["method"].as_str().is_some_and(|x| !ASKS.contains(&x)) {
                    let _ = send(&cin, &json!({"id": m["id"], "error": {"code": -32601, "message": "not supported by the vault app"}}));
                }
            }
            let code = codex_code(&mut codex);
            gone(code); // codex is gone: so is the conversation's process
            code
        })
    };
    let mut n = 10;
    for line in input.lines() {
        let Ok(line) = line else { break };
        let Ok(mut m) = serde_json::from_str::<Value>(&line) else { continue };
        if !m.is_object() { continue; }
        if m["method"].is_string() && m["params"].is_object() {
            if m["params"]["threadId"] == "" { m["params"]["threadId"] = thread.clone().into(); }
            if m["method"] == "turn/start" {
                n += 1;
                if m.get("id").is_none() { m["id"] = n.into(); }
                for k in ["model", "effort"] {
                    if let Some(v) = text(cfg, k) { m["params"].as_object_mut().unwrap().entry(k).or_insert(v.into()); }
                }
            }
        }
        let m = if m["method"] == "turn/start" {
            match prepare_turn(&m, &skills) {
                Ok(p) => p,
                Err(e) => { emit(&out, &json!({"id": m["id"], "error": {"message": e}}).to_string()); continue; }
            }
        } else { m };
        if send(&cin, &m).is_err() { break; }
    }
    terminate(pid);
    pump.join().unwrap_or(1)
}

fn read_line<R: BufRead>(r: &mut R, line: &mut String) -> usize {
    let mut buf = vec![];
    let n = r.read_until(b'\n', &mut buf).unwrap_or(0);
    line.push_str(&String::from_utf8_lossy(&buf));
    n
}

fn codex_code(c: &mut Child) -> i32 { c.wait().ok().and_then(|s| s.code()).unwrap_or(1) }

#[cfg(test)]
mod tests {
    use super::*;

    fn prepare(text: &str, extra: Vec<Value>) -> Result<Value, String> {
        let mut input = vec![json!({"type": "text", "text": text})];
        input.extend(extra);
        let skills = HashMap::from([("writer".to_string(), json!({"name": "writer", "path": "/skills/writer/SKILL.md"}))]);
        prepare_turn(&json!({"id": 11, "method": "turn/start", "params": {"threadId": "t", "model": "m", "effort": "high", "input": input}}), &skills)
    }

    #[test]
    fn compact_and_review_leave_no_turn_only_fields() {
        assert_eq!(prepare("/compact", vec![]).unwrap(), json!({"id": 11, "method": "thread/compact/start", "params": {"threadId": "t"}}));
        assert_eq!(prepare("/review", vec![]).unwrap()["params"]["target"], json!({"type": "uncommittedChanges"}));
        assert_eq!(prepare("/review focus on errors", vec![]).unwrap()["params"]["target"], json!({"type": "custom", "instructions": "focus on errors"}));
        assert!(prepare("/compact instructions", vec![]).is_err());
        assert!(prepare("/compact", vec![json!({"type": "image", "url": "data:x"})]).is_err());
    }

    #[test]
    fn skill_invocation_is_explicit_and_keeps_arguments_and_attachments() {
        let image = json!({"type": "image", "url": "data:x"});
        let r = prepare("/skill:writer rewrite this\nwith examples", vec![image.clone()]).unwrap();
        assert_eq!(r["params"]["input"], json!([{"type": "text", "text": "$writer rewrite this\nwith examples"}, image, {"type": "skill", "name": "writer", "path": "/skills/writer/SKILL.md"}]));
        assert_eq!(r["params"]["model"], "m");
        assert!(prepare("/skill:removed", vec![]).is_err());
        assert_eq!(prepare("ordinary /text", vec![]).unwrap()["params"]["input"][0]["text"], "ordinary /text");
    }
}
