// The agent providers (packages/agent-*), registered in one place, and what the app keeps about them:
// settings.agents (switched on, default, binary override) and sessions.json (conversation -> provider + session).
// No translated strings here: the app adds those (src-tauri/src/agents.rs), `relay serve` has no UI language.

use agent_core::AgentProvider;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Every agent provider, in the order of the settings and the composer. A new one is one line here and one in
/// src/agents/index.ts.
pub static PROVIDERS: &[&dyn AgentProvider] = &[&agent_claude::PROVIDER, &agent_codex::PROVIDER, &agent_opencode::PROVIDER, &agent_pi::PROVIDER];
/// The provider of everything from before the providers: sessions.json strings, old pending files, `t:<sid>`.
pub const FIRST: &str = "claude";

pub fn find(id: &str) -> Option<&'static dyn AgentProvider> { PROVIDERS.iter().copied().find(|p| p.id() == id) }
pub fn get_or_first(id: Option<&str>) -> &'static dyn AgentProvider {
    id.and_then(find).unwrap_or(PROVIDERS[0])
}

/// `settings.agents = {default, providers: {<id>: {on, bin}}}`, filled in: Claude Code on, the default a
/// switched-on provider.
pub fn migrate(v: &mut Value) {
    if !v["agents"].is_object() { v["agents"] = json!({}); }
    let a = &mut v["agents"];
    if !a["providers"].is_object() { a["providers"] = json!({}); }
    for p in PROVIDERS {
        let c = &mut a["providers"][p.id()];
        if !c.is_object() { *c = json!({}); }
        if !c["on"].is_boolean() { c["on"] = json!(p.id() == FIRST); }
        if !c["bin"].is_string() { c["bin"] = json!(""); }
    }
    let on = |id: &str| a["providers"][id]["on"] == true;
    let cur = a["default"].as_str().unwrap_or("").to_string();
    if !PROVIDERS.iter().any(|p| p.id() == cur && on(&cur)) {
        a["default"] = json!(PROVIDERS.iter().find(|p| on(p.id())).map_or(FIRST, |p| p.id()));
    }
}

pub fn enabled(s: &Value) -> Vec<&'static dyn AgentProvider> {
    PROVIDERS.iter().copied().filter(|p| s["agents"]["providers"][p.id()]["on"] == true).collect()
}
pub fn default_id(s: &Value) -> String { s["agents"]["default"].as_str().unwrap_or(FIRST).to_string() }
/// The binary: the settings' override, else where the provider installs itself, else the same name on the login
/// PATH (an npm or Homebrew install).
pub fn bin(s: &Value, p: &dyn AgentProvider, home: &str, path: &str) -> String {
    Some(s["agents"]["providers"][p.id()]["bin"].as_str().unwrap_or("")).filter(|b| !b.is_empty()).map(String::from).unwrap_or_else(|| {
        let def = p.default_bin(home);
        if std::path::Path::new(&def).is_file() { return def; }
        def.rsplit('/').next().and_then(|n| agent_core::which(n, path)).unwrap_or(def)
    })
}

/// A conversation's session: which provider, and its session id there.
#[derive(Clone, Debug, PartialEq)]
pub struct Sess { pub provider: String, pub sid: String }

/// sessions.json: `{key: "<sid>"}` is Claude's (every file from before the providers), `{key: {provider, sid}}`
/// another provider's. Claude's stay strings, so an older build still reads the file.
pub fn load_sessions(raw: &str) -> HashMap<String, Sess> {
    let m: Map<String, Value> = serde_json::from_str(raw).unwrap_or_default();
    m.into_iter().filter_map(|(k, v)| match v {
        Value::String(sid) => Some((k, Sess { provider: FIRST.into(), sid })),
        Value::Object(o) => Some((k, Sess { provider: o.get("provider")?.as_str()?.into(), sid: o.get("sid")?.as_str()?.into() })),
        _ => None,
    }).collect()
}
pub fn save_sessions(m: &HashMap<String, Sess>) -> String {
    let o: Map<String, Value> = m.iter().map(|(k, s)| (k.clone(), if s.provider == FIRST { json!(s.sid) } else { json!({"provider": s.provider, "sid": s.sid}) })).collect();
    serde_json::to_string_pretty(&Value::Object(o)).unwrap()
}

/// A terminal key: `t:<sid>` is Claude's, `t:<provider>:<sid>` another provider's.
pub fn term_key(key: &str) -> Option<(&'static dyn AgentProvider, String)> {
    let rest = key.strip_prefix("t:")?;
    match rest.split_once(':') {
        Some((p, sid)) => Some((find(p)?, sid.to_string())),
        None => Some((find(FIRST)?, rest.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sessions_json_stays_readable_both_ways() {
        let m = load_sessions(r#"{"c:1": "36099ce4-d17c", "p": {"provider": "codex", "sid": "abc"}, "bad": 3}"#);
        assert_eq!(m["c:1"], Sess { provider: "claude".into(), sid: "36099ce4-d17c".into() });
        assert_eq!(m["p"].provider, "codex");
        assert_eq!(m.len(), 2);
        let back: Value = serde_json::from_str(&save_sessions(&m)).unwrap();
        assert_eq!(back["c:1"], "36099ce4-d17c");
        assert_eq!(back["p"], json!({"provider": "codex", "sid": "abc"}));
        assert!(load_sessions("").is_empty());
    }
    #[test]
    fn settings_fill_in_claude() {
        let mut v = json!({});
        migrate(&mut v);
        assert_eq!(v["agents"], json!({"default": "claude", "providers": {"claude": {"on": true, "bin": ""}, "codex": {"on": false, "bin": ""}, "opencode": {"on": false, "bin": ""}, "pi": {"on": false, "bin": ""}}}));
        assert_eq!(bin(&json!({}), PROVIDERS[0], "/h", ""), "/h/.local/bin/claude");
        assert!(term_key("t:abc").is_some_and(|(p, s)| p.id() == "claude" && s == "abc"));
        assert!(term_key("t:nope:abc").is_none() && term_key("c:1").is_none());
    }
}
