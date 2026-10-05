// Dictation from any app (Settings › Voice): two shortcuts registered with macOS, so they record wherever the cursor
// is, held or tapped as the mode says. One starts a new conversation in Relay with what was said (the main window
// comes forward, src/application/boot.ts sends it); the other pastes the text (dictation.rs) into the app in front: the clipboard is kept aside, the text put on it, ⌘V sent, and the clipboard put back. Sending ⌘V needs
// Accessibility; without it the text stays on the clipboard to paste by hand. A small pill at the bottom of the screen
// (overlay.html) shows the level and the transcribing; it never takes the focus, so the app in front keeps it.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const PILL: &str = "dictation-pill";
// when the shortcut went down while nothing recorded: a release after 400 ms ends a held recording
static PRESSED: Mutex<Option<Instant>> = Mutex::new(None);
// where the running recording's text goes
static TARGET: Mutex<Target> = Mutex::new(Target::Paste);
// while Settings records a new shortcut, none is registered: macOS would swallow the keys it waits for
static PAUSED: Mutex<bool> = Mutex::new(false);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Target { Chat, Paste }

/// The shortcuts Settings › Voice switched on, with the mode: `(shortcut, target)` as global-hotkey parses them.
fn wanted(settings: &Value) -> (Vec<(String, Target)>, String) {
    let voice = &settings["voice"];
    let one = |on: &str, key: &str, default: &str, target| {
        (voice[on] == true).then(|| {
            let shortcut = voice[key].as_str().filter(|s| !s.is_empty()).unwrap_or(default);
            // the composer's names (domain/settings/voice.ts) as global-hotkey parses them
            (shortcut.replace("meta", "super"), target)
        })
    };
    let list = [one("chatOn", "chatShortcut", "alt+shift+Space", Target::Chat), one("pasteOn", "pasteShortcut", "ctrl+alt+Space", Target::Paste)];
    (list.into_iter().flatten().collect(), voice["mode"].as_str().unwrap_or("both").to_string())
}

/// Registers the shortcuts, or takes them away, as the settings say. Called at the start and after every save.
pub fn apply(app: &AppHandle) {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().ok();
    if *PAUSED.lock().unwrap() { return; }
    let settings = app.state::<super::App>().settings.lock().unwrap().clone();
    let (list, mode) = wanted(&settings);
    for (shortcut, target) in list {
        let mode = mode.clone();
        let registered = shortcuts.on_shortcut(shortcut.as_str(), move |app, _, event| {
            let held = || PRESSED.lock().unwrap().take().is_some_and(|at| at.elapsed() > Duration::from_millis(400));
            match event.state {
                ShortcutState::Pressed if !super::dictation::recording(app) => {
                    *PRESSED.lock().unwrap() = Some(Instant::now());
                    *TARGET.lock().unwrap() = target;
                    start(app);
                }
                ShortcutState::Pressed if mode != "hold" => finish(app),
                ShortcutState::Released => {
                    let held = held();
                    if super::dictation::recording(app) && (mode == "hold" || (mode == "both" && held)) { finish(app); }
                }
                _ => {}
            }
        });
        if let Err(e) = registered { eprintln!("dictation: shortcut {shortcut}: {e}"); }
    }
}

/// Settings › Voice records a new shortcut: the registered ones step aside until it is done.
#[tauri::command]
pub fn dictation_pause_shortcuts(app: AppHandle, paused: bool) {
    *PAUSED.lock().unwrap() = paused;
    apply(&app);
}

fn pill(app: &AppHandle, state: Value) {
    if app.get_webview_window(PILL).is_none() {
        let built = tauri::WebviewWindowBuilder::new(app, PILL, tauri::WebviewUrl::App("overlay.html".into()))
            .inner_size(260.0, 48.0).decorations(false).transparent(true).shadow(false).resizable(false)
            .always_on_top(true).visible_on_all_workspaces(true).skip_taskbar(true)
            .focusable(false).focused(false).visible(false)
            .build();
        let Ok(w) = built else { return };
        w.set_ignore_cursor_events(true).ok();
        // bottom centre of the screen with the cursor, above the Dock
        if let Some(m) = w.cursor_position().ok().and_then(|p| w.monitor_from_point(p.x, p.y).ok().flatten()).or_else(|| w.primary_monitor().ok().flatten()) {
            let (size, at, scale) = (m.size(), m.position(), m.scale_factor());
            let x = at.x as f64 + (size.width as f64 - 260.0 * scale) / 2.0;
            let y = at.y as f64 + size.height as f64 - 120.0 * scale;
            w.set_position(tauri::PhysicalPosition::new(x, y)).ok();
        }
    }
    let hide = state["phase"] == "hidden";
    app.emit_to(PILL, "pill", state).ok();
    if let Some(w) = app.get_webview_window(PILL) {
        if hide { w.hide().ok(); } else { w.show().ok(); }
    }
}

fn start(app: &AppHandle) {
    let a = app.clone();
    match super::dictation::start(app, Box::new(move |level| { a.emit_to(PILL, "pill", json!({ "phase": "recording", "level": level })).ok(); })) {
        Ok(()) => pill(app, json!({ "phase": "recording", "level": 0 })),
        // the model is downloaded from Settings › Voice, the pill says so
        Err(e) => pill_for(app, json!({ "phase": "error", "error": e })),
    }
}

/// The pill with a message, gone again after a few seconds.
fn pill_for(app: &AppHandle, state: Value) {
    pill(app, state);
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if !super::dictation::recording(&a) { pill(&a, json!({ "phase": "hidden" })); }
    });
}

fn finish(app: &AppHandle) {
    pill(app, json!({ "phase": "transcribing" }));
    let a = app.clone();
    std::thread::spawn(move || match super::dictation::stop(&a) {
        Ok(text) if text.is_empty() => pill(&a, json!({ "phase": "hidden" })),
        Ok(text) if *TARGET.lock().unwrap() == Target::Chat => {
            pill(&a, json!({ "phase": "hidden" }));
            super::tray::show_main(&a);
            a.emit_to("main", "dictated-chat", text).ok();
        }
        Ok(text) => {
            let pasted = mac::trusted();
            let b = a.clone();
            a.run_on_main_thread(move || mac::paste(&b, text, pasted)).ok();
            if pasted { pill(&a, json!({ "phase": "hidden" })) } else { pill_for(&a, json!({ "phase": "copied" })) }
        }
        Err(e) => pill_for(&a, json!({ "phase": "error", "error": e })),
    });
}

/// Whether Relay may send keys to other apps (System Settings › Privacy & Security › Accessibility).
#[tauri::command]
pub fn dictation_access() -> bool { mac::trusted() }
/// Asks macOS for Accessibility: its dialog, which opens the pane. Answers whether it is already allowed.
#[tauri::command]
pub fn dictation_ask_access() -> bool { mac::ask() }

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString};
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSNumber, NSString};
    use std::ffi::c_void;
    use std::time::Duration;
    use tauri::AppHandle;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
        static kAXTrustedCheckOptionPrompt: *const c_void;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state: i32) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(source: *mut c_void, key: u16, down: bool) -> *mut c_void;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *mut c_void);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    const HID_STATE: i32 = 1; // kCGEventSourceStateHIDSystemState
    const HID_TAP: u32 = 0; // kCGHIDEventTap
    const KEY_V: u16 = 9; // kVK_ANSI_V
    const COMMAND: u64 = 0x0010_0000; // kCGEventFlagMaskCommand

    pub fn trusted() -> bool { unsafe { AXIsProcessTrusted() } }
    pub fn ask() -> bool {
        unsafe {
            let key: &NSString = &*(kAXTrustedCheckOptionPrompt as *const NSString);
            let options = NSDictionary::<NSString, NSNumber>::from_slices(&[key], &[&*NSNumber::new_bool(true)]);
            AXIsProcessTrustedWithOptions(Retained::as_ptr(&options) as *const c_void)
        }
    }

    /// ⌘V, with only ⌘ down whatever the hands still hold (an ⌥ of the shortcut would make it ⌥⌘V).
    fn command_v() {
        unsafe {
            let source = CGEventSourceCreate(HID_STATE);
            for down in [true, false] {
                let event = CGEventCreateKeyboardEvent(source, KEY_V, down);
                CGEventSetFlags(event, COMMAND);
                CGEventPost(HID_TAP, event);
                CFRelease(event);
            }
            if !source.is_null() { CFRelease(source); }
        }
    }

    type Saved = Vec<Vec<(String, Vec<u8>)>>;
    /// Every item on the clipboard with all its types, as plain bytes (so it can wait on another thread).
    fn save(board: &NSPasteboard) -> Saved {
        let items = board.pasteboardItems().map(|a| a.to_vec()).unwrap_or_default();
        items.iter().map(|item| {
            item.types().iter().filter_map(|kind| item.dataForType(&kind).map(|data| (kind.to_string(), data.to_vec()))).collect()
        }).collect()
    }
    fn restore(board: &NSPasteboard, saved: &Saved) {
        board.clearContents();
        let items: Vec<_> = saved.iter().map(|types| {
            let item = NSPasteboardItem::new();
            for (kind, bytes) in types { item.setData_forType(&NSData::with_bytes(bytes), &NSString::from_str(kind)); }
            ProtocolObject::from_retained(item)
        }).collect();
        board.writeObjects(&NSArray::from_retained_slice(&items));
    }

    /// Puts `text` on the clipboard and, when `send`, pastes it with ⌘V and puts the clipboard back once the app read
    /// it, unless something else was copied meanwhile. Runs on the main thread.
    pub fn paste(app: &AppHandle, text: String, send: bool) {
        let board = NSPasteboard::generalPasteboard();
        let saved = save(&board);
        board.clearContents();
        board.setString_forType(&NSString::from_str(&text), unsafe { NSPasteboardTypeString });
        if !send { return; }
        let ours = board.changeCount();
        command_v();
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            app.clone().run_on_main_thread(move || {
                let board = NSPasteboard::generalPasteboard();
                if board.changeCount() == ours { restore(&board, &saved); }
            }).ok();
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    pub fn trusted() -> bool { false }
    pub fn ask() -> bool { false }
    pub fn paste(_: &tauri::AppHandle, _: String, _: bool) {}
}

#[cfg(test)]
mod tests {
    use super::{wanted, Target};
    use serde_json::json;

    #[test]
    fn only_the_switched_on_shortcuts_are_registered() {
        assert_eq!(wanted(&json!({})), (vec![], "both".into()));
        assert_eq!(wanted(&json!({ "voice": { "pasteOn": true } })).0, vec![("ctrl+alt+Space".into(), Target::Paste)]);
        let both = json!({ "voice": { "chatOn": true, "chatShortcut": "shift+meta+KeyD", "pasteOn": true, "mode": "hold" } });
        assert_eq!(wanted(&both), (vec![("shift+super+KeyD".into(), Target::Chat), ("ctrl+alt+Space".into(), Target::Paste)], "hold".into()));
        // the composer's switch does not register anything with macOS
        assert_eq!(wanted(&json!({ "voice": { "on": true, "shortcut": "alt+Space" } })).0, vec![]);
    }
}
