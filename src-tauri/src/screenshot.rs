// `relay --screenshot <file.png>`: Relay starts, draws for a few seconds, saves a picture of its window as a PNG and
// quits; Craft Anything checks a build this way. It must never touch the person's own Relay, so main.rs gives it a
// home folder of its own (a fresh one in the temp folder: no settings, no vault, so the first-run screen), the window
// keeps its storage in memory and takes no focus (windows.rs `open_main`), and setup starts none of the background work
// (sync, agents, machines, shortcuts, the tray).

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};

static TARGET: OnceLock<PathBuf> = OnceLock::new();

/// Where the picture goes, when this run is one.
pub fn target() -> Option<&'static PathBuf> { TARGET.get() }

/// What a `--screenshot <file>` in the arguments asks for, as an absolute path (relative to `cwd`).
pub fn asked(args: &[String], cwd: &std::path::Path) -> Option<PathBuf> {
    let at = args.iter().position(|a| a == "--screenshot")?;
    let file = PathBuf::from(args.get(at + 1)?);
    Some(if file.is_absolute() { file } else { cwd.join(file) })
}

/// Make this run a picture run: a home of its own, so nothing of the person's Relay is read or written. Call before
/// anything else runs (main, single-threaded).
pub fn prepare(out: PathBuf) {
    let home = std::env::temp_dir().join(format!("relay-screenshot-{}", std::process::id()));
    std::fs::create_dir_all(&home).ok();
    std::env::set_var("HOME", &home);
    #[cfg(windows)]
    { std::env::set_var("USERPROFILE", &home); std::env::set_var("APPDATA", home.join("AppData/Roaming")); std::env::set_var("LOCALAPPDATA", home.join("AppData/Local")); }
    TARGET.set(out).ok();
    #[cfg(debug_assertions)]
    dev_pages();
}

/// A development build loads its pages from the dev server (`devUrl`, http://localhost:1420). For a picture without
/// one running, serve the built pages (`dist`, from `pnpm build`) there; with a dev server up, it keeps them.
#[cfg(debug_assertions)]
fn dev_pages() {
    use std::io::{BufRead, BufReader, Write};
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist");
    for addr in ["127.0.0.1:1420", "[::1]:1420"] {
        let Ok(listener) = std::net::TcpListener::bind(addr) else { continue };
        let dist = dist.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let dist = dist.clone();
                std::thread::spawn(move || {
                    let mut line = String::new();
                    let mut reader = BufReader::new(&stream);
                    if reader.read_line(&mut line).is_err() { return; }
                    // the rest of the request's head
                    let mut h = String::new();
                    while reader.read_line(&mut h).is_ok_and(|n| n > 2) { h.clear(); }
                    let asked = line.split_whitespace().nth(1).unwrap_or("/").split(['?', '#']).next().unwrap_or("/");
                    let rel = asked.trim_start_matches('/');
                    let rel = if rel.is_empty() || rel.split('/').any(|p| p == "..") { "index.html" } else { rel };
                    let file = dist.join(rel);
                    let file = if file.is_file() { file } else { dist.join("index.html") };
                    let (status, body) = match std::fs::read(&file) { Ok(b) => ("200 OK", b), Err(_) => ("404 Not Found", vec![]) };
                    let kind = match file.extension().and_then(|e| e.to_str()).unwrap_or("") {
                        "html" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript", "css" => "text/css",
                        "svg" => "image/svg+xml", "png" => "image/png", "woff2" => "font/woff2", "json" => "application/json",
                        "wasm" => "application/wasm", _ => "application/octet-stream",
                    };
                    let mut out = &stream;
                    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    out.write_all(head.as_bytes()).and_then(|_| out.write_all(&body)).ok();
                });
            }
        });
    }
}

/// About 120 frames after the page loads (a few seconds: the app's start-up calls settle first), the main window's
/// picture to `out`, then quit. A failure quits too, with the reason, so a check never waits on it.
pub fn take(app: AppHandle, out: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(6));
        let shot = app.get_webview_window("main").ok_or("no main window".to_string())
            .and_then(|w| crate::design::snapshot(w.as_ref()))
            .and_then(|png| {
                if let Some(dir) = out.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
                std::fs::write(&out, png).map_err(|e| e.to_string())
            });
        let code = match shot { Ok(()) => 0, Err(e) => { eprintln!("screenshot: {e}"); 1 } };
        // its own home goes with it
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from).filter(|h| h.starts_with(std::env::temp_dir())) { std::fs::remove_dir_all(home).ok(); }
        app.exit(code);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_picture_path_comes_from_the_argument_after_the_flag() {
        let cwd = std::path::Path::new("/work");
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(asked(&a(&["relay", "--screenshot", "shots/now.png"]), cwd), Some(PathBuf::from("/work/shots/now.png")));
        assert_eq!(asked(&a(&["relay", "--screenshot", "/tmp/a.png"]), cwd), Some(PathBuf::from("/tmp/a.png")));
        assert_eq!(asked(&a(&["relay", "--screenshot"]), cwd), None);
        assert_eq!(asked(&a(&["relay"]), cwd), None);
    }
}
