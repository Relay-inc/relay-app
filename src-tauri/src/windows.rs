// Relay's windows: the main one from tauri.conf.json and the ones Cmd-N opens next to it (main-2, main-3, …), each
// the whole app. The one the user worked in last is the active one: the menu, a banner's click, dictation and the
// Design drawer go there, and only it writes the UI state (src/infrastructure/storage.ts).

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Window, WindowEvent};

static ACTIVE: Mutex<String> = Mutex::new(String::new());

/// The main window or one Cmd-N opened (not settings, the viewer, the dictation pill).
pub fn is_relay(label: &str) -> bool { label == "main" || label.starts_with("main-") }

/// The label of the Relay window used last, "main" before any had the focus.
pub fn active() -> String {
    let a = ACTIVE.lock().unwrap();
    if a.is_empty() { "main".into() } else { a.clone() }
}
#[tauri::command]
pub fn active_window() -> String { active() }

fn set_active(app: &AppHandle, label: &str) {
    *ACTIVE.lock().unwrap() = label.to_string();
    app.emit("active-window", label).ok();
}

/// A Relay window that gets the focus becomes the active one; when the active one closes, the main window is.
pub fn track(w: &Window, e: &WindowEvent) {
    if !is_relay(w.label()) { return; }
    match e {
        WindowEvent::Focused(true) => set_active(w.app_handle(), w.label()),
        WindowEvent::Destroyed if active() == w.label() => set_active(w.app_handle(), "main"),
        _ => {}
    }
}

/// Cmd-N: a new window with the main window's configuration, a little down and right of the active one.
pub fn open_new(app: &AppHandle) -> tauri::Result<()> {
    let mut conf = app.config().app.windows.first().cloned().unwrap_or_default();
    conf.label = (2..).map(|n| format!("main-{n}")).find(|l| app.get_webview_window(l).is_none()).unwrap();
    let from = app.get_webview_window(&active()).and_then(|w| Some((w.outer_position().ok()?, w.scale_factor().ok()?)));
    let w = tauri::WebviewWindowBuilder::from_config(app, &conf)?.build()?;
    if let Some((at, scale)) = from {
        let step = (28.0 * scale) as i32;
        w.set_position(PhysicalPosition::new(at.x + step, at.y + step)).ok();
    }
    w.set_focus().ok();
    Ok(())
}

/// Bring the active window up (the main one may be hidden), its label.
pub fn show_active(app: &AppHandle) -> String {
    let label = active();
    if let Some(w) = app.get_webview_window(&label) { w.show().ok(); w.unminimize().ok(); w.set_focus().ok(); }
    label
}
