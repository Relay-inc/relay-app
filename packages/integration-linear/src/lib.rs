//! Linear on the backend: a personal API key in the keychain (vault-app.linear/token), sent as the
//! Authorization header as it is. One endpoint, POST /graphql. Any query goes (a query cannot change anything);
//! the only mutation allowed is MOVE, the one in src/map.ts, with nothing but an issue id and a state id.

use board_core::{t, Provider, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["Linear refused the API key. Check it under Vault › Settings… › Integrations.", "Linear weigert de API-sleutel. Controleer hem bij Vault › Instellingen… › Integraties.", "Linear refuse la clé API. Vérifiez-la dans Vault › Réglages… › Intégrations.", "Linear lehnt den API-Schlüssel ab. Prüf ihn unter Vault › Einstellungen… › Integrationen."]),
    ("rate", ["Linear's rate limit is reached. Wait a minute, then refresh.", "De limiet van Linear is bereikt. Wacht een minuut en vernieuw dan.", "La limite de requêtes de Linear est atteinte. Attendez une minute, puis actualisez.", "Das Anfragelimit von Linear ist erreicht. Warte eine Minute und aktualisiere dann."]),
];

/// The mutation that moves an issue to another workflow state, compared with its whitespace collapsed.
const MOVE: &str = "mutation Move($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id sortOrder } } }";
fn squash(s: &str) -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") }
/// A Linear id: a UUID.
fn linear_id(v: &Value) -> bool { v.as_str().is_some_and(|s| (1..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')) }
/// The code in the first GraphQL error, e.g. RATELIMITED or AUTHENTICATION_ERROR.
fn gql_code(v: &Value) -> &str { v["errors"][0]["extensions"]["code"].as_str().unwrap_or("") }

pub const PROVIDER: Provider = Provider {
    id: "linear",
    name: "Linear",
    text: TEXT,
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        if !c["done"].is_boolean() { c["done"] = json!(false); }
    },
    check: |_| Ok(()),
    ready: |_| true,
    not_ready: "",
    secrets: &["token"],
    url: |_, method, path, body| {
        let o = body.as_ref().and_then(Value::as_object)?;
        let q = o.get("query")?.as_str()?;
        let vars = o.get("variables").cloned().unwrap_or(json!({}));
        let shape = o.keys().all(|k| k == "query" || k == "variables") && vars.is_object();
        let words = |w: &str| q.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|x| x == w);
        let read = !words("mutation") && !words("subscription");
        let moves = squash(q) == MOVE && vars.as_object().unwrap().len() == 2 && linear_id(&vars["id"]) && linear_id(&vars["stateId"]);
        (method == "POST" && path == "/graphql" && shape && q.len() < 4000 && (read || moves)).then(|| "https://api.linear.app/graphql".into())
    },
    headers: |_, s| vec![format!("Authorization: {}", s[0]), "Content-Type: application/json".into()],
    upload: |_| false,
    upload_kind: board_core::UploadKind::Form,
    thumb: |_| false,
    ok: |v| v["errors"].as_array().is_none_or(|e| e.is_empty()),
    error: |code, v| {
        let c = gql_code(v);
        if code == "401" || code == "403" || c == "AUTHENTICATION_ERROR" || c == "FORBIDDEN" { return t(TEXT, "auth"); }
        if code == "429" || c == "RATELIMITED" { return t(TEXT, "rate"); }
        let m = board_core::message(v["errors"][0]["message"].as_str().or(v.as_str()));
        if code.starts_with('2') { format!("Linear: {m}") } else { format!("Linear {code}: {m}") }
    },
    // the official Linear MCP server signs in in the browser: nothing to take over; a key-based one has LINEAR_API_KEY
    mcp: Some(board_core::Mcp { server: "linear", secrets: &[("token", &["LINEAR_API_KEY", "LINEAR_API_TOKEN"])], fields: &[] }),
};
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn allows_queries_and_only_the_move_mutation() {
        let p = &PROVIDER;
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
    fn errors_read_as_one_line() {
        let p = &PROVIDER;
        let e = |code: &str| json!({ "errors": [{ "message": "boom", "extensions": { "code": code } }] });
        assert!((p.ok)(&json!({ "data": {} })) && !(p.ok)(&e("INVALID_INPUT")));
        assert_eq!((p.error)("400", &e("RATELIMITED")), t(TEXT, "rate"));
        assert_eq!((p.error)("429", &Value::Null), t(TEXT, "rate"));
        assert_eq!((p.error)("400", &e("AUTHENTICATION_ERROR")), t(TEXT, "auth"));
        assert_eq!((p.error)("401", &Value::Null), t(TEXT, "auth"));
        assert_eq!((p.error)("200", &e("INVALID_INPUT")), "Linear: boom");
        assert_eq!((p.error)("500", &json!("down")), "Linear 500: down");
    }
}
