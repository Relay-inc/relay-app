//! Relay on a phone (spike): pair with a relay-server, list its conversations and cards, and follow one live.
//! Everything goes through relay-remote's Client, the same code the desktop app uses for a work machine.

use relay_remote::broker::{frame, Frame};
use relay_remote::client::{self, Client};
use relay_remote::tls::Identity;
use serde_json::{json, Value};
use std::io::BufRead;
use std::path::PathBuf;
use std::{fs, thread};
use tauri::{AppHandle, Emitter, Manager};

/// The app's data folder: this phone's certificate (`phone.{crt,key}.der`) and the paired server (`server.json`).
fn dir(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|e| e.to_string()) }
fn identity(app: &AppHandle) -> Result<Identity, String> { Identity::load_or_create(&dir(app)?, "phone").map_err(|e| e.to_string()) }

fn server(app: &AppHandle) -> Result<Client, String> {
    let s: Value = serde_json::from_str(&fs::read_to_string(dir(app)?.join("server.json")).map_err(|_| "not paired yet")?).map_err(|e| e.to_string())?;
    Ok(Client::new(s["host"].as_str().unwrap_or(""), s["port"].as_u64().unwrap_or(0) as u16, s["fp"].as_str().unwrap_or(""), identity(app)?))
}

/// Pair with the line Relay on the laptop made for this phone (Settings › Machines › Add phone), and keep where the
/// server is and the key to the laptop's mirror there.
#[tauri::command]
fn pair(app: AppHandle, line: String, name: String) -> Result<Value, String> {
    let (l, info) = client::pair(&line, &identity(&app)?, &name)?;
    // ponytail: the mirror key sits in the app's private data folder; the Keychain / Android Keystore is phase 2
    let s = json!({"host": l.host, "port": l.port, "fp": l.fp, "key": l.key});
    fs::write(dir(&app)?.join("server.json"), s.to_string()).map_err(|e| e.to_string())?;
    Ok(json!({"server": s, "info": info}))
}

/// What the server says about itself. A locked mirror (the server restarted, the laptop is closed) is opened with the
/// key from pairing, so conversations there can start again.
#[tauri::command]
fn info(app: AppHandle) -> Result<Value, String> {
    let c = server(&app)?;
    let info = c.info()?;
    if info.mirror_open { return Ok(json!(info)); }
    let saved: Value = serde_json::from_str(&fs::read_to_string(dir(&app)?.join("server.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let Some(key) = saved["key"].as_str() else { return Ok(json!(info)) };
    c.unlock(key)?;
    Ok(json!(c.info()?))
}

/// The conversations whose broker runs on the server for this device.
#[tauri::command]
fn list(app: AppHandle) -> Result<Value, String> { Ok(json!(server(&app)?.list()?)) }

/// Open permission cards.
#[tauri::command]
fn pending(app: AppHandle) -> Result<Value, String> { Ok(json!(server(&app)?.pending()?)) }

/// Follow a conversation: its buffered frames, then live ones, as `frame` events until the broker ends or the
/// connection drops. Read-only for now; nothing is written to the agent's stdin.
#[tauri::command]
fn attach(app: AppHandle, key: String) -> Result<Value, String> {
    let conn = server(&app)?.attach(&key)?.ok_or("that conversation is gone")?;
    let backlog = conn.backlog;
    thread::spawn(move || {
        let _stdin = conn.stdin; // kept open while following, so the broker sees this device as connected
        for line in conn.frames.lines() {
            let Ok(line) = line else { break };
            let (kind, text) = match frame(&line) { Frame::Out(l) => ("out", l), Frame::Err(l) => ("err", l), Frame::Exit => ("exit", String::new()) };
            app.emit("frame", json!({"key": key, "kind": kind, "line": text})).ok();
            if kind == "exit" { break; }
        }
        app.emit("frame", json!({"key": key, "kind": "closed", "line": ""})).ok();
    });
    Ok(json!({"backlog": backlog}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![pair, info, list, pending, attach])
        .run(tauri::generate_context!())
        .expect("error while running Relay");
}
