// Board integrations, the host side. Each tracker is a crate in packages/ (integration-productive, -trello,
// -linear) that exports a board_core::Provider: where its API lives, which calls the webview may make, how the
// secrets are sent and how an error reads. This module registers them (PROVIDERS, the one place) and does the
// part they share: the secrets live in the macOS keychain under `vault-app.<id>` (one entry per name in
// `secrets`), go to `security` and curl over stdin, never as an argument (visible in the process list), and
// never go back to a webview. The rest of a provider's config is in settings.json under `integrations.<id>`.
// Listing, moving and mapping cards is the webview's side (the same packages, src/providers/index.ts).

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

use crate::{trc, trc_v};

pub use board_core::Provider;

/// Every integration, in the order of the sidebar: a new one is one line here and one in src/providers/index.ts.
pub const PROVIDERS: &[&Provider] = &[
    &integration_productive::PROVIDER,
    &integration_trello::PROVIDER,
    &integration_linear::PROVIDER,
];

pub fn get(id: &str) -> Result<&'static Provider, String> {
    PROVIDERS.iter().copied().find(|p| p.id == id).ok_or_else(|| trc_v("err.no_provider", id))
}

/// A settings value for the old layout, where the Productive ids sat at the top as `productive`,
/// moved to `integrations.productive`. Switched on: it showed whenever it was set up.
pub fn migrate(v: &mut Value) {
    if !v["integrations"].is_object() { v["integrations"] = json!({}); }
    if let Some(old) = v.as_object_mut().and_then(|o| o.remove("productive")) {
        if !v["integrations"]["productive"].is_object() && old.is_object() {
            v["integrations"]["productive"] = json!({ "on": true, "org": old["org"], "user": old["user"] });
        }
    }
    for p in PROVIDERS {
        if !v["integrations"][p.id].is_object() { v["integrations"][p.id] = json!({}); }
        (p.defaults)(&mut v["integrations"][p.id]);
    }
    // per vault project at most one board: { provider, project, board }, dropped when malformed
    if !v["boards"].is_object() { v["boards"] = json!({}); }
    v["boards"].as_object_mut().unwrap().retain(|_, b| ["provider", "project", "board"].iter().all(|k| b[*k].is_string()));
}

/// Every provider config and board mapping in the settings, checked before they are saved.
pub fn check(s: &Value) -> Result<(), String> {
    for p in PROVIDERS { (p.check)(&s["integrations"][p.id])?; }
    for (name, b) in s["boards"].as_object().unwrap() {
        let ok = get(b["provider"].as_str().unwrap()).is_ok()
            && ["project", "board"].iter().all(|k| { let x = b[*k].as_str().unwrap(); x.len() <= 100 && x.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) });
        if !ok { return Err(trc_v("err.board_map", name)); }
    }
    Ok(())
}

// ---------- keychain

fn service(p: &Provider) -> String { format!("vault-app.{}", p.id) }
fn secret(p: &Provider, account: &str) -> Option<String> {
    let o = Command::new("/usr/bin/security").args(["find-generic-password", "-s", &service(p), "-a", account, "-w"]).output().ok()?;
    let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !t.is_empty()).then_some(t)
}
/// Every secret of the provider, in the order of `secrets`, or None when one is missing.
pub fn token(p: &Provider) -> Option<Vec<String>> { p.secrets.iter().map(|a| secret(p, a)).collect() }
/// Save one secret (`account` is one of the provider's `secrets`), or remove it when empty.
pub fn set_token(p: &Provider, account: &str, t: &str) -> Result<(), String> {
    if !p.secrets.contains(&account) { return Err(trc_v("err.call", p.name)); }
    if t.is_empty() {
        Command::new("/usr/bin/security").args(["delete-generic-password", "-s", &service(p), "-a", account]).output().map_err(|e| e.to_string())?;
        return Ok(());
    }
    if t.len() > 200 || !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(trc("err.token_chars"));
    }
    let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    writeln!(ch.stdin.take().unwrap(), "add-generic-password -U -s {} -a {account} -w {t}", service(p)).map_err(|e| e.to_string())?;
    ch.wait().map_err(|e| e.to_string())?;
    // `security -i` exits 0 even when the command inside failed, so read it back
    if secret(p, account).as_deref() == Some(t) { Ok(()) } else { Err(trc("err.keychain")) }
}

// ---------- one call

/// A value inside double quotes in a curl config file.
pub fn curl_quote(s: &str) -> String { format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")) }

/// One API call for the provider, blocking: the caller runs it off the main thread.
pub fn call(p: &Provider, cfg: &Value, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let url = (p.url)(cfg, method, path, &body).ok_or_else(|| trc_v("err.call", p.name))?;
    if !(p.ready)(cfg) { return Err(board_core::t(p.text, p.not_ready)); }
    let token = token(p).ok_or_else(|| trc_v("err.no_token", p.name))?;
    // globoff: the [ ] in filter[...] are not curl ranges
    let mut conf = format!("globoff\nurl = {}\nrequest = {method}\n", curl_quote(&url));
    for h in (p.headers)(cfg, &token) { conf += &format!("header = {}\n", curl_quote(&h)); }
    if let Some(b) = body { conf += &format!("data-binary = {}\n", curl_quote(&b.to_string())); }
    let mut ch = Command::new("/usr/bin/curl").args(["-sS", "--max-time", "20", "-K", "-", "-w", "\n%{http_code}"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    ch.stdin.take().unwrap().write_all(conf.as_bytes()).map_err(|e| e.to_string())?;
    let o = ch.wait_with_output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(trc_v("err.down", String::from_utf8_lossy(&o.stderr).trim()).replace("{p}", p.name)); }
    let out = String::from_utf8_lossy(&o.stdout);
    let (text, code) = out.rsplit_once('\n').unwrap_or(("", &out));
    // some APIs (Trello) answer an error as plain text: kept as a string, cut short
    let v: Value = serde_json::from_str(text).unwrap_or_else(|_| if text.trim().is_empty() { Value::Null } else { Value::String(text.trim().chars().take(200).collect()) });
    if code.starts_with('2') && (p.ok)(&v) { Ok(v) } else { Err((p.error)(code, &v)) }
}

/// A file posted as a form to a URL the provider's `upload` allows (an S3 policy: `fields` first, the file last, as S3
/// wants it). Trello uses its exact card attachment endpoint and backend-held credentials instead.
/// Linear uses a raw PUT with signed headers and no API key. Resolves with Location (or empty); callers reload the ticket.
pub fn upload(p: &Provider, url: &str, fields: &serde_json::Map<String, Value>, name: &str, mime: &str, data: &[u8]) -> Result<String, String> {
    // the URL and the fields come from the API's answer: a control character would start a new curl config line
    let clean = |s: &str| !s.chars().any(char::is_control);
    if !(p.upload)(url) || !clean(url) || !fields.iter().all(|(k, v)| clean(k) && v.as_str().map_or(true, clean)) { return Err(trc_v("err.call", p.name)); }
    let headers = if p.upload_kind == board_core::UploadKind::Trello {
        if !fields.is_empty() { return Err(trc_v("err.call", p.name)); }
        (p.headers)(&json!({}), &token(p).ok_or_else(|| trc_v("err.no_token", p.name))?).into_iter()
            .filter(|h| !h.to_ascii_lowercase().starts_with("content-type:")).collect()
    } else if p.upload_kind == board_core::UploadKind::Put {
        if !fields.iter().all(|(key, value)| {
            let key = key.to_ascii_lowercase();
            key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') &&
            (["content-type", "cache-control", "content-disposition"].contains(&key.as_str()) || key.starts_with("x-goog-") || key.starts_with("x-amz-")) && value.is_string()
        }) { return Err(trc_v("err.call", p.name)); }
        fields.iter().map(|(k, v)| format!("{k}: {}", v.as_str().unwrap())).collect()
    } else { vec![] };
    upload_file(p, url, fields, name, mime, data, &headers)
}

fn upload_file(p: &Provider, url: &str, fields: &serde_json::Map<String, Value>, name: &str, mime: &str, data: &[u8], headers: &[String]) -> Result<String, String> {
    let tmp = std::env::temp_dir().join(format!("relay-upload-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    // form-string: a value starting with @ or < stays text. The file name loses what would break curl's field syntax
    let mut conf = format!("url = {}\n", curl_quote(url));
    for h in headers { conf += &format!("header = {}\n", curl_quote(h)); }
    if p.upload_kind != board_core::UploadKind::Put {
        for (k, v) in fields { conf += &format!("form-string = {}\n", curl_quote(&format!("{k}={}", v.as_str().map_or_else(|| v.to_string(), str::to_string)))); }
        let safe = |s: &str| s.chars().map(|c| if c.is_control() || "\";\\".contains(c) { '_' } else { c }).collect::<String>();
        let field = if p.upload_kind == board_core::UploadKind::Trello { "file" } else { "File" };
        conf += &format!("form = {}\n", curl_quote(&format!("{field}=@\"{}\";type={};filename=\"{}\"", tmp.display(), safe(mime), safe(name))));
    } else {
        conf += &format!("request = PUT\ndata-binary = {}\n", curl_quote(&format!("@{}", tmp.display())));
    }
    let out = (|| {
        let mut ch = Command::new("/usr/bin/curl").args(["-sS", "--max-time", "120", "-K", "-", "-w", "\n%{http_code} %header{location}"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        ch.stdin.take().unwrap().write_all(conf.as_bytes()).map_err(|e| e.to_string())?;
        ch.wait_with_output().map_err(|e| e.to_string())
    })();
    std::fs::remove_file(&tmp).ok();
    let o = out?;
    if !o.status.success() { return Err(trc_v("err.down", String::from_utf8_lossy(&o.stderr).trim()).replace("{p}", p.name)); }
    let out = String::from_utf8_lossy(&o.stdout);
    let (body, tail) = out.rsplit_once('\n').unwrap_or(("", &out));
    let (code, location) = tail.split_once(' ').unwrap_or((tail, ""));
    if !code.starts_with('2') { return Err(format!("{} upload {code}: {}", p.name, body.trim().chars().take(200).collect::<String>())); }
    let xml = body.split_once("<Location>").and_then(|(_, r)| r.split_once("</Location>")).map(|(l, _)| l.replace("&amp;", "&"));
    Ok(if location.trim().is_empty() { xml.unwrap_or_default() } else { location.trim().to_string() })
}

/// A picture's preview for the card panel, as a data URL: the webview loads no outside images (CSP). Only from a URL the
/// provider's `thumb` allows, without the secrets and without following a redirect (one to a login page is no picture).
pub fn thumb(p: &Provider, url: &str) -> Result<String, String> {
    if !(p.thumb)(url) { return Err(trc_v("err.call", p.name)); }
    let mut ch = Command::new("/usr/bin/curl").args(["-sS", "--fail", "--proto", "=https", "--max-time", "30", "--max-filesize", "2097152", "-K", "-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    ch.stdin.take().unwrap().write_all(format!("url = {}\n", curl_quote(url)).as_bytes()).map_err(|e| e.to_string())?;
    let o = ch.wait_with_output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(trc_v("err.down", String::from_utf8_lossy(&o.stderr).trim()).replace("{p}", p.name)); }
    picture(&o.stdout).ok_or_else(|| format!("{}: not a picture", p.name))
}
/// Bytes as a data URL when they are a PNG, JPEG, GIF or WebP, told by their first bytes, not by what the server says.
fn picture(b: &[u8]) -> Option<String> {
    use base64::Engine;
    let mime = if b.starts_with(b"\x89PNG") { "image/png" } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) { "image/jpeg" }
        else if b.starts_with(b"GIF8") { "image/gif" } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" { "image/webp" } else { return None };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_pictures_become_data_urls() {
        assert!(picture(b"\x89PNG\r\n\x1a\n....").unwrap().starts_with("data:image/png;base64,"));
        assert!(picture(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().starts_with("data:image/jpeg"));
        assert!(picture(b"RIFF\0\0\0\0WEBPVP8 ").unwrap().starts_with("data:image/webp"));
        assert!(picture(b"<svg onload=x>").is_none() && picture(b"<!DOCTYPE html>").is_none());
    }
    #[test]
    fn upload_posts_the_fields_then_the_file_and_reads_location() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", l.local_addr().unwrap());
        let srv = std::thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            c.set_read_timeout(Some(std::time::Duration::from_millis(500))).unwrap();
            let (mut got, mut buf) = (vec![], [0u8; 4096]);
            while let Ok(n) = c.read(&mut buf) { if n == 0 { break; } got.extend_from_slice(&buf[..n]); if String::from_utf8_lossy(&got).contains("PNGDATA\r\n--") { break; } }
            c.write_all(b"HTTP/1.1 204 No Content\r\nLocation: https://b.s3.amazonaws.com/up/9\r\nContent-Length: 0\r\n\r\n").unwrap();
            String::from_utf8_lossy(&got).into_owned()
        });
        let mut p = integration_productive::PROVIDER;
        p.upload = |_| true;
        let fields: serde_json::Map<String, Value> = serde_json::from_value(json!({ "key": "up/9/x.png", "policy": "@/etc/passwd" })).unwrap();
        let bad: serde_json::Map<String, Value> = serde_json::from_value(json!({ "key": "x\noutput = /tmp/pwned" })).unwrap();
        assert!(upload(&p, &url, &bad, "x", "text/plain", b"x").is_err() && upload(&p, &format!("{url}\nurl = x"), &fields, "x", "text/plain", b"x").is_err());
        let at = upload(&p, &url, &fields, "a\"b;.png", "image/png", b"PNGDATA").unwrap();
        let req = srv.join().unwrap();
        assert_eq!(at, "https://b.s3.amazonaws.com/up/9");
        assert!(req.contains("name=\"policy\"\r\n\r\n@/etc/passwd\r\n"), "a value starting with @ stays text");
        let (k, f) = (req.find("name=\"key\"").unwrap(), req.find("name=\"File\"").unwrap());
        assert!(k < f && req.contains("filename=\"a_b_.png\"") && req.contains("Content-Type: image/png"));
        assert!(!(integration_productive::PROVIDER.upload)(&url), "the real allowlist refuses it");
    }
    #[test]
    fn trello_upload_is_authenticated_multipart_with_lowercase_file() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", l.local_addr().unwrap());
        let srv = std::thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            c.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
            let (mut got, mut buf) = (vec![], [0u8; 4096]);
            while let Ok(n) = c.read(&mut buf) { if n == 0 { break; } got.extend_from_slice(&buf[..n]); if String::from_utf8_lossy(&got).contains("FILEDATA\r\n--") { break; } }
            c.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap();
            String::from_utf8_lossy(&got).into_owned()
        });
        let p = integration_trello::PROVIDER;
        upload_file(&p, &url, &serde_json::Map::new(), "a.txt", "text/plain", b"FILEDATA", &["Authorization: test-token".into()]).unwrap();
        let req = srv.join().unwrap();
        assert!(req.starts_with("POST "));
        assert!(req.contains("Authorization: test-token"));
        assert!(req.contains("multipart/form-data") && req.contains("name=\"file\"") && req.contains("FILEDATA"));
    }
    #[test]
    fn linear_upload_puts_raw_bytes_and_signed_headers() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", l.local_addr().unwrap());
        let srv = std::thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            c.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
            let (mut got, mut buf) = (vec![], [0u8; 4096]);
            while let Ok(n) = c.read(&mut buf) { if n == 0 { break; } got.extend_from_slice(&buf[..n]); if got.ends_with(b"RAWFILE") { break; } }
            c.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").unwrap();
            String::from_utf8_lossy(&got).into_owned()
        });
        let p = integration_linear::PROVIDER;
        let headers = vec!["Content-Type: text/plain".into(), "x-goog-test: signed-value".into()];
        upload_file(&p, &url, &serde_json::Map::new(), "a.txt", "text/plain", b"RAWFILE", &headers).unwrap();
        let req = srv.join().unwrap();
        assert!(req.starts_with("PUT "));
        assert!(req.contains("x-goog-test: signed-value") && req.contains("Content-Type: text/plain"));
        assert!(req.ends_with("\r\n\r\nRAWFILE"));
        assert!(!req.contains("multipart") && !req.contains("Authorization"));
        for fields in [json!({ "Authorization": "secret" }), json!({ "Host": "evil" }), json!({ "x-goog-test": "x\nurl=https://evil.com" }), json!({ "x-goog-test": 1 })] {
            assert!(upload(&p, "https://uploads.linear.app/file", fields.as_object().unwrap(), "a.txt", "text/plain", b"x").is_err());
        }
    }
    #[test]
    fn old_productive_settings_move_to_integrations() {
        let mut v = json!({ "productive": { "org": "123", "user": "45" } });
        migrate(&mut v);
        assert!(v.get("productive").is_none());
        assert_eq!(v["integrations"]["productive"], json!({ "on": true, "org": "123", "user": "45" }));
        let mut fresh = json!({});
        migrate(&mut fresh);
        assert_eq!(fresh["integrations"]["productive"], json!({ "on": true, "org": "", "user": "" }));
        let mut maps = json!({ "boards": { "A": { "provider": "productive", "project": "1", "board": "2" }, "B": { "provider": 3 } } });
        migrate(&mut maps);
        assert!(maps["boards"]["A"].is_object() && maps["boards"].get("B").is_none());
        assert!(check(&maps).is_ok());
        maps["boards"]["A"]["provider"] = json!("nope");
        assert!(check(&maps).is_err());
    }
}
