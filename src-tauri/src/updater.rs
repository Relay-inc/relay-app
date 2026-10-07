// Updates from the private GitHub repo, with the user's own gh login: whoever can download a release can update, and
// no token ships in the app. scripts/release.sh writes latest.json to the `updates` branch, its download url is the
// GitHub API url of the release's .app.tar.gz. An app updated this way gets no quarantine flag, only the first
// install needs the xattr line. A check at start and once a day, and Relay › Check for Updates.
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

const DAY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

pub fn start(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || loop {
        check(&h, false);
        std::thread::sleep(DAY);
    });
}

/// From the menu: also says when there is nothing new, or why it could not look.
pub fn check_now(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || check(&h, true));
}

fn check(app: &AppHandle, asked: bool) {
    let say = |text: String| { app.dialog().message(text).title("Relay").blocking_show(); };
    match tauri::async_runtime::block_on(find(app)) {
        Ok(Some(update)) => {
            let text = crate::trc_v("update.available", &update.version) + &update.body.clone().map(|b| format!("\n\n{b}")).unwrap_or_default();
            let install = app.dialog().message(text).title("Relay")
                .buttons(MessageDialogButtons::OkCancelCustom(crate::trc("update.install"), crate::trc("update.later")))
                .blocking_show();
            if !install { return; }
            match tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {})) {
                Ok(()) => app.request_restart(), // through RunEvent::Exit, so quit() runs as on Cmd-Q
                Err(e) => say(crate::trc_v("update.failed", &e.to_string())),
            }
        }
        Ok(None) => if asked { say(crate::trc_v("update.none", &app.package_info().version.to_string())) },
        Err(e) => if asked { say(crate::trc_v("update.failed", &e)) } else { eprintln!("update check: {e}") },
    }
}

async fn find(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let token = crate::gh(&app.state::<crate::App>(), &["auth", "token"])?.trim().to_string();
    let auth = format!("Bearer {token}");
    let updater = app.updater_builder()
        .header("Authorization", auth.as_str()).map_err(|e| e.to_string())?
        // latest.json raw from the contents API, not wrapped in JSON
        .header("Accept", "application/vnd.github.raw").map_err(|e| e.to_string())?
        .build().map_err(|e| e.to_string())?;
    let mut update = updater.check().await.map_err(|e| e.to_string())?;
    // the download keeps the token but takes the updater's own Accept (application/octet-stream): GitHub sends the
    // asset's bytes for that, and its metadata for the raw type
    if let Some(u) = update.as_mut() { u.headers.remove("accept"); }
    Ok(update)
}
