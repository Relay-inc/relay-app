// The native claude.ai webview the Artifact drawer shows a live page in (artifacts.ts: liveShow, liveBounds, liveHide).
// An iframe cannot hold it (claude.ai sends `frame-ancestors 'self'`), so the page is its own child webview, placed by
// the UI from the drawer's bounds. The sign-in cookies live in the webview's own store.
//
// ponytail: a native webview sits above the DOM, so a Relay popover or modal over the drawer is hidden behind it.
// It is only hidden when the drawer closes (design_hide); hide it while an overlay is open if that gets in the way.

use std::sync::mpsc;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};

const LABEL: &str = "design";

/// Hosts the live webview may navigate to (and open a sign-in popup on): claude.ai, the sandbox the artifact runs
/// in, Google sign-in and Cloudflare's challenge.
pub fn host_ok(url: &Url) -> bool {
    let Some(h) = url.host_str() else { return false };
    let under = |d: &str| h == d || h.ends_with(&format!(".{d}"));
    // hcaptcha.com: claude.ai's sign-in checks the browser in an hCaptcha frame
    url.scheme() == "https"
        && (under("claude.ai") || under("claudeusercontent.com") || under("hcaptcha.com") || h == "accounts.google.com" || h == "challenges.cloudflare.com")
}
/// Whether a webview label is the live webview.
pub fn is_design(label: &str) -> bool { label == LABEL }

/// wry's popup window (`NewWindowResponse::Allow`) ignores `window.close()`: its WKWebView has no UI delegate, and
/// Google's sign-in closes the popup itself once claude.ai has the answer. `watch` gives every such window (a WKWebView
/// as content view, no UI delegate; Relay's own webviews all have wry's) a delegate that closes it.
#[cfg(target_os = "macos")]
mod popup {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, ClassType, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::NSApplication;
    use objc2_web_kit::{WKUIDelegate, WKWebView};

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "RelayDesignPopupCloser"]
        struct Closer;

        unsafe impl NSObjectProtocol for Closer {}

        unsafe impl WKUIDelegate for Closer {
            #[unsafe(method(webViewDidClose:))]
            fn did_close(&self, web_view: &WKWebView) {
                if let Some(w) = web_view.window() { w.close(); }
            }
        }
    );

    thread_local! {
        // WebKit holds its UI delegate weakly: one closer, alive for the app's life
        static CLOSER: Retained<Closer> = unsafe { msg_send![Closer::class(), new] };
    }

    pub fn watch() {
        let Some(mtm) = MainThreadMarker::new() else { return };
        for window in NSApplication::sharedApplication(mtm).windows() {
            let Some(wk) = window.contentView().and_then(|v| v.downcast::<WKWebView>().ok()) else { continue };
            if unsafe { wk.UIDelegate() }.is_none() {
                CLOSER.with(|c| unsafe { wk.setUIDelegate(Some(ProtocolObject::from_ref(&**c))) });
            }
        }
    }
}
/// WebView2: wry 0.57 answers `Allow` with `SetHandled(false)` on `NewWindowRequested`, so WebView2 opens and owns its
/// default popup window (the opener's profile and cookies, `window.opener` intact) and handles its `window.close()`.
/// If a sign-in popup stays open on Windows, close it here from its `WindowCloseRequested`.
#[cfg(not(target_os = "macos"))]
mod popup { pub fn watch() {} }

/// The drawer is narrow: once per page load, collapse claude.ai's sidebar and expand the canvas over its chat
/// (the same buttons a person presses; they can open both again). The chat stays in the page, only hidden.
/// ponytail: claude.ai's own selectors (sidebar toggle by its Cmd+B shortcut, the canvas expand button by test id);
/// when claude.ai changes them this does nothing and the page shows as is.
const COMPACT: &str = r#"(() => {
  if (location.hostname !== "claude.ai") return;
  let sidebar = false, chat = false, tries = 0;
  const t = setInterval(() => {
    const side = document.querySelector('aside button[aria-keyshortcuts="Meta+b"]');
    if (!sidebar && side && side.closest("aside").getBoundingClientRect().width > 100) { side.click(); sidebar = true; }
    const expand = document.querySelector('[data-testid="frame-artifact-header-expand"]');
    if (!chat && expand) { expand.click(); chat = true; }
    if ((sidebar && chat) || ++tries > 40) clearInterval(t);
  }, 500);
})();"#;

fn claude_url(s: &str) -> Result<Url, String> {
    let u: Url = s.trim().parse().map_err(|_| format!("not a link: {s}"))?;
    if u.scheme() == "https" && u.host_str() == Some("claude.ai") { Ok(u) } else { Err(format!("not a claude.ai link: {s}")) }
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w, h).into() }
}

#[tauri::command]
pub fn design_show(app: AppHandle, window: tauri::Window, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let url = claude_url(&url)?;
    if let Some(view) = app.get_webview(LABEL) {
        // one live webview: it moves to the Relay window that opens the drawer
        if view.window().label() != window.label() { view.reparent(&window).map_err(|e| e.to_string())?; }
        if view.url().map_err(|e| e.to_string())? != url { view.navigate(url).map_err(|e| e.to_string())?; }
        view.set_bounds(rect(x, y, w, h)).map_err(|e| e.to_string())?;
        return view.show().map_err(|e| e.to_string());
    }
    // Google sign-in opens a popup that talks back through window.opener. It is a plain window wry makes from the
    // opener's configuration (`Allow`): a Tauri window (`Create`) aborts the app, because that configuration shares
    // the live webview's script handlers and wry adds Tauri's `ipc` handler a second time (wry 0.57, WebKit throws).
    // The popup is not a Tauri webview (no IPC, no navigation guard); popup::watch makes its `window.close()` work.
    // Anything off the allowed hosts goes to the browser.
    let handle = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url)).initialization_script(COMPACT).on_new_window(move |url, _| {
        if !host_ok(&url) {
            if matches!(url.scheme(), "http" | "https") { tauri_plugin_opener::open_url(url.as_str(), None::<&str>).ok(); }
            return NewWindowResponse::Deny;
        }
        // wry makes the window after this returns: from another thread, run_on_main_thread queues behind it
        let h = handle.clone();
        std::thread::spawn(move || { h.run_on_main_thread(popup::watch).ok(); });
        NewWindowResponse::Allow
    });
    window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn design_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    app.get_webview(LABEL).map_or(Ok(()), |v| v.set_bounds(rect(x, y, w, h)).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn design_hide(app: AppHandle) -> Result<(), String> {
    app.get_webview(LABEL).map_or(Ok(()), |v| v.hide().map_err(|e| e.to_string()))
}

/// A picture of a webview as PNG (the `--screenshot` flag, screenshot.rs).
#[cfg(target_os = "macos")]
pub(crate) fn snapshot(view: &Webview) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
    view.with_webview(move |w| {
        use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
        use objc2_foundation::{NSDictionary, NSError};
        use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
        // SAFETY: inner() is the WKWebView, and this runs on the main thread
        let wk = unsafe { &*w.inner().cast::<WKWebView>() };
        let done = block2::RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
            let png = unsafe { image.as_ref() }.and_then(|i| i.TIFFRepresentation()).and_then(|t| NSBitmapImageRep::imageRepWithData(&t))
                .and_then(|r| unsafe { r.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }).map(|d| d.to_vec());
            tx.send(png).ok();
        });
        unsafe { wk.takeSnapshotWithConfiguration_completionHandler(Some(&WKSnapshotConfiguration::new(objc2_foundation::MainThreadMarker::new().expect("main thread"))), &done) };
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15)).map_err(|_| "no snapshot in time".to_string())?.ok_or_else(|| "the snapshot failed".to_string())
}
/// WebView2's `CapturePreview` writes a PNG of the visible page into a memory stream, read back once it completes.
#[cfg(windows)]
pub(crate) fn snapshot(view: &Webview) -> Result<Vec<u8>, String> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    view.with_webview(move |w| {
        let start = || -> windows::core::Result<()> {
            // SAFETY: COM calls on the webview's own (main) thread, the stream owns its memory
            unsafe {
                let stream = CreateStreamOnHGlobal(Default::default(), true)?;
                let out = stream.clone();
                let tx = tx.clone();
                let done = CapturePreviewCompletedHandler::create(Box::new(move |r| {
                    tx.send(r.and_then(|_| stream_bytes(&out)).map_err(|e| e.to_string())).ok();
                    Ok(())
                }));
                w.controller().CoreWebView2()?.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &done)
            }
        };
        if let Err(e) = start() { tx.send(Err(e.to_string())).ok(); }
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15)).map_err(|_| "no snapshot in time".to_string())?.map_err(|e| format!("the snapshot failed: {e}"))
}
/// The whole of a memory stream, from its start.
#[cfg(windows)]
unsafe fn stream_bytes(s: &windows::Win32::System::Com::IStream) -> windows::core::Result<Vec<u8>> {
    use windows::Win32::System::Com::{STREAM_SEEK_END, STREAM_SEEK_SET};
    let mut len = 0u64;
    s.Seek(0, STREAM_SEEK_END, Some(&mut len))?;
    s.Seek(0, STREAM_SEEK_SET, None)?;
    let mut buf = vec![0u8; len as usize];
    let mut read = 0u32;
    s.Read(buf.as_mut_ptr().cast(), len as u32, Some(&mut read)).ok()?;
    buf.truncate(read as usize);
    Ok(buf)
}
#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn snapshot(_: &Webview) -> Result<Vec<u8>, String> { Err("snapshots are macOS and Windows only".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn ok(s: &str) -> bool { host_ok(&s.parse().unwrap()) }
    #[test]
    fn only_claude_google_and_cloudflare_hosts() {
        assert!(ok("https://claude.ai/artifact/x?sk=1"));
        assert!(ok("https://www.claude.ai/"));
        assert!(ok("https://abc.claudeusercontent.com/x"));
        assert!(ok("https://accounts.google.com/o/oauth2/auth"));
        assert!(ok("https://challenges.cloudflare.com/turnstile"));
        assert!(ok("https://newassets.hcaptcha.com/captcha/v1/x"));
        assert!(!ok("http://claude.ai/"));
        assert!(!ok("https://evilclaude.ai/"));
        assert!(!ok("https://claude.ai.evil.com/"));
        assert!(!ok("https://google.com/"));
        assert!(claude_url("https://claude.ai/artifact/x").is_ok());
        assert!(claude_url("https://www.claude.ai/x").is_err());
        assert!(claude_url("https://example.com/").is_err());
    }
}
