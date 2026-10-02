// The server: conversations that run on another machine under relay-serve (packages/relay-core/src/serve.rs), so they
// go on with the laptop closed. A conversation's host ("" here, "server" there) is fixed at its first message and
// kept in sessions.json. Settings › Agents holds the address (settings.server.addr), the token is in the keychain.
//
// Everything local works without it: the status is checked off the main thread every 15 s, and the commands that
// would ask the server (pending, history, subagents) only do while it answered last time. A server conversation's
// history is cached here, so it still reads while the server is offline.

use crate::{agents, broker, read_agent, App, Proc};
use relay_core::remote::{self, Server};
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;
use std::fs;
use tauri::{AppHandle, Emitter, Manager, State};

pub const HOST: &str = "server";
const SECRET: &str = "vault-app.relay-serve";

fn saved_token() -> Option<String> {
    let o = Command::new("/usr/bin/security").args(["find-generic-password", "-s", SECRET, "-a", "token", "-w"]).output().ok()?;
    let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !t.is_empty()).then_some(t)
}

/// The server from the settings, when it has an address and a token.
pub fn of(st: &App) -> Option<Server> {
    let addr = st.settings.lock().unwrap()["server"]["addr"].as_str().unwrap_or("").to_string();
    if addr.is_empty() { return None; }
    Some(Server { addr, token: saved_token()? })
}
/// The server, only when it answered the last check: callers that run often never wait on a server that is away.
pub fn online(st: &App) -> Option<Server> { if st.server.lock().unwrap()["online"] == true { of(st) } else { None } }

/// Ask the server how it is; the answer is what Settings shows and what `online` goes by.
fn check(app: &AppHandle) -> Value {
    let st = app.state::<App>();
    let addr = st.settings.lock().unwrap()["server"]["addr"].as_str().unwrap_or("").to_string();
    let status = match (addr.is_empty(), of(&st)) {
        (true, _) => json!({"configured": false, "online": false}),
        (false, None) => json!({"configured": false, "online": false, "error": "no token"}),
        (false, Some(s)) => match remote::call(&s, json!({"cmd": "hello"})) {
            Ok(h) => json!({"configured": true, "online": true, "version": h["version"], "vault": h["vault"], "providers": h["providers"]}),
            Err(e) => json!({"configured": true, "online": false, "error": e}),
        },
    };
    let was = std::mem::replace(&mut *st.server.lock().unwrap(), status.clone());
    if was["online"] != status["online"] || was["configured"] != status["configured"] { app.emit("server", &status).ok(); }
    status
}

/// At start: check every 15 s, and take back the server conversations that still run there.
pub fn start(app: &AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || {
        let mut taken = false;
        loop {
            if check(&a)["online"] == true && !taken { reattach(&a); taken = true; }
            std::thread::sleep(Duration::from_secs(15));
        }
    });
}

/// The server conversations it still runs become the app's again, with the model and effort they run on.
fn reattach(app: &AppHandle) {
    let st = app.state::<App>();
    let Some(s) = of(&st) else { return };
    let Ok(running) = remote::call(&s, json!({"cmd": "running"})) else { return };
    let keys: Vec<(String, String)> = st.sids.lock().unwrap().iter().filter(|(_, x)| x.host == HOST).map(|(k, x)| (k.clone(), x.provider.clone())).collect();
    for (key, provider) in keys {
        let Some(r) = running.as_array().into_iter().flatten().find(|r| r["key"] == key.as_str() && r["done"] != true) else { continue };
        if st.procs.lock().unwrap().contains_key(&key) { continue; }
        let (Some(p), Ok(c)) = (agents::find(&provider), remote::open(&s, &key, None)) else { continue };
        let Ok(stdin) = c.stdin.try_clone() else { continue };
        let opts = (r["model"].as_str().unwrap_or("").to_string(), r["effort"].as_str().unwrap_or("").to_string());
        st.procs.lock().unwrap().insert(key.clone(), Proc { child: c.agent.clone(), stdin, opts, provider: p.id(), tainted: false, key: key.clone(), turns: 1, host: HOST.into() });
        read_agent(app, &key, p, c, (false, false), HOST);
    }
}

/// Start a conversation on the server: the provider's command is built there, from its own settings.
pub fn open(st: &App, key: &str, req: Value) -> Result<broker::Conn, String> {
    let s = online(st).ok_or_else(|| crate::trc("err.server_offline"))?;
    remote::open(&s, key, Some(req))
}

/// The server's waiting permission cards and questions; their ids, so an answer goes back there.
pub fn pending(st: &App) -> Vec<Value> {
    let list: Vec<Value> = online(st).and_then(|s| remote::call(&s, json!({"cmd": "pending"})).ok()).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    *st.remote_pending.lock().unwrap() = list.iter().filter_map(|r| r["id"].as_str().map(String::from)).collect();
    list
}
/// Some(result) when the request is the server's.
pub fn answer(st: &App, id: &str, decision: &Value) -> Option<Result<(), String>> {
    if !st.remote_pending.lock().unwrap().contains(id) { return None; }
    let s = online(st)?;
    Some(remote::call(&s, json!({"cmd": "answer", "request": id, "decision": decision})).map(|_| ()))
}

fn cache(app: &AppHandle, sid: &str) -> PathBuf {
    let d = crate::data_dir(app).join("server-history");
    fs::create_dir_all(&d).ok();
    d.join(format!("{sid}.json"))
}
/// A server conversation's past messages: from the server, or what it said last time while it is offline.
pub fn history(app: &AppHandle, st: &App, provider: &str, sid: &str) -> Value {
    if !agents::find(provider).is_some_and(|p| p.valid_session(sid)) { return json!([]); }
    let fresh = online(st).and_then(|s| remote::call(&s, json!({"cmd": "history", "provider": provider, "sid": sid, "from": 0})).ok());
    match fresh {
        Some(r) => { fs::write(cache(app, sid), r["items"].to_string()).ok(); r["items"].clone() }
        None => fs::read_to_string(cache(app, sid)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!([])),
    }
}
/// subagents / agent_log of a server conversation, empty while it is offline.
pub fn ask(st: &App, req: Value) -> Value {
    online(st).and_then(|s| remote::call(&s, req).ok()).unwrap_or(json!([]))
}

#[tauri::command]
pub fn server_status(app: AppHandle, fresh: Option<bool>) -> Value {
    if fresh == Some(true) { return check(&app); }
    app.state::<App>().server.lock().unwrap().clone()
}

/// Save the server's token in the keychain (over stdin, never as an argument), or remove it when empty.
#[tauri::command]
pub fn server_token(app: AppHandle, token: String) -> Result<Value, String> {
    let t = token.trim();
    if t.is_empty() {
        Command::new("/usr/bin/security").args(["delete-generic-password", "-s", SECRET, "-a", "token"]).output().map_err(|e| e.to_string())?;
    } else {
        if t.len() > 200 || !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { return Err(crate::trc("err.token_chars")); }
        let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        writeln!(ch.stdin.take().unwrap(), "add-generic-password -U -s {SECRET} -a token -w {t}").map_err(|e| e.to_string())?;
        ch.wait().map_err(|e| e.to_string())?;
        if saved_token().as_deref() != Some(t) { return Err(crate::trc("err.token_save")); }
    }
    Ok(check(&app))
}

/// Where each app conversation runs, for the ones on the server.
#[tauri::command]
pub fn chat_hosts(state: State<App>) -> Value {
    state.sids.lock().unwrap().iter().filter(|(_, s)| !s.host.is_empty()).map(|(k, s)| (k.clone(), json!(s.host))).collect()
}
