// macOS banners for a finished turn or a waiting card. A click brings the main window up and opens that
// conversation. Each banner is a child process (`relay --notify`) that waits for the click, one per conversation:
// a new banner kills the previous one's process, so unclicked banners don't pile up. It runs from a
// copy in the app data folder: usernoted may not read a binary under ~/Documents (privacy protection) and
// then denies the banner. `tauri dev` has no registered bundle, so the banner goes out as Terminal there.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

/// banner slot (the conversation key, or the caller's own slot) -> the process of its latest banner
static BANNERS: LazyLock<Mutex<HashMap<String, Child>>> = LazyLock::new(Default::default);

/// `key` is what a click opens. `slot` is which earlier banner this one replaces, the key when left out: a meeting's
/// banner has its own slot and opens Waiting, so two meetings close together both keep their banner.
#[tauri::command]
pub fn notify(app: AppHandle, key: String, title: String, body: String, slot: Option<String>) {
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
            super::tray::show_main(&app);
            app.emit("open-chat", key).ok();
        }
    });
}

/// The copy of this binary that sends the banners, refreshed after every build.
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
