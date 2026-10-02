//! Trello on the backend: an API key and a user token, both in the keychain (vault-app.trello/key and /token),
//! sent in the OAuth header (not in the URL). GET under the member, a board or a workspace; PUT only on a
//! single card for list changes, a new card in a list, comments and individual member changes. File uploads use a
//! separate allowlist.

use board_core::{arg, arg_ok, only_keys, path_ok, read, t, write, Action, Provider, Req, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("auth", ["Trello refused the API key or token. Check both under Vault › Settings… › Integrations.", "Trello weigert de API-sleutel of het token. Controleer ze bij Vault › Instellingen… › Integraties.", "Trello refuse la clé API ou le jeton. Vérifiez-les dans Vault › Réglages… › Intégrations.", "Trello lehnt den API-Schlüssel oder das Token ab. Prüf beide unter Vault › Einstellungen… › Integrationen."]),
    ("rate", ["Trello's rate limit is reached. Wait a few seconds, then refresh.", "De limiet van Trello is bereikt. Wacht een paar seconden en vernieuw dan.", "La limite de requêtes de Trello est atteinte. Attendez quelques secondes, puis actualisez.", "Das Anfragelimit von Trello ist erreicht. Warte ein paar Sekunden und aktualisiere dann."]),
];

/// A Trello id: 24 hex digits.
fn trello_id(s: &str) -> bool { s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) }

pub const PROVIDER: Provider = Provider {
    id: "trello",
    name: "Trello",
    text: TEXT,
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        if !c["mine"].is_boolean() { c["mine"] = json!(false); }
    },
    check: |_| Ok(()),
    ready: |_| true,
    not_ready: "",
    secrets: &["key", "token"],
    url: |_, method, path, body| {
        let parts: Vec<_> = path.split('?').next().unwrap_or("").trim_start_matches('/').split('/').collect();
        let card = parts.len() >= 2 && parts[0] == "cards" && trello_id(parts[1]);
        let card_read = card && (parts.len() == 2 || (parts.len() == 3 && ["actions", "attachments"].contains(&parts[2])));
        let comment = card && parts.len() == 4 && parts[2..] == ["actions", "comments"] && method == "POST"
            && only_keys(body, &["text"]) && body.as_ref().is_some_and(|b| b["text"].as_str().is_some_and(|s| !s.trim().is_empty()));
        let add = card && parts.len() == 3 && parts[2] == "idMembers" && method == "POST"
            && only_keys(body, &["value"]) && body.as_ref().is_some_and(|b| b["value"].as_str().is_some_and(trello_id));
        let remove = card && parts.len() == 4 && parts[2] == "idMembers" && trello_id(parts[3]) && method == "DELETE" && body.is_none();
        let read = method == "GET" && (card_read || ["/members/me", "/boards/", "/organizations/"].iter().any(|p| path.starts_with(p)));
        let one_card = path.strip_prefix("/cards/").is_some_and(trello_id);
        let move_only = only_keys(body, &["idList", "pos"]) && body.as_ref().is_some_and(|b| b["idList"].as_str().is_some_and(trello_id));
        // a new card from the board: in a list, with a name, nothing else
        let create = method == "POST" && path == "/cards" && only_keys(body, &["idList", "name", "desc", "pos"])
            && body.as_ref().is_some_and(|b| b["idList"].as_str().is_some_and(trello_id) && b["name"].as_str().is_some_and(|s| !s.trim().is_empty()) && b["pos"] == "bottom");
        (path_ok(path) && (read || comment || add || remove || create || (method == "PUT" && one_card && move_only))).then(|| format!("https://api.trello.com/1{path}"))
    },
    headers: |_, s| vec![format!("Authorization: OAuth oauth_consumer_key=\"{}\", oauth_token=\"{}\"", s[0], s[1]),
        "Content-Type: application/json".into(), "Accept: application/json".into()],
    upload: |url| url.strip_prefix("https://api.trello.com/1/cards/")
        .and_then(|r| r.strip_suffix("/attachments")).is_some_and(trello_id),
    upload_kind: board_core::UploadKind::Trello,
    thumb: |_| false,
    ok: |_| true,
    error: |code, v| match code {
        "401" | "403" => t(TEXT, "auth"),
        "429" => t(TEXT, "rate"),
        _ => format!("Trello {code}: {}", board_core::message(v.as_str().or(v["message"].as_str()))),
    },
    mcp: Some(board_core::Mcp { server: "trello", secrets: &[("key", &["TRELLO_API_KEY"]), ("token", &["TRELLO_TOKEN", "TRELLO_API_TOKEN"])], fields: &[] }),
    actions: ACTIONS,
};

// ---------- agent actions (`relay trello.<id>`)

fn api(method: &'static str, path: String, body: Option<Value>) -> Result<Req, String> { Ok(Req { method, url: format!("https://api.trello.com/1{path}"), body }) }
fn id_ok(s: &str) -> bool { trello_id(s) }
fn named(v: &Value) -> Value { v.as_array().map(|d| d.iter().map(|r| json!({ "id": r["id"], "name": r["name"] })).collect()).unwrap_or_default() }

const ACTIONS: &[Action] = &[
    read("boards", "Your open boards.", &[], |_, _| api("GET", "/members/me/boards?filter=open&fields=name".into(), None), named),
    read("lists", "The open lists of a board, where a new card goes.", &[("board", "board id")],
        |_, a| api("GET", format!("/boards/{}/lists?filter=open&fields=name", arg_ok(a, "board", id_ok)?), None), named),
    write("create_card", "Create a card at the bottom of a list.", &[("list", "list id"), ("name", "card title"), ("desc?", "description, Markdown")],
        |_, a| api("POST", "/cards".into(), Some(json!({ "idList": arg_ok(a, "list", id_ok)?, "name": arg(a, "name"), "desc": arg(a, "desc").unwrap_or_default(), "pos": "bottom" }))),
        |v| json!({ "id": v["id"], "url": v["shortUrl"] })),
    write("comment", "Comment on a card.", &[("card", "card id"), ("text", "the comment, Markdown")],
        |_, a| api("POST", format!("/cards/{}/actions/comments", arg_ok(a, "card", id_ok)?), Some(json!({ "text": arg(a, "text") }))),
        |v| json!({ "id": v["id"] })),
];

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    #[test]
    fn actions_check_ids_before_they_reach_the_url() {
        let act = |id: &str| PROVIDER.actions.iter().find(|a| a.id == id).unwrap();
        let list = "60718293a4b55f1b2c3d4e5f";
        let r = (act("create_card").build)(&json!({}), &json!({ "list": list, "name": "N" })).unwrap();
        assert_eq!((r.method, r.url.as_str(), r.body.unwrap()["idList"].as_str()), ("POST", "https://api.trello.com/1/cards", Some(list)));
        assert!((act("lists").build)(&json!({}), &json!({ "board": "x/../members" })).is_err());
        assert_eq!((act("boards").out)(&json!([{ "id": "1", "name": "B", "x": 2 }])), json!([{ "id": "1", "name": "B" }]));
    }
    #[test]
    fn allows_reads_and_moving_one_card() {
        let p = &PROVIDER;
        let (c, card, list) = (json!({}), "5f1b2c3d4e5f60718293a4b5", "60718293a4b55f1b2c3d4e5f");
        assert!((p.url)(&c, "GET", "/members/me/boards?filter=open&fields=name,idOrganization", &None).is_some());
        assert!((p.url)(&c, "GET", &format!("/boards/{card}/cards/open?fields=name,idList"), &None).is_some());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "idList": list, "pos": "bottom" }))).is_some());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "idList": list, "closed": true }))).is_none());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "idList": "x" }))).is_none());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &Some(json!({ "pos": "top" }))).is_none());
        assert!((p.url)(&c, "PUT", &format!("/cards/{card}"), &None).is_none());
        assert!((p.url)(&c, "DELETE", &format!("/cards/{card}"), &None).is_none());
        assert!((p.url)(&c, "GET", "/tokens/abc", &None).is_none());
        assert!((p.url)(&c, "GET", "/boards/../x", &None).is_none());
        let h = (p.headers)(&c, &["k1".into(), "t2".into()]);
        assert_eq!(h[0], r#"Authorization: OAuth oauth_consumer_key="k1", oauth_token="t2""#);
    }
    #[test]
    fn ticket_calls_and_uploads_are_scoped() {
        let id = "5f1b2c3d4e5f60718293a4b5";
        let allowed = |method, path: &str, body| (PROVIDER.url)(&json!({}), method, path, &body).is_some();
        assert!(allowed("GET", &format!("/cards/{id}?fields=name,desc&attachments=true"), None));
        assert!(allowed("GET", &format!("/cards/{id}/actions?filter=all&limit=1000&before={id}"), None));
        assert!(allowed("POST", &format!("/cards/{id}/actions/comments"), Some(json!({ "text": "hello" }))));
        assert!(allowed("POST", "/cards", Some(json!({ "idList": id, "name": "T", "desc": "", "pos": "bottom" }))));
        assert!(!allowed("POST", "/cards", Some(json!({ "idList": id, "name": " ", "pos": "bottom" }))));
        assert!(!allowed("POST", "/cards", Some(json!({ "idList": id, "name": "T", "pos": "bottom", "idMembers": [id] }))));
        assert!(!allowed("POST", "/cards", Some(json!({ "idList": "bad", "name": "T", "pos": "bottom" }))));
        assert!(allowed("POST", &format!("/cards/{id}/idMembers"), Some(json!({ "value": id }))));
        assert!(allowed("DELETE", &format!("/cards/{id}/idMembers/{id}"), None));
        assert!(!allowed("DELETE", &format!("/cards/{id}"), None));
        assert!(!allowed("POST", &format!("/cards/{id}/actions/comments"), Some(json!({ "text": "hi", "x": true }))));
        assert!(!allowed("POST", &format!("/cards/{id}/idMembers"), Some(json!({ "value": "bad" }))));
        assert!(!allowed("GET", "/cards/invalid", None));
        assert!((PROVIDER.upload)(&format!("https://api.trello.com/1/cards/{id}/attachments")));
        for url in [format!("https://api.trello.com.evil/1/cards/{id}/attachments"), format!("https://api.trello.com/1/cards/{id}/attachments?key=x"), "https://api.trello.com/1/cards/../attachments".into()] {
            assert!(!(PROVIDER.upload)(&url));
        }
    }
    #[test]
    fn errors_read_as_one_line() {
        let p = &PROVIDER;
        assert_eq!((p.error)("401", &json!("invalid token")), t(TEXT, "auth"));
        assert_eq!((p.error)("429", &Value::Null), t(TEXT, "rate"));
        assert_eq!((p.error)("400", &json!("invalid value for idList")), "Trello 400: invalid value for idList");
        assert_eq!((p.error)("404", &json!({ "message": "not found" })), "Trello 404: not found");
    }
}
