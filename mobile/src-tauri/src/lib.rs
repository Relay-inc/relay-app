//! Relay on a phone: a remote control for the conversations on a relay-server, paired as a device of the laptop
//! (Settings › Machines › Add phone). The commands and the `agent` events have the desktop app's names and shapes
//! (src-tauri/src/lib.rs), so the webview's conversation code runs on both; only what a phone does is here. Every
//! conversation runs on the server: the phone follows it (several devices at once, see relay-remote's broker), sends
//! messages and answers its cards. Claude's lines are read with the same parser as on the laptop (agent-claude).

use agent_claude::PROVIDER;
use agent_core::{pending, AgentProvider, Event, Image, Turn};
use relay_remote::broker::{frame, Frame};
use relay_remote::client::{self, Client};
use relay_remote::tls::Identity;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::{fs, thread};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod sealed;

/// A conversation this phone follows: what goes to its agent's stdin, and its pid there (for stop).
struct Live { stdin: Box<dyn Write + Send>, pid: u32 }

#[derive(Default)]
struct App {
    live: Mutex<HashMap<String, Live>>,
    /// the conversations to follow again when the app comes back (iOS and Android close sockets in the background)
    wanted: Mutex<HashSet<String>>,
    /// the turns in flight per conversation, as this phone saw them
    turns: Mutex<HashMap<String, u32>>,
    /// open permission cards, raised from the conversations' own lines
    cards: Mutex<Vec<pending::Request>>,
}

/// The app's data folder: the sealed secrets (sealed.rs) and where the paired server is (`server.json`, no secret).
fn dir(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|e| e.to_string()) }
fn identity(app: &AppHandle) -> Result<Identity, String> { Ok(sealed::load(app, &dir(app)?)?.id) }
fn saved(app: &AppHandle) -> Result<Value, String> {
    serde_json::from_str(&fs::read_to_string(dir(app)?.join("server.json")).map_err(|_| "not paired yet")?).map_err(|e| e.to_string())
}
fn server(app: &AppHandle) -> Result<Client, String> {
    let s = saved(app)?;
    Ok(Client::new(s["host"].as_str().unwrap_or(""), s["port"].as_u64().unwrap_or(0) as u16, s["fp"].as_str().unwrap_or(""), identity(app)?))
}
/// The mirrored vault on the server, where the conversations run (their transcripts are found by it).
fn vault_there(c: &Client) -> Result<String, String> { Ok(format!("{}/vault", c.info()?.work)) }

/// Pair with the line Relay on the laptop made for this phone (Settings › Machines › Add phone), and keep where the
/// server is and the key to the laptop's mirror there.
#[tauri::command]
fn pair(app: AppHandle, line: String, name: String) -> Result<Value, String> {
    let d = dir(&app)?;
    let mut secrets = sealed::load(&app, &d)?;
    let (l, info) = client::pair(&line, &secrets.id, &name)?;
    secrets.mirror = l.key.clone();
    sealed::save(&app, &d, &secrets)?;
    let s = json!({"host": l.host, "port": l.port, "fp": l.fp});
    fs::write(d.join("server.json"), s.to_string()).map_err(|e| e.to_string())?;
    Ok(json!({"server": s, "info": info}))
}

/// What the server says about itself. A locked mirror (the server restarted, the laptop is closed) is opened with the
/// key from pairing, so conversations there can start again.
#[tauri::command]
fn info(app: AppHandle) -> Result<Value, String> {
    let c = server(&app)?;
    let info = c.info()?;
    if info.mirror_open { return Ok(json!(info)); }
    let Some(key) = sealed::load(&app, &dir(&app)?)?.mirror else { return Ok(json!(info)) };
    c.unlock(&key)?;
    Ok(json!(c.info()?))
}

/// The laptop's conversations on the server: [{key, title, provider, model, effort, sid}], `sid` and `title` (the first
/// thing said in it) where the server saw them.
#[tauri::command]
fn conversations(app: AppHandle) -> Result<Value, String> {
    let (metas, sids, titles) = server(&app)?.list_named()?;
    Ok(json!(metas.iter().map(|m| json!({"key": m.key, "title": titles.get(&m.key), "provider": m.provider, "model": m.model, "effort": m.effort, "sid": sids.get(&m.key)})).collect::<Vec<_>>()))
}

/// The conversations whose agent runs, with the turns each has in flight as this phone saw them (desktop: `running`).
#[tauri::command]
fn running(app: AppHandle, state: State<App>) -> Result<HashMap<String, u32>, String> {
    let (metas, _) = server(&app)?.list_sessions()?;
    let turns = state.turns.lock().unwrap();
    Ok(metas.into_iter().map(|m| { let n = turns.get(&m.key).copied().unwrap_or(0); (m.key, n) }).collect())
}

/// A message to a conversation: followed first (taken up again, or started on the server from the laptop's profile,
/// resuming its session when there is one), then written to its agent.
#[tauri::command]
fn send(app: AppHandle, state: State<App>, project: String, text: String, images: Option<Vec<Value>>, model: Option<String>, effort: Option<String>) -> Result<(), String> {
    follow(&app, &state, &project, model.as_deref().unwrap_or(""), effort.as_deref().unwrap_or(""))?;
    let images: Vec<Image> = images.unwrap_or_default().into_iter().filter_map(|i| serde_json::from_value(i).ok()).collect();
    let line = PROVIDER.input(&Turn { text, images }).ok_or("no input")?;
    let mut live = state.live.lock().unwrap();
    let x = live.get_mut(&project).ok_or("the conversation went away")?;
    writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())?;
    *state.turns.lock().unwrap().entry(project).or_default() += 1;
    Ok(())
}

/// Follow a conversation without writing to it (opening it on the phone): what it says from now on comes as events.
#[tauri::command]
fn open(app: AppHandle, state: State<App>, project: String) -> Result<(), String> { follow(&app, &state, &project, "", "") }

/// Stop a conversation's agent on the server, as on the laptop.
#[tauri::command]
fn stop(app: AppHandle, state: State<App>, project: String) -> Result<(), String> {
    let pid = state.live.lock().unwrap().remove(&project).map(|x| x.pid);
    state.wanted.lock().unwrap().remove(&project);
    let pid = match pid { Some(p) => p, None => server(&app)?.list()?.into_iter().find(|m| m.key == project).map(|m| m.pid).ok_or("not running")? };
    server(&app)?.kill(&project, pid)
}

/// The desktop's banner for a turn that ended while its window was away (the conversation code asks for it): the
/// phone hears about its conversations from relay-server's notifications (ntfy) instead, so nothing here.
#[tauri::command]
fn notify() {}

/// The open cards, as the desktop's `pending` gives them.
#[tauri::command]
fn pending(state: State<App>) -> Vec<Value> {
    let mut cards = state.cards.lock().unwrap().clone();
    cards.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));
    cards.iter().map(|r| serde_json::to_value(r).unwrap_or_default()).collect()
}

/// Answer a card: Claude's answer line goes to its conversation. The laptop may still show the same card until it
/// is touched there (answers go to stdin, no line says so).
#[tauri::command]
fn answer(state: State<App>, id: String, decision: Value) -> Result<(), String> {
    let r = { let mut cards = state.cards.lock().unwrap(); let i = cards.iter().position(|r| r.id == id).ok_or("no such card")?; cards.remove(i) };
    let line = PROVIDER.respond(&r, &decision).ok_or("no answer for this card")?;
    let mut live = state.live.lock().unwrap();
    let x = live.get_mut(&r.project).ok_or("the conversation went away")?;
    writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())
}

/// A conversation's whole transcript, by its session on the server (desktop: `history`).
#[tauri::command]
fn history(app: AppHandle, project: String) -> Result<Value, String> {
    let c = server(&app)?;
    let Some(sid) = c.list_sessions()?.1.remove(&project) else { return Ok(json!([])) };
    Ok(c.history(&sid, 0, &vault_there(&c)?)?.0)
}

/// A transcript by session id from an offset (desktop: `history_sid`): {items, next}.
#[tauri::command]
fn history_sid(app: AppHandle, sid: String, from: Option<u64>) -> Result<Value, String> {
    if !agent_core::safe_id(&sid) { return Ok(json!({"items": [], "next": 0})); }
    let c = server(&app)?;
    let (items, next) = c.history(&sid, from.unwrap_or(0), &vault_there(&c)?)?;
    Ok(json!({"items": items, "next": next}))
}

/// Follow a conversation unless this phone does already: attach to its agent, or start it when it has none.
fn follow(app: &AppHandle, state: &App, key: &str, model: &str, effort: &str) -> Result<(), String> {
    if key.trim().is_empty() { return Err("no conversation".into()); }
    if state.live.lock().unwrap().contains_key(key) { return Ok(()); }
    let c = server(app)?;
    let conn = match c.attach(key)? {
        Some(conn) => conn,
        None => {
            let sid = c.list_sessions()?.1.remove(key);
            c.start(key, key, model, effort, sid.as_deref())?
        }
    };
    state.wanted.lock().unwrap().insert(key.into());
    state.live.lock().unwrap().insert(key.into(), Live { stdin: conn.stdin, pid: conn.agent.id() });
    let (app, key, frames, backlog) = (app.clone(), key.to_string(), conn.frames, conn.backlog);
    thread::spawn(move || read(&app, &key, frames, backlog));
    Ok(())
}

/// One conversation's lines, as the laptop reads them (src-tauri's session/frames.rs, without the git snapshots of
/// the laptop's checkouts): events to the webview, cards, turns. The first `backlog` came while this phone was away:
/// their cards still count, the webview only hears their turn ends and reads the rest from the transcript.
fn read(app: &AppHandle, key: &str, frames: Box<dyn BufRead + Send>, backlog: usize) {
    let st = app.state::<App>();
    let mut parse = PROVIDER.parser();
    let emit = |ev: Value| { app.emit("agent", json!({"project": key, "provider": PROVIDER.id(), "event": ev})).ok(); };
    let mut exited = false;
    for (n, l) in frames.lines().map_while(Result::ok).enumerate() {
        let line = match frame(&l) { Frame::Out(o) => o, Frame::Err(_) => continue, Frame::Exit => { exited = true; break } };
        let replay = n < backlog;
        // Claude asks for a tool on its pipe (`can_use_tool`): a card, answered with `answer`
        if let Some(r) = serde_json::from_str::<Value>(&line).ok().and_then(|v| agent_claude::permission::card(key, &v)) {
            st.cards.lock().unwrap().push(r.clone());
            emit(json!({"type": "permission", "request": r}));
            continue;
        }
        for ev in parse(&line) {
            match &ev {
                Event::Synthetic | Event::Control { .. } | Event::Limited { .. } | Event::TurnLimited => continue,
                Event::Permission { request } => {
                    let mut r = request.clone();
                    (r.project, r.provider, r.relay) = (key.to_string(), PROVIDER.id().into(), true);
                    st.cards.lock().unwrap().push(r);
                }
                Event::TurnEnd { .. } => { if let Some(n) = st.turns.lock().unwrap().get_mut(key) { *n = n.saturating_sub(1); } }
                _ => {}
            }
            if !replay || matches!(ev, Event::TurnEnd { .. }) { emit(serde_json::to_value(&ev).unwrap_or_default()); }
        }
    }
    st.live.lock().unwrap().remove(key);
    // the agent ended there: done with it; else only the connection went (the phone slept) and it is followed again
    if exited {
        st.wanted.lock().unwrap().remove(key);
        st.turns.lock().unwrap().remove(key);
        st.cards.lock().unwrap().retain(|r| r.project != key);
        emit(json!({"type": "exit"}));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(App::default())
        .plugin(sealed::init())
        // relay://conversation/<key>: a notification tapped opens its conversation (src/application/mobile)
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // the camera, for the pairing code the laptop shows (Settings › Machines › Add phone)
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init())?;
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pair, info, conversations, running, open, send, notify, stop, pending, answer, history, history_sid])
        .build(tauri::generate_context!())
        .expect("error while running Relay")
        .run(|app, ev| {
            // back from the background: the conversations followed before, again (the server kept what they said)
            if let RunEvent::Resumed = ev {
                let st = app.state::<App>();
                let keys: Vec<String> = st.wanted.lock().unwrap().iter().cloned().collect();
                for k in keys { follow(app, &st, &k, "", "").ok(); }
            }
        });
}
