// Settings › General › Permissions: what macOS lets Relay do, checked without making macOS ask, and a button to the
// pane of System Settings where each one is switched. An ad-hoc signed build loses these grants with every update
// (macOS keys them to the binary), so this is where that shows up.
// System Audio Recording and Notifications have no status here: macOS has no public call that answers for the
// process tap (meeting.rs), and banners go through NSUserNotification in a helper process (notify.rs), whose
// setting UNUserNotificationCenter does not report. They get the button only.
// On Windows only the microphone has a state, from the privacy settings. System audio needs no permission there.

use serde_json::{json, Value};

/// Every permission: "ok", "missing", "ask" (macOS has not asked yet, it will the first time it is used) or null
/// when it cannot be told.
#[tauri::command]
pub fn permissions() -> Value {
    json!({
        "microphone": os::microphone(),
        "accessibility": if super::anywhere::dictation_access() { "ok" } else { "missing" },
        "fullDisk": full_disk(),
        "systemAudio": null,
        "notifications": null,
    })
}

/// Whether the microphone is switched off for Relay before anything opens it: Windows' privacy settings, so a meeting
/// does not record silence. macOS asks on first use instead.
pub(crate) fn microphone_off() -> bool { cfg!(windows) && os::microphone() == Some("missing") }

/// Opens the pane of Windows Settings for one permission.
#[cfg(windows)]
#[tauri::command]
pub fn permissions_open(which: String) -> Result<(), String> {
    let page = match which.as_str() {
        "microphone" => "ms-settings:privacy-microphone",
        "notifications" => "ms-settings:notifications",
        _ => return Err(format!("{which} has no setting on Windows")),
    };
    // explorer hands a URI to the app registered for it, here Settings
    std::process::Command::new("explorer").arg(page).status().map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens the pane of System Settings for one permission.
#[cfg(not(windows))]
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
mod os {
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
/// Windows keeps the microphone switches in the registry: the device's (HKLM), the user's, and "Let desktop apps access
/// your microphone" (NonPackaged, which an installed Relay is). Any of them on Deny turns it off, a missing one allows.
#[cfg(windows)]
mod os {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
    /// A key's `Value` string, None when it is missing or longer than "Allow" and "Deny".
    fn value(root: HKEY, key: &str) -> Option<String> {
        let (key, name) = (wide(key), wide("Value"));
        let mut buf = [0u16; 16];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let st = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
        (st == 0).then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
    }

    pub fn microphone() -> Option<&'static str> {
        let desktop = format!(r"{STORE}\NonPackaged");
        let says = [(HKEY_LOCAL_MACHINE, STORE), (HKEY_CURRENT_USER, STORE), (HKEY_CURRENT_USER, desktop.as_str())].map(|(root, key)| value(root, key));
        Some(if says.iter().any(|v| v.as_deref() == Some("Deny")) { "missing" } else { "ok" })
    }
}
#[cfg(not(any(target_os = "macos", windows)))]
mod os {
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
