// The agent providers (packages/agent-*), registered in one place, and what the app keeps about them:
// settings.agents (switched on, default, binary override) and sessions.json (conversation -> provider + session).

use agent_core::AgentProvider;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Every agent provider, in the order of the settings and the composer. A new one is one line here and one in
/// src/agents/index.ts.
pub static PROVIDERS: &[&dyn AgentProvider] = &[&agent_claude::PROVIDER, &agent_codex::PROVIDER, &agent_opencode::PROVIDER];
/// The provider of everything from before the providers: sessions.json strings, old pending files, `t:<sid>`.
pub const FIRST: &str = "claude";

pub fn get(id: &str) -> Result<&'static dyn AgentProvider, String> {
    PROVIDERS.iter().copied().find(|p| p.id() == id).ok_or_else(|| super::trc_v("err.no_agent", id))
}
pub fn get_or_first(id: Option<&str>) -> &'static dyn AgentProvider {
    id.and_then(|i| get(i).ok()).unwrap_or(PROVIDERS[0])
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
        if p.caps().accounts {
            // accounts: the extra logins as {name, dir}; active: the one new conversations start on ("" the CLI's own);
            // auto: move to the next account when one's limits are used up
            let list: Vec<Value> = c["accounts"].as_array().into_iter().flatten()
                .filter(|a| a["dir"].as_str().is_some_and(|d| !d.is_empty()) && a["name"].is_string()).cloned().collect();
            let active = c["active"].as_str().filter(|d| list.iter().any(|a| a["dir"] == *d)).unwrap_or("").to_string();
            (c["accounts"], c["active"]) = (json!(list), json!(active));
            if !c["auto"].is_boolean() { c["auto"] = json!(false); }
        }
    }
    let on = |id: &str| a["providers"][id]["on"] == true;
    let cur = a["default"].as_str().unwrap_or("").to_string();
    if !PROVIDERS.iter().any(|p| p.id() == cur && on(&cur)) {
        a["default"] = json!(PROVIDERS.iter().find(|p| on(p.id())).map_or(FIRST, |p| p.id()));
    }
}

/// At least one provider on, and every binary override an absolute path.
pub fn check(v: &Value) -> Result<(), String> {
    if !PROVIDERS.iter().any(|p| v["agents"]["providers"][p.id()]["on"] == true) { return Err(super::trc("err.agent_none")); }
    for p in PROVIDERS {
        let b = v["agents"]["providers"][p.id()]["bin"].as_str().unwrap_or("");
        if !b.is_empty() && (!b.starts_with('/') || b.len() > 500 || b.contains(['\n', '\0'])) { return Err(super::trc_v("err.agent_bin", p.name())); }
        for a in v["agents"]["providers"][p.id()]["accounts"].as_array().into_iter().flatten() {
            let (d, n) = (a["dir"].as_str().unwrap_or(""), a["name"].as_str().unwrap_or(""));
            if !d.starts_with('/') || d.len() > 500 || d.contains(['\n', '\0']) || n.chars().count() > 40 { return Err(super::trc_v("err.agent_account", p.name())); }
        }
    }
    Ok(())
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

/// A provider's accounts as config folders, the CLI's own ("") first. Just "" for a provider without accounts.
pub fn accounts(s: &Value, p: &dyn AgentProvider) -> Vec<String> {
    let c = &s["agents"]["providers"][p.id()];
    let extra = c["accounts"].as_array().into_iter().flatten().filter_map(|a| a["dir"].as_str()).map(String::from);
    std::iter::once(String::new()).chain(extra.filter(|_| p.caps().accounts)).collect()
}
/// The account a conversation runs on: `cur` (its own, or the active one for a new conversation) while it still
/// exists; with `auto` and `cur` used up, the next account after it that is not, round the list.
pub fn pick_account(list: &[String], cur: &str, auto: bool, spent: impl Fn(&str) -> bool) -> String {
    let i = list.iter().position(|a| a == cur).unwrap_or(0);
    if !auto || !spent(&list[i]) { return list[i].clone(); }
    (1..list.len()).map(|n| &list[(i + n) % list.len()]).find(|a| !spent(a)).unwrap_or(&list[i]).clone()
}

/// A conversation's session: which provider, its session id there, and the account (config folder, "" the CLI's own).
#[derive(Clone, Debug, PartialEq)]
pub struct Sess { pub provider: String, pub sid: String, pub account: String }

/// sessions.json: `{key: "<sid>"}` is Claude's on its own account (every file from before the providers),
/// `{key: {provider, sid, account?}}` the rest. Those stay strings, so an older build still reads the file.
pub fn load_sessions(raw: &str) -> HashMap<String, Sess> {
    let m: Map<String, Value> = serde_json::from_str(raw).unwrap_or_default();
    m.into_iter().filter_map(|(k, v)| match v {
        Value::String(sid) => Some((k, Sess { provider: FIRST.into(), sid, account: String::new() })),
        Value::Object(o) => Some((k, Sess { provider: o.get("provider")?.as_str()?.into(), sid: o.get("sid")?.as_str()?.into(),
            account: o.get("account").and_then(Value::as_str).unwrap_or("").into() })),
        _ => None,
    }).collect()
}
pub fn save_sessions(m: &HashMap<String, Sess>) -> String {
    let o: Map<String, Value> = m.iter().map(|(k, s)| (k.clone(), match (s.provider == FIRST, s.account.is_empty()) {
        (true, true) => json!(s.sid),
        (_, true) => json!({"provider": s.provider, "sid": s.sid}),
        _ => json!({"provider": s.provider, "sid": s.sid, "account": s.account}),
    })).collect();
    serde_json::to_string_pretty(&Value::Object(o)).unwrap()
}

/// A terminal key: `t:<sid>` is Claude's, `t:<provider>:<sid>` another provider's.
pub fn term_key(key: &str) -> Option<(&'static dyn AgentProvider, String)> {
    let rest = key.strip_prefix("t:")?;
    match rest.split_once(':') {
        Some((p, sid)) => Some((get(p).ok()?, sid.to_string())),
        None => Some((get(FIRST).ok()?, rest.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sessions_json_stays_readable_both_ways() {
        let m = load_sessions(r#"{"c:1": "36099ce4-d17c", "p": {"provider": "codex", "sid": "abc"}, "w": {"provider": "claude", "sid": "d1", "account": "/h/.claude-work"}, "bad": 3}"#);
        assert_eq!(m["c:1"], Sess { provider: "claude".into(), sid: "36099ce4-d17c".into(), account: "".into() });
        assert_eq!(m["p"].provider, "codex");
        assert_eq!(m["w"].account, "/h/.claude-work");
        assert_eq!(m.len(), 3);
        let back: Value = serde_json::from_str(&save_sessions(&m)).unwrap();
        assert_eq!(back["c:1"], "36099ce4-d17c");
        assert_eq!(back["p"], json!({"provider": "codex", "sid": "abc"}));
        assert_eq!(back["w"], json!({"provider": "claude", "sid": "d1", "account": "/h/.claude-work"}));
        assert!(load_sessions("").is_empty());
    }
    #[test]
    fn settings_fill_in_claude() {
        let mut v = json!({});
        migrate(&mut v);
        assert_eq!(v["agents"], json!({"default": "claude", "providers": {"claude": {"on": true, "bin": "", "accounts": [], "active": "", "auto": false}, "codex": {"on": false, "bin": ""}, "opencode": {"on": false, "bin": ""}}}));
        assert!(check(&v).is_ok());
        v["agents"]["providers"]["claude"]["accounts"] = json!([{"name": "Work", "dir": "relative"}]);
        assert!(check(&v).is_err());
        v["agents"]["providers"]["claude"]["accounts"] = json!([{"name": "Work", "dir": "/h/.claude-work"}, {"dir": ""}]);
        v["agents"]["providers"]["claude"]["active"] = json!("/gone");
        migrate(&mut v);
        assert!(check(&v).is_ok());
        assert_eq!(v["agents"]["providers"]["claude"]["active"], "");
        assert_eq!(accounts(&v, PROVIDERS[0]), ["", "/h/.claude-work"]);
        v["agents"]["providers"]["claude"]["bin"] = json!("relative/claude");
        assert!(check(&v).is_err());
        v["agents"]["providers"]["claude"] = json!({"on": false, "bin": ""});
        assert!(check(&v).is_err());
        assert_eq!(bin(&json!({}), PROVIDERS[0], "/h", ""), "/h/.local/bin/claude");
        assert!(term_key("t:abc").is_some_and(|(p, s)| p.id() == "claude" && s == "abc"));
        assert!(term_key("t:nope:abc").is_none() && term_key("c:1").is_none());
    }
    #[test]
    fn accounts_switch_only_when_used_up() {
        let l: Vec<String> = ["", "/a", "/b"].map(String::from).to_vec();
        assert_eq!(pick_account(&l, "/a", true, |_| false), "/a");
        assert_eq!(pick_account(&l, "/a", false, |_| true), "/a");
        assert_eq!(pick_account(&l, "/a", true, |a| a == "/a"), "/b");
        assert_eq!(pick_account(&l, "/b", true, |a| a != ""), "");
        assert_eq!(pick_account(&l, "/b", true, |_| true), "/b"); // all used up: stay
        assert_eq!(pick_account(&l, "/gone", true, |_| false), "");
    }
}
