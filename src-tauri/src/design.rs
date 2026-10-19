// The Design drawer: a claude.ai artifact (Claude Design) in a native child webview over the drawer body. An iframe
// cannot hold it (claude.ai sends `frame-ancestors 'self'`), so the page is its own webview, placed by the UI from
// the drawer's bounds. The sign-in cookies live in the webview's own store. Links are kept per project in the
// vault's .relay/config.json (`designs`).
//
// ponytail: a native webview sits above the DOM, so a Relay popover or modal over the drawer is hidden behind it.
// It is only hidden when the drawer closes (design_hide); hide it while an overlay is open if that gets in the way.

use crate::{need_vault, relay_config, App};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, State, Url, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "design";
const POPUP: &str = "design-popup";

/// Hosts the Design webview and its sign-in popup may navigate to: claude.ai, the sandbox the artifact runs in,
/// Google sign-in and Cloudflare's challenge.
pub fn host_ok(url: &Url) -> bool {
    let Some(h) = url.host_str() else { return false };
    let under = |d: &str| h == d || h.ends_with(&format!(".{d}"));
    // hcaptcha.com: claude.ai's sign-in checks the browser in an hCaptcha frame
    url.scheme() == "https"
        && (under("claude.ai") || under("claudeusercontent.com") || under("hcaptcha.com") || h == "accounts.google.com" || h == "challenges.cloudflare.com")
}
/// Whether a webview label is the Design webview or its popup.
pub fn is_design(label: &str) -> bool { label == LABEL || label == POPUP }
/// Whether a Design navigation may load. The sign-in popup may go anywhere on https: Google's sign-in passes
/// through several of its hosts, and the popup is a plain page with no access to Relay.
pub fn nav_ok(label: &str, url: &Url) -> bool { host_ok(url) || (label == POPUP && url.scheme() == "https") }

/// wry does not close a window on `window.close()` (macOS), and Google's sign-in popup closes itself to tell
/// claude.ai it is done: the popup's `window.close()` navigates here instead, and the guard closes the window.
const CLOSE_URL: &str = "https://relay-design.invalid/close";
pub fn is_close(url: &Url) -> bool { url.host_str() == Some("relay-design.invalid") }

fn claude_url(s: &str) -> Result<Url, String> {
    let u: Url = s.trim().parse().map_err(|_| format!("not a link: {s}"))?;
    if u.scheme() == "https" && u.host_str() == Some("claude.ai") { Ok(u) } else { Err(format!("not a claude.ai link: {s}")) }
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w, h).into() }
}

#[tauri::command]
pub fn design_show(app: AppHandle, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let url = claude_url(&url)?;
    if let Some(view) = app.get_webview(LABEL) {
        if view.url().map_err(|e| e.to_string())? != url { view.navigate(url).map_err(|e| e.to_string())?; }
        view.set_bounds(rect(x, y, w, h)).map_err(|e| e.to_string())?;
        return view.show().map_err(|e| e.to_string());
    }
    let window = app.get_window("main").ok_or("no main window")?;
    let handle = app.clone();
    // Google sign-in opens a popup that talks back through window.opener: it has to be a real window made from the
    // opener's own features (`Create`), not a navigation of this webview. Anything else goes to the browser.
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url)).on_new_window(move |url, features| {
        if !host_ok(&url) {
            if matches!(url.scheme(), "http" | "https") { tauri_plugin_opener::open_url(url.as_str(), None::<&str>).ok(); }
            return NewWindowResponse::Deny;
        }
        if let Some(old) = handle.get_webview_window(POPUP) { old.close().ok(); }
        match WebviewWindowBuilder::new(&handle, POPUP, WebviewUrl::External("about:blank".parse().unwrap()))
            .window_features(features)
            .initialization_script(format!("window.close = () => {{ location.href = '{CLOSE_URL}'; }};"))
            .on_document_title_changed(|w, title| { w.set_title(&title).ok(); })
            .title(url.as_str())
            .build()
        {
            Ok(window) => NewWindowResponse::Create { window },
            Err(_) => NewWindowResponse::Deny,
        }
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

/// A project's saved Design link, "" for none.
#[tauri::command]
pub fn design_link(state: State<App>, project: String) -> Result<String, String> {
    Ok(relay_config::design(&need_vault(&state)?, &project))
}
/// Save a project's Design link ("" removes it).
#[tauri::command]
pub fn set_design_link(state: State<App>, project: String, url: String) -> Result<(), String> {
    let url = url.trim();
    if !url.is_empty() { claude_url(url)?; }
    relay_config::set_design(&need_vault(&state)?, &project, url)
}

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
        let u = |s: &str| s.parse::<Url>().unwrap();
        assert!(nav_ok(POPUP, &u("https://accounts.youtube.com/x")));
        assert!(!nav_ok(LABEL, &u("https://accounts.youtube.com/x")));
        assert!(is_close(&u(CLOSE_URL)));
        assert!(!ok("http://claude.ai/"));
        assert!(!ok("https://evilclaude.ai/"));
        assert!(!ok("https://claude.ai.evil.com/"));
        assert!(!ok("https://google.com/"));
        assert!(claude_url("https://claude.ai/artifact/x").is_ok());
        assert!(claude_url("https://www.claude.ai/x").is_err());
        assert!(claude_url("https://example.com/").is_err());
    }
}
