// macOS banners for a finished turn or a waiting card. A click brings the main window up and opens that
// conversation. `tauri dev` has no registered bundle, so the banner is sent as Terminal there (what
// tauri-plugin-notification does too), but the click still lands in this process through the delegate.

use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn notify(app: AppHandle, key: String, title: String, body: String) {
    #[cfg(target_os = "macos")]
    std::thread::spawn(move || {
        use mac_notification_sys::{set_application, Notification, NotificationResponse};
        static SENDER: std::sync::Once = std::sync::Once::new();
        SENDER.call_once(|| {
            let id = if tauri::is_dev() { "com.apple.Terminal".to_string() } else { app.config().identifier.clone() };
            set_application(&id).ok();
        });
        // ponytail: icon from the checkout, fine while the app runs on this machine, a resource when it ships
        let icon = concat!(env!("CARGO_MANIFEST_DIR"), "/icons/128x128@2x.png");
        // blocks this thread until the banner is clicked or cleared from Notification Center
        let r = Notification::new().title(&title).message(&body).app_icon(icon).wait_for_click(true).send();
        if let Ok(NotificationResponse::Click) = r {
            super::tray::show_main(&app);
            app.emit("open-chat", key).ok();
        }
    });
}
