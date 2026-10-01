// macOS banners for a finished turn or a waiting card. A click brings the main window up and opens that
// conversation. Each banner is a child process (`relay --notify`) that waits for the click. It runs from a
// copy in the app data folder: usernoted may not read a binary under ~/Documents (privacy protection) and
// then denies the banner. `tauri dev` has no registered bundle, so the banner goes out as Terminal there.

use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn notify(app: AppHandle, key: String, title: String, body: String) {
    std::thread::spawn(move || {
        let Some(exe) = helper(&app) else { return };
        // blocks until the banner is clicked or cleared from Notification Center
        let out = std::process::Command::new(exe).args(["--notify", &title, &body]).output();
        if out.is_ok_and(|o| o.stdout.starts_with(b"click")) {
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
        // ponytail: icon from the checkout, fine while the app runs on this machine, a resource when it ships
        let icon = concat!(env!("CARGO_MANIFEST_DIR"), "/icons/128x128@2x.png");
        let r = Notification::new().title(title).message(body).app_icon(icon).wait_for_click(true).send();
        if let Ok(NotificationResponse::Click) = r { println!("click"); }
    }
}
