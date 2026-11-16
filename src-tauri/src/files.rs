//! Files attached by their path (dropped, picked with +, pasted from Finder): the agent reads them where they are, so
//! nothing here copies a file. The webview gets paths, a picture's bytes to send it inline, and opens a file again.

use std::path::Path;
use tauri::AppHandle;

const IMAGES: [(&str, &str); 5] =
    [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")];
/// A picture's media type by its extension, None for any other file.
pub fn image_type(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    IMAGES.iter().find(|(e, _)| *e == ext).map(|(_, mt)| *mt)
}

/// The files picked in the open dialog (+ in the composer), as paths.
#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_files().unwrap_or_default();
    picked.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect()
}

/// A picture at `path` as [media type, base64], to send it inline the way a pasted one goes. Only pictures, 20 MB at most.
#[tauri::command]
pub async fn read_image(path: String) -> Result<(String, String), String> {
    let mt = image_type(&path).ok_or("not a picture")?;
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 20_000_000 { return Err("> 20 MB".into()); }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        Ok((mt.to_string(), base64::engine::general_purpose::STANDARD.encode(bytes)))
    }).await.map_err(|e| e.to_string())?
}

// what the system would run instead of show: an app, a script, an installer, any file with an execute bit (macOS),
// anything Windows runs by its extension (no execute bit there)
fn runs(path: &Path) -> bool {
    #[cfg(not(windows))]
    const RUN: &[&str] = &["app", "command", "tool", "terminal", "workflow", "scpt", "pkg", "mpkg", "sh"];
    #[cfg(not(windows))]
    let by_name = {
        let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        RUN.contains(&ext.as_str())
    };
    #[cfg(windows)]
    let by_name = win_runs(&path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        &std::env::var("PATHEXT").unwrap_or_default());
    by_name || std::fs::metadata(path).is_ok_and(|m| m.is_file() && crate::platform::executable(&m))
}
/// Whether Windows would run the file `name` instead of opening it: by its extension (the list plus `PATHEXT`), read
/// the way Windows reads a name (trailing dots and spaces dropped). A `:` (an alternate data stream) counts as running.
// ponytail: a denylist, a file type registered later as runnable gets past it. AssocQueryString per file if it matters
#[cfg(any(windows, test))]
fn win_runs(name: &str, pathext: &str) -> bool {
    const RUN: &[&str] = &["exe", "com", "bat", "cmd", "ps1", "psm1", "psc1", "ps1xml", "vbs", "vbe", "vb", "js", "jse",
        "wsf", "wsh", "ws", "wsc", "msi", "msp", "msix", "appx", "scr", "hta", "cpl", "msc", "chm", "inf", "scf", "lnk",
        "url", "website", "pif", "reg", "jar", "py", "pyw", "mde", "mda", "gadget", "xbap", "diagcab", "appref-ms",
        "application", "library-ms", "settingcontent-ms", "sh"];
    let name = name.trim_end_matches(['.', ' ']);
    if name.contains(':') { return true; }
    let Some((_, ext)) = name.rsplit_once('.') else { return false };
    let ext = ext.to_ascii_lowercase();
    RUN.contains(&ext.as_str()) || pathext.split(';').any(|p| p.trim_start_matches('.').eq_ignore_ascii_case(&ext))
}
/// An attached file in its default app, or shown in Finder (`reveal`). Something that would run (an app, a script)
/// is only ever shown in Finder: a click on a chip opens a document, it never starts a program.
#[tauri::command]
pub fn open_file(path: String, reveal: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Err("not found".into()); }
    if reveal || runs(p) { tauri_plugin_opener::reveal_item_in_dir(p) } else { tauri_plugin_opener::open_path(p, None::<&str>) }
        .map_err(|e| e.to_string())
}

/// The files copied in Finder (Cmd-C) as paths: the webview's paste only gets their bytes. Empty when the clipboard
/// holds no files, so a pasted screenshot goes on as a picture.
#[tauri::command]
pub fn pasted_files() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
        let items = NSPasteboard::generalPasteboard().pasteboardItems().map(|a| a.to_vec()).unwrap_or_default();
        items.iter()
            .filter_map(|item| item.stringForType(unsafe { NSPasteboardTypeFileURL }))
            .filter_map(|url| tauri::Url::parse(&url.to_string()).ok()?.to_file_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

/// Text on the clipboard. The webview's `navigator.clipboard.writeText` is refused now and then in WKWebView (a copy
/// button showed its tick and copied nothing), so the app writes the pasteboard itself.
#[tauri::command]
pub fn copy_text(text: String) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        board.setString_forType(&NSString::from_str(&text), unsafe { NSPasteboardTypeString });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = text;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_reads_the_name_as_it_runs_it() {
        let pe = ".COM;.EXE;.BAT;.CMD;.XYZ";
        for n in ["a.exe", "A.EXE", "a.exe.", "a.exe . ", "a.txt:evil.exe", "a.msc", "a.xyz", "setup.py"] { assert!(win_runs(n, pe), "{n}"); }
        for n in ["a.pdf", "notes.md", "README", "a.exe.pdf"] { assert!(!win_runs(n, pe), "{n}"); }
    }

    #[test]
    fn pictures_by_extension() {
        assert_eq!(image_type("/a/b.PNG"), Some("image/png"));
        assert_eq!(image_type("/a/b.jpeg"), Some("image/jpeg"));
        assert_eq!(image_type("/a/b.pdf"), None);
        assert_eq!(image_type("/a/png"), None);
    }

    #[test]
    fn programs_are_never_opened() {
        let dir = std::env::temp_dir().join(format!("relay-files-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let doc = dir.join("a.pdf");
        let script = dir.join("run");
        std::fs::write(&doc, "x").unwrap();
        std::fs::write(&script, "#!/bin/sh").unwrap();
            crate::platform::set_mode(&script, 0o755).unwrap();
        assert!(!runs(&doc));
        assert!(runs(&script));
        assert!(runs(Path::new("/Applications/Safari.app")));
        assert!(runs(&dir.join("x.command")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

