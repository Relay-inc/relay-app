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

#[cfg(test)]
mod tests {
    use super::*;
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
