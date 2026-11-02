//! Buddy on the backend: a personal access token in the keychain (vault-app.buddy/token), sent as a Bearer header to
//! the API of the region in `integrations.buddy.host`. Read-only twice over: the token should only carry
//! WORKSPACE_READ, PROJECT_READ and PIPELINE_READ, and whatever it carries, the allowlist below lets through GET on
//! the workspaces, their projects, a project's pipelines and a pipeline's executions, nothing else. Not a board:
//! the webview side is src/application/buddy, not a package.

use board_core::{t, Provider, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["Buddy refused the token. Check it under Vault › Settings… › Integrations.", "Buddy weigert het token. Controleer het bij Vault › Instellingen… › Integraties.", "Buddy refuse le jeton. Vérifiez-le dans Vault › Réglages… › Intégrations.", "Buddy lehnt das Token ab. Prüf es unter Vault › Einstellungen… › Integrationen."]),
    ("rate", ["Buddy's rate limit is reached. Wait a minute, then refresh.", "De limiet van Buddy is bereikt. Wacht een minuut en vernieuw dan.", "La limite de requêtes de Buddy est atteinte. Attendez une minute, puis actualisez.", "Das Anfragelimit von Buddy ist erreicht. Warte eine Minute und aktualisiere dann."]),
    ("host", ["Pick Buddy's region: US, EU or Asia.", "Kies de regio van Buddy: US, EU of Azië.", "Choisissez la région de Buddy : US, EU ou Asie.", "Wähl die Region von Buddy: US, EU oder Asien."]),
];

/// The cloud APIs, one per region (an app.buddy.works account uses the US one). The token goes nowhere else.
pub const HOSTS: &[&str] = &["api.buddy.works", "api.eu.buddy.works", "api.asia.buddy.works"];
fn host(cfg: &Value) -> Option<&str> { cfg["host"].as_str().filter(|h| HOSTS.contains(h)) }

/// A workspace domain or a project name as Buddy writes them in a path: letters, digits, `-` and `_`.
fn slug(s: &str) -> bool { (1..=100).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) }
fn number(s: &str) -> bool { (1..=12).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit()) }
/// Only `page` and `per_page`, as numbers.
fn query(q: &str) -> bool { q.split('&').all(|kv| kv.split_once('=').is_some_and(|(k, v)| ["page", "per_page"].contains(&k) && number(v))) }

/// The paths a GET may take: /workspaces, /workspaces/<w>/projects, …/projects/<p>/pipelines, …/pipelines/<id>/executions.
fn allowed(path: &str) -> bool {
    let (path, q) = path.split_once('?').unwrap_or((path, ""));
    if !(q.is_empty() || query(q)) { return false; }
    match path.split('/').collect::<Vec<_>>()[..] {
        ["", "workspaces"] => true,
        ["", "workspaces", w, "projects"] => slug(w),
        ["", "workspaces", w, "projects", p, "pipelines"] => slug(w) && slug(p),
        ["", "workspaces", w, "projects", p, "pipelines", id, "executions"] => slug(w) && slug(p) && number(id),
        _ => false,
    }
}

pub const PROVIDER: Provider = Provider {
    id: "buddy",
    name: "Buddy",
    text: TEXT,
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(false); }
        if host(c).is_none() { c["host"] = json!(HOSTS[0]); }
    },
    check: |c| if host(c).is_some() { Ok(()) } else { Err(t(TEXT, "host")) },
    ready: |c| host(c).is_some(),
    not_ready: "host",
    secrets: &["token"],
    url: |cfg, method, path, body| {
        let read = method == "GET" && body.as_ref().is_none_or(Value::is_null) && allowed(path);
        host(cfg).filter(|_| read).map(|h| format!("https://{h}{path}"))
    },
    headers: |_, s| vec![format!("Authorization: Bearer {}", s[0])],
    upload: |_| false,
    upload_kind: board_core::UploadKind::Form,
    thumb: |_| false,
    original: |_| false,
    ok: |_| true,
    error: |code, v| {
        if code == "401" { return t(TEXT, "auth"); }
        // Buddy answers a reached limit with 429, or with 403 without Retry-After
        if code == "429" { return t(TEXT, "rate"); }
        let m = board_core::message(v["errors"][0]["message"].as_str().or(v["message"].as_str()).or(v.as_str()));
        format!("Buddy {code}: {m}")
    },
    mcp: None,
    actions: &[],
};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_reads_go_through() {
        let c = json!({ "host": "api.eu.buddy.works" });
        let get = |p: &str| (PROVIDER.url)(&c, "GET", p, &None);
        assert_eq!(get("/workspaces").as_deref(), Some("https://api.eu.buddy.works/workspaces"));
        assert!(get("/workspaces/acme/projects?per_page=100").is_some());
        assert!(get("/workspaces/acme/projects/web-app/pipelines?page=2&per_page=50").is_some());
        assert!(get("/workspaces/acme/projects/web-app/pipelines/42/executions?per_page=1").is_some());
        for p in ["/workspaces/acme", "/workspaces/acme/projects/web-app", "/workspaces/acme/projects/web-app/pipelines/42",
            "/workspaces/acme/projects/web-app/pipelines/42/executions/7", "/workspaces/../projects", "/workspaces/a b/projects",
            "/workspaces/acme/projects/web-app/pipelines/x/executions", "/workspaces?sort_by=name", "/workspaces?page=1;x",
            "/workspaces/acme/projects/web-app/pipelines/42/actions", "/user", "workspaces", "//evil.com/workspaces"] {
            assert!(get(p).is_none(), "{p}");
        }
        for m in ["POST", "PUT", "PATCH", "DELETE", "get"] { assert!((PROVIDER.url)(&c, m, "/workspaces", &None).is_none(), "{m}"); }
        assert!((PROVIDER.url)(&c, "GET", "/workspaces", &Some(json!({ "x": 1 }))).is_none());
    }
    #[test]
    fn the_token_goes_only_to_buddy() {
        assert!((PROVIDER.url)(&json!({ "host": "evil.com" }), "GET", "/workspaces", &None).is_none());
        assert!((PROVIDER.url)(&json!({}), "GET", "/workspaces", &None).is_none());
        assert!((PROVIDER.check)(&json!({ "host": "api.buddy.works.evil.com" })).is_err());
        let mut c = json!({ "host": "nope" });
        (PROVIDER.defaults)(&mut c);
        assert_eq!(c, json!({ "on": false, "host": "api.buddy.works" }));
        assert_eq!((PROVIDER.headers)(&c, &["tok".into()]), ["Authorization: Bearer tok"]);
    }
    #[test]
    fn errors_read_as_one_line() {
        assert_eq!((PROVIDER.error)("401", &Value::Null), t(TEXT, "auth"));
        assert_eq!((PROVIDER.error)("429", &Value::Null), t(TEXT, "rate"));
        assert_eq!((PROVIDER.error)("404", &json!({ "errors": [{ "message": "Not found" }] })), "Buddy 404: Not found");
    }
}
