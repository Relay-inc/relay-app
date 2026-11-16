//! GitHub Projects on the backend: a token in the keychain (vault-app.github-projects/token), sent as a Bearer token.
//! One endpoint, POST /graphql. Any query goes (a query cannot change anything); the three board mutations are
//! matched exactly, with validated variables: an item to a Status option, to No status, and a new draft item.

use board_core::{t, Provider, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["GitHub refused the token. Check it under Vault › Settings… › Integrations.", "GitHub weigert de token. Controleer hem bij Vault › Instellingen… › Integraties.", "GitHub refuse le jeton. Vérifiez-le dans Vault › Réglages… › Intégrations.", "GitHub lehnt das Token ab. Prüf es unter Vault › Einstellungen… › Integrationen."]),
    ("scope", ["The GitHub token lacks the project scope: add it to the token, or run gh auth refresh -s project.", "De GitHub-token mist de scope project: voeg hem toe aan de token, of voer gh auth refresh -s project uit.", "Le jeton GitHub n'a pas le scope project : ajoutez-le au jeton, ou lancez gh auth refresh -s project.", "Dem GitHub-Token fehlt der Scope project: füg ihn dem Token hinzu oder führe gh auth refresh -s project aus."]),
    ("rate", ["GitHub's rate limit is reached. Wait a minute, then refresh.", "De limiet van GitHub is bereikt. Wacht een minuut en vernieuw dan.", "La limite de requêtes de GitHub est atteinte. Attendez une minute, puis actualisez.", "Das Anfragelimit von GitHub ist erreicht. Warte eine Minute und aktualisiere dann."]),
];

/// The board's mutations (src/map.ts), compared with their whitespace collapsed.
const MOVE: &str = "mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }";
const CLEAR: &str = "mutation Clear($project: ID!, $item: ID!, $field: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) { projectV2Item { id } } }";
const CREATE: &str = "mutation Create($project: ID!, $title: String!, $body: String!) { addProjectV2DraftIssue(input: { projectId: $project, title: $title, body: $body }) { projectItem { id } } }";
fn squash(s: &str) -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") }
/// A GitHub node id (PVT_…, PVTI_…) or a single-select option id: letters, digits, - and _.
fn node_id(v: &Value) -> bool { v.as_str().is_some_and(|s| (1..=100).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) }
fn err_type(v: &Value) -> &str { v["errors"][0]["type"].as_str().unwrap_or("") }

pub const PROVIDER: Provider = Provider {
    id: "github-projects",
    name: "GitHub Projects",
    text: TEXT,
    defaults: |c| { if !c["on"].is_boolean() { c["on"] = json!(true); } },
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
        let count = vars.as_object().map_or(0, |o| o.len());
        let ids = |keys: &[&str]| keys.iter().all(|k| node_id(&vars[*k]));
        let writes = match squash(q).as_str() {
            MOVE => count == 4 && ids(&["project", "item", "field", "option"]),
            CLEAR => count == 3 && ids(&["project", "item", "field"]),
            CREATE => count == 3 && ids(&["project"]) && vars["title"].as_str().is_some_and(|s| !s.trim().is_empty()) && vars["body"].is_string(),
            _ => false,
        };
        (method == "POST" && path == "/graphql" && shape && q.len() < 4000 && (read || writes)).then(|| "https://api.github.com/graphql".into())
    },
    // the next global ids: letters, digits and _ only, as the board ids in settings must be
    headers: |_, s| vec![format!("Authorization: Bearer {}", s[0]), "Content-Type: application/json".into(), "X-Github-Next-Global-ID: 1".into()],
    upload: |_| false,
    upload_kind: board_core::UploadKind::Form,
    thumb: |_| false,
    original: |_| false,
    // an organization behind SAML single sign-on answers FORBIDDEN next to the data of the others: still a success
    ok: |v| v["errors"].as_array().is_none_or(|e| e.is_empty() || (v["data"].is_object() && e.iter().all(|x| x["type"] == "FORBIDDEN"))),
    error: |code, v| {
        let ty = err_type(v);
        if code == "401" { return t(TEXT, "auth"); }
        if ty == "INSUFFICIENT_SCOPES" { return t(TEXT, "scope"); }
        let m = board_core::message(v["errors"][0]["message"].as_str().or(v["message"].as_str()).or(v.as_str()));
        if code == "429" || ty == "RATE_LIMITED" || (code == "403" && m.contains("rate limit")) { return t(TEXT, "rate"); }
        if code.starts_with('2') { format!("GitHub: {m}") } else { format!("GitHub {code}: {m}") }
    },
    // GitHub's MCP server for Claude Code carries a token in its env
    mcp: Some(board_core::Mcp { server: "github", secrets: &[("token", &["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN"])], fields: &[] }),
    actions: &[],
};

#[cfg(test)]
mod tests {
    use super::*;
    const P: &str = "PVT_kwDOAbc123";
    const I: &str = "PVTI_lADOAbc123zgXyZ";
    const F: &str = "PVTSSF_lADOAbc123zgAbC";
    fn allowed(query: &str, variables: Value) -> bool {
        (PROVIDER.url)(&json!({}), "POST", "/graphql", &Some(json!({ "query": query, "variables": variables }))).is_some()
    }
    #[test]
    fn allows_queries_and_only_the_board_mutations() {
        assert!(allowed("query Boards { viewer { login } }", json!({})));
        assert!(allowed("query Items($id: ID!) { node(id: $id) { id } }", json!({ "id": P })));
        let mv = "mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!) {\n  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } }\n}";
        assert!(allowed(mv, json!({ "project": P, "item": I, "field": F, "option": "f75ad846" })));
        assert!(!allowed(mv, json!({ "project": P, "item": I, "field": F, "option": "a b" })));
        assert!(!allowed(mv, json!({ "project": P, "item": I, "field": F, "option": "f75ad846", "x": 1 })));
        assert!(allowed(CLEAR, json!({ "project": P, "item": I, "field": F })));
        assert!(!allowed(CLEAR, json!({ "project": P, "item": I })));
        assert!(allowed(CREATE, json!({ "project": P, "title": "T", "body": "" })));
        assert!(!allowed(CREATE, json!({ "project": P, "title": " ", "body": "" })));
        assert!(!allowed(CREATE, json!({ "project": "x\"y", "title": "T", "body": "" })));
        assert!(!allowed("mutation { deleteProjectV2Item(input: { projectId: \"x\", itemId: \"y\" }) { deletedItemId } }", json!({})));
        assert!(!allowed(&format!("{CLEAR} mutation D {{ deleteProjectV2(input: {{ projectId: \"x\" }}) {{ clientMutationId }} }}"), json!({ "project": P, "item": I, "field": F })));
        assert!(!allowed("subscription { x }", json!({})));
        assert!((PROVIDER.url)(&json!({}), "POST", "/graphql", &Some(json!({ "query": "query { viewer { id } }", "operationName": "x" }))).is_none());
        assert!((PROVIDER.url)(&json!({}), "GET", "/graphql", &None).is_none());
        assert!((PROVIDER.url)(&json!({}), "POST", "/repos", &Some(json!({ "query": "query { viewer { id } }" }))).is_none());
        assert_eq!((PROVIDER.headers)(&json!({}), &["ghp_x".into()])[0], "Authorization: Bearer ghp_x");
    }
    #[test]
    fn errors_read_as_one_line() {
        let p = &PROVIDER;
        let e = |ty: &str| json!({ "data": null, "errors": [{ "type": ty, "message": "boom" }] });
        assert!((p.ok)(&json!({ "data": {} })) && !(p.ok)(&e("NOT_FOUND")));
        assert!((p.ok)(&json!({ "data": { "viewer": {} }, "errors": [{ "type": "FORBIDDEN", "message": "SAML" }] })));
        assert!(!(p.ok)(&e("FORBIDDEN")));
        assert_eq!((p.error)("401", &json!({ "message": "Bad credentials" })), t(TEXT, "auth"));
        assert_eq!((p.error)("200", &e("INSUFFICIENT_SCOPES")), t(TEXT, "scope"));
        assert_eq!((p.error)("200", &e("RATE_LIMITED")), t(TEXT, "rate"));
        assert_eq!((p.error)("403", &json!({ "message": "API rate limit exceeded for user" })), t(TEXT, "rate"));
        assert_eq!((p.error)("200", &e("NOT_FOUND")), "GitHub: boom");
        assert_eq!((p.error)("502", &json!("down")), "GitHub 502: down");
    }
}
