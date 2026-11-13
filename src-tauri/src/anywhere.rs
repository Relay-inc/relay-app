// Dictation from any app (Settings › Voice): two shortcuts registered with the system (macOS or Windows), so they record
// wherever the cursor is, held or tapped as the mode says. One starts a new conversation in Relay with what was said (the
// main window comes forward, src/application/boot.ts sends it), the other pastes the text (dictation.rs) into the app in
// front: the clipboard is kept aside, the text put on it, ⌘V (Ctrl+V on Windows) sent, and the clipboard put back.
// Sending ⌘V needs Accessibility on the Mac, without it the text stays on the clipboard to paste by hand. Windows asks
// for nothing. A small pill at the bottom of the screen (overlay.html) shows the level and the transcribing. It never
// takes the focus, so the app in front keeps it.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const PILL: &str = "dictation-pill";
const CAPTURE: &str = "capture";
/// The keys until Settings sets others, in global-hotkey's spelling: the two dictation shortcuts (as voice.ts'
/// DEFAULT_SHORTCUTS) and quick capture (`app.capture` in shortcuts.ts). ⌘⇧N is Finder's New Folder and every
/// browser's private window, so a key registered for the whole Mac must not be it: ⌃⌥⌘N is nobody's. Windows keeps
/// every Win key for itself, opens the window menu with Alt+Space and switches the keyboard with Alt+Shift, so Ctrl
/// takes their place there.
/// ponytail: Ctrl+Alt is AltGr on many European layouts, so Ctrl+Alt+N or Ctrl+Alt+Space may be a character there.
/// Settings › Shortcuts changes the key, a layout check would pick another default.
#[derive(Debug, PartialEq)]
struct Keys { chat: &'static str, paste: &'static str, capture: &'static str }
const fn keys(windows: bool) -> Keys {
    if windows { Keys { chat: "ctrl+shift+Space", paste: "ctrl+alt+Space", capture: "ctrl+alt+KeyN" } }
    else { Keys { chat: "alt+shift+Space", paste: "ctrl+alt+Space", capture: "ctrl+alt+super+KeyN" } }
}
const KEYS: Keys = keys(cfg!(windows));
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
    let list = [one("chatOn", "chatShortcut", KEYS.chat, Target::Chat), one("pasteOn", "pasteShortcut", KEYS.paste, Target::Paste)];
    (list.into_iter().flatten().collect(), voice["mode"].as_str().unwrap_or("both").to_string())
}

/// The shortcut that opens quick capture, in global-hotkey's spelling.
fn capture_shortcut(settings: &Value) -> String {
    settings["shortcuts"]["app.capture"][0].as_str().filter(|s| !s.is_empty()).map_or(KEYS.capture.into(), |s| s.replace("meta", "super"))
}

/// Quick capture: its small window, made once and kept hidden; every call brings it forward (over a full-screen app too)
/// and tells the page to take the focus.
pub fn open_capture(app: &AppHandle) {
    let a = app.clone();
    app.run_on_main_thread(move || {
        let app = &a;
        if app.get_webview_window(CAPTURE).is_none() {
            let lang = super::ui_lang_of(&app.state::<super::App>().settings.lock().unwrap());
            let built = tauri::WebviewWindowBuilder::new(app, CAPTURE, tauri::WebviewUrl::App("capture.html".into()))
                .title(super::tr(lang, "capture")).inner_size(440.0, 200.0).resizable(false).minimizable(false).maximizable(false)
                .always_on_top(true).visible_on_all_workspaces(true).center().visible(false).build();
            if let Err(e) = built { eprintln!("capture window: {e}"); return; }
        }
        let Some(w) = app.get_webview_window(CAPTURE) else { return };
        w.show().ok();
        w.set_focus().ok();
        app.emit_to(CAPTURE, "capture-open", ()).ok();
    }).ok();
}
/// The capture window out of the way (Esc, or after Save): what was typed stays for the next time unless it was saved.
#[tauri::command]
pub fn quick_capture_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(CAPTURE) { w.hide().ok(); }
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
                    os::remember();
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
    let key = capture_shortcut(&settings);
    let opened = shortcuts.on_shortcut(key.as_str(), |app, _, event| { if event.state == ShortcutState::Pressed { open_capture(app); } });
    if let Err(e) = opened { eprintln!("capture: shortcut {key}: {e}"); }
}

/// Settings records a new shortcut (Voice, Shortcuts): the registered ones and the menu bar's step aside until it is
/// done.
#[tauri::command]
pub fn dictation_pause_shortcuts(app: AppHandle, paused: bool) {
    *PAUSED.lock().unwrap() = paused;
    apply(&app);
    super::refresh_menu(&app);
}
pub fn paused() -> bool { *PAUSED.lock().unwrap() }

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
            let w = super::windows::show_active(&a);
            a.emit_to(w, "dictated-chat", text).ok();
        }
        Ok(text) => {
            let pasted = os::trusted();
            let b = a.clone();
            a.run_on_main_thread(move || os::paste(&b, text, pasted)).ok();
            if pasted { pill(&a, json!({ "phase": "hidden" })) } else { pill_for(&a, json!({ "phase": "copied" })) }
        }
        Err(e) => pill_for(&a, json!({ "phase": "error", "error": e })),
    });
}

/// Whether Relay may send keys to other apps (System Settings › Privacy & Security › Accessibility). Always on Windows.
#[tauri::command]
pub fn dictation_access() -> bool { os::trusted() }
/// Asks macOS for Accessibility: its dialog, which opens the pane. Answers whether it is already allowed.
#[tauri::command]
pub fn dictation_ask_access() -> bool { os::ask() }

#[cfg(target_os = "macos")]
mod os {
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
    /// Nothing to keep: the pill never takes the focus and macOS gives it back to the app in front.
    pub fn remember() {}
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

/// Windows: Ctrl+V through SendInput, which needs no permission. The window in front when the shortcut went down gets
/// the focus back first (the pill never takes it, but a click elsewhere meanwhile would), and the clipboard is saved
/// and restored with every format that is plain memory.
#[cfg(windows)]
mod os {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::Foundation::{GlobalFree, HWND};
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};

    const CF_UNICODETEXT: u32 = 13;
    // the window in front when the shortcut went down, as an address (HWND is a pointer, not Send)
    static FRONT: Mutex<usize> = Mutex::new(0);

    pub fn trusted() -> bool { true }
    pub fn ask() -> bool { true }
    pub fn remember() { *FRONT.lock().unwrap() = unsafe { GetForegroundWindow() } as usize; }

    /// Puts `text` on the clipboard, brings the remembered window back, sends Ctrl+V and puts the clipboard back once
    /// the app read it, unless something else was copied meanwhile. Waits on a thread of its own, not the main one.
    pub fn paste(app: &AppHandle, text: String, _: bool) {
        // the clipboard's owner: the pill, which is there while it transcribes
        let owner = app.get_webview_window(super::PILL).and_then(|w| w.hwnd().ok()).map_or(0, |h| h.0 as usize);
        let front = std::mem::take(&mut *FRONT.lock().unwrap());
        std::thread::spawn(move || {
            let owner = owner as HWND;
            let Some(saved) = with_clipboard(owner, || unsafe {
                let saved = save();
                EmptyClipboard();
                put(CF_UNICODETEXT, &text.encode_utf16().chain(Some(0)).flat_map(u16::to_le_bytes).collect::<Vec<_>>());
                saved
            }) else { return eprintln!("dictation: the clipboard is busy, nothing pasted") };
            let ours = unsafe { GetClipboardSequenceNumber() };
            let front = front as HWND;
            if !front.is_null() && unsafe { IsWindow(front) != 0 && GetForegroundWindow() != front } {
                // ponytail: Windows refuses this unless Relay may take the foreground (it got the last input, the
                // hotkey), else the text goes where the focus is now. AttachThreadInput is the next step if that bites.
                unsafe { SetForegroundWindow(front) };
                std::thread::sleep(Duration::from_millis(50));
            }
            released();
            control_v();
            std::thread::sleep(Duration::from_millis(400));
            if unsafe { GetClipboardSequenceNumber() } == ours {
                with_clipboard(owner, || unsafe {
                    EmptyClipboard();
                    for (format, bytes) in &saved { put(*format, bytes); }
                });
            }
        });
    }

    /// Runs `f` with the clipboard open, trying for half a second while another app holds it.
    fn with_clipboard<T>(owner: HWND, f: impl FnOnce() -> T) -> Option<T> {
        for _ in 0..50 {
            if unsafe { OpenClipboard(owner) } != 0 {
                let out = f();
                unsafe { CloseClipboard() };
                return Some(out);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }

    /// Every format on the clipboard whose data is plain memory, as bytes. The clipboard is open.
    unsafe fn save() -> Vec<(u32, Vec<u8>)> {
        let mut saved = vec![];
        let mut format = EnumClipboardFormats(0);
        while format != 0 {
            let handle = if super::plain_memory(format) { GetClipboardData(format) } else { std::ptr::null_mut() };
            let data = if handle.is_null() { std::ptr::null_mut() } else { GlobalLock(handle) };
            if !data.is_null() {
                saved.push((format, std::slice::from_raw_parts(data as *const u8, GlobalSize(handle)).to_vec()));
                GlobalUnlock(handle);
            }
            format = EnumClipboardFormats(format);
        }
        saved
    }
    /// One format onto the open clipboard, which owns the memory after.
    unsafe fn put(format: u32, bytes: &[u8]) {
        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        let data = if handle.is_null() { return } else { GlobalLock(handle) };
        if data.is_null() { GlobalFree(handle); return; }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), data as *mut u8, bytes.len());
        GlobalUnlock(handle);
        if SetClipboardData(format, handle).is_null() { GlobalFree(handle); }
    }

    /// Waits up to a second for the shortcut's modifiers to come up: Ctrl+V with Alt or Shift still held would be
    /// another key.
    fn released() {
        let start = Instant::now();
        let down = || [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN].iter().any(|k| unsafe { GetAsyncKeyState(*k as i32) } < 0);
        while down() && start.elapsed() < Duration::from_secs(1) { std::thread::sleep(Duration::from_millis(20)); }
    }
    fn control_v() {
        let key = |vk, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, ..Default::default() } },
        };
        let keys = [key(VK_CONTROL, false), key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)];
        unsafe { SendInput(keys.len() as u32, keys.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    }
}

/// Whether a clipboard format holds plain memory (an HGLOBAL), so a copy of its bytes restores it. GDI handles
/// (bitmaps, metafiles, palettes, a program's private GDI objects) and owner-drawn formats do not: they are left
/// out, and Windows makes CF_BITMAP from CF_DIB again.
#[cfg_attr(not(windows), allow(dead_code))]
fn plain_memory(format: u32) -> bool {
    // CF_BITMAP, CF_METAFILEPICT, CF_PALETTE, CF_ENHMETAFILE, CF_OWNERDISPLAY, CF_DSPBITMAP, CF_DSPMETAFILEPICT,
    // CF_DSPENHMETAFILE, then CF_GDIOBJFIRST to CF_GDIOBJLAST
    !matches!(format, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E) && !(0x300..=0x3FF).contains(&format)
}

#[cfg(not(any(target_os = "macos", windows)))]
mod os {
    pub fn trusted() -> bool { false }
    pub fn ask() -> bool { false }
    pub fn remember() {}
    pub fn paste(_: &tauri::AppHandle, _: String, _: bool) {}
}
#[cfg(test)]
mod tests {
    use super::{capture_shortcut, keys, wanted, Target, KEYS};
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
    #[test]
    fn the_capture_key_parses_and_a_saved_one_wins() {
        assert!(capture_shortcut(&json!({})).parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok());
        assert_eq!(capture_shortcut(&json!({})), KEYS.capture);
        assert_eq!(capture_shortcut(&json!({"shortcuts": {"app.capture": ["shift+meta+KeyJ"]}})), "shift+super+KeyJ");
        assert_eq!(capture_shortcut(&json!({"shortcuts": {"app.capture": [""]}})), KEYS.capture);
    }
    #[test]
    fn each_platform_has_its_own_defaults_and_windows_none_of_its_own_keys() {
        assert_eq!(keys(false), super::Keys { chat: "alt+shift+Space", paste: "ctrl+alt+Space", capture: "ctrl+alt+super+KeyN" });
        for windows in [false, true] {
            let k = keys(windows);
            let all = [k.chat, k.paste, k.capture];
            for key in all { assert!(key.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok(), "{key}"); }
            assert!(all[0] != all[1] && all[1] != all[2] && all[0] != all[2]);
            if windows {
                // no Win key, no Alt+Space (the window menu), no Alt+Shift (the keyboard switch)
                for key in all { assert!(!key.contains("super") && !key.starts_with("alt+"), "{key}"); }
            }
        }
    }
    #[test]
    fn only_plain_memory_formats_are_kept_aside() {
        // CF_TEXT, CF_DIB, CF_UNICODETEXT, CF_HDROP, a registered format such as HTML Format
        for format in [1, 8, 13, 15, 0xC0FF] { assert!(super::plain_memory(format), "{format}"); }
        // CF_BITMAP, CF_ENHMETAFILE, CF_OWNERDISPLAY, private GDI objects
        for format in [2, 14, 0x80, 0x300, 0x3FF] { assert!(!super::plain_memory(format), "{format}"); }
    }
}
