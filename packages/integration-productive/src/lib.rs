//! Productive on the backend: org and user id in the config, the API token in the keychain
//! (vault-app.productive/token). GET on any path, PATCH only on a single task (a card moved to another column).

use board_core::{path_ok, t, t_v, Provider, Text};
use serde_json::json;

const TEXT: Text = &[
    ("digits", ["Productive: {v} may only contain digits", "Productive: {v} bestaat enkel uit cijfers", "Productive : {v} ne peut contenir que des chiffres", "Productive: {v} darf nur Ziffern enthalten"]),
    ("org_id", ["organisation ID", "organisatie-id", "l'ID d'organisation", "die Organisations-ID"]),
    ("user_id", ["user ID", "gebruikers-id", "l'ID utilisateur", "die Benutzer-ID"]),
    ("no_org", ["No organisation ID. Fill it in under Vault › Settings… › Integrations.", "Geen organisatie-id. Vul het in bij Vault › Instellingen… › Integraties.", "Aucun ID d'organisation. Renseignez-le dans Vault › Réglages… › Intégrations.", "Keine Organisations-ID. Trag sie unter Vault › Einstellungen… › Integrationen ein."]),
    ("no_import_token", ["No Productive token in ~/.claude.json", "Geen Productive-token in ~/.claude.json", "Aucun jeton Productive dans ~/.claude.json", "Kein Productive-Token in ~/.claude.json"]),
];

pub const PROVIDER: Provider = Provider {
    id: "productive",
    name: "Productive",
    text: TEXT,
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        for k in ["org", "user"] { if !c[k].is_string() { c[k] = json!(""); } }
    },
    check: |c| {
        for k in ["org", "user"] {
            if !c[k].as_str().unwrap().chars().all(|x| x.is_ascii_digit()) {
                return Err(t_v(TEXT, "digits", &t(TEXT, if k == "org" { "org_id" } else { "user_id" })));
            }
        }
        Ok(())
    },
    ready: |c| !c["org"].as_str().unwrap_or("").is_empty(),
    not_ready: "no_org",
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
        format!("Productive {code}: {}", board_core::message(e["detail"].as_str().or(e["title"].as_str())))
    },
    mcp: Some(board_core::Mcp { server: "productive", secrets: &[("token", &["PRODUCTIVE_API_TOKEN"])],
        fields: &[("PRODUCTIVE_ORG_ID", "org"), ("PRODUCTIVE_USER_ID", "user")] }),
};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    #[test]
    fn imports_from_wherever_claude_code_keeps_the_server() {
        let env = json!({"env": {"PRODUCTIVE_API_TOKEN": "t", "PRODUCTIVE_ORG_ID": "9093", "PRODUCTIVE_USER_ID": "7"}});
        let fields = json!({"org": "9093", "user": "7"});
        let import = |c: Value, v: &str, m: Value| board_core::from_claude(&PROVIDER, &c, v, &m).map(|(s, f)| (s, Value::Object(f)));
        let want = Some((vec![("token".to_string(), "t".to_string())], fields));
        assert_eq!(import(json!({"mcpServers": {"productive": env}}), "/v", Value::Null), want);
        assert_eq!(import(json!({"projects": {"/v": {"mcpServers": {"productive": env}}}}), "/v", Value::Null), want);
        assert_eq!(import(json!({}), "/v", json!({"mcpServers": {"productive": env}})), want);
        assert_eq!(import(json!({"projects": {"/other": {"mcpServers": {"productive": env}}}}), "/v", Value::Null), None);
        // the exact name wins over one that contains it (productive-dev next to productive)
        let dev = json!({"env": {"PRODUCTIVE_API_TOKEN": "dev"}});
        assert_eq!(import(json!({"mcpServers": {"productive-dev": dev, "productive": env}}), "/v", Value::Null).unwrap().0[0].1, "t");
    }
    #[test]
    fn allows_reads_and_moving_one_task() {
        let p = &PROVIDER;
        let c = json!({ "org": "1" });
        assert!((p.url)(&c, "GET", "/tasks?filter[folder_id]=3&page[size]=200", &None).is_some());
        assert!((p.url)(&c, "PATCH", "/tasks/42", &Some(json!({}))).is_some());
        assert!((p.url)(&c, "PATCH", "/tasks", &Some(json!({}))).is_none());
        assert!((p.url)(&c, "DELETE", "/tasks/42", &None).is_none());
        assert!((p.url)(&c, "GET", "/../x", &None).is_none());
        assert!((p.ready)(&c) && !(p.ready)(&json!({ "org": "" })));
        assert_eq!((p.headers)(&c, &["t-1".into()])[..2], ["X-Auth-Token: t-1".to_string(), "X-Organization-Id: 1".into()]);
    }
    #[test]
    fn config_ids_are_digits_and_errors_read_as_one_line() {
        let p = &PROVIDER;
        assert!((p.check)(&json!({ "org": "12", "user": "" })).is_ok());
        assert!((p.check)(&json!({ "org": "x1", "user": "" })).unwrap_err().contains("organisation ID"));
        assert_eq!((p.error)("422", &json!({ "errors": [{ "detail": "bad list" }] })), "Productive 422: bad list");
        assert_eq!((p.error)("500", &Value::Null), "Productive 500: unknown error");
    }
    #[test]
    fn import_reads_the_mcp_config() {
        let (tok, cfg) = board_core::from_claude(&PROVIDER, &json!({ "mcpServers": { "productive": { "env": { "PRODUCTIVE_API_TOKEN": "abc", "PRODUCTIVE_ORG_ID": "7" } } } }), "", &Value::Null).unwrap();
        assert_eq!((tok, Value::Object(cfg)), (vec![("token".to_string(), "abc".to_string())], json!({ "org": "7", "user": "" })));
        assert!(board_core::from_claude(&PROVIDER, &json!({}), "", &Value::Null).is_none());
    }
}
