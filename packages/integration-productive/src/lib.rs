//! Productive on the backend: org and user id in the config, the API token in the keychain
//! (vault-app.productive/token). GET on any path, PATCH only on a single task (a card moved to another column).

use board_core::{path_ok, t, t_v, Provider, Text};
use serde_json::{json, Value};

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
};

/// Token, org and user from Claude Code's own Productive MCP config (~/.claude.json, read by the app):
/// the token for the keychain, and the config fields for the settings window to save.
/// The Productive MCP server's credentials from Claude Code's config, wherever Claude Code keeps the server: for the
/// user (`mcpServers`), for the vault as a project (`projects.<vault>.mcpServers`), or shared in the vault's .mcp.json
/// (`mcp_json`, Null when there is none).
pub fn import(claude_json: &Value, vault: &str, mcp_json: &Value) -> Result<(String, Value), String> {
    let has = |s: &Value| s["productive"]["env"]["PRODUCTIVE_API_TOKEN"].is_string();
    let servers = [&claude_json["mcpServers"], &claude_json["projects"][vault]["mcpServers"], &mcp_json["mcpServers"]];
    let env = &servers.into_iter().find(|s| has(s)).unwrap_or(&Value::Null)["productive"]["env"];
    let token = env["PRODUCTIVE_API_TOKEN"].as_str().ok_or_else(|| t(TEXT, "no_import_token"))?;
    Ok((token.to_string(), json!({ "org": env["PRODUCTIVE_ORG_ID"].as_str().unwrap_or(""), "user": env["PRODUCTIVE_USER_ID"].as_str().unwrap_or("") })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_from_wherever_claude_code_keeps_the_server() {
        let env = json!({"env": {"PRODUCTIVE_API_TOKEN": "t", "PRODUCTIVE_ORG_ID": "9093", "PRODUCTIVE_USER_ID": "7"}});
        let fields = json!({"org": "9093", "user": "7"});
        assert_eq!(import(&json!({"mcpServers": {"productive": env}}), "/v", &Value::Null).unwrap(), ("t".into(), fields.clone()));
        assert_eq!(import(&json!({"projects": {"/v": {"mcpServers": {"productive": env}}}}), "/v", &Value::Null).unwrap(), ("t".into(), fields.clone()));
        assert_eq!(import(&json!({}), "/v", &json!({"mcpServers": {"productive": env}})).unwrap(), ("t".into(), fields));
        assert!(import(&json!({"projects": {"/other": {"mcpServers": {"productive": env}}}}), "/v", &Value::Null).is_err());
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
        let (tok, cfg) = import(&json!({ "mcpServers": { "productive": { "env": { "PRODUCTIVE_API_TOKEN": "abc", "PRODUCTIVE_ORG_ID": "7" } } } }), "", &Value::Null).unwrap();
        assert_eq!((tok.as_str(), cfg), ("abc", json!({ "org": "7", "user": "" })));
        assert!(import(&json!({}), "", &Value::Null).is_err());
    }
}
