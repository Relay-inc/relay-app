// Plugins: MCP servers that Relay runs as child processes over stdio and hosts as an MCP Apps host. A plugin is a
// command with arguments and an environment in settings.json under `plugins`; its secrets (the env names in
// `secrets`) live in the macOS keychain under `vault-app.plugin.<id>` and only ever travel from there into the child's
// environment, never to settings.json or the webview. A server starts the first time something needs it and stops when
// its entry changes, is switched off or removed, and when the app quits (its whole process group, so what `npx` or
// `uvx` started goes too).
//
// A plugin's view is a `ui://` resource (spec: github.com/modelcontextprotocol/ext-apps, revision 2026-01-26). Its HTML
// is not given to the webview as text: it is served from the `relay-plugin://` scheme with the Content-Security-Policy
// the resource declares, and the webview shows it in an iframe with `sandbox="allow-scripts"` (opaque origin: no
// Tauri IPC, no access to the app's DOM). A `srcdoc` iframe would inherit the app's own CSP and lose its inline
// scripts. The bridge between the view and the server is the webview's (src/application/plugins), the backend only
// refuses what the user did not allow: `plugin_call` runs a tool only when it is in the plugin's `allowed` list and its
// `_meta.ui.visibility` includes "app".

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub use crate::providers::keychain_get;
use crate::providers::keychain_set;
use crate::{fs, home, trc, trc_v, vault, App};

/// The MCP revision we speak to servers: the last one with the initialize handshake that servers in use implement
/// (2026-07-28 drops it, a server on that revision still answers an older initialize).
const PROTOCOL: &str = "2025-11-25";
/// The MCP Apps extension (SEP-1865) and the one content type a view may have.
const UI_EXT: &str = "io.modelcontextprotocol/ui";
const UI_MIME: &str = "text/html;profile=mcp-app";
const SCHEME: &str = "relay-plugin";

// ---------- JSON-RPC over stdio: one message per line

/// What a server sends: the answer to one of our requests, or a request (it needs an answer) or a notification of its own.
#[derive(Debug, PartialEq)]
pub enum Incoming { Reply(i64, Result<Value, String>), Request(Value, String), Other }

pub fn parse(text: &str) -> Incoming {
    let Ok(m) = serde_json::from_str::<Value>(text) else { return Incoming::Other };
    match (m["method"].as_str(), m.get("id").filter(|id| !id.is_null())) {
        (Some(method), Some(id)) => Incoming::Request(id.clone(), method.to_string()),
        (None, Some(id)) => match id.as_i64() {
            Some(id) if m["error"].is_object() => Incoming::Reply(id, Err(m["error"]["message"].as_str().unwrap_or("error").to_string())),
            Some(id) => Incoming::Reply(id, Ok(m["result"].clone())),
            None => Incoming::Other,
        },
        _ => Incoming::Other,
    }
}
// serde_json writes a Value on one line (newlines inside strings are escaped), which is all the framing there is
fn request_line(id: i64, method: &str, params: Value) -> String { format!("{}\n", json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})) }
fn notification_line(method: &str) -> String { format!("{}\n", json!({"jsonrpc": "2.0", "method": method})) }
/// Our answer to a server's request: ping is the only one we know (we offer no roots, sampling or elicitation).
fn answer_line(id: &Value, method: &str) -> String {
    let m = if method == "ping" { json!({"jsonrpc": "2.0", "id": id, "result": {}}) }
        else { json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Method not found"}}) };
    format!("{m}\n")
}

type Pending = Arc<Mutex<HashMap<i64, mpsc::Sender<Result<Value, String>>>>>;

/// A running MCP server and the handshake behind it.
struct Server {
    key: String, // the part of the entry that decides how it starts: a different one starts a new process
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next: AtomicI64,
    tail: Arc<Mutex<VecDeque<String>>>, // the last lines of its stderr, for an error message
    dead: Arc<AtomicBool>,
    info: Mutex<Value>,         // serverInfo of the handshake
    tools: Mutex<Option<Vec<Value>>>,
}

impl Server {
    fn spawn(key: String, command: &str, args: &[String], env: &HashMap<String, String>, path: &str, cwd: Option<&std::path::Path>) -> Result<Arc<Server>, String> {
        let mut cmd = Command::new(command);
        cmd.args(args).env("PATH", path).envs(env);
        // a plugin installed from GitHub runs in its own folder, as its README expects
        if let Some(cwd) = cwd { cmd.current_dir(cwd); }
        let mut child = cmd
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .process_group(0) // its own group, so stopping it also stops what it started
            .spawn().map_err(|e| trc_v("err.plugin_start", &format!("{command}: {e}")))?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let (out, err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let tail: Arc<Mutex<VecDeque<String>>> = Default::default();
        let (pending, dead): (Pending, Arc<AtomicBool>) = (Default::default(), Default::default());
        let t = tail.clone();
        std::thread::spawn(move || for l in BufReader::new(err).lines().map_while(Result::ok) {
            let mut t = t.lock().unwrap();
            if t.len() == 20 { t.pop_front(); }
            t.push_back(l.chars().take(300).collect());
        });
        let (p, d, w, t) = (pending.clone(), dead.clone(), stdin.clone(), tail.clone());
        std::thread::spawn(move || {
            for l in BufReader::new(out).lines().map_while(Result::ok) {
                match parse(&l) {
                    Incoming::Reply(id, r) => if let Some(tx) = p.lock().unwrap().remove(&id) { tx.send(r).ok(); },
                    Incoming::Request(id, method) => { w.lock().unwrap().write_all(answer_line(&id, &method).as_bytes()).ok(); }
                    Incoming::Other => {}
                }
            }
            // the process ended: whoever waits for an answer gets why
            d.store(true, Ordering::SeqCst);
            let why = why(&t);
            for (_, tx) in p.lock().unwrap().drain() { tx.send(Err(why.clone())).ok(); }
        });
        Ok(Arc::new(Server { key, child: Mutex::new(child), stdin, pending, next: AtomicI64::new(1), tail, dead, info: Mutex::new(Value::Null), tools: Mutex::new(None) }))
    }

    /// initialize, as a host that understands MCP Apps views, then the notification that completes it.
    fn handshake(&self) -> Result<(), String> {
        let r = self.request("initialize", json!({
            "protocolVersion": PROTOCOL,
            "capabilities": {"extensions": {UI_EXT: {"mimeTypes": [UI_MIME]}}},
            "clientInfo": {"name": "relay", "version": env!("CARGO_PKG_VERSION")},
        }), Duration::from_secs(120))?; // the first start of an `npx` or `uvx` plugin installs it
        if !r["protocolVersion"].is_string() { return Err(trc("err.plugin_not_mcp")); }
        *self.info.lock().unwrap() = r["serverInfo"].clone();
        self.send(&notification_line("notifications/initialized"))
    }

    fn send(&self, line: &str) -> Result<(), String> {
        self.stdin.lock().unwrap().write_all(line.as_bytes()).map_err(|_| why(&self.tail))
    }

    fn request(&self, method: &str, params: Value, wait: Duration) -> Result<Value, String> {
        if self.dead.load(Ordering::SeqCst) { return Err(why(&self.tail)); }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        // the process may have ended between the check and the insert, after its reader drained the waiters
        if self.dead.load(Ordering::SeqCst) || self.send(&request_line(id, method, params)).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(why(&self.tail));
        }
        rx.recv_timeout(wait).unwrap_or_else(|_| { self.pending.lock().unwrap().remove(&id); Err(trc("err.plugin_timeout")) })
    }

    /// Every tool, asked once per process (`tools/list` pages through `nextCursor`).
    fn tools(&self) -> Result<Vec<Value>, String> {
        if let Some(t) = self.tools.lock().unwrap().clone() { return Ok(t); }
        let (mut all, mut cursor) = (vec![], Value::Null);
        for _ in 0..20 {
            let r = self.request("tools/list", if cursor.is_null() { json!({}) } else { json!({"cursor": cursor}) }, Duration::from_secs(30))?;
            all.extend(r["tools"].as_array().cloned().unwrap_or_default());
            cursor = r["nextCursor"].clone();
            if !cursor.is_string() { break; }
        }
        *self.tools.lock().unwrap() = Some(all.clone());
        Ok(all)
    }
    /// The server's resources, empty when it has none or does not list them (UI resources may be left out of the list).
    fn resources(&self) -> Vec<Value> {
        self.request("resources/list", json!({}), Duration::from_secs(30)).ok().and_then(|r| r["resources"].as_array().cloned()).unwrap_or_default()
    }
}

fn why(tail: &Mutex<VecDeque<String>>) -> String {
    tail.lock().unwrap().back().cloned().unwrap_or_else(|| trc("err.plugin_exit"))
}

impl Drop for Server {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap();
        // the group first (a negative pid), the child itself as well in case it left the group
        Command::new("/bin/kill").args(["-s", "TERM", "--", &format!("-{}", child.id())]).output().ok();
        child.kill().ok();
        child.wait().ok();
    }
}

// ---------- tools and views

/// The `ui://` resource a tool says it renders in: `_meta.ui.resourceUri`, or the deprecated flat `ui/resourceUri`.
pub fn ui_uri(tool: &Value) -> Option<&str> {
    tool["_meta"]["ui"]["resourceUri"].as_str().or(tool["_meta"]["ui/resourceUri"].as_str()).filter(|u| u.starts_with("ui://"))
}
/// Whether a view may call the tool: `_meta.ui.visibility` defaults to model and app, a tool of ["model"] is not theirs.
pub fn app_visible(tool: &Value) -> bool {
    tool["_meta"]["ui"]["visibility"].as_array().map_or(true, |v| v.iter().any(|x| x == "app"))
}
/// The views a server has, `{uri, name}`: those its tools point to first, then the `ui://` resources it lists besides.
pub fn views(tools: &[Value], resources: &[Value]) -> Vec<Value> {
    let listed = |uri: &str| resources.iter().find(|r| r["uri"] == uri);
    let mut out: Vec<Value> = vec![];
    let candidates = tools.iter().filter_map(|t| ui_uri(t).map(|u| (u, t["title"].as_str().or(t["name"].as_str()))))
        .chain(resources.iter().filter_map(|r| r["uri"].as_str().filter(|u| u.starts_with("ui://")).map(|u| (u, None))));
    for (uri, tool_name) in candidates {
        if out.iter().any(|v| v["uri"] == uri) { continue; }
        let name = listed(uri).and_then(|r| r["title"].as_str().or(r["name"].as_str())).or(tool_name).unwrap_or(uri);
        out.push(json!({"uri": uri, "name": name}));
    }
    out
}
/// Whether a view's call is allowed: the tool is in the plugin's `allowed` list and the server lets apps call it.
pub fn check_call(allowed: &[String], tools: &[Value], name: &str) -> Result<(), String> {
    let known = tools.iter().find(|t| t["name"] == name);
    if allowed.iter().any(|a| a == name) && known.is_some_and(app_visible) { Ok(()) } else { Err(trc_v("err.plugin_tool", name)) }
}

/// A domain from a resource's CSP lists as it may sit in a policy: no quote, space, comma or semicolon can end the
/// source early and add a directive of its own.
fn source_ok(s: &str) -> bool { !s.is_empty() && s.len() <= 200 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-._~:/*[]%".contains(c)) }
/// The Content-Security-Policy of a view from its `_meta.ui.csp` (spec: default-src 'none', connect-src 'none', no
/// frames and no foreign base URI unless a list says so). Every list is `[domain, …]` and is cleaned by `source_ok`.
pub fn csp(meta: &Value) -> String {
    let list = |key: &str| -> String {
        meta["csp"][key].as_array().into_iter().flatten().filter_map(|s| s.as_str()).filter(|s| source_ok(s)).collect::<Vec<_>>().join(" ")
    };
    let (connect, resources, frames, base) = (list("connectDomains"), list("resourceDomains"), list("frameDomains"), list("baseUriDomains"));
    let or = |s: String, default: &str| if s.is_empty() { default.to_string() } else { s };
    format!(
        "default-src 'none'; script-src 'self' 'unsafe-inline' {resources}; style-src 'self' 'unsafe-inline' {resources}; img-src 'self' data: {resources}; \
         font-src 'self' {resources}; media-src 'self' data: {resources}; connect-src {}; frame-src {}; base-uri {}; object-src 'none'",
        or(connect, "'none'"), or(frames, "'none'"), or(base, "'self'"),
    )
}

// ---------- the entries in settings.json

pub fn valid_id(s: &str) -> bool { (1..=40).contains(&s.len()) && s.starts_with(|c: char| c.is_ascii_alphanumeric()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') }
pub fn valid_env_name(s: &str) -> bool { (1..=60).contains(&s.len()) && !s.starts_with(|c: char| c.is_ascii_digit()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') }
pub fn strings(v: &Value, max: usize, len: usize) -> Option<Vec<&str>> {
    let a = v.as_array()?;
    let out: Vec<&str> = a.iter().filter_map(|x| x.as_str().filter(|s| s.len() <= len && !s.contains('\0'))).collect();
    (a.len() <= max && out.len() == a.len()).then_some(out)
}
/// One entry of `plugins`: `{id, name, command, args, env, secrets, on, allowed, views, toolViews, mcp}`. `views` are the
/// ones the last test found (`{uri, name}`, shown as tabs), which is what puts the plugin in the sidebar without starting
/// it. `toolViews` maps a tool to the view its result renders in (the same test), which tells a conversation what to show
/// under a call to that tool without starting the server. `mcp` is the name Claude Code knows the server by (a call
/// there is `mcp__<name>__<tool>`), the plugin's id when absent. `source` is `{repo, ref, sha}` for a plugin installed from
/// GitHub (its folder is `plugins/<id>/`), `sync` whether the server is also registered in Claude Code.
pub fn valid(p: &Value) -> bool {
    let (Some(_), Some(secrets), Some(_)) = (strings(&p["args"], 50, 2000), strings(&p["secrets"], 20, 60), strings(&p["allowed"], 200, 200)) else { return false };
    let env_ok = p["env"].as_object().is_some_and(|e| e.len() <= 50 && e.iter().all(|(k, v)| valid_env_name(k) && v.as_str().is_some_and(|v| v.len() <= 2000 && !v.contains('\0'))));
    let views_ok = p["views"].as_array().is_some_and(|a| a.len() <= 20 && a.iter().all(|v| v["uri"].as_str().is_some_and(|u| u.starts_with("ui://") && u.len() <= 500) && v["name"].as_str().is_some_and(|n| n.len() <= 100)));
    let tool_views_ok = p["toolViews"].is_null() || p["toolViews"].as_object().is_some_and(|m| m.len() <= 200 && m.iter().all(|(k, v)| k.len() <= 200 && v.as_str().is_some_and(|u| u.starts_with("ui://") && u.len() <= 500)));
    // where a plugin from GitHub came from (plugin_repo.rs): the repo, the ref asked for (null: the default branch) and the commit
    let source_ok = p["source"].is_null() || (p["source"]["repo"].as_str().is_some_and(|r| (1..=200).contains(&r.len())) && (p["source"]["ref"].is_null() || p["source"]["ref"].as_str().is_some_and(|r| r.len() <= 200))
        && p["source"]["sha"].as_str().is_some_and(|s| s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())));
    let sync_ok = p["sync"].is_null() || p["sync"].is_boolean();
    let mcp_ok = p["mcp"].is_null() || p["mcp"].as_str().is_some_and(|n| (1..=100).contains(&n.len()) && !n.contains('\0'));
    p["id"].as_str().is_some_and(valid_id)
        && p["name"].as_str().is_some_and(|n| (1..=60).contains(&n.chars().count()))
        && p["command"].as_str().is_some_and(|c| (1..=500).contains(&c.len()) && !c.contains('\0'))
        && p["on"].is_boolean() && env_ok && views_ok && tool_views_ok && mcp_ok && source_ok && sync_ok
        && secrets.iter().all(|s| valid_env_name(s) && p["env"].get(*s).is_none())
}
pub fn norm(v: &mut Value) { if !v["plugins"].is_array() { v["plugins"] = json!([]); } }
/// Every entry valid and no id twice, checked before the settings are saved.
pub fn check(s: &Value) -> Result<(), String> {
    let list = s["plugins"].as_array().unwrap();
    for (i, p) in list.iter().enumerate() {
        if !valid(p) || list[..i].iter().any(|q| q["id"] == p["id"]) { return Err(trc_v("err.plugin_bad", p["name"].as_str().unwrap_or(""))); }
    }
    Ok(())
}
/// A file-name-like id from a name: "Garmin (Connect)" is "garmin-connect".
pub fn slug(name: &str) -> String {
    let s: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    let s: String = s.chars().take(40).collect();
    if s.is_empty() { "plugin".into() } else { s.trim_end_matches('-').into() }
}

pub fn service(id: &str) -> String { format!("vault-app.plugin.{id}") }
pub fn entry(state: &App, id: &str) -> Result<Value, String> {
    state.settings.lock().unwrap()["plugins"].as_array().and_then(|l| l.iter().find(|p| p["id"] == id)).cloned().ok_or_else(|| trc_v("err.plugin_unknown", id))
}
pub fn string_list(v: &Value) -> Vec<String> { v.as_array().into_iter().flatten().filter_map(|s| s.as_str().map(String::from)).collect() }

// ---------- the servers

#[derive(Default)]
pub struct Plugins {
    servers: Mutex<HashMap<String, Arc<Server>>>,
    /// `<plugin id>/<n>` (the path of the served URL) -> the HTML its view serves, and its CSP. One per frame: views of the
    /// same plugin load side by side (a conversation can have several), and a frame must get the page it asked for.
    views: Mutex<Served>,
    n: AtomicU64,
}

/// Stop every server (the app quits).
pub fn kill_all(app: &AppHandle) { app.state::<Plugins>().servers.lock().unwrap().clear(); }
/// Stop the servers whose plugin is gone or switched off: call it after the settings were saved.
pub fn sync(app: &AppHandle) {
    let settings = app.state::<App>().settings.lock().unwrap().clone();
    let live = |id: &str| settings["plugins"].as_array().is_some_and(|l| l.iter().any(|p| p["id"] == id && p["on"] == true));
    let plugins = app.state::<Plugins>();
    plugins.servers.lock().unwrap().retain(|id, _| live(id));
    plugins.views.lock().unwrap().retain(|path, _| live(of(path)));
}
/// The plugin a served path (`<id>/<n>`) belongs to.
fn of(path: &str) -> &str { path.split('/').next().unwrap_or("") }
/// How many served pages are kept: past it the oldest goes (a frame reads its page as it loads, right after `plugin_view`).
const KEPT_VIEWS: usize = 24;
type Served = HashMap<String, (String, String)>;
fn keep(views: &mut Served, path: String, page: (String, String)) {
    views.insert(path, page);
    while views.len() > KEPT_VIEWS {
        let oldest = views.keys().min_by_key(|k| k.rsplit('/').next().and_then(|n| n.parse::<u64>().ok())).cloned().unwrap();
        views.remove(&oldest);
    }
}
pub fn stop(app: &AppHandle, id: &str) {
    let plugins = app.state::<Plugins>();
    plugins.servers.lock().unwrap().remove(id);
    plugins.views.lock().unwrap().retain(|path, _| of(path) != id);
}

/// The plugin's server, started when it is not running (or runs for an older entry). `need_on`: a view or a call only
/// runs for a plugin that is switched on, the test of Settings does not need it.
fn ensure(app: &AppHandle, id: &str, need_on: bool) -> Result<(Arc<Server>, Value), String> {
    let state = app.state::<App>();
    let cfg = entry(&state, id)?;
    if need_on && cfg["on"] != true { return Err(trc_v("err.plugin_off", cfg["name"].as_str().unwrap_or(id))); }
    let key = json!([cfg["command"], cfg["args"], cfg["env"], cfg["secrets"]]).to_string();
    let plugins = app.state::<Plugins>();
    let running = plugins.servers.lock().unwrap().get(id).filter(|s| s.key == key && !s.dead.load(Ordering::SeqCst)).cloned();
    if let Some(s) = running { return Ok((s, cfg)); }
    stop(app, id);
    let mut env: HashMap<String, String> = cfg["env"].as_object().into_iter().flatten().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string()))).collect();
    for name in string_list(&cfg["secrets"]) { if let Some(v) = keychain_get(&service(id), &name) { env.insert(name, v); } }
    let cwd = cfg["source"].is_object().then(|| crate::plugin_repo::dir(app).join(id));
    let server = Server::spawn(key, cfg["command"].as_str().unwrap(), &string_list(&cfg["args"]), &env, &state.path, cwd.as_deref())?;
    server.handshake()?; // an error drops the server, which stops the process
    plugins.servers.lock().unwrap().insert(id.to_string(), server.clone());
    Ok((server, cfg))
}

// ---------- commands

/// Which of each plugin's secrets are in the keychain, `{id: {NAME: bool}}`, for the settings page.
#[tauri::command]
pub fn plugins_list(state: tauri::State<App>) -> Value {
    let list = state.settings.lock().unwrap()["plugins"].clone();
    let mut out = serde_json::Map::new();
    for p in list.as_array().into_iter().flatten() {
        let id = p["id"].as_str().unwrap_or_default();
        out.insert(id.into(), Value::Object(string_list(&p["secrets"]).into_iter().map(|n| { let set = keychain_get(&service(id), &n).is_some(); (n, json!(set)) }).collect()));
    }
    Value::Object(out)
}

/// Save (or, with "", remove) one secret of a plugin. The server restarts on the next use to see it.
#[tauri::command]
pub fn plugin_secret(app: AppHandle, state: tauri::State<App>, id: String, name: String, value: String) -> Result<(), String> {
    let cfg = entry(&state, &id)?;
    if !string_list(&cfg["secrets"]).contains(&name) { return Err(trc_v("err.plugin_bad", &name)); }
    keychain_set(&service(&id), &name, &value)?;
    stop(&app, &id);
    Ok(())
}

/// Before a plugin is removed from the settings: stop its server, delete its secrets from the keychain, and for one from
/// GitHub its folder and its server in Claude Code.
#[tauri::command]
pub fn plugin_forget(app: AppHandle, state: tauri::State<App>, id: String) -> Result<(), String> {
    let cfg = entry(&state, &id)?;
    for name in string_list(&cfg["secrets"]) { keychain_set(&service(&id), &name, "")?; }
    stop(&app, &id);
    crate::plugin_repo::remove(&app, &cfg)
}

/// The Test button: a fresh start, then what the server offers: its tools (with whether the model and an app may call
/// them, and which view they render in) and its views.
#[tauri::command]
pub async fn plugin_test(app: AppHandle, id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stop(&app, &id);
        let (server, _) = ensure(&app, &id, false)?;
        let tools = server.tools()?;
        let views = views(&tools, &server.resources());
        let tools: Vec<Value> = tools.iter().map(|t| json!({
            "name": t["name"], "description": t["description"], "view": ui_uri(t), "app": app_visible(t),
        })).collect();
        Ok(json!({"server": server.info.lock().unwrap().clone(), "tools": tools, "views": views}))
    }).await.map_err(|e| e.to_string())?
}

/// Read a view's `ui://` resource and have it served: returns the `relay-plugin://` URL for the iframe, the name and
/// what the host tells the view about its sandbox. `uri` is one of the plugin's views, the first when absent.
#[tauri::command]
pub async fn plugin_view(app: AppHandle, id: String, uri: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (server, _) = ensure(&app, &id, true)?;
        let tools = server.tools()?;
        let resources = server.resources();
        let found = views(&tools, &resources);
        let view = match &uri {
            Some(u) => found.iter().find(|v| v["uri"] == u.as_str()),
            None => found.first(),
        }.ok_or_else(|| trc_v("err.plugin_view", uri.as_deref().unwrap_or("")))?.clone();
        let uri = view["uri"].as_str().unwrap();
        let read = server.request("resources/read", json!({"uri": uri}), Duration::from_secs(30))?;
        let content = read["contents"].as_array().and_then(|a| a.iter().find(|c| c["uri"] == uri).or(a.first())).ok_or_else(|| trc_v("err.plugin_view", uri))?;
        let mime: String = content["mimeType"].as_str().unwrap_or("").to_lowercase().split_whitespace().collect();
        if mime != UI_MIME { return Err(trc_v("err.plugin_view", uri)); }
        let html = match (content["text"].as_str(), content["blob"].as_str()) {
            (Some(text), _) => text.to_string(),
            (None, Some(blob)) => {
                use base64::Engine;
                String::from_utf8(base64::engine::general_purpose::STANDARD.decode(blob).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
            }
            _ => return Err(trc_v("err.plugin_view", uri)),
        };
        // the declaration may sit on the content or on the listed resource
        let meta = if content["_meta"]["ui"].is_object() { content["_meta"]["ui"].clone() } else { resources.iter().find(|r| r["uri"] == uri).map_or(Value::Null, |r| r["_meta"]["ui"].clone()) };
        let plugins = app.state::<Plugins>();
        let n = plugins.n.fetch_add(1, Ordering::SeqCst);
        keep(&mut plugins.views.lock().unwrap(), format!("{id}/{n}"), (html, csp(&meta)));
        // what the host tells the view it enforces: the declared domains that passed the check
        let applied: serde_json::Map<String, Value> = ["connectDomains", "resourceDomains", "frameDomains", "baseUriDomains"].iter()
            .map(|k| (k.to_string(), Value::Array(meta["csp"][*k].as_array().into_iter().flatten().filter(|s| s.as_str().is_some_and(source_ok)).cloned().collect())))
            .collect();
        Ok(json!({"url": format!("{SCHEME}://localhost/{id}/{n}"), "uri": uri, "name": view["name"], "prefersBorder": meta["prefersBorder"].as_bool(), "csp": applied}))
    }).await.map_err(|e| e.to_string())?
}

/// A tool call from a plugin's view, answered with the server's result as it is (`isError` included).
#[tauri::command]
pub async fn plugin_call(app: AppHandle, id: String, tool: String, args: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (server, cfg) = ensure(&app, &id, true)?;
        check_call(&string_list(&cfg["allowed"]), &server.tools()?, &tool)?;
        let args = if args.is_object() { args } else { json!({}) };
        server.request("tools/call", json!({"name": tool, "arguments": args}), Duration::from_secs(120))
    }).await.map_err(|e| e.to_string())?
}

/// The `relay-plugin://localhost/<id>/<n>` scheme: the HTML of the view read for that `plugin_view` call, with its policy.
pub fn serve(app: &AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    let view = app.state::<Plugins>().views.lock().unwrap().get(path.trim_matches('/')).cloned();
    let builder = tauri::http::Response::builder();
    match view {
        Some((html, csp)) => builder.header("Content-Type", "text/html; charset=utf-8").header("Content-Security-Policy", csp)
            .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").body(html.into_bytes()),
        None => builder.status(404).body(vec![]),
    }.unwrap()
}

// ---------- import from Claude Code's MCP config

/// The stdio servers in Claude Code's config: `~/.claude.json` (user level and the vault as a project) and the
/// vault's `.mcp.json`, `(name, entry)` by name; the later source wins a name.
pub fn claude_servers(cfg: &Value, vault: &str, mcp: &Value) -> Vec<(String, Value)> {
    let mut found: std::collections::BTreeMap<String, Value> = Default::default();
    for source in [&cfg["mcpServers"], &cfg["projects"][vault]["mcpServers"], &mcp["mcpServers"]] {
        for (name, s) in source.as_object().into_iter().flatten() {
            if s["command"].as_str().is_some_and(|c| !c.is_empty()) && s["type"].as_str().map_or(true, |t| t == "stdio") { found.insert(name.clone(), s.clone()); }
        }
    }
    found.into_iter().collect()
}
fn claude_config(state: &App) -> Vec<(String, Value)> {
    let read = |p: String| fs::read_to_string(p).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).unwrap_or(Value::Null);
    let v = vault(state);
    claude_servers(&read(format!("{}/.claude.json", home())), &v, &read(format!("{v}/.mcp.json")))
}
/// An env var that holds a secret by its name: it goes to the keychain on import, the rest stays in settings.json.
pub fn secret_name(name: &str) -> bool {
    let n = name.to_uppercase();
    ["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL"].iter().any(|w| n.contains(w))
}

/// The names of Claude Code's MCP servers that can be imported (command-based ones), without their env.
#[tauri::command]
pub fn plugin_import_list(state: tauri::State<App>) -> Vec<String> { claude_config(&state).into_iter().map(|(n, _)| n).collect() }

/// Import one: its secrets go to the keychain, the new entry comes back for the settings window to add and save.
#[tauri::command]
pub fn plugin_import(state: tauri::State<App>, name: String) -> Result<Value, String> {
    let (_, s) = claude_config(&state).into_iter().find(|(n, _)| *n == name).ok_or_else(|| trc_v("err.plugin_unknown", &name))?;
    let taken: Vec<String> = state.settings.lock().unwrap()["plugins"].as_array().into_iter().flatten().filter_map(|p| p["id"].as_str().map(String::from)).collect();
    let base = slug(&name);
    let id = (1..).map(|i| if i == 1 { base.clone() } else { format!("{base}-{i}") }).find(|c| !taken.contains(c)).unwrap();
    let (mut env, mut secrets) = (serde_json::Map::new(), vec![]);
    for (k, v) in s["env"].as_object().into_iter().flatten() {
        let Some(v) = v.as_str() else { continue };
        if secret_name(k) { keychain_set(&service(&id), k, v)?; secrets.push(json!(k)); } else { env.insert(k.clone(), json!(v)); }
    }
    let p = json!({"id": id, "name": name, "command": s["command"], "args": string_list(&s["args"]), "env": env, "secrets": secrets, "on": true, "allowed": [], "views": [], "mcp": name});
    if valid(&p) { Ok(p) } else { Err(trc_v("err.plugin_bad", &name)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(meta: Value) -> Value { json!({"name": "t", "_meta": meta}) }

    #[test]
    fn framing_and_parsing() {
        let l = request_line(7, "tools/call", json!({"text": "a\nb"}));
        assert!(l.ends_with('\n') && l.matches('\n').count() == 1, "one line, newlines in strings escaped");
        assert_eq!(parse(r#"{"jsonrpc":"2.0","id":7,"result":{"ok":1}}"#), Incoming::Reply(7, Ok(json!({"ok": 1}))));
        assert_eq!(parse(r#"{"jsonrpc":"2.0","id":7,"error":{"code":-1,"message":"no"}}"#), Incoming::Reply(7, Err("no".into())));
        assert_eq!(parse(r#"{"jsonrpc":"2.0","id":"a","method":"ping"}"#), Incoming::Request(json!("a"), "ping".into()));
        assert_eq!(parse(r#"{"jsonrpc":"2.0","method":"notifications/message","params":{}}"#), Incoming::Other);
        assert_eq!(parse("starting up..."), Incoming::Other);
        assert!(answer_line(&json!(1), "ping").contains("\"result\""));
        assert!(answer_line(&json!(1), "roots/list").contains("-32601"));
    }

    #[test]
    fn views_and_visibility() {
        let tools = vec![
            json!({"name": "a", "title": "Dice", "_meta": {"ui": {"resourceUri": "ui://x/dice"}}}),
            json!({"name": "b", "_meta": {"ui/resourceUri": "ui://x/old"}}),
            json!({"name": "c", "_meta": {"ui": {"resourceUri": "https://evil/x"}}}),
        ];
        let resources = vec![json!({"uri": "ui://x/dice", "name": "dice_view"}), json!({"uri": "ui://x/other", "name": "Other"}), json!({"uri": "file:///etc/passwd", "name": "f"})];
        let v: Vec<(String, String)> = views(&tools, &resources).iter().map(|v| (v["uri"].as_str().unwrap().into(), v["name"].as_str().unwrap().into())).collect();
        assert_eq!(v, vec![("ui://x/dice".into(), "dice_view".into()), ("ui://x/old".into(), "b".into()), ("ui://x/other".into(), "Other".into())]);
        assert!(app_visible(&tool(json!({}))));
        assert!(app_visible(&tool(json!({"ui": {"visibility": ["model", "app"]}}))));
        assert!(!app_visible(&tool(json!({"ui": {"visibility": ["model"]}}))));
    }

    #[test]
    fn calls_need_the_allowed_list_and_app_visibility() {
        let tools = vec![json!({"name": "roll"}), json!({"name": "secret", "_meta": {"ui": {"visibility": ["model"]}}})];
        let allowed = vec!["roll".to_string(), "secret".to_string(), "gone".to_string()];
        assert!(check_call(&allowed, &tools, "roll").is_ok());
        assert!(check_call(&allowed, &tools, "secret").is_err(), "allowed, but the server hides it from apps");
        assert!(check_call(&allowed, &tools, "gone").is_err(), "allowed, but the server has no such tool");
        assert!(check_call(&["roll".to_string()], &tools, "other").is_err());
        assert!(check_call(&[], &tools, "roll").is_err());
    }

    #[test]
    fn csp_defaults_and_declared_domains() {
        let d = csp(&Value::Null);
        assert!(d.contains("default-src 'none'") && d.contains("connect-src 'none'") && d.contains("frame-src 'none'") && d.contains("base-uri 'self'") && d.contains("object-src 'none'"));
        let c = csp(&json!({"csp": {"connectDomains": ["https://api.example.com", "wss://x.io"], "resourceDomains": ["https://*.cdn.com"]}}));
        assert!(c.contains("connect-src https://api.example.com wss://x.io;") && c.contains("script-src 'self' 'unsafe-inline' https://*.cdn.com;"));
        // a source that would end the directive early is dropped
        let bad = csp(&json!({"csp": {"connectDomains": ["https://a.com; script-src *", "'unsafe-eval'", "https://ok.com"]}}));
        assert!(bad.contains("connect-src https://ok.com;") && !bad.contains("unsafe-eval") && !bad.contains("script-src *"));
    }

    #[test]
    fn served_pages_are_kept_per_frame_and_the_oldest_goes() {
        let mut views = Served::new();
        for n in 0..(KEPT_VIEWS as u64 + 3) { keep(&mut views, format!("a/{n}"), (n.to_string(), String::new())); }
        assert_eq!(views.len(), KEPT_VIEWS);
        assert!(!views.contains_key("a/0") && views.contains_key("a/3") && views.contains_key(&format!("a/{}", KEPT_VIEWS + 2)));
        assert_eq!(of("a/3"), "a");
    }

    #[test]
    fn entries_in_settings() {
        let ok = json!({"id": "garmin", "name": "Garmin", "command": "uvx", "args": ["a"], "env": {"X": "1"}, "secrets": ["PASSWORD"], "on": true, "allowed": ["t"], "views": []});
        assert!(valid(&ok));
        let with = |k: &str, v: Value| { let mut p = ok.clone(); p[k] = v; p };
        assert!(!valid(&with("id", json!("Bad Id"))));
        assert!(!valid(&with("command", json!(""))));
        assert!(!valid(&with("env", json!({"1X": "a"}))));
        assert!(!valid(&with("secrets", json!(["X"]))), "a name is a secret or plain env, not both");
        assert!(!valid(&with("views", json!([{"uri": "https://x", "name": "n"}]))));
        assert!(!valid(&with("views", Value::Null)));
        assert!(valid(&with("views", json!([{"uri": "ui://x/y", "name": "n"}, {"uri": "ui://x/z", "name": "m"}]))));
        // the tool-to-view map and the Claude Code name are optional (an entry from before has neither)
        assert!(valid(&with("toolViews", json!({"roll": "ui://x/y"}))) && valid(&with("mcp", json!("my-server"))) && valid(&with("mcp", Value::Null)));
        assert!(!valid(&with("toolViews", json!({"roll": "https://x"}))) && !valid(&with("toolViews", json!(["a"]))));
        assert!(!valid(&with("mcp", json!(""))) && !valid(&with("mcp", json!(3))));
        // where a plugin from GitHub came from, and whether Claude Code has it too
        let sha = "0123456789abcdef0123456789abcdef01234567";
        assert!(valid(&with("source", json!({"repo": "a/b", "ref": null, "sha": sha}))) && valid(&with("source", json!({"repo": "a/b", "ref": "v1", "sha": sha}))) && valid(&with("sync", json!(true))));
        assert!(!valid(&with("source", json!({"repo": "a/b", "sha": "abc"}))) && !valid(&with("source", json!("a/b"))) && !valid(&with("sync", json!("yes"))));
        let mut s = json!({"plugins": [ok.clone(), ok]});
        assert!(check(&s).is_err(), "the same id twice");
        s["plugins"].as_array_mut().unwrap().pop();
        assert!(check(&s).is_ok());
        assert_eq!(slug("Garmin (Connect)"), "garmin-connect");
        assert_eq!(slug("???"), "plugin");
    }

    #[test]
    fn claude_config_servers() {
        let cfg = json!({"mcpServers": {"a": {"command": "node", "args": ["a.js"]}, "web": {"type": "http", "url": "https://x"}},
            "projects": {"/v": {"mcpServers": {"a": {"command": "bun"}, "b": {"command": "uvx"}}}}});
        let mcp = json!({"mcpServers": {"c": {"command": "npx", "env": {"API_KEY": "k", "REGION": "eu"}}}});
        let got = claude_servers(&cfg, "/v", &mcp);
        let names: Vec<&str> = got.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["a", "b", "c"], "http servers are not plugins");
        assert_eq!(got[0].1["command"], "bun", "the project's entry wins over the user's");
        assert!(secret_name("API_KEY") && secret_name("garmin_password") && !secret_name("REGION"));
    }

    /// A shell that answers every request with one canned result, as a server would: enough for the handshake and lists.
    const ECHO: &str = r#"while read l; do id=${l#*\"id\":}; id=${id%%,*}; echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"protocolVersion\":\"x\",\"serverInfo\":{\"name\":\"fake\"},\"tools\":[{\"name\":\"a\"}]}}"; done"#;

    #[test]
    fn a_server_answers_and_dies_with_its_group() {
        let s = Server::spawn("k".into(), "/bin/sh", &["-c".into(), ECHO.into()], &HashMap::new(), "/usr/bin:/bin", None).unwrap();
        s.handshake().unwrap();
        assert_eq!(s.info.lock().unwrap()["name"], "fake");
        assert_eq!(s.tools().unwrap()[0]["name"], "a");
        let pid = s.child.lock().unwrap().id();
        drop(s);
        assert!(!Command::new("/bin/kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().unwrap().success(), "the process is gone");
    }

    #[test]
    fn a_server_that_exits_answers_with_its_last_stderr_line() {
        let s = Server::spawn("k".into(), "/bin/sh", &["-c".into(), "echo missing token >&2; exit 1".into()], &HashMap::new(), "/usr/bin:/bin", None).unwrap();
        let e = s.handshake().unwrap_err();
        assert!(e.contains("missing token") || !e.is_empty());
        assert!(Server::spawn("k".into(), "/nonexistent/x", &[], &HashMap::new(), "/bin", None).is_err());
    }

    /// The real thing end to end: the host's side against packages/plugin-example (skipped without node).
    #[test]
    fn the_example_plugin() {
        let Ok(node) = Command::new("which").arg("node").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()) else { return };
        if node.is_empty() { return; }
        let script = format!("{}/../packages/plugin-example/server.mjs", env!("CARGO_MANIFEST_DIR"));
        let s = Server::spawn("k".into(), &node, &[script], &HashMap::new(), "/usr/bin:/bin", None).unwrap();
        s.handshake().unwrap();
        let tools = s.tools().unwrap();
        let found = views(&tools, &s.resources());
        assert_eq!(found.len(), 1);
        let uri = found[0]["uri"].as_str().unwrap();
        let read = s.request("resources/read", json!({"uri": uri}), Duration::from_secs(5)).unwrap();
        assert_eq!(read["contents"][0]["mimeType"], UI_MIME);
        assert!(read["contents"][0]["text"].as_str().unwrap().contains("ui/initialize"));
        let rolled = s.request("tools/call", json!({"name": "roll", "arguments": {"sides": 6}}), Duration::from_secs(5)).unwrap();
        assert!((1..=6).contains(&rolled["structuredContent"]["value"].as_i64().unwrap()));
        assert!(check_call(&["roll".into()], &tools, "roll").is_ok());
    }
}
