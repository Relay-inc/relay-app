// Banners for a finished turn or a waiting card, a toast through the notification plugin on Windows. On macOS a click
// brings the main window up and opens that conversation. Each banner is a child process (`relay --notify`) that waits
// for the click, one per conversation: a new banner kills the previous one's process, so unclicked banners don't pile
// up. It runs from a copy in the app data folder: usernoted may not read a binary under ~/Documents (privacy
// protection) and then denies the banner. `tauri dev` has no registered bundle, so the banner goes out as Terminal there.

#[cfg(not(windows))]
use std::{collections::HashMap, io::Read, process::{Child, Command, Stdio}, sync::{LazyLock, Mutex}};
use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Emitter;

/// banner slot (the conversation key, or the caller's own slot) -> the process of its latest banner
#[cfg(not(windows))]
static BANNERS: LazyLock<Mutex<HashMap<String, Child>>> = LazyLock::new(Default::default);

/// `key` is what a click opens. `slot` is which earlier banner this one replaces, the key when left out: a meeting's
/// banner has its own slot and opens Waiting, so two meetings close together both keep their banner.
#[tauri::command]
pub fn notify(app: AppHandle, key: String, title: String, body: String, slot: Option<String>) {
    // ponytail: no click back to the conversation on Windows, the plugin has no click event on desktop. A
    // tauri-winrt-notification toast with on_activated if that is missed
    #[cfg(windows)]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = (key, slot);
        app.notification().builder().title(title).body(body).show().ok();
    }
    #[cfg(not(windows))]
    banner_process(app, key, title, body, slot);
}

#[cfg(not(windows))]
fn banner_process(app: AppHandle, key: String, title: String, body: String, slot: Option<String>) {
    let slot = slot.unwrap_or_else(|| key.clone());
    std::thread::spawn(move || {
        let Some(exe) = helper(&app) else { return };
        let Ok(mut child) = Command::new(exe).args(["--notify", &title, &body]).stdout(Stdio::piped()).spawn() else { return };
        let (pid, mut stdout) = (child.id(), child.stdout.take().unwrap());
        if let Some(mut old) = BANNERS.lock().unwrap().insert(slot.clone(), child) {
            old.kill().ok();
            old.wait().ok();
        }
        // EOF once the banner is clicked, cleared from Notification Center, or replaced by a newer one
        let mut out = Vec::new();
        stdout.read_to_end(&mut out).ok();
        let mut banners = BANNERS.lock().unwrap();
        if banners.get(&slot).is_some_and(|c| c.id() == pid) {
            if let Some(mut done) = banners.remove(&slot) { done.wait().ok(); }
        }
        drop(banners);
        if out.starts_with(b"click") {
            let w = super::windows::show_active(&app);
            app.emit_to(w, "open-chat", key).ok();
        }
    });
}

/// The copy of this binary that sends the banners, refreshed after every build.
#[cfg(not(windows))]
fn helper(app: &AppHandle) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dst = super::data_dir(app).join("relay-notify");
    let at = |p: &std::path::Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
    if at(&dst).is_none() || at(&exe) > at(&dst) {
        let tmp = dst.with_extension("tmp"); // a rename, so a banner never starts a half-written copy
        std::fs::copy(&exe, &tmp).ok()?;
        std::fs::rename(&tmp, &dst).ok()?;
    }
    Some(dst)
}

/// The child: one banner, "click" on stdout when it was clicked.
pub fn banner(title: &str, body: &str) {
    #[cfg(not(target_os = "macos"))]
    let _ = (title, body);
    #[cfg(target_os = "macos")]
    {
        use mac_notification_sys::{set_application, Notification, NotificationResponse};
        let id = if tauri::is_dev() { "com.apple.Terminal" } else { "be.laurentmeersman.relay" };
        set_application(id).ok();
        // Once Relay quits (the parent becomes launchd, pid 1) a click has nothing to open, so stop waiting for one.
        std::thread::spawn(|| {
            while std::os::unix::process::parent_id() != 1 {
                std::thread::sleep(std::time::Duration::from_secs(10));
            }
            std::process::exit(0);
        });
        // ponytail: icon from the checkout, fine while the app runs on this machine, a resource when it ships
        let icon = concat!(env!("CARGO_MANIFEST_DIR"), "/icons/128x128@2x.png");
        let r = Notification::new().title(title).message(body).app_icon(icon).wait_for_click(true).send();
        if let Ok(NotificationResponse::Click) = r { println!("click"); }
    }
}

// ---------- Record nudge
// A meeting that started without a recording (src/application/calendar/nudge.ts): a small window at the top right that
// stays above every app, on every desktop and next to a full-screen call, until Record or Skip. Not a banner: macOS
// hides a banner after a few seconds unless the user made Relay's style Alerts, and hides all of them while the screen
// is shared. It never takes the focus from the call; a click goes through at once (accept_first_mouse).
const NUDGE: &str = "record-nudge";
const NUDGE_SIZE: (f64, f64) = (440.0, 92.0);
/// The meeting the nudge shows, for the window to read when it loads (an event sent before that is lost).
static NUDGE_NOW: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);

/// `meeting` ({id, title, time}) shows the nudge with it, None hides it.
#[tauri::command]
pub fn record_nudge(app: AppHandle, meeting: Option<serde_json::Value>) {
    use tauri::{Emitter, Manager};
    *NUDGE_NOW.lock().unwrap() = meeting.clone();
    let a = app.clone();
    app.run_on_main_thread(move || {
        let app = &a;
        let Some(meeting) = meeting else {
            if let Some(w) = app.get_webview_window(NUDGE) { w.hide().ok(); }
            return;
        };
        if app.get_webview_window(NUDGE).is_none() {
            let (width, height) = NUDGE_SIZE;
            let built = tauri::WebviewWindowBuilder::new(app, NUDGE, tauri::WebviewUrl::App("nudge.html".into()))
                .title("Relay").inner_size(width, height).decorations(false).transparent(true).resizable(false)
                .always_on_top(true).visible_on_all_workspaces(true).skip_taskbar(true)
                .focusable(false).focused(false).accept_first_mouse(true).visible(false)
                .build();
            let Ok(w) = built else { return };
            // top right of the screen with the cursor, under the menu bar, where a banner would be
            if let Some(m) = w.cursor_position().ok().and_then(|p| w.monitor_from_point(p.x, p.y).ok().flatten()).or_else(|| w.primary_monitor().ok().flatten()) {
                let (size, at, scale) = (m.size(), m.position(), m.scale_factor());
                let x = at.x as f64 + size.width as f64 - (width + 16.0) * scale;
                let y = at.y as f64 + 40.0 * scale;
                w.set_position(tauri::PhysicalPosition::new(x, y)).ok();
            }
            #[cfg(target_os = "macos")]
            above_full_screen(&w);
        }
        app.emit_to(NUDGE, "record-nudge", meeting).ok();
        if let Some(w) = app.get_webview_window(NUDGE) { w.show().ok(); }
    }).ok();
}
/// What the nudge shows now, null when hidden.
#[tauri::command]
pub fn record_nudge_now() -> Option<serde_json::Value> { NUDGE_NOW.lock().unwrap().clone() }

/// On every Space including a full-screen app's, above floating windows: a window that only floats stays behind a
/// full-screen Meet or Zoom.
#[cfg(target_os = "macos")]
fn above_full_screen(w: &tauri::WebviewWindow) {
    let Ok(ns) = w.ns_window() else { return };
    let ns = ns as *mut objc2::runtime::AnyObject;
    // NSWindowCollectionBehavior CanJoinAllSpaces (1) | Stationary (16) | FullScreenAuxiliary (256); NSStatusWindowLevel (25)
    unsafe {
        let _: () = objc2::msg_send![ns, setCollectionBehavior: 1usize | 16 | 256];
        let _: () = objc2::msg_send![ns, setLevel: 25isize];
    }
}
