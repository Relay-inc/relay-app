//! Google Cloud Build on the backend: no token of ours. The app asks the user's gcloud login for an access token
//! (src-tauri/src/gcloud.rs) and `headers` sends it as a Bearer header, like GitHub uses gh's login. Read-only twice
//! over: whatever the login may do, the allowlist below lets through GET on the project list (for the picker) and on a
//! project's builds, nothing else. Not a board: the webview side is src/application/cloudbuild, not a package.

use board_core::{arg_ok, read, t, Action, Provider, Req, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["Google refused the gcloud login. Run `gcloud auth login` in the terminal.", "Google weigert de gcloud-login. Voer `gcloud auth login` uit in de terminal.", "Google refuse la connexion gcloud. Lancez `gcloud auth login` dans le terminal.", "Google lehnt die gcloud-Anmeldung ab. Führe `gcloud auth login` im Terminal aus."]),
    ("denied", ["The gcloud account may not list builds there. It needs the permission cloudbuild.builds.list on the project.", "Het gcloud-account mag daar geen builds opvragen. Het heeft de permissie cloudbuild.builds.list op het project nodig.", "Le compte gcloud ne peut pas lister les builds ici. Il lui faut la permission cloudbuild.builds.list sur le projet.", "Das gcloud-Konto darf dort keine Builds auflisten. Es braucht die Berechtigung cloudbuild.builds.list für das Projekt."]),
    ("rate", ["Google's rate limit is reached. Wait a minute, then refresh.", "De limiet van Google is bereikt. Wacht een minuut en vernieuw dan.", "La limite de requêtes de Google est atteinte. Attendez une minute, puis actualisez.", "Das Anfragelimit von Google ist erreicht. Warte eine Minute und aktualisiere dann."]),
];

/// A project id as Google writes it: 6 to 30 characters, lower case letters, digits and `-`, starting with a letter.
fn project(s: &str) -> bool {
    (6..=30).contains(&s.len()) && s.starts_with(|c: char| c.is_ascii_lowercase()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
/// `global` or a region like `europe-west1`.
fn location(s: &str) -> bool {
    s == "global" || ((4..=30).contains(&s.len()) && s.starts_with(|c: char| c.is_ascii_lowercase()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
}
fn number(s: &str) -> bool { (1..=4).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit()) }
/// A page token as Google hands it out (base64url, maybe percent-encoded).
fn token(s: &str) -> bool { (1..=2000).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_=%.".contains(c)) }
/// Only `pageSize` as a number, and for the project list `pageToken`.
fn query(q: &str, paged: bool) -> bool {
    q.split('&').all(|kv| kv.split_once('=').is_some_and(|(k, v)| (k == "pageSize" && number(v)) || (paged && k == "pageToken" && token(v))))
}

/// The host and path a GET may take: /v1/projects, /v1/projects/<p>/locations/<l>/builds.
fn allowed(path: &str) -> Option<&'static str> {
    let (path, q) = path.split_once('?').unwrap_or((path, ""));
    match path.split('/').collect::<Vec<_>>()[..] {
        ["", "v1", "projects"] if q.is_empty() || query(q, true) => Some("cloudresourcemanager.googleapis.com"),
        ["", "v1", "projects", p, "locations", l, "builds"] if project(p) && location(l) && (q.is_empty() || query(q, false)) => Some("cloudbuild.googleapis.com"),
        _ => None,
    }
}


// ---------- agent actions (`relay cloudbuild.builds`): a read through `PROVIDER.url`, so the allowlist is the only way out.
// The app turns a vault project name into `gcp_project` and `location` from the settings (src-tauri/src/actions.rs).

/// The newest build of each trigger among the answer's builds, newest trigger first: what the Builds tab lists
/// (src/domain/cloudbuild/rules.ts triggersOf). Builds from no trigger are one entry with an empty `trigger_id`.
fn latest(v: &Value) -> Value {
    let mut builds: Vec<&Value> = v["builds"].as_array().map_or(&[][..], Vec::as_slice).iter().collect();
    builds.sort_by(|a, b| b["createTime"].as_str().unwrap_or("").cmp(a["createTime"].as_str().unwrap_or("")));
    let mut seen: Vec<&str> = vec![];
    let mut out = vec![];
    for b in builds {
        let id = b["buildTriggerId"].as_str().unwrap_or("");
        if seen.contains(&id) { continue; }
        seen.push(id);
        let sub = &b["substitutions"];
        let name = sub["TRIGGER_NAME"].as_str().filter(|n| !n.is_empty()).unwrap_or(id);
        // only a link into the Google Cloud console is passed on, as the tab does
        let log = b["logUrl"].as_str().filter(|u| u.starts_with("https://console.cloud.google.com/"));
        out.push(json!({ "trigger_id": id, "trigger": name, "status": b["status"], "branch": sub["BRANCH_NAME"], "commit": sub["SHORT_SHA"],
            "started": b["startTime"].as_str().or(b["createTime"].as_str()), "finished": b["finishTime"], "log": log }));
    }
    Value::Array(out)
}

const ACTIONS: &[Action] = &[
    read("builds", "The last build of each trigger of a vault project's Google Cloud project, among its 50 newest builds: trigger, status, branch, commit, started, finished, log link.",
        &[("project", "vault project name, linked to a Google Cloud project in Settings")],
        |c, a| {
            let path = format!("/v1/projects/{}/locations/{}/builds?pageSize=50", arg_ok(a, "gcp_project", project)?, arg_ok(a, "location", location)?);
            (PROVIDER.url)(c, "GET", &path, &None).map(|url| Req { method: "GET", url, body: None }).ok_or_else(|| "Cloud Build: that read is not on the allowlist".to_string())
        },
        latest),
];

pub const PROVIDER: Provider = Provider {
    id: "cloudbuild",
    name: "Cloud Build",
    text: TEXT,
    defaults: |c| { if !c["on"].is_boolean() { c["on"] = json!(false); } },
    check: |_| Ok(()),
    ready: |_| true,
    not_ready: "auth",
    // gcloud's login, not the keychain: the backend passes the access token as the only secret
    secrets: &[],
    url: |_, method, path, body| {
        let read = method == "GET" && body.as_ref().is_none_or(Value::is_null);
        allowed(path).filter(|_| read).map(|h| format!("https://{h}{path}"))
    },
    headers: |_, s| s.iter().map(|t| format!("Authorization: Bearer {t}")).collect(),
    upload: |_| false,
    upload_kind: board_core::UploadKind::Form,
    thumb: |_| false,
    original: |_| false,
    ok: |_| true,
    error: |code, v| {
        if code == "401" { return t(TEXT, "auth"); }
        if code == "403" { return t(TEXT, "denied"); }
        if code == "429" { return t(TEXT, "rate"); }
        let m = board_core::message(v["error"]["message"].as_str().or(v.as_str()));
        format!("Google {code}: {m}")
    },
    mcp: None,
    actions: ACTIONS,
};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_reads_go_through() {
        let c = json!({});
        let get = |p: &str| (PROVIDER.url)(&c, "GET", p, &None);
        assert_eq!(get("/v1/projects?pageSize=200").as_deref(), Some("https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=200"));
        assert!(get("/v1/projects?pageSize=200&pageToken=Cgs_-=").is_some());
        assert_eq!(get("/v1/projects/northwind-web/locations/global/builds?pageSize=50").as_deref(), Some("https://cloudbuild.googleapis.com/v1/projects/northwind-web/locations/global/builds?pageSize=50"));
        assert!(get("/v1/projects/northwind-web/locations/europe-west1/builds").is_some());
        for p in ["/v1/projects/northwind-web", "/v1/projects/northwind-web/builds", "/v1/projects/northwind-web/locations/global/builds/123",
            "/v1/projects/northwind-web/locations/global/builds/123:cancel", "/v1/projects/northwind-web/locations/global/builds:retry",
            "/v1/projects/northwind-web/locations/global/triggers", "/v1/projects/northwind-web/locations/global/builds?filter=status=FAILURE",
            "/v1/projects/northwind-web/locations/global/builds?pageToken=abc", "/v1/projects?pageSize=x", "/v1/projects?pageSize=1;x",
            "/v1/projects?filter=name:x", "/v1/projects/Northwind/locations/global/builds", "/v1/projects/../locations/global/builds",
            "/v1/projects/abc/locations/global/builds", "/v1/projects/northwind-web/locations/a%20b/builds", "/v1/projects/northwind-web/locations/../builds",
            "/v1/organizations", "v1/projects", "//evil.com/v1/projects"] {
            assert!(get(p).is_none(), "{p}");
        }
        for m in ["POST", "PUT", "PATCH", "DELETE", "get"] { assert!((PROVIDER.url)(&c, m, "/v1/projects", &None).is_none(), "{m}"); }
        assert!((PROVIDER.url)(&c, "GET", "/v1/projects", &Some(json!({ "x": 1 }))).is_none());
    }

    fn run(args: Value) -> Result<String, String> {
        (ACTIONS[0].build)(&json!({}), &args).map(|r| r.url)
    }
    #[test]
    fn builds_is_a_read_through_the_allowlist() {
        assert!(!ACTIONS[0].write && ACTIONS[0].default == board_core::Policy::Auto);
        // the vault project name is the one argument the agent gives; the rest comes from the settings
        assert!(board_core::check_args(ACTIONS[0].args, &json!({ "project": "Orchard" })).is_ok());
        assert!(board_core::check_args(ACTIONS[0].args, &json!({ "gcp_project": "orchard-web" })).is_err());
        assert!(board_core::check_args(ACTIONS[0].args, &json!({})).is_err());
        let url = run(json!({ "gcp_project": "orchard-web", "location": "europe-west1" })).unwrap();
        assert_eq!(url, "https://cloudbuild.googleapis.com/v1/projects/orchard-web/locations/europe-west1/builds?pageSize=50");
        let path = url.strip_prefix("https://cloudbuild.googleapis.com").unwrap();
        assert_eq!((PROVIDER.url)(&json!({}), "GET", path, &None).as_deref(), Some(url.as_str()));
        for args in [json!({}), json!({ "gcp_project": "orchard-web" }), json!({ "gcp_project": "Orchard", "location": "global" }), json!({ "gcp_project": "orchard-web", "location": "../x" }),
            json!({ "gcp_project": "orchard-web/locations/global/builds/1:cancel#", "location": "global" }), json!({ "gcp_project": "orchard-web", "location": "global?filter=x" })] {
            assert!(run(args.clone()).is_err(), "{args}");
        }
    }
    #[test]
    fn builds_answer_is_the_newest_build_per_trigger() {
        let v = json!({ "builds": [
            { "id": "1", "status": "FAILURE", "createTime": "2026-10-01T08:00:00Z", "buildTriggerId": "t1", "substitutions": { "TRIGGER_NAME": "deploy-web", "BRANCH_NAME": "main", "SHORT_SHA": "a1b2c3d" }, "logUrl": "https://console.cloud.google.com/cloud-build/builds/1" },
            { "id": "2", "status": "SUCCESS", "createTime": "2026-10-01T09:00:00Z", "startTime": "2026-10-01T09:00:05Z", "finishTime": "2026-10-01T09:04:00Z", "buildTriggerId": "t1", "substitutions": { "TRIGGER_NAME": "deploy-web", "BRANCH_NAME": "main", "SHORT_SHA": "e4f5a6b" },
              "logUrl": "https://console.cloud.google.com/cloud-build/builds/2", "serviceAccount": "s3cret", "secrets": [{ "kmsKeyName": "s3cret" }] },
            { "id": "3", "status": "WORKING", "createTime": "2026-10-01T07:00:00Z", "logUrl": "https://evil.example/log" },
        ] });
        let out = latest(&v);
        assert_eq!(out.as_array().unwrap().len(), 2);
        assert_eq!(out[0]["trigger"], "deploy-web");
        assert_eq!(out[0]["status"], "SUCCESS");
        assert_eq!(out[0]["commit"], "e4f5a6b");
        assert_eq!(out[1]["trigger_id"], "");
        assert_eq!(out[1]["log"], Value::Null, "only the console's own links");
        assert!(!out.to_string().contains("s3cret"));
        assert_eq!(latest(&Value::Null), json!([]));
    }
    #[test]
    fn the_token_is_a_bearer_header() {
        assert_eq!((PROVIDER.headers)(&json!({}), &["ya29.tok".into()]), ["Authorization: Bearer ya29.tok"]);
    }
    #[test]
    fn errors_read_as_one_line() {
        assert_eq!((PROVIDER.error)("401", &Value::Null), t(TEXT, "auth"));
        assert_eq!((PROVIDER.error)("403", &Value::Null), t(TEXT, "denied"));
        assert_eq!((PROVIDER.error)("404", &json!({ "error": { "message": "Not found" } })), "Google 404: Not found");
    }
}
