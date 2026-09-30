// Board providers: the external task trackers the sidebar board can show (Productive, Trello, Linear). The backend part of a provider is small on purpose: where its API lives, which calls the
// webview may make, how the token is sent and how an error reads. Listing, moving and mapping cards is
// the webview's side (src/providers/). The token lives in the macOS keychain under `vault-app.<id>`
// (one entry per name in `secrets`: Productive and Linear have a token, Trello a key and a token),
// goes to `security` and curl over stdin, never as an argument (visible in the process list), and it
// never goes back to a webview. The rest of a provider's config is in settings.json under
// `integrations.<id>`.

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

use crate::{trc, trc_v};

pub struct Provider {
    /// "productive": the key in settings.integrations, in the keychain service and in the webview's registry
    pub id: &'static str,
    /// shown in errors
    pub name: &'static str,
    /// settings.integrations.<id> with the defaults filled in, run by norm on every load and save
    pub defaults: fn(&mut Value),
    /// a saved config the provider refuses, as a translated message
    pub check: fn(&Value) -> Result<(), String>,
    /// whether the config (without the token) is complete enough to make calls, e.g. an org id
    pub ready: fn(&Value) -> bool,
    /// the translation key (lib.rs TEXT) for a call made while `ready` is false
    pub not_ready: &'static str,
    /// the keychain accounts under `vault-app.<id>` that must all be there, in the order `headers` gets them
    pub secrets: &'static [&'static str],
    /// the full URL for a call the webview asks for, or None when it is not allowed
    pub url: fn(cfg: &Value, method: &str, path: &str, body: &Option<Value>) -> Option<String>,
    /// the headers that carry the secrets (in the order of `secrets`), and anything else the API wants
    pub headers: fn(cfg: &Value, secrets: &[String]) -> Vec<String>,
    /// whether a 2xx answer is a success: a GraphQL API (Linear) answers its errors with 200 and `errors`
    pub ok: fn(body: &Value) -> bool,
    /// an error answer as one line: HTTP status and the API's own message
    pub error: fn(code: &str, body: &Value) -> String,
}

pub const PROVIDERS: &[Provider] = &[PRODUCTIVE, TRELLO, LINEAR];

pub fn get(id: &str) -> Result<&'static Provider, String> {
    PROVIDERS.iter().find(|p| p.id == id).ok_or_else(|| trc_v("err.no_provider", id))
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

/// A path the webview may put after an API's base URL: no way out of it, nothing curl reads as syntax.
fn path_ok(path: &str) -> bool {
    path.starts_with('/') && path.len() < 600 && !path.contains("..") && path.chars().all(|c| c.is_ascii_alphanumeric() || "/?&=[]_-.,%".contains(c))
}

/// One API call for the provider, blocking: the caller runs it off the main thread.
pub fn call(p: &Provider, cfg: &Value, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let url = (p.url)(cfg, method, path, &body).ok_or_else(|| trc_v("err.call", p.name))?;
    if !(p.ready)(cfg) { return Err(trc(p.not_ready)); }
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

// ---------- Productive: org and user id in the config, GET on any path, PATCH only on a single task
// (a card moved to another column).

const PRODUCTIVE: Provider = Provider {
    id: "productive",
    name: "Productive",
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        for k in ["org", "user"] { if !c[k].is_string() { c[k] = json!(""); } }
    },
    check: |c| {
        for k in ["org", "user"] {
            if !c[k].as_str().unwrap().chars().all(|x| x.is_ascii_digit()) {
                return Err(trc_v("err.pv_digits", &trc(if k == "org" { "pv.org_id" } else { "pv.user_id" })));
            }
        }
        Ok(())
    },
    ready: |c| !c["org"].as_str().unwrap_or("").is_empty(),
    not_ready: "err.no_org",
    secrets: &["token"],
    url: |_, method, path, body| {
        let one_task = path.strip_prefix("/tasks/").is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()));
        (path_ok(path) && (method == "GET" || (method == "PATCH" && one_task && body.is_some())))
            .then(|| format!("https://api.productive.io/api/v2{path}"))
    },
    headers: |c, s| vec![format!("X-Auth-Token: {}", s[0]), format!("X-Organization-Id: {}", c["org"].as_str().unwrap_or("")),
        "Content-Type: application/vnd.api+json".into()],
    ok: |_| true,
    error: |code, v| {
        let e = &v["errors"][0];
        format!("Productive {code}: {}", e["detail"].as_str().or(e["title"].as_str()).map_or_else(|| trc("err.unknown"), str::to_string))
    },
};

// ---------- Trello: an API key and a user token, both in the keychain, sent in the OAuth header (not in the URL).
// GET under the member, a board or a workspace, PUT only on a single card with nothing but its list and position.

/// A Trello id: 24 hex digits.
fn trello_id(s: &str) -> bool { s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) }

const TRELLO: Provider = Provider {
    id: "trello",
    name: "Trello",
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        if !c["mine"].is_boolean() { c["mine"] = json!(false); }
    },
    check: |_| Ok(()),
    ready: |_| true,
    not_ready: "err.unknown",
    secrets: &["key", "token"],
    url: |_, method, path, body| {
        let read = method == "GET" && ["/members/me", "/boards/", "/organizations/"].iter().any(|p| path.starts_with(p));
        let one_card = path.strip_prefix("/cards/").is_some_and(trello_id);
        let move_only = body.as_ref().and_then(Value::as_object).is_some_and(|o| o["idList"].as_str().is_some_and(trello_id)
            && o.keys().all(|k| k == "idList" || k == "pos"));
        (path_ok(path) && (read || (method == "PUT" && one_card && move_only))).then(|| format!("https://api.trello.com/1{path}"))
    },
    headers: |_, s| vec![format!("Authorization: OAuth oauth_consumer_key=\"{}\", oauth_token=\"{}\"", s[0], s[1]),
        "Content-Type: application/json".into(), "Accept: application/json".into()],
    ok: |_| true,
    error: |code, v| match code {
        "401" | "403" => trc("err.tr_auth"),
        "429" => trc("err.tr_rate"),
        _ => format!("Trello {code}: {}", v.as_str().or(v["message"].as_str()).map_or_else(|| trc("err.unknown"), str::to_string)),
    },
};

// ---------- Linear: a personal API key in the keychain, sent as the Authorization header as it is.
// One endpoint, POST /graphql. Any query goes (a query cannot change anything); the only mutation allowed is
// LINEAR_MOVE, the one in src/providers/linear-map.ts (MOVE), with nothing but an issue id and a state id.

/// The mutation that moves an issue to another workflow state, compared with its whitespace collapsed.
const LINEAR_MOVE: &str = "mutation Move($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id sortOrder } } }";
fn squash(s: &str) -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") }
/// A Linear id: a UUID.
fn linear_id(v: &Value) -> bool { v.as_str().is_some_and(|s| (1..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')) }
/// The code in the first GraphQL error, e.g. RATELIMITED or AUTHENTICATION_ERROR.
fn gql_code(v: &Value) -> &str { v["errors"][0]["extensions"]["code"].as_str().unwrap_or("") }

const LINEAR: Provider = Provider {
    id: "linear",
    name: "Linear",
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        if !c["done"].is_boolean() { c["done"] = json!(false); }
    },
    check: |_| Ok(()),
    ready: |_| true,
    not_ready: "err.unknown",
    secrets: &["token"],
    url: |_, method, path, body| {
        let o = body.as_ref().and_then(Value::as_object)?;
        let q = o.get("query")?.as_str()?;
        let vars = o.get("variables").cloned().unwrap_or(json!({}));
        let shape = o.keys().all(|k| k == "query" || k == "variables") && vars.is_object();
        let words = |w: &str| q.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|x| x == w);
        let read = !words("mutation") && !words("subscription");
        let moves = squash(q) == LINEAR_MOVE && vars.as_object().unwrap().len() == 2 && linear_id(&vars["id"]) && linear_id(&vars["stateId"]);
        (method == "POST" && path == "/graphql" && shape && q.len() < 4000 && (read || moves)).then(|| "https://api.linear.app/graphql".into())
    },
    headers: |_, s| vec![format!("Authorization: {}", s[0]), "Content-Type: application/json".into()],
    ok: |v| v["errors"].as_array().is_none_or(|e| e.is_empty()),
    error: |code, v| {
        let c = gql_code(v);
        if code == "401" || code == "403" || c == "AUTHENTICATION_ERROR" || c == "FORBIDDEN" { return trc("err.li_auth"); }
        if code == "429" || c == "RATELIMITED" { return trc("err.li_rate"); }
        let m = v["errors"][0]["message"].as_str().or(v.as_str()).map_or_else(|| trc("err.unknown"), str::to_string);
        if code.starts_with('2') { format!("Linear: {m}") } else { format!("Linear {code}: {m}") }
    },
};

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
    #[test]
    fn productive_allows_reads_and_moving_one_task() {
        let p = get("productive").unwrap();
        let c = json!({ "org": "1" });
        assert!((p.url)(&c, "GET", "/tasks?filter[folder_id]=3&page[size]=200", &None).is_some());
        assert!((p.url)(&c, "PATCH", "/tasks/42", &Some(json!({}))).is_some());
        assert!((p.url)(&c, "PATCH", "/tasks", &Some(json!({}))).is_none());
        assert!((p.url)(&c, "DELETE", "/tasks/42", &None).is_none());
        assert!((p.url)(&c, "GET", "/../x", &None).is_none());
        assert!((p.ready)(&c) && !(p.ready)(&json!({ "org": "" })));
    }
    #[test]
    fn trello_allows_reads_and_moving_one_card() {
        let p = get("trello").unwrap();
        let (c, card, list) = (json!({}), "5f1b2c3d4e5f60718293a4b5", "60718293a4b55f1b2c3d4e5f");
        assert!((p.url)(&c, "GET", "/members/me/boards?filter=open&fields=name,idOrganization", &None).is_some());
        assert!((p.url)(&c, "GET", &format!("/boards/{card}/cards/open?fields=name,idList"), &None).is_some());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "idList": list, "pos": "bottom" }))).is_some());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "idList": list, "closed": true }))).is_none());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "idList": "x" }))).is_none());
        assert!((p.url)(&c, "DELETE", &format!("/cards/{card}"), &None).is_none());
        assert!((p.url)(&c, "GET", "/tokens/abc", &None).is_none());
        assert!((p.url)(&c, "GET", "/boards/../x", &None).is_none());
        let h = (p.headers)(&c, &["k1".into(), "t2".into()]);
        assert_eq!(h[0], r#"Authorization: OAuth oauth_consumer_key="k1", oauth_token="t2""#);
    }
    #[test]
    fn trello_errors_read_as_one_line() {
        let p = get("trello").unwrap();
        assert_eq!((p.error)("401", &json!("invalid token")), trc("err.tr_auth"));
        assert_eq!((p.error)("429", &Value::Null), trc("err.tr_rate"));
        assert_eq!((p.error)("400", &json!("invalid value for idList")), "Trello 400: invalid value for idList");
        assert_eq!((p.error)("404", &json!({ "message": "not found" })), "Trello 404: not found");
    }
    #[test]
    fn linear_allows_queries_and_only_the_move_mutation() {
        let p = get("linear").unwrap();
        let c = json!({});
        let (id, st) = ("2b1c3d4e-0000-4000-8000-00000000000a", "5e6f7a8b-0000-4000-8000-00000000000b");
        let q = |b: Value| (p.url)(&c, "POST", "/graphql", &Some(b));
        assert!(q(json!({ "query": "query { viewer { id name } }" })).is_some());
        assert!(q(json!({ "query": "query I($f: IssueFilter) { issues(filter: $f) { nodes { id } } }", "variables": { "f": {} } })).is_some());
        let mv = "mutation Move($id: String!, $stateId: String!) {\n  issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id sortOrder } }\n}";
        assert!(q(json!({ "query": mv, "variables": { "id": id, "stateId": st } })).is_some());
        assert!(q(json!({ "query": mv, "variables": { "id": id, "stateId": st, "x": 1 } })).is_none());
        assert!(q(json!({ "query": mv, "variables": { "id": "a b", "stateId": st } })).is_none());
        assert!(q(json!({ "query": "mutation { issueDelete(id: \"x\") { success } }" })).is_none());
        assert!(q(json!({ "query": "query { viewer { id } } mutation { issueDelete(id: \"x\") { success } }" })).is_none());
        assert!(q(json!({ "query": "subscription { x }" })).is_none());
        assert!(q(json!({ "query": "query { viewer { id } }", "operationName": "x" })).is_none());
        assert!((p.url)(&c, "GET", "/graphql", &None).is_none());
        assert!((p.url)(&c, "POST", "/other", &Some(json!({ "query": "query { viewer { id } }" }))).is_none());
        assert_eq!((p.headers)(&c, &["lin_api_x".into()])[0], "Authorization: lin_api_x");
    }
    #[test]
    fn linear_errors_read_as_one_line() {
        let p = get("linear").unwrap();
        let e = |code: &str| json!({ "errors": [{ "message": "boom", "extensions": { "code": code } }] });
        assert!((p.ok)(&json!({ "data": {} })) && !(p.ok)(&e("INVALID_INPUT")));
        assert_eq!((p.error)("400", &e("RATELIMITED")), trc("err.li_rate"));
        assert_eq!((p.error)("429", &Value::Null), trc("err.li_rate"));
        assert_eq!((p.error)("400", &e("AUTHENTICATION_ERROR")), trc("err.li_auth"));
        assert_eq!((p.error)("401", &Value::Null), trc("err.li_auth"));
        assert_eq!((p.error)("200", &e("INVALID_INPUT")), "Linear: boom");
        assert_eq!((p.error)("500", &json!("down")), "Linear 500: down");
    }
}
