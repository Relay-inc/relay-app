// Settings › General › Permissions: what macOS lets Relay do, checked without making macOS ask, and a button to the
// pane of System Settings where each one is switched. An ad-hoc signed build loses these grants with every update
// (macOS keys them to the binary), so this is where that shows up.
// System Audio Recording and Notifications have no status here: macOS has no public call that answers for the
// process tap (meeting.rs), and banners go through NSUserNotification in a helper process (notify.rs), whose
// setting UNUserNotificationCenter does not report. They get the button only.

use serde_json::{json, Value};

/// Every permission: "ok", "missing", "ask" (macOS has not asked yet, it will the first time it is used) or null
/// when it cannot be told.
#[tauri::command]
pub fn permissions() -> Value {
    json!({
        "microphone": mac::microphone(),
        "accessibility": if super::anywhere::dictation_access() { "ok" } else { "missing" },
        "fullDisk": full_disk(),
        "systemAudio": null,
        "notifications": null,
    })
}

/// Opens the pane of System Settings for one permission.
#[tauri::command]
pub fn permissions_open(which: String) -> Result<(), String> {
    let pane = match which.as_str() {
        "microphone" => "com.apple.preference.security?Privacy_Microphone",
        "accessibility" => "com.apple.preference.security?Privacy_Accessibility",
        "fullDisk" => "com.apple.preference.security?Privacy_AllFiles",
        // "Screen & System Audio Recording" holds the audio-only list too
        "systemAudio" => "com.apple.preference.security?Privacy_ScreenCapture",
        "notifications" => "com.apple.Notifications-Settings.extension",
        _ => return Err(format!("unknown permission {which}")),
    };
    std::process::Command::new("open").arg(format!("x-apple.systempreferences:{pane}")).status().map_err(|e| e.to_string())?;
    Ok(())
}

/// The TCC database can only be read with Full Disk Access; opening it fails without one and never prompts.
fn full_disk() -> Option<&'static str> {
    let db = std::path::Path::new(&super::home()).join("Library/Application Support/com.apple.TCC/TCC.db");
    match std::fs::File::open(db) {
        Ok(_) => Some("ok"),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Some("missing"),
        Err(_) => None,
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::AnyClass;
    use objc2::msg_send;
    use objc2_foundation::NSString;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    pub fn microphone() -> Option<&'static str> {
        let class = AnyClass::get(c"AVCaptureDevice")?;
        let audio = NSString::from_str("soun"); // AVMediaTypeAudio
        let status: isize = unsafe { msg_send![class, authorizationStatusForMediaType: &*audio] };
        Some(match status { 0 => "ask", 3 => "ok", _ => "missing" }) // 1 restricted, 2 denied
    }
}
#[cfg(not(target_os = "macos"))]
mod mac {
    pub fn microphone() -> Option<&'static str> { None }
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_permission_answers_a_known_state() {
        let p = super::permissions();
        for key in ["microphone", "accessibility", "fullDisk", "systemAudio", "notifications"] {
            let v = &p[key];
            assert!(v.is_null() || ["ok", "missing", "ask"].contains(&v.as_str().unwrap()), "{key}: {v}");
        }
        assert!(super::permissions_open("nope".into()).is_err());
    }
}
