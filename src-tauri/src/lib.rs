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
fn vault() -> String { format!("{}/Documents/LaurentMe/Obsidian - Context-management", home()) }
fn claude_bin() -> String { format!("{}/.local/bin/claude", home()) }
fn transcripts() -> String {
    format!("{}/.claude/projects/-Users-laurentmeersman-Documents-LaurentMe-Obsidian---Context-management", home())
}

struct Proc { child: Child, stdin: ChildStdin }

struct App {
    procs: Mutex<HashMap<String, Proc>>,
    sids: Mutex<HashMap<String, String>>, // project -> session id, persisted
    path: String,                          // login-shell PATH, so Claude's tools find gh, himalaya, node
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

#[tauri::command]
fn snapshot(state: State<App>) -> Result<Value, String> {
    let out = Command::new("/usr/bin/python3").arg(format!("{REPO}/snapshot.py"))
        .env("PATH", &state.path).output().map_err(|e| e.to_string())?;
    serde_json::from_slice(&out.stdout).map_err(|e| format!("snapshot: {e}"))
}

fn spawn(app: &AppHandle, state: &App, project: &str, name: &str) -> Result<Proc, String> {
    let mcp = json!({"mcpServers": {"vaultperm": {
        "command": "/usr/bin/python3", "args": [format!("{REPO}/perm_server.py")],
        "env": {"PENDING": pending_dir(app).to_string_lossy(), "PROJECT": project}}}});
    let mut cmd = Command::new(claude_bin());
    cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
              "--permission-prompt-tool", "mcp__vaultperm__approve", "--mcp-config"])
        .arg(mcp.to_string()).args(["-n", name]);
    if let Some(sid) = state.sids.lock().unwrap().get(project) { cmd.args(["--resume", sid]); }
    cmd.current_dir(vault()).env("PATH", &state.path).env_remove("ANTHROPIC_API_KEY")
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
fn send(app: AppHandle, state: State<App>, project: String, text: String, name: Option<String>) -> Result<(), String> {
    let mut procs = state.procs.lock().unwrap();
    if !procs.contains_key(&project) {
        let p = spawn(&app, &state, &project, name.as_deref().unwrap_or(&project))?;
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
    let Ok(raw) = fs::read_to_string(format!("{}/{sid}.jsonl", transcripts())) else { return vec![] };
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
fn history_sid(sid: String) -> Vec<Value> {
    if !sid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') { return vec![]; }
    let Ok(raw) = fs::read_to_string(format!("{}/{sid}.jsonl", transcripts())) else { return vec![] };
    raw.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|e| (e["type"] == "user" || e["type"] == "assistant") && e["isSidechain"] != true)
        .map(|e| json!({"type": e["type"], "message": e["message"]})).collect()
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
    Command::new(claude_bin()).args(["agents", "--json"]).env("PATH", &state.path).stdin(Stdio::null())
        .output().ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or(json!([]))
}

/// Continue a project's conversation in iTerm. The app's own process for it stops first, so two
/// processes never write the same session.
#[tauri::command]
fn open_terminal(state: State<App>, project: String, session: Option<String>, name: Option<String>) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    let sid = session.or_else(|| state.sids.lock().unwrap().get(&project).cloned());
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = match sid {
        Some(s) if s.chars().all(|c| c.is_ascii_hexdigit() || c == '-') => format!("cd {} && claude --resume {s}", q(&vault())),
        _ => format!("cd {} && claude -n {}", q(&vault()), q(name.as_deref().unwrap_or(&project))),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let sids = fs::read_to_string(data_dir(app.handle()).join("sessions.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            app.manage(App { procs: Mutex::new(HashMap::new()), sids: Mutex::new(sids), path: login_path() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, send, stop, reset, move_chat, chats, bg, app_sids, history_sid, history, running, pending, answer, agents, open_terminal])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
