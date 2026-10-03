//! Linear on the backend: a personal API key in the keychain (vault-app.linear/token), sent as the
//! Authorization header as it is. One endpoint, POST /graphql. Any query goes (a query cannot change anything);
//! ticket mutations are matched exactly, with validated variables. Signed file uploads carry no API key.

use board_core::{arg, arg_ok, read, t, write, Action, Provider, Req, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["Linear refused the API key. Check it under Vault › Settings… › Integrations.", "Linear weigert de API-sleutel. Controleer hem bij Vault › Instellingen… › Integraties.", "Linear refuse la clé API. Vérifiez-la dans Vault › Réglages… › Intégrations.", "Linear lehnt den API-Schlüssel ab. Prüf ihn unter Vault › Einstellungen… › Integrationen."]),
    ("rate", ["Linear's rate limit is reached. Wait a minute, then refresh.", "De limiet van Linear is bereikt. Wacht een minuut en vernieuw dan.", "La limite de requêtes de Linear est atteinte. Attendez une minute, puis actualisez.", "Das Anfragelimit von Linear ist erreicht. Warte eine Minute und aktualisiere dann."]),
];

/// The mutation that moves an issue to another workflow state, compared with its whitespace collapsed.
const MOVE: &str = "mutation Move($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id sortOrder } } }";
const ASSIGN: &str = "mutation Assign($id: String!, $assigneeId: String) { issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }";
const COMMENT: &str = "mutation Comment($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }";
const UPLOAD: &str = "mutation Upload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }";
/// A new issue from the board (a lane's state, the board's Linear project or null), its variables checked below.
const CREATE: &str = "mutation Create($teamId: String!, $stateId: String!, $title: String!, $description: String!, $projectId: String) { issueCreate(input: { teamId: $teamId, stateId: $stateId, title: $title, description: $description, projectId: $projectId }) { success issue { id identifier title priority url sortOrder dueDate updatedAt state { id name type } labels { nodes { name } } assignee { name displayName } } } }";
const ATTACH: &str = "mutation Attach($id: String!, $title: String!, $url: String!) { attachmentCreate(input: { issueId: $id, title: $title, url: $url }) { success } }";
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
        let count = vars.as_object().map_or(0, |o| o.len());
        let moves = squash(q) == MOVE && count == 2 && linear_id(&vars["id"]) && linear_id(&vars["stateId"]);
        let text = |key: &str| vars[key].as_str().is_some_and(|s| !s.trim().is_empty());
        let writes = match squash(q).as_str() {
            ASSIGN => count == 2 && linear_id(&vars["id"]) && vars.get("assigneeId").is_some_and(|v| v.is_null() || linear_id(v)),
            COMMENT => count == 2 && linear_id(&vars["id"]) && text("body"),
            UPLOAD => count == 3 && text("contentType") && text("filename") && vars["size"].as_u64().is_some_and(|s| s <= 50_000_000),
            CREATE => count == 5 && linear_id(&vars["teamId"]) && linear_id(&vars["stateId"]) && text("title") && vars["description"].is_string()
                && vars.get("projectId").is_some_and(|v| v.is_null() || linear_id(v)),
            ATTACH => count == 3 && linear_id(&vars["id"]) && text("title") && vars["url"].as_str().is_some_and(|s| s.starts_with("https://uploads.linear.app/") && !s.chars().any(char::is_control)),
            _ => false,
        };
        (method == "POST" && path == "/graphql" && shape && q.len() < 4000 && (read || moves || writes)).then(|| "https://api.linear.app/graphql".into())
    },
    headers: |_, s| vec![format!("Authorization: {}", s[0]), "Content-Type: application/json".into()],
    upload: |url| url.len() < 16000 && !url.chars().any(char::is_control) &&
        ["https://uploads.linear.app/", "https://storage.googleapis.com/"].iter().any(|prefix| url.starts_with(prefix)),
    upload_kind: board_core::UploadKind::Put,
    thumb: |_| false,
    original: |_| false,
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
    actions: ACTIONS,
};

// ---------- agent actions (`relay linear.<id>`): fixed queries, the arguments only ever go in as variables

fn gql(query: &str, variables: Value) -> Result<Req, String> {
    Ok(Req { method: "POST", url: "https://api.linear.app/graphql".into(), body: Some(json!({ "query": query, "variables": variables })) })
}
fn uuid(s: &str) -> bool { linear_id(&json!(s)) }

const ACTIONS: &[Action] = &[
    read("teams", "Your teams; a new issue goes to one.", &[], |_, _| gql("{ teams { nodes { id key name } } }", json!({})), |v| v["data"]["teams"]["nodes"].clone()),
    write("create_issue", "Create an issue in a team.", &[("team", "team id"), ("title", "issue title"), ("description?", "body, Markdown")],
        |_, a| gql("mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
            json!({ "input": { "teamId": arg_ok(a, "team", uuid)?, "title": arg(a, "title"), "description": arg(a, "description").unwrap_or_default() } })),
        |v| v["data"]["issueCreate"]["issue"].clone()),
];
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actions_send_their_text_as_variables() {
        let act = |id: &str| PROVIDER.actions.iter().find(|a| a.id == id).unwrap();
        let r = (act("create_issue").build)(&json!({}), &json!({ "team": "9b1c-22", "title": "\" } mutation {" })).unwrap();
        let b = r.body.unwrap();
        assert!(!b["query"].as_str().unwrap().contains("mutation {"));
        assert_eq!(b["variables"]["input"]["teamId"], "9b1c-22");
        assert!((act("create_issue").build)(&json!({}), &json!({ "team": "x y", "title": "t" })).is_err());
    }
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
    fn allows_only_ticket_mutations_and_valid_variables() {
        let id = "2b1c3d4e-0000-4000-8000-00000000000a";
        let allowed = |query, variables| (PROVIDER.url)(&json!({}), "POST", "/graphql", &Some(json!({ "query": query, "variables": variables }))).is_some();
        assert!(allowed(ASSIGN, json!({ "id": id, "assigneeId": null })));
        assert!(allowed(ASSIGN, json!({ "id": id, "assigneeId": id })));
        assert!(!allowed(ASSIGN, json!({ "id": id })));
        assert!(!allowed(ASSIGN, json!({ "id": id, "assigneeId": "bad id" })));
        assert!(allowed(COMMENT, json!({ "id": id, "body": "hello" })));
        assert!(!allowed(COMMENT, json!({ "id": id, "body": " " })));
        assert!(allowed(UPLOAD, json!({ "contentType": "text/plain", "filename": "a.txt", "size": 12 })));
        assert!(!allowed(UPLOAD, json!({ "contentType": "text/plain", "filename": "a.txt", "size": 50_000_001 })));
        assert!(!allowed(UPLOAD, json!({ "contentType": "text/plain", "filename": "a.txt", "size": -1 })));
        assert!(allowed(ATTACH, json!({ "id": id, "title": "a.txt", "url": "https://uploads.linear.app/a" })));
        assert!(allowed(CREATE, json!({ "teamId": id, "stateId": id, "title": "T", "description": "", "projectId": null })));
        assert!(allowed(CREATE, json!({ "teamId": id, "stateId": id, "title": "T", "description": "body", "projectId": id })));
        assert!(!allowed(CREATE, json!({ "teamId": id, "stateId": id, "title": " ", "description": "", "projectId": null })));
        assert!(!allowed(CREATE, json!({ "teamId": "x y", "stateId": id, "title": "T", "description": "", "projectId": null })));
        assert!(!allowed(CREATE, json!({ "teamId": id, "stateId": id, "title": "T", "description": "" })));
        assert!(!allowed(ATTACH, json!({ "id": id, "title": "a.txt", "url": "https://uploads.linear.app.evil/a" })));
        assert!(!allowed(COMMENT, json!({ "id": id, "body": "hello", "extra": true })));
        assert!(!allowed(COMMENT, json!([])));
        assert!(!allowed(&format!("{COMMENT} mutation Delete {{ issueDelete(id: \"x\") {{ success }} }}"), json!({ "id": id, "body": "hi" })));
        assert!((PROVIDER.upload)("https://storage.googleapis.com/linear/file?signature=abc"));
        assert!((PROVIDER.upload)("https://uploads.linear.app/file?signature=abc"));
        for url in ["http://storage.googleapis.com/a", "https://storage.googleapis.com.evil/a", "https://uploads.linear.app@evil/a", "https://evil.com/a", "https://uploads.linear.app/a\noutput=x"] {
            assert!(!(PROVIDER.upload)(url));
        }
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
