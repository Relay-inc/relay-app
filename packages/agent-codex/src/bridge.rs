//! The app's stdin/stdout to `codex app-server` (JSON-RPC 2.0, one JSON object per line), for one conversation.
//! Run as `relay --codex-bridge <codex-bin> '<config json>'`; config: {cwd, model, effort, sandbox, approval, fenced, resume, instructions}.
//! Fenced (a workspace) it also reads codex's config for the folder first, to switch off its MCP servers (`thread_params`).
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

// what a fenced conversation's profile keeps read-only in the workspace: the agents' config and instructions.
// `.claude` covers the folder it links to (codex resolves the link). `.codex`, `.agents` and `.git` are what
// `:workspace` itself keeps, which a profile's own `:project_roots` table replaces, so they are listed again.
// Nested instruction files are not listed: they are notes that sync, which any member can write anyway.
const READ_ONLY: [&str; 8] = [".claude", "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", ".codex", ".agents", ".git"];
const PROFILE: &str = "relay-workspace";
/// What a fenced conversation's commands may still read outside the workspace: everything else is `none` (`:root`),
/// so a note cannot have Codex read a file of yours and write it into a note that syncs. Measured with codex-cli 0.163
/// (`codex sandbox`, then a real thread): without one of these `zsh -lc`, git or a here-document fails.
/// - `:minimal`: macOS's own system folders (dyld, /bin, /usr, /System, /dev, /etc and the like), without which no
///   program starts.
/// - `/opt/homebrew`: the Homebrew programs, as Relay's guard lets them through (policy.rs, `SYSTEM`). Not its `var`,
///   where the databases and logs of Homebrew services live.
/// - `~/.gitconfig` and the files `config`, `ignore` and `attributes` of `~/.config/git`: git stops with "unable to
///   access" when it cannot read its global config. Not that folder whole, git's credential store can be in it.
/// `:tmpdir` (the user's `$TMPDIR`) stays writable as in `:workspace`: here-documents and xcrun need it. `/tmp` does not.
/// The workspace itself is the project root. Codex itself is not in the sandbox: it reads `~/.codex` (login, sessions)
/// as before, its commands do not. A workspace conversation gets no project repos, so none are listed.
fn readable(home: &str) -> Map<String, Value> {
    let home = home.trim_end_matches('/');
    let mut fs = Map::new();
    for (p, a) in [(":root", "none"), (":slash_tmp", "none"), (":minimal", "read"), ("/opt/homebrew", "read"), ("/opt/homebrew/var", "none")] { fs.insert(p.into(), a.into()); }
    if home.starts_with('/') { for x in [".gitconfig", ".config/git/config", ".config/git/ignore", ".config/git/attributes"] { fs.insert(format!("{home}/{x}"), "read".into()); } }
    fs
}
// the first codex-cli this ran against with permission profiles (docs/workspaces.md › Trust)
const MIN_FENCED: (u32, u32) = (0, 163);

/// From initialize's `userAgent` ("relay/0.163.0 (Mac OS ...) ..."): a codex with permission profiles.
fn has_profiles(user_agent: &str) -> bool {
    let v = user_agent.split_once('/').map(|(_, r)| r).unwrap_or("").split([' ', '-', '+']).next().unwrap_or("");
    let mut n = v.split('.').map(|p| p.parse::<u32>().ok());
    match (n.next().flatten(), n.next().flatten()) {
        (Some(major), Some(minor)) => (major, minor) >= MIN_FENCED,
        _ => false,
    }
}

/// thread/start (and thread/resume) params. Fenced (a workspace): approvals to the app (Relay's guard and the cards),
/// never to codex's own auto review. Its MCP servers (`mcp`, from config/read), plugins and apps are off, as Claude
/// Code runs there with `--strict-mcp-config`. And the sandbox becomes Relay's permission profile: `workspace-write` the
/// same sandbox with READ_ONLY kept and none of the user's own extra writable roots, `read-only` the same read-only one,
/// both reading only the workspace and `readable` outside it.
fn thread_params(cfg: &Value, mcp: &[String]) -> Value {
    let sandbox = text(cfg, "sandbox").unwrap_or("workspace-write".into());
    let mut opts = json!({"cwd": cfg["cwd"], "approvalPolicy": text(cfg, "approval").unwrap_or("on-request".into()), "sandbox": sandbox});
    let mut config = Map::new();
    if let Some(m) = text(cfg, "model") { opts["model"] = m.into(); }
    if let Some(e) = text(cfg, "effort") { config.insert("model_reasoning_effort".into(), e.into()); }
    if let Some(i) = text(cfg, "instructions") { opts["developerInstructions"] = i.into(); }
    if cfg["fenced"] == true {
        opts["approvalsReviewer"] = "user".into();
        config.insert("features".into(), json!({"plugins": false, "apps": false}));
        config.insert("mcp_servers".into(), mcp.iter().map(|n| (n.clone(), json!({"enabled": false}))).collect::<Map<_, _>>().into());
        // codex takes a sandbox or a profile, not both: both modes a workspace allows become Relay's profile
        let mut fs = readable(cfg["home"].as_str().unwrap_or(""));
        let base = if sandbox == "workspace-write" {
            fs.insert(":project_roots".into(), READ_ONLY.iter().map(|p| (p.to_string(), json!("read"))).collect::<Map<_, _>>().into());
            ":workspace"
        } else {
            fs.insert(":project_roots".into(), "read".into());
            ":read-only"
        };
        opts.as_object_mut().unwrap().remove("sandbox");
        config.insert("default_permissions".into(), PROFILE.into());
        config.insert("permissions".into(), json!({PROFILE: {"extends": base, "filesystem": fs}}));
    }
    if !config.is_empty() { opts["config"] = config.into(); }
    opts
}

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

/// The bridge on `input`/`out`; `gone(code)` is called (from a thread) when codex ends by itself, the process exit in
/// the app. Returns the exit code.
pub fn run<W: Write + Send + 'static>(bin: &str, cfg: &Value, input: impl BufRead, out: W, gone: fn(i32)) -> i32 {
    let mut cmd = Command::new(bin);
    cmd.arg("app-server").stdin(Stdio::piped()).stdout(Stdio::piped());
    #[cfg(unix)]
    let Ok(mut codex) = cmd.spawn() else { return 1 };
    // Windows: codex and the commands it runs in a Job Object, ended when this bridge goes
    #[cfg(windows)]
    let Some((_job, mut codex)) = agent_core::job::Job::new().ok().and_then(|j| j.spawn(&mut cmd).ok().map(|c| (j, c))) else { return 1 };
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
        let init = until(&mut cout, 0)?;
        send(&cin, &json!({"method": "initialized"})).map_err(io)?;
        let mut mcp = vec![];
        if cfg["fenced"] == true {
            // an older codex ignores the profile and would fall back to the user's own sandbox_mode: refuse instead
            if !has_profiles(init["result"]["userAgent"].as_str().unwrap_or("")) {
                emit(&out, &json!({"id": 2, "error": {"message": format!("Codex {}.{} or newer is needed in a workspace", MIN_FENCED.0, MIN_FENCED.1)}}).to_string());
                agent_core::terminate(pid);
                return Err(1);
            }
            // the MCP servers its config gives this folder, to switch off (the user's, and a project layer's)
            send(&cin, &json!({"id": 4, "method": "config/read", "params": {"cwd": cfg["cwd"]}})).map_err(io)?;
            let c = until(&mut cout, 4)?;
            if c.get("error").is_some() { emit(&out, &json!({"id": 2, "error": c["error"]}).to_string()); agent_core::terminate(pid); return Err(1); }
            mcp = c["result"]["config"]["mcp_servers"].as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
        }
        let opts = thread_params(cfg, &mcp);
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
            agent_core::terminate(pid);
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
    agent_core::terminate(pid);
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

    #[test]
    fn main_vault_threads_keep_the_chosen_sandbox_and_codexs_own_mcp() {
        let cfg = json!({"cwd": "/v", "model": "m", "effort": "high", "sandbox": "workspace-write", "approval": "on-request", "fenced": false, "instructions": "i"});
        assert_eq!(thread_params(&cfg, &["mine".into()]), json!({"cwd": "/v", "approvalPolicy": "on-request", "sandbox": "workspace-write", "model": "m", "developerInstructions": "i", "config": {"model_reasoning_effort": "high"}}));
        assert!(thread_params(&json!({"cwd": "/v"}), &[]).get("config").is_none());
    }

    #[test]
    fn a_workspace_thread_gets_relays_profile_and_no_mcp_servers() {
        let cfg = json!({"cwd": "/w", "home": "/me/", "sandbox": "workspace-write", "approval": "on-request", "fenced": true});
        let p = thread_params(&cfg, &["node_repl".into(), "fake".into()]);
        assert!(p.get("sandbox").is_none()); // a profile, not a sandbox mode: codex refuses both
        assert_eq!(p["approvalsReviewer"], "user");
        assert_eq!(p["config"]["default_permissions"], PROFILE);
        // nothing outside the workspace to read but the system's programs and git's config, the agents' files kept
        let outside = json!({":root": "none", ":slash_tmp": "none", ":minimal": "read", "/opt/homebrew": "read", "/opt/homebrew/var": "none",
            "/me/.gitconfig": "read", "/me/.config/git/config": "read", "/me/.config/git/ignore": "read", "/me/.config/git/attributes": "read"});
        let mut fs = outside.clone();
        fs[":project_roots"] = json!({".claude": "read", "CLAUDE.md": "read", "CLAUDE.local.md": "read", "AGENTS.md": "read", "AGENTS.override.md": "read", ".codex": "read", ".agents": "read", ".git": "read"});
        assert_eq!(p["config"]["permissions"], json!({"relay-workspace": {"extends": ":workspace", "filesystem": fs}}));
        assert_eq!(p["config"]["mcp_servers"], json!({"node_repl": {"enabled": false}, "fake": {"enabled": false}}));
        assert_eq!(p["config"]["features"], json!({"plugins": false, "apps": false}));
        // read-only stays read-only, with the same reads, still without MCP servers
        let p = thread_params(&json!({"cwd": "/w", "home": "/me", "sandbox": "read-only", "fenced": true}), &[]);
        let mut fs = outside;
        fs[":project_roots"] = json!("read");
        assert!(p.get("sandbox").is_none());
        assert_eq!(p["config"]["permissions"], json!({"relay-workspace": {"extends": ":read-only", "filesystem": fs}}));
        assert_eq!(p["config"]["mcp_servers"], json!({}));
        // no home known: no home path at all, rather than one at the disk's root
        let p = thread_params(&json!({"cwd": "/w", "fenced": true}), &[]);
        assert!(p["config"]["permissions"][PROFILE]["filesystem"].get("/.gitconfig").is_none());
    }

    #[test]
    fn only_a_codex_with_permission_profiles_runs_fenced() {
        assert!(has_profiles("relay/0.163.0 (Mac OS 26.4.1; arm64) unknown (relay; 0.1.0)"));
        assert!(has_profiles("relay/0.170.2-alpha.1 (Linux)") && has_profiles("relay/1.0.0"));
        assert!(!has_profiles("relay/0.159.2 (Mac OS 26.1; arm64)"));
        assert!(!has_profiles("") && !has_profiles("relay") && !has_profiles("relay/x.y"));
    }
}
