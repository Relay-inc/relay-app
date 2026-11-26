// The Artifact drawer's local preview: a page Claude Code published as a claude.ai Artifact, served from the file it
// was published from, in a sandboxed frame that cannot reach Relay. Only what the parser saw published is served
// (agent_claude::stream::published): the page, and files of a served type in its folder. The policy is the Artifact
// page contract's: scripts from the CDNs it names, stylesheets from Google Fonts, everything else from the page's folder.

use crate::attach::{mime_of, pct_decode};
use std::path::Path;

/// The page contract's sources, as a frame policy: no network but the CDNs and fonts, pictures from anywhere (pages
/// show photos by URL), no frame of Relay's own.
const CSP: &str = "default-src 'self' relay-artifact: data: blob:; \
script-src 'self' relay-artifact: 'unsafe-inline' 'unsafe-eval' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
style-src 'self' relay-artifact: 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; \
font-src 'self' relay-artifact: data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; \
img-src * data: blob:; media-src 'self' relay-artifact: data: blob: https:; \
connect-src 'self' relay-artifact: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; \
frame-src 'self' relay-artifact: data: blob:; frame-ancestors *";

/// The content type of a served file: the web types an Artifact serves, the rest as the attachments know them.
fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("json" | "map" | "geojson" | "webmanifest") => "application/json; charset=utf-8",
        // ponytail: a Markdown page shows as its text here; the live page renders it
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        Some("xml") => "application/xml",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => mime_of(path),
    }
}

/// A page with the viewer's theme on its root, as Claude's frame kernel sets it for light or dark (kernel.js `Xt`/`Pe`:
/// `dataset.theme` and `style.colorScheme`; for "system" it sets neither and the page follows the Mac), so a page that
/// follows the contract shows in Relay's light or dark. A root that has a style of its own keeps it.
pub fn themed(html: &str, theme: &str) -> String {
    let lower = html.to_ascii_lowercase();
    if let Some(at) = lower.find("<html").filter(|&i| matches!(lower.as_bytes().get(i + 5), Some(b' ' | b'>' | b'\n' | b'\t' | b'\r'))) {
        let tag_end = lower[at..].find('>').map_or(lower.len(), |i| at + i);
        let styled = lower[at..tag_end].contains("style=");
        let scheme = if styled { String::new() } else { format!(" style=\"color-scheme: {theme}\"") };
        return format!("{} data-theme=\"{theme}\"{scheme}{}", &html[..at + 5], &html[at + 5..]);
    }
    // the contract lets a page leave out the skeleton: the viewer wraps it
    let after = if lower.trim_start().starts_with("<!doctype") { lower.find('>').map_or(0, |i| i + 1) } else { 0 };
    format!("{}<html data-theme=\"{theme}\" style=\"color-scheme: {theme}\">{}</html>", &html[..after], &html[after..])
}

/// `relay-artifact://localhost/<absolute path, each part percent-encoded>[?theme=light|dark|system]`; "system" (or none)
/// leaves the page as written, as Claude's kernel does.
pub fn serve(uri_path: &str, query: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    let answer = |status: u16| tauri::http::Response::builder().status(status).header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store").header("Access-Control-Allow-Origin", "*");
    let asked = pct_decode(uri_path);
    let Some(path) = agent_claude::stream::published(Path::new(&asked)) else { return answer(404).body(vec![]).unwrap() };
    let Ok(mut body) = std::fs::read(&path) else { return answer(500).body(vec![]).unwrap() };
    let name = path.to_string_lossy();
    let kind = content_type(&name);
    let theme = query.into_iter().flat_map(|q| q.split('&')).find_map(|kv| kv.strip_prefix("theme=")).filter(|t| matches!(*t, "light" | "dark"));
    if let (Some(theme), true) = (theme, kind.starts_with("text/html")) {
        body = themed(&String::from_utf8_lossy(&body), theme).into_bytes();
    }
    answer(200).header("Content-Type", kind).header("Content-Security-Policy", CSP).body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_theme_goes_on_the_root_with_or_without_a_skeleton() {
        assert_eq!(themed("<!doctype html><html lang=\"en\"><body>x", "dark"), "<!doctype html><html data-theme=\"dark\" style=\"color-scheme: dark\" lang=\"en\"><body>x");
        assert_eq!(themed("<HTML><body>x", "light"), "<HTML data-theme=\"light\" style=\"color-scheme: light\"><body>x");
        // a root with its own style keeps it: a second style attribute would be ignored anyway
        assert_eq!(themed("<html style=\"--a:1\">x", "dark"), "<html data-theme=\"dark\" style=\"--a:1\">x");
        assert_eq!(themed("<!DOCTYPE html>\n<title>A</title>", "dark"), "<!DOCTYPE html><html data-theme=\"dark\" style=\"color-scheme: dark\">\n<title>A</title></html>");
        assert_eq!(themed("<div>x</div>", "dark"), "<html data-theme=\"dark\" style=\"color-scheme: dark\"><div>x</div></html>");
        // an <htmlfoo> tag is not the root
        assert_eq!(themed("<htmlish>", "dark"), "<html data-theme=\"dark\" style=\"color-scheme: dark\"><htmlish></html>");
    }

    #[test]
    fn nothing_unpublished_is_served() {
        assert_eq!(serve("/etc/hosts", None).status(), 404);
        assert_eq!(serve(&format!("{}/Library/Keychains/x.html", std::env::var("HOME").unwrap_or_default()), None).status(), 404);
    }
}
