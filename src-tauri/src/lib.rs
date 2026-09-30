// Vault: a shell around the real Claude Code CLI. Every conversation is a `claude -p` process in
// stream-json mode, in the vault, on Laurent's subscription (no API key). Permission requests and
// Claude's questions come in through perm_server.py as files in the pending folder.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

// ponytail: paths are Laurent's own machine and this repo, fine for a personal app that is not distributed.
const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
fn home() -> String { std::env::var("HOME").unwrap_or_default() }
fn default_vault() -> String { format!("{}/Documents/LaurentMe/Obsidian - Context-management", home()) }
fn claude_bin() -> String { format!("{}/.local/bin/claude", home()) }
/// The vault folder from the settings.
fn vault(st: &App) -> String {
    st.settings.lock().unwrap()["vault"].as_str().map(String::from).unwrap_or_else(default_vault)
}
/// Claude Code's transcript folder for the vault: the path with every non-alphanumeric char as `-`.
fn transcripts(st: &App) -> String {
    let slug: String = vault(st).chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    format!("{}/.claude/projects/{slug}", home())
}
/// Settings as stored on disk, with the defaults filled in for missing or malformed keys.
fn norm(mut v: Value) -> Value {
    if !v.is_object() { v = json!({}); }
    if !v["vault"].is_string() { v["vault"] = json!(default_vault()); }
    for k in ["projects", "overrides"] { if !v[k].is_object() { v[k] = json!({}); } }
    v
}

struct Proc { child: Child, stdin: ChildStdin }

struct App {
    procs: Mutex<HashMap<String, Proc>>,
    sids: Mutex<HashMap<String, String>>, // project -> session id, persisted
    path: String,                          // login-shell PATH, so Claude's tools find gh, himalaya, node
    settings: Mutex<Value>,                // settings.json: vault, projects, overrides
    subs: Mutex<SubCache>,
}

/// Subagent rows per agent file (reparsed only when mtime or size changes), and per parent session
/// the byte offset read so far plus the last task-notification time per agent id.
#[derive(Default)]
struct SubCache {
    files: HashMap<PathBuf, (std::time::SystemTime, u64, Value)>,
    notes: HashMap<String, (u64, HashMap<String, String>)>,
}

fn data_dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(d.join("pending")).ok();
    d
}
fn pending_dir(app: &AppHandle) -> PathBuf { data_dir(app).join("pending") }

fn save_sids(app: &AppHandle, sids: &HashMap<String, String>) {
    fs::write(data_dir(app).join("sessions.json"), serde_json::to_string_pretty(sids).unwrap()).ok();
}

fn login_path() -> String {
    Command::new("/bin/zsh").args(["-lic", "printf %s \"$PATH\""]).stdin(Stdio::null()).output()
        .ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin".into())
}

/// The brain folder of a vault: System/ in the new layout, Resources/Meta/Claude/ in the old one.
fn brain(vault: &str) -> Option<String> {
    ["System", "Resources/Meta/Claude"].iter().map(|d| format!("{vault}/{d}"))
        .find(|m| PathBuf::from(m).join("rules/core/work-state.md").is_file())
}

#[tauri::command]
fn snapshot(state: State<App>) -> Result<Value, String> {
    let out = Command::new("/usr/bin/python3").arg(format!("{REPO}/snapshot.py"))
        .env("PATH", &state.path).env("VAULT", vault(&state)).output().map_err(|e| e.to_string())?;
    serde_json::from_slice(&out.stdout).map_err(|e| format!("snapshot: {e}"))
}

fn spawn(app: &AppHandle, state: &App, project: &str, name: &str, fork: Option<&str>) -> Result<Proc, String> {
    let mcp = json!({"mcpServers": {"vaultperm": {
        "command": "/usr/bin/python3", "args": [format!("{REPO}/perm_server.py")],
        "env": {"PENDING": pending_dir(app).to_string_lossy(), "PROJECT": project}}}});
    let mut cmd = Command::new(claude_bin());
    cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
              "--permission-prompt-tool", "mcp__vaultperm__approve", "--mcp-config"])
        .arg(mcp.to_string()).args(["-n", name]);
    if let Some(sid) = state.sids.lock().unwrap().get(project) { cmd.args(["--resume", sid]); }
    // continue a terminal conversation as a copy: full history, new session id, the terminal one untouched
    else if let Some(f) = fork.filter(|f| f.chars().all(|c| c.is_ascii_hexdigit() || c == '-')) { cmd.args(["--resume", f, "--fork-session"]); }
    cmd.current_dir(vault(state)).env("PATH", &state.path).env_remove("ANTHROPIC_API_KEY")
        .env("MCP_TOOL_TIMEOUT", "86400000") // a permission may wait a day for Laurent
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("claude start: {e}"))?;
    let stdin = child.stdin.take().unwrap();
    let (stdout, stderr) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());

    let (a, p) = (app.clone(), project.to_string());
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
            if ev["type"] == "system" && ev["subtype"] == "init" {
                if let Some(sid) = ev["session_id"].as_str() {
                    let st = a.state::<App>();
                    let mut sids = st.sids.lock().unwrap();
                    sids.insert(p.clone(), sid.to_string());
                    save_sids(&a, &sids);
                }
            }
            a.emit("claude", json!({"project": p, "event": ev})).ok();
        }
        a.state::<App>().procs.lock().unwrap().remove(&p);
        a.emit("claude", json!({"project": p, "event": {"type": "exit"}})).ok();
    });
    let (a, p) = (app.clone(), project.to_string());
    std::thread::spawn(move || {
        let err: Vec<String> = BufReader::new(stderr).lines().map_while(Result::ok).collect();
        if !err.is_empty() { a.emit("claude", json!({"project": p, "event": {"type": "stderr", "text": err.join("\n")}})).ok(); }
    });
    Ok(Proc { child, stdin })
}

#[tauri::command]
fn send(app: AppHandle, state: State<App>, project: String, text: String, name: Option<String>, fork: Option<String>) -> Result<(), String> {
    let mut procs = state.procs.lock().unwrap();
    if !procs.contains_key(&project) {
        let p = spawn(&app, &state, &project, name.as_deref().unwrap_or(&project), fork.as_deref())?;
        procs.insert(project.clone(), p);
    }
    let msg = json!({"type": "user", "message": {"role": "user", "content": text}});
    let p = procs.get_mut(&project).unwrap();
    writeln!(p.stdin, "{msg}").and_then(|_| p.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop(state: State<App>, project: String) {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
}

/// Past messages of a project's conversation, read from the same transcript the terminal uses.
#[tauri::command]
fn history(state: State<App>, project: String) -> Vec<Value> {
    let Some(sid) = state.sids.lock().unwrap().get(&project).cloned() else { return vec![] };
    let Ok(raw) = fs::read_to_string(format!("{}/{sid}.jsonl", transcripts(&state))) else { return vec![] };
    raw.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|e| (e["type"] == "user" || e["type"] == "assistant") && e["isSidechain"] != true)
        .map(|e| json!({"type": e["type"], "message": e["message"]})).collect()
}

/// "Nieuw gesprek": stop the process and forget the session, the next message starts fresh.
#[tauri::command]
fn reset(app: AppHandle, state: State<App>, project: String) {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    let mut sids = state.sids.lock().unwrap();
    sids.remove(&project);
    save_sids(&app, &sids);
}

/// Hang a conversation under another key, e.g. a general chat that turned out to be about a
/// project. Only while idle: the process stops and the next message resumes it under the new key.
#[tauri::command]
fn move_chat(app: AppHandle, state: State<App>, from: String, to: String) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&from) { p.child.kill().ok(); }
    let mut sids = state.sids.lock().unwrap();
    if let Some(sid) = sids.remove(&from) { sids.insert(to, sid); }
    save_sids(&app, &sids);
    Ok(())
}

/// Every conversation key the app has a session for (projects and general chats).
#[tauri::command]
fn chats(state: State<App>) -> Vec<String> { state.sids.lock().unwrap().keys().cloned().collect() }

/// Session ids of the app's own conversations, so the sidebar does not list them twice.
#[tauri::command]
fn app_sids(state: State<App>) -> Vec<String> { state.sids.lock().unwrap().values().cloned().collect() }

/// Read-only history of any session in the vault, e.g. one that is open in the terminal.
#[tauri::command]
fn history_sid(state: State<App>, sid: String, from: Option<u64>) -> Value {
    use std::io::{Read, Seek, SeekFrom};
    if !sid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') { return json!({"items": [], "next": 0}); }
    // transcripts only grow at the end: read from the byte offset of the previous call, up to the last full line
    let Ok(mut f) = fs::File::open(format!("{}/{sid}.jsonl", transcripts(&state))) else { return json!({"items": [], "next": 0}) };
    let start = from.unwrap_or(0);
    if f.seek(SeekFrom::Start(start)).is_err() { return json!({"items": [], "next": start}); }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    let items: Vec<Value> = String::from_utf8_lossy(&buf[..end]).lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|e| (e["type"] == "user" || e["type"] == "assistant") && e["isSidechain"] != true)
        .map(|e| json!({"type": e["type"], "message": e["message"]})).collect();
    json!({"items": items, "next": start + end as u64})
}

/// Complete JSON lines from the last `n` bytes of a file, the first cut line dropped.
fn tail_lines(path: &std::path::Path, n: u64) -> (Vec<Value>, bool) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = fs::File::open(path) else { return (vec![], true) };
    let start = f.metadata().map(|m| m.len()).unwrap_or(0).saturating_sub(n);
    f.seek(SeekFrom::Start(start)).ok();
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let s = String::from_utf8_lossy(&buf);
    let rows = s.lines().skip(if start > 0 { 1 } else { 0 }).filter_map(|l| serde_json::from_str(l).ok()).collect();
    (rows, start == 0)
}

/// One subagent from its transcript tail and meta file. `ended`: the last message is Claude's and
/// its turn stopped for a reason other than a tool call, so the agent handed back.
fn agent_row(path: &std::path::Path) -> Value {
    let id = path.file_stem().unwrap_or_default().to_string_lossy().trim_start_matches("agent-").to_string();
    let meta: Value = fs::read_to_string(path.with_extension("meta.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({}));
    let mut first = String::new();
    fs::File::open(path).map(|f| BufReader::new(f).read_line(&mut first)).ok();
    let started = serde_json::from_str::<Value>(&first).ok().map(|e| e["timestamp"].clone()).unwrap_or(Value::Null);
    let mut row = json!({"id": id, "description": meta["description"], "agentType": meta["agentType"], "model": meta["model"],
        "started_at": started, "last_at": started, "ended": false});
    // widen the window until the last user or assistant line and the last visible step are in it
    for n in [64u64 << 10, 1 << 20, 8 << 20] {
        let (ev, whole) = tail_lines(path, n);
        let msgs: Vec<&Value> = ev.iter().filter(|e| e["type"] == "user" || e["type"] == "assistant").collect();
        if let Some(last) = msgs.last() {
            row["last_at"] = last["timestamp"].clone();
            let stop = last["message"]["stop_reason"].as_str();
            row["ended"] = json!(last["type"] == "assistant" && stop.is_some_and(|s| s != "tool_use"));
        }
        let step = msgs.iter().rev().filter(|e| e["type"] == "assistant")
            .flat_map(|e| e["message"]["content"].as_array().into_iter().flatten().rev())
            .find(|c| c["type"] == "tool_use" || (c["type"] == "text" && c["text"].as_str().is_some_and(|t| !t.trim().is_empty())));
        if let Some(c) = step {
            if c["type"] == "tool_use" {
                // only the small fields the tool line needs, never a file's content
                let input: serde_json::Map<String, Value> = ["file_path", "command", "pattern", "query", "url", "description", "skill", "subagent_type"].iter()
                    .filter_map(|k| c["input"][*k].as_str().map(|v| (k.to_string(), json!(v.chars().take(120).collect::<String>())))).collect();
                row["tool"] = c["name"].clone();
                row["input"] = Value::Object(input);
            } else { row["text"] = json!(c["text"].as_str().unwrap_or("").trim().chars().take(80).collect::<String>()); }
        }
        if (step.is_some() && !msgs.is_empty()) || whole { break; }
    }
    row
}

/// Last task-notification per agent id in a parent transcript, read incrementally from the saved offset.
fn notifications<'a>(dir: &str, sid: &str, notes: &'a mut HashMap<String, (u64, HashMap<String, String>)>) -> &'a HashMap<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let e = notes.entry(sid.to_string()).or_default();
    if let Ok(mut f) = fs::File::open(format!("{dir}/{sid}.jsonl")) {
        if f.metadata().map(|m| m.len()).unwrap_or(0) < e.0 { *e = Default::default(); }
        let mut buf = Vec::new();
        if f.seek(SeekFrom::Start(e.0)).is_ok() && f.read_to_end(&mut buf).is_ok() {
            let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
            for l in String::from_utf8_lossy(&buf[..end]).lines().filter(|l| l.contains("\"queue-operation\"") && l.contains("<task-id>")) {
                let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
                let c = v["content"].as_str().unwrap_or("");
                if v["operation"] != "enqueue" || c.contains("<status>running</status>") { continue; }
                let Some(id) = c.split("<task-id>").nth(1).and_then(|x| x.split('<').next()) else { continue };
                let ts = v["timestamp"].as_str().unwrap_or("").to_string();
                let cur = e.1.entry(id.to_string()).or_default();
                if ts > *cur { *cur = ts; }
            }
            e.0 += end as u64;
        }
    }
    &e.1
}

/// The subagents of one session. Running unless the agent handed back, the parent got a notification
/// (completed, failed, killed) after its last line, or its file has been silent for 15 minutes.
fn subagents_of(dir: &str, sid: &str, cache: &mut SubCache) -> Vec<Value> {
    let Ok(rd) = fs::read_dir(format!("{dir}/{sid}/subagents")) else { return vec![] };
    let notes = notifications(dir, sid, &mut cache.notes).clone();
    let now = std::time::SystemTime::now();
    let mut rows: Vec<Value> = rd.flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("agent-")))
        .filter_map(|p| {
            let m = p.metadata().ok()?;
            let (mt, len) = (m.modified().ok()?, m.len());
            let mut row = match cache.files.get(&p) {
                Some((a, b, r)) if *a == mt && *b == len => r.clone(),
                _ => { let r = agent_row(&p); cache.files.insert(p.clone(), (mt, len, r.clone())); r }
            };
            let last = row["last_at"].as_str().unwrap_or("").to_string();
            let noted = row["id"].as_str().and_then(|id| notes.get(id)).is_some_and(|t| *t >= last);
            let stale = now.duration_since(mt).map_or(false, |d| d.as_secs() > 900);
            row["running"] = json!(!(row["ended"] == true || noted || stale));
            Some(row)
        }).collect();
    rows.sort_by(|a, b| a["started_at"].as_str().cmp(&b["started_at"].as_str()));
    rows
}

/// The session id behind a conversation key: `t:<sid>` for a terminal session, else the app's own.
fn sid_of(state: &App, key: &str) -> Option<String> {
    key.strip_prefix("t:").map(String::from).or_else(|| state.sids.lock().unwrap().get(key).cloned())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
}

/// Subagents per conversation key, only for keys that ever spawned one.
#[tauri::command]
fn subagents(state: State<App>, keys: Vec<String>) -> Value {
    let dir = transcripts(&state);
    let mut out = serde_json::Map::new();
    for k in keys {
        let Some(sid) = sid_of(&state, &k) else { continue };
        let list = subagents_of(&dir, &sid, &mut state.subs.lock().unwrap());
        if !list.is_empty() { out.insert(k, json!(list)); }
    }
    Value::Object(out)
}

/// The last few things a subagent wrote, read-only, from the tail of its transcript.
#[tauri::command]
fn agent_log(state: State<App>, key: String, id: String) -> Vec<String> {
    let Some(sid) = sid_of(&state, &key) else { return vec![] };
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return vec![]; }
    let (ev, _) = tail_lines(&PathBuf::from(format!("{}/{sid}/subagents/agent-{id}.jsonl", transcripts(&state))), 512 << 10);
    let texts: Vec<String> = ev.iter().filter(|e| e["type"] == "assistant")
        .flat_map(|e| e["message"]["content"].as_array().cloned().unwrap_or_default())
        .filter_map(|c| c["text"].as_str().map(|t| t.trim().chars().take(2000).collect::<String>())).filter(|t| !t.is_empty()).collect();
    texts[texts.len().saturating_sub(3)..].to_vec()
}

#[tauri::command]
fn running(state: State<App>) -> Vec<String> { state.procs.lock().unwrap().keys().cloned().collect() }

#[tauri::command]
fn pending(app: AppHandle) -> Vec<Value> {
    let mut out: Vec<Value> = fs::read_dir(pending_dir(&app)).into_iter().flatten().flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json") && !p.to_string_lossy().ends_with(".answer.json"))
        .filter(|p| !PathBuf::from(p.to_string_lossy().replace(".json", ".answer.json")).exists())
        .filter_map(|p| fs::read_to_string(p).ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
    out.sort_by(|a: &Value, b: &Value| a["at"].as_f64().partial_cmp(&b["at"].as_f64()).unwrap());
    out
}

#[tauri::command]
fn answer(app: AppHandle, id: String, decision: Value) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("bad id".into()); }
    fs::write(pending_dir(&app).join(format!("{id}.answer.json")), decision.to_string()).map_err(|e| e.to_string())
}

/// Sessions Claude Code knows about, including the ones in the terminal and in the background.
#[tauri::command]
fn agents(state: State<App>) -> Value {
    let mut list: Value = Command::new(claude_bin()).args(["agents", "--json"]).env("PATH", &state.path).stdin(Stdio::null())
        .output().ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or(json!([]));
    let dir = transcripts(&state);
    for a in list.as_array_mut().into_iter().flatten() {
        let sid = a["sessionId"].as_str().unwrap_or("").to_string();
        if a["status"] == "busy" && !sid.is_empty() && turn_ended(&PathBuf::from(format!("{dir}/{sid}.jsonl"))) { a["status"] = json!("idle"); }
    }
    list
}

/// `claude agents` keeps a session busy while a background shell of it still runs, also after the turn
/// ended. The transcript closes every turn with a `turn_duration` line: when that comes after the last
/// prompt (typed, or a notification that starts a new turn), Claude is done.
fn turn_ended(path: &std::path::Path) -> bool {
    let (rows, _) = tail_lines(path, 256 << 10);
    for v in rows.iter().rev() {
        if v["type"] == "system" && v["subtype"] == "turn_duration" { return true; }
        if v["type"] != "user" || v["isSidechain"] == true || v["isMeta"] == true { continue; }
        let c = &v["message"]["content"];
        let prompt = c.is_string() || c.as_array().is_some_and(|b| b.iter().all(|x| x["type"] != "tool_result"));
        if prompt { return false; }
    }
    false
}

/// Continue a project's conversation in iTerm. The app's own process for it stops first, so two
/// processes never write the same session.
#[tauri::command]
fn open_terminal(state: State<App>, project: String, session: Option<String>, name: Option<String>) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    let sid = session.or_else(|| state.sids.lock().unwrap().get(&project).cloned());
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = match sid {
        Some(s) if s.chars().all(|c| c.is_ascii_hexdigit() || c == '-') => format!("cd {} && claude --resume {s}", q(&vault(&state))),
        _ => format!("cd {} && claude -n {}", q(&vault(&state)), q(name.as_deref().unwrap_or(&project))),
    };
    let script = format!(
        "tell application \"iTerm\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {}\nend tell",
        serde_json::to_string(&cmd).unwrap());
    Command::new("/usr/bin/osascript").args(["-e", &script]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Background sessions of Claude Code itself (not started by the app): step into one in iTerm, or
/// stop it. `stop` keeps the conversation, `claude attach <id>` resumes it later. No `rm`, that deletes.
#[tauri::command]
fn bg(state: State<App>, action: String, id: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
    match action.as_str() {
        "stop" => {
            let out = Command::new(claude_bin()).args(["stop", &id]).env("PATH", &state.path).stdin(Stdio::null())
                .output().map_err(|e| e.to_string())?;
            if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
        }
        "attach" => {
            let script = format!(
                "tell application \"iTerm\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {}\nend tell",
                serde_json::to_string(&format!("claude attach {id}")).unwrap());
            Command::new("/usr/bin/osascript").args(["-e", &script]).spawn().map(|_| ()).map_err(|e| e.to_string())
        }
        _ => Err("unknown action".into()),
    }
}

/// The saved settings: vault, projects (icon, label) and session overrides.
#[tauri::command]
fn get_settings(state: State<App>) -> Value { state.settings.lock().unwrap().clone() }

/// Validate, save and activate new settings. Returns what was saved.
#[tauri::command]
fn set_settings(app: AppHandle, state: State<App>, settings: Value) -> Result<Value, String> {
    let s = norm(settings);
    let v = s["vault"].as_str().unwrap();
    if brain(v).is_none() {
        return Err(format!("Geen vault: work-state.md niet gevonden in {v}"));
    }
    for (name, p) in s["projects"].as_object().unwrap() {
        let ok = p.as_object().is_some_and(|o| o.iter().all(|(k, x)| match (k.as_str(), x.as_str()) {
            ("icon", Some(t)) => t.chars().count() <= 4,
            ("label", Some(t)) => t.chars().count() <= 60,
            _ => false,
        }));
        if !ok { return Err(format!("Ongeldig project '{name}': icon (max 4 tekens) en label (max 60) moeten tekst zijn")); }
    }
    for (sid, t) in s["overrides"].as_object().unwrap() {
        if sid.is_empty() || !sid.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c) || c == '-') || !(t.is_string() || t.is_null()) {
            return Err(format!("Ongeldige override '{sid}'"));
        }
    }
    fs::write(data_dir(&app).join("settings.json"), serde_json::to_string_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
    app.emit("settings-changed", &s).ok(); // the main window follows a change made in the settings window
    *state.settings.lock().unwrap() = s.clone();
    Ok(s)
}

/// Native folder picker (blocking, so async keeps it off the main thread). None when cancelled.
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

/// Mark a reminder done, push it to a new date, or drop it, via the vault's own reminder script.
#[tauri::command]
fn reminder(state: State<App>, action: String, id: String, date: Option<String>) -> Result<String, String> {
    if !["done", "push", "drop"].contains(&action.as_str()) { return Err("unknown action".into()); }
    if id.len() != 8 || !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("bad id".into()); }
    let v = vault(&state);
    let mut cmd = Command::new("/usr/bin/python3");
    let meta = brain(&v).ok_or("Geen vault: System/ of Resources/Meta/Claude/ niet gevonden")?;
    cmd.arg(format!("{meta}/scripts/reminder-digest.py")).args([&action, &id]);
    if action == "push" {
        let d = date.filter(|d| !d.is_empty() && d.len() <= 12 && d.chars().all(|c| c.is_ascii_alphanumeric() || "+/-".contains(c)))
            .ok_or("date required (max 12 chars of [0-9A-Za-z+/-])")?;
        cmd.arg(d);
    }
    let out = cmd.current_dir(&v).env("PATH", &state.path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // native menu bar: Vault > Instellingen… (Cmd-comma), plus Wijzig and Venster so copy, paste
        // and window shortcuts keep working once the default menu is replaced
        .menu(|h| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
            let settings = MenuItem::with_id(h, "settings", "Instellingen…", true, Some("CmdOrCtrl+,"))?;
            let app = Submenu::with_items(h, "Vault", true, &[
                &P::about(h, Some("Over Vault"), None)?, &P::separator(h)?, &settings, &P::separator(h)?,
                &P::hide(h, Some("Verberg Vault"))?, &P::hide_others(h, Some("Verberg andere"))?, &P::show_all(h, Some("Toon alles"))?,
                &P::separator(h)?, &P::quit(h, Some("Stop Vault"))?])?;
            let edit = Submenu::with_items(h, "Wijzig", true, &[
                &P::undo(h, Some("Herstel"))?, &P::redo(h, Some("Opnieuw"))?, &P::separator(h)?,
                &P::cut(h, Some("Knip"))?, &P::copy(h, Some("Kopieer"))?, &P::paste(h, Some("Plak"))?, &P::select_all(h, Some("Selecteer alles"))?])?;
            let window = Submenu::with_items(h, "Venster", true, &[
                &P::minimize(h, Some("Minimaliseer"))?, &P::maximize(h, Some("Zoom"))?, &P::fullscreen(h, Some("Volledig scherm"))?,
                &P::separator(h)?, &P::close_window(h, Some("Sluit venster"))?])?;
            Menu::with_items(h, &[&app, &edit, &window])
        })
        // settings live in their own small window, the Mac way: open it, or bring it forward when it is open
        .on_menu_event(|app, event| {
            if event.id() != "settings" { return; }
            if let Some(w) = app.get_webview_window("settings") { w.set_focus().ok(); return; }
            tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
                .title("Instellingen").inner_size(600.0, 460.0).min_inner_size(520.0, 360.0)
                .minimizable(false).maximizable(false).build().ok();
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let sids = fs::read_to_string(data_dir(app.handle()).join("sessions.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let settings = norm(fs::read_to_string(data_dir(app.handle()).join("settings.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
            app.manage(App { procs: Mutex::new(HashMap::new()), sids: Mutex::new(sids), path: login_path(), settings: Mutex::new(settings), subs: Default::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, send, stop, reset, move_chat, chats, bg, app_sids, history_sid, history, running, subagents, agent_log, pending, answer, agents, open_terminal, get_settings, set_settings, pick_folder, reminder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // runs against Laurent's own transcripts, skipped on a machine without them
    #[test]
    fn subagents_of_example_session() {
        let dir = format!("{}/.claude/projects/-Users-laurentmeersman-Documents-LaurentMe-Obsidian---Context-management", super::home());
        let sid = "36099ce4-d17c-482a-8907-23790cc0e8db";
        if !std::path::Path::new(&format!("{dir}/{sid}/subagents")).is_dir() { return; }
        let mut c = super::SubCache::default();
        let t = std::time::Instant::now();
        let rows = super::subagents_of(&dir, sid, &mut c);
        let first = t.elapsed();
        let t = std::time::Instant::now();
        super::subagents_of(&dir, sid, &mut c);
        for r in &rows { println!("{} {:5} {} {} | {}", r["id"], r["running"], r["started_at"], r["last_at"], r["description"]); }
        println!("{} agents, first {:?}, cached {:?}", rows.len(), first, t.elapsed());
        let get = |id: &str| rows.iter().find(|r| r["id"] == id).unwrap();
        assert_eq!(get("a13a6342c4ed7b3e7")["running"], false); // ended with end_turn
        assert_eq!(get("a896673643d285b30")["running"], false); // no end_turn, finished per the parent's notification
        assert!(rows.iter().all(|r| r["description"].is_string() && r["started_at"].is_string()));
    }
}

#[cfg(test)]
mod turn_tests {
    #[test]
    fn turn_ended_follows_the_last_marker() {
        let d = std::env::temp_dir().join("vault-turn-test.jsonl");
        let prompt = r#"{"type":"user","message":{"content":"doe iets"}}"#;
        let tool = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
        let done = r#"{"type":"system","subtype":"turn_duration"}"#;
        std::fs::write(&d, format!("{prompt}\n{tool}\n{done}\n")).unwrap();
        assert!(super::turn_ended(&d));
        std::fs::write(&d, format!("{done}\n{prompt}\n{tool}\n")).unwrap();
        assert!(!super::turn_ended(&d));
    }
}
