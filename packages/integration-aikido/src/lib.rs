//! Aikido Security on the backend: an API client (client id and secret) in the keychain (vault-app.aikido,
//! accounts `client_id` and `client_secret`), exchanged for a short-lived bearer token (src-tauri/src/aikido.rs keeps
//! it in memory until it expires, it never reaches a webview), sent to the API of the region in
//! `integrations.aikido.region`. Read-only twice over: the client should only carry `repositories:read` and
//! `issues:read`, and whatever it carries, the allowlist below lets through GET on the code repos, the open issue
//! groups and the issue export, nothing else (no ignore, snooze, solve or rescan). Not a board: the webview side is
//! src/application/aikido, not a package.

use base64::Engine;
use board_core::{t, Provider, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["Aikido refused the access token. Save the client again under Relay › Settings… › Integrations.", "Aikido weigert het toegangstoken. Bewaar de client opnieuw bij Relay › Instellingen… › Integraties.", "Aikido refuse le jeton d'accès. Enregistrez le client à nouveau dans Relay › Réglages… › Intégrations.", "Aikido lehnt das Zugriffstoken ab. Speichere den Client erneut unter Relay › Einstellungen… › Integrationen."]),
    ("client", ["Aikido refused the client ID or secret. Check them under Relay › Settings… › Integrations.", "Aikido weigert de client-ID of het secret. Controleer ze bij Relay › Instellingen… › Integraties.", "Aikido refuse l'ID client ou le secret. Vérifiez-les dans Relay › Réglages… › Intégrations.", "Aikido lehnt die Client-ID oder das Secret ab. Prüf sie unter Relay › Einstellungen… › Integrationen."]),
    ("scope", ["The Aikido client may not read this. It needs the scopes repositories:read and issues:read.", "De Aikido-client mag dit niet lezen. Hij heeft de scopes repositories:read en issues:read nodig.", "Le client Aikido ne peut pas lire ceci. Il lui faut les scopes repositories:read et issues:read.", "Der Aikido-Client darf das nicht lesen. Er braucht die Scopes repositories:read und issues:read."]),
    ("rate", ["Aikido's rate limit is reached. Wait a minute, then refresh.", "De limiet van Aikido is bereikt. Wacht een minuut en vernieuw dan.", "La limite de requêtes d'Aikido est atteinte. Attendez une minute, puis actualisez.", "Das Anfragelimit von Aikido ist erreicht. Warte eine Minute und aktualisiere dann."]),
    ("region", ["Pick Aikido's region: EU, US, AU or ME.", "Kies de regio van Aikido: EU, US, AU of ME.", "Choisissez la région d'Aikido : EU, US, AU ou ME.", "Wähl die Region von Aikido: EU, US, AU oder ME."]),
];

/// The regions and their app hosts; the API is under /api/public/v1 there. The credentials and the token go nowhere else.
pub const REGIONS: &[(&str, &str)] = &[("eu", "app.aikido.dev"), ("us", "app.us.aikido.dev"), ("au", "app.au.aikido.dev"), ("me", "app.me.aikido.dev")];
fn host(cfg: &Value) -> Option<&'static str> {
    let r = cfg["region"].as_str()?;
    REGIONS.iter().find(|(id, _)| *id == r).map(|(_, h)| *h)
}

fn number(s: &str, max: u32) -> bool { (1..=9).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit()) && s.parse::<u32>().is_ok_and(|n| n <= max) }
fn id(s: &str) -> bool { number(s, u32::MAX) && !s.starts_with('0') }
/// A repo name filter as typed: letters, digits, `-`, `_`, `.`.
fn name(s: &str) -> bool { (1..=100).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) }
fn severities(s: &str) -> bool { s.split(',').all(|x| ["critical", "high", "medium", "low"].contains(&x)) }

/// The query a path may carry: only the keys listed for it, each with a value of its kind.
fn query(q: &str, ok: impl Fn(&str, &str) -> bool) -> bool {
    q.is_empty() || q.split('&').all(|kv| kv.split_once('=').is_some_and(|(k, v)| ok(k, v)))
}
/// The paths a GET may take: the code repos (Settings), the open issue groups of one repo and the open issues of a
/// group or of a repo (the fix prompt). Paging within the API's own limits.
fn allowed(path: &str) -> bool {
    let (path, q) = path.split_once('?').unwrap_or((path, ""));
    match path {
        "/repositories/code" => query(q, |k, v| match k {
            "page" => number(v, 1000),
            "per_page" => number(v, 200),
            "filter_name" => name(v),
            _ => false,
        }),
        "/open-issue-groups" => query(q, |k, v| match k {
            "page" => number(v, 1000),
            "per_page" => number(v, 100) && v.parse::<u32>().is_ok_and(|n| n >= 10),
            "filter_code_repo_id" => id(v),
            "filter_status" => v == "open",
            _ => false,
        }),
        "/issues/export" => query(q, |k, v| match k {
            "format" => v == "json",
            "page" => number(v, 1000),
            "per_page" => number(v, 100) && v.parse::<u32>().is_ok_and(|n| n >= 10),
            "filter_status" => v == "open",
            "filter_issue_group_id" | "filter_code_repo_id" => id(v),
            "filter_severities" => severities(v),
            // the dependency updates of a repo (Fix dependency-updates): only this one type
            "filter_issue_type" => v == "open_source",
            _ => false,
        }),
        _ => false,
    }
}

/// Where the client is exchanged for a token: the EU host first (the one Aikido documents for every region), then the
/// region's own host, in case a region has its own (not confirmed by Aikido's docs).
pub fn token_urls(cfg: &Value) -> Vec<String> {
    let mut hosts = vec![REGIONS[0].1];
    if let Some(h) = host(cfg).filter(|h| *h != REGIONS[0].1) { hosts.push(h); }
    hosts.into_iter().map(|h| format!("https://{h}/api/oauth/token")).collect()
}
/// The token request's headers (the client as Basic auth); its body is `TOKEN_BODY`.
pub fn token_headers(client_id: &str, secret: &str) -> Vec<String> {
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{client_id}:{secret}"));
    vec![format!("Authorization: Basic {basic}"), "Content-Type: application/x-www-form-urlencoded".into(), "Accept: application/json".into()]
}
pub const TOKEN_BODY: &str = "grant_type=client_credentials";
/// The access token and how many seconds it lasts, from the token answer; None for anything else, a token with
/// characters that do not belong in a header among it.
pub fn parse_token(v: &Value) -> Option<(String, u64)> {
    let token = v["access_token"].as_str().filter(|s| (1..=4000).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.~+/=".contains(c)))?;
    if !v["token_type"].as_str().is_some_and(|t| t.eq_ignore_ascii_case("bearer")) { return None; }
    Some((token.to_string(), v["expires_in"].as_u64().unwrap_or(0)))
}
/// A token answer that is no token, as one line (400 `invalid_client` and 401 mean the client is wrong).
pub fn token_error(code: &str, v: &Value) -> String {
    if code == "400" || code == "401" || code == "403" { return t(TEXT, "client"); }
    (PROVIDER.error)(code, v)
}

pub const PROVIDER: Provider = Provider {
    id: "aikido",
    name: "Aikido",
    text: TEXT,
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(false); }
        if host(c).is_none() { c["region"] = json!(REGIONS[0].0); }
    },
    check: |c| if host(c).is_some() { Ok(()) } else { Err(t(TEXT, "region")) },
    ready: |c| host(c).is_some(),
    not_ready: "region",
    // the client in the keychain; a call gets the access token exchanged for it instead (src-tauri/src/aikido.rs)
    secrets: &["client_id", "client_secret"],
    url: |cfg, method, path, body| {
        let read = method == "GET" && body.as_ref().is_none_or(Value::is_null) && allowed(path);
        host(cfg).filter(|_| read).map(|h| format!("https://{h}/api/public/v1{path}"))
    },
    // only ever the one access token: the client id and secret go to the token endpoint, never to the API
    headers: |_, s| match s {
        [token] => vec![format!("Authorization: Bearer {token}"), "Accept: application/json".into()],
        _ => vec![],
    },
    upload: |_| false,
    upload_kind: board_core::UploadKind::Form,
    thumb: |_| false,
    original: |_| false,
    ok: |_| true,
    error: |code, v| {
        if code == "401" { return t(TEXT, "auth"); }
        if code == "403" { return t(TEXT, "scope"); }
        if code == "429" { return t(TEXT, "rate"); }
        let m = board_core::message(v["error_description"].as_str().or(v["message"].as_str()).or(v["error"].as_str()).or(v.as_str()));
        format!("Aikido {code}: {m}")
    },
    mcp: None,
    actions: &[],
};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_reads_go_through() {
        let c = json!({ "region": "eu" });
        let get = |p: &str| (PROVIDER.url)(&c, "GET", p, &None);
        assert_eq!(get("/repositories/code?per_page=200").as_deref(), Some("https://app.aikido.dev/api/public/v1/repositories/code?per_page=200"));
        assert!(get("/repositories/code?page=1&per_page=50&filter_name=orchard-web").is_some());
        assert!(get("/open-issue-groups?filter_code_repo_id=101&filter_status=open&per_page=100&page=0").is_some());
        assert!(get("/issues/export?format=json&filter_status=open&filter_issue_group_id=48213&per_page=10&page=0").is_some());
        assert!(get("/issues/export?format=json&filter_status=open&filter_code_repo_id=101&filter_severities=critical,high&per_page=100").is_some());
        assert!(get("/issues/export?format=json&filter_status=open&filter_code_repo_id=101&filter_severities=critical&per_page=100").is_some());
        assert!(get("/issues/export?format=json&filter_status=open&filter_code_repo_id=101&filter_issue_type=open_source&per_page=100").is_some());
        for p in [
            // writes and everything not listed
            "/issues/48213/ignore", "/issues/48213/snooze", "/issues/groups/48213/ignore", "/issues/groups/48213/snooze",
            "/issues/48213/solve", "/repositories/code/101/scan", "/repositories/code/101", "/issues/groups/48213", "/issues/48213",
            "/issues/counts", "/clouds", "/teams", "/users", "repositories/code", "//evil.com/repositories/code", "/repositories/code/",
            // queries outside the list or the limits
            "/repositories/code?per_page=201", "/repositories/code?include_inactive=true", "/repositories/code?filter_name=a b",
            "/repositories/code?filter_name=../x", "/repositories/code?page=1;x", "/repositories/code?page", "/repositories/code?page=",
            "/open-issue-groups?per_page=101", "/open-issue-groups?per_page=5", "/open-issue-groups?filter_status=ignored",
            "/open-issue-groups?filter_code_repo_id=abc", "/open-issue-groups?filter_code_repo_id=0", "/open-issue-groups?filter_team_id=1",
            "/issues/export?format=csv", "/issues/export?filter_status=all", "/issues/export?per_page=5000",
            "/issues/export?filter_severities=critical,urgent", "/issues/export?filter_cve_id=CVE-2026-1",
            "/issues/export?filter_issue_type=sast", "/issues/export?filter_issue_type=open_source,sast", "/issues/export?filter_issue_type=",
            "/open-issue-groups?filter_issue_type=open_source",
        ] {
            assert!(get(p).is_none(), "{p}");
        }
        for m in ["POST", "PUT", "PATCH", "DELETE", "get"] { assert!((PROVIDER.url)(&c, m, "/repositories/code", &None).is_none(), "{m}"); }
        assert!((PROVIDER.url)(&c, "GET", "/repositories/code", &Some(json!({ "x": 1 }))).is_none());
    }
    #[test]
    fn the_token_goes_only_to_aikido() {
        assert_eq!((PROVIDER.url)(&json!({ "region": "us" }), "GET", "/repositories/code", &None).as_deref(), Some("https://app.us.aikido.dev/api/public/v1/repositories/code"));
        assert!((PROVIDER.url)(&json!({ "region": "evil.com" }), "GET", "/repositories/code", &None).is_none());
        assert!((PROVIDER.url)(&json!({ "host": "evil.com" }), "GET", "/repositories/code", &None).is_none());
        assert!((PROVIDER.url)(&json!({}), "GET", "/repositories/code", &None).is_none());
        assert!((PROVIDER.check)(&json!({ "region": "app.aikido.dev.evil.com" })).is_err());
        let mut c = json!({ "region": "nope" });
        (PROVIDER.defaults)(&mut c);
        assert_eq!(c, json!({ "on": false, "region": "eu" }));
        assert_eq!(token_urls(&json!({ "region": "eu" })), ["https://app.aikido.dev/api/oauth/token"]);
        assert_eq!(token_urls(&json!({ "region": "au" })), ["https://app.aikido.dev/api/oauth/token", "https://app.au.aikido.dev/api/oauth/token"]);
        assert_eq!(token_urls(&json!({ "region": "evil.com" })), ["https://app.aikido.dev/api/oauth/token"]);
    }
    #[test]
    fn the_client_never_reaches_the_api() {
        // the API only ever gets the one access token as a bearer; given the keychain's two secrets it sends nothing
        assert_eq!((PROVIDER.headers)(&json!({}), &["eyJ.tok".into()]), ["Authorization: Bearer eyJ.tok", "Accept: application/json"]);
        assert!((PROVIDER.headers)(&json!({}), &["AIK_CLIENT_x".into(), "s3cret".into()]).is_empty());
        let h = token_headers("AIK_CLIENT_x", "s3cret");
        assert_eq!(h[0], format!("Authorization: Basic {}", base64::engine::general_purpose::STANDARD.encode("AIK_CLIENT_x:s3cret")));
        assert!(!h.concat().contains("s3cret"), "the secret only goes base64'd in the Basic header");
        // an error never echoes what was sent
        let e = token_error("400", &json!({ "error": "invalid_client", "error_description": "bad s3cret" }));
        assert_eq!(e, t(TEXT, "client"));
        assert!(!e.contains("s3cret"));
    }
    #[test]
    fn token_answers() {
        assert_eq!(parse_token(&json!({ "access_token": "eyJh.eyJz.sig-_", "expires_in": 3600, "token_type": "bearer" })), Some(("eyJh.eyJz.sig-_".into(), 3600)));
        assert_eq!(parse_token(&json!({ "access_token": "a", "token_type": "Bearer" })), Some(("a".into(), 0)));
        assert!(parse_token(&json!({ "access_token": "a\nurl = https://evil.com", "token_type": "bearer" })).is_none());
        assert!(parse_token(&json!({ "access_token": "a\"b", "token_type": "bearer" })).is_none());
        assert!(parse_token(&json!({ "access_token": "a", "token_type": "mac" })).is_none());
        assert!(parse_token(&json!({ "error": "invalid_client" })).is_none());
    }
    #[test]
    fn errors_read_as_one_line() {
        assert_eq!((PROVIDER.error)("401", &Value::Null), t(TEXT, "auth"));
        assert_eq!((PROVIDER.error)("403", &Value::Null), t(TEXT, "scope"));
        assert_eq!((PROVIDER.error)("429", &Value::Null), t(TEXT, "rate"));
        assert_eq!((PROVIDER.error)("404", &json!({ "message": "Not found" })), "Aikido 404: Not found");
    }
}
