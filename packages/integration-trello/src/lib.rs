//! Trello on the backend: an API key and a user token, both in the keychain (vault-app.trello/key and /token),
//! sent in the OAuth header (not in the URL). GET under the member, a board or a workspace; PUT only on a
//! single card with nothing but its list and position.

use board_core::{only_keys, path_ok, t, Provider, Text};
use serde_json::json;

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
        let read = method == "GET" && ["/members/me", "/boards/", "/organizations/"].iter().any(|p| path.starts_with(p));
        let one_card = path.strip_prefix("/cards/").is_some_and(trello_id);
        let move_only = only_keys(body, &["idList", "pos"]) && body.as_ref().is_some_and(|b| b["idList"].as_str().is_some_and(trello_id));
        (path_ok(path) && (read || (method == "PUT" && one_card && move_only))).then(|| format!("https://api.trello.com/1{path}"))
    },
    headers: |_, s| vec![format!("Authorization: OAuth oauth_consumer_key=\"{}\", oauth_token=\"{}\"", s[0], s[1]),
        "Content-Type: application/json".into(), "Accept: application/json".into()],
    upload: |_| false,
    thumb: |_| false,
    ok: |_| true,
    error: |code, v| match code {
        "401" | "403" => t(TEXT, "auth"),
        "429" => t(TEXT, "rate"),
        _ => format!("Trello {code}: {}", board_core::message(v.as_str().or(v["message"].as_str()))),
    },
    mcp: Some(board_core::Mcp { server: "trello", secrets: &[("key", &["TRELLO_API_KEY"]), ("token", &["TRELLO_TOKEN", "TRELLO_API_TOKEN"])], fields: &[] }),
};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
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
    fn errors_read_as_one_line() {
        let p = &PROVIDER;
        assert_eq!((p.error)("401", &json!("invalid token")), t(TEXT, "auth"));
        assert_eq!((p.error)("429", &Value::Null), t(TEXT, "rate"));
        assert_eq!((p.error)("400", &json!("invalid value for idList")), "Trello 400: invalid value for idList");
        assert_eq!((p.error)("404", &json!({ "message": "not found" })), "Trello 404: not found");
    }
}
