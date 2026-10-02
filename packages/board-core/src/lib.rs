//! The backend half of the board contract (see README, "Integrations"). An integration crate exports one
//! `Provider`: where its API lives, which calls the webview may make, how the secrets are sent and how an
//! error reads. The app (src-tauri/src/providers.rs) registers it and does the rest: the secrets live in the
//! macOS keychain under `vault-app.<id>`, go to `security` and curl over stdin and never reach a webview,
//! and the config is settings.json `integrations.<id>`. Nothing in here is specific to one tracker.

use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Native strings in the app's language order (en, nl, fr, de): an integration's error messages.
pub type Text = &'static [(&'static str, [&'static str; 4])];

pub struct Provider {
    /// "productive": the key in settings.integrations, in the keychain service and in the webview's registry
    pub id: &'static str,
    /// shown in errors
    pub name: &'static str,
    /// the provider's own strings, for `t` and `not_ready`
    pub text: Text,
    /// settings.integrations.<id> with the defaults filled in, run on every load and save
    pub defaults: fn(&mut Value),
    /// a saved config the provider refuses, as a translated message
    pub check: fn(&Value) -> Result<(), String>,
    /// whether the config (without the token) is complete enough to make calls, e.g. an org id
    pub ready: fn(&Value) -> bool,
    /// the key in `text` of the error for a call made while `ready` is false
    pub not_ready: &'static str,
    /// the keychain accounts under `vault-app.<id>` that must all be there, in the order `headers` gets them
    pub secrets: &'static [&'static str],
    /// the full URL for a call the webview asks for, or None when it is not allowed: the allowlist
    pub url: fn(cfg: &Value, method: &str, path: &str, body: &Option<Value>) -> Option<String>,
    /// the headers that carry the secrets (in the order of `secrets`), and anything else the API wants
    pub headers: fn(cfg: &Value, secrets: &[String]) -> Vec<String>,
    /// whether a file may be posted as a form to this URL (Productive: its S3 bucket), never with the secrets
    pub upload: fn(url: &str) -> bool,
    /// whether a picture's preview may be fetched from this URL for the card panel (Productive: its public thumbs),
    /// never with the secrets
    pub thumb: fn(url: &str) -> bool,
    /// whether a 2xx answer is a success: a GraphQL API (Linear) answers its errors with 200 and `errors`
    pub ok: fn(body: &Value) -> bool,
    /// an error answer as one line: HTTP status and the API's own message
    pub error: fn(code: &str, body: &Value) -> String,
    /// where in Claude Code's MCP config the provider's credentials can come from, if anywhere
    pub mcp: Option<Mcp>,
}

/// A Claude Code MCP server that carries a provider's credentials in its env: a server whose name is `server` (or
/// contains it), the env names per keychain account (the first one set wins), and env -> config field.
pub struct Mcp {
    pub server: &'static str,
    pub secrets: &'static [(&'static str, &'static [&'static str])],
    pub fields: &'static [(&'static str, &'static str)],
}

/// The provider's credentials from Claude Code's config: the keychain accounts with their values, and the config
/// fields. Claude Code keeps a server for the user (`mcpServers` in ~/.claude.json), for a project
/// (`projects.<path>.mcpServers`) or shared in the project's .mcp.json; looked at in that order, a server named
/// exactly like `server` before one that only contains it. None when no server has every secret.
pub fn from_claude(p: &Provider, claude_json: &Value, vault: &str, mcp_json: &Value) -> Option<(Vec<(String, String)>, serde_json::Map<String, Value>)> {
    let m = p.mcp.as_ref()?;
    let scopes = [&claude_json["mcpServers"], &claude_json["projects"][vault]["mcpServers"], &mcp_json["mcpServers"]];
    let servers: Vec<(&String, &Value)> = scopes.iter().filter_map(|s| s.as_object()).flatten().collect();
    let read = |env: &Value| -> Option<Vec<(String, String)>> {
        m.secrets.iter().map(|(acct, names)| names.iter().find_map(|n| env[*n].as_str().filter(|v| !v.is_empty())).map(|v| (acct.to_string(), v.to_string()))).collect()
    };
    let exact = servers.iter().find(|(n, s)| n.to_lowercase() == m.server && read(&s["env"]).is_some());
    let (_, s) = exact.or_else(|| servers.iter().find(|(n, s)| n.to_lowercase().contains(m.server) && read(&s["env"]).is_some()))?;
    let fields = m.fields.iter().map(|(env, key)| (key.to_string(), Value::from(s["env"][*env].as_str().unwrap_or("")))).collect();
    Some((read(&s["env"])?, fields))
}

// ---------- strings: the app sets the language, an integration looks its keys up in its own `Text`

static LANG: AtomicUsize = AtomicUsize::new(0);
/// The UI language as an index in en, nl, fr, de; kept in step by the app.
pub fn set_lang(i: usize) { LANG.store(i.min(3), Ordering::Relaxed); }
/// `key` from `text` in the current language, the key itself when it is not there.
pub fn t(text: Text, key: &str) -> String {
    text.iter().find(|(k, _)| *k == key).map_or(key, |(_, row)| row[LANG.load(Ordering::Relaxed)]).to_string()
}
/// `t` with `{v}` filled in.
pub fn t_v(text: Text, key: &str, v: &str) -> String { t(text, key).replace("{v}", v) }

const TEXT: Text = &[("unknown", ["unknown error", "onbekende fout", "erreur inconnue", "unbekannter Fehler"])];
/// For an error answer without a message.
pub fn unknown() -> String { t(TEXT, "unknown") }
/// The API's message, or `unknown()`.
pub fn message(m: Option<&str>) -> String { m.map_or_else(unknown, str::to_string) }

// ---------- allowlist helpers

/// A path the webview may put after an API's base URL: no way out of it, nothing curl reads as syntax.
pub fn path_ok(path: &str) -> bool {
    path.starts_with('/') && path.len() < 600 && !path.contains("..") && path.chars().all(|c| c.is_ascii_alphanumeric() || "/?&=[]_-.,%".contains(c))
}
/// A body that is a JSON object with only these keys (all optional).
pub fn only_keys(body: &Option<Value>, keys: &[&str]) -> bool {
    body.as_ref().and_then(Value::as_object).is_some_and(|o| o.keys().all(|k| keys.contains(&k.as_str())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn paths_stay_under_the_base_url() {
        assert!(path_ok("/tasks?filter[folder_id]=3&page[size]=200"));
        assert!(!path_ok("tasks") && !path_ok("/../x") && !path_ok("/a b") && !path_ok("/a\"b"));
        assert!(only_keys(&Some(json!({ "a": 1 })), &["a", "b"]) && !only_keys(&Some(json!({ "c": 1 })), &["a"]) && !only_keys(&None, &["a"]));
    }
    #[test]
    fn strings_follow_the_language() {
        const T: Text = &[("x", ["one", "een", "un", "eins"])];
        set_lang(1);
        assert_eq!(t(T, "x"), "een");
        assert_eq!(t(T, "y"), "y");
        set_lang(0);
        assert_eq!(t_v(&[("v", ["a {v}", "", "", ""])], "v", "b"), "a b");
    }
}
