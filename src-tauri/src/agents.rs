// The agent providers (packages/agent-*), registered in one place, and what the app keeps about them:
// settings.agents (switched on, default, binary override) and sessions.json (conversation -> provider + session).

use agent_core::AgentProvider;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Every agent provider, in the order of the settings and the composer. A new one is one line here and one in
/// src/agents/index.ts.
pub static PROVIDERS: &[&dyn AgentProvider] = &[&agent_claude::PROVIDER, &agent_codex::PROVIDER, &agent_opencode::PROVIDER, &agent_pi::PROVIDER];
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
            // a blank name (older builds saved one) becomes the folder's, so check() still passes
            let list: Vec<Value> = c["accounts"].as_array().into_iter().flatten()
                .filter(|a| a["dir"].as_str().is_some_and(|d| !d.is_empty()) && a["name"].is_string()).cloned()
                .map(|mut a| { if a["name"].as_str().unwrap_or("").trim().is_empty() {
                    a["name"] = json!(a["dir"].as_str().unwrap_or("").trim_end_matches('/').rsplit('/').next().unwrap_or("").trim_start_matches('.'));
                } a }).collect();
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
        // each account its own folder, never ~/.claude (the CLI's own, always there as "")
        let mut dirs = vec![format!("{}/.claude", super::home())];
        for a in v["agents"]["providers"][p.id()]["accounts"].as_array().into_iter().flatten() {
            let (d, n) = (a["dir"].as_str().unwrap_or(""), a["name"].as_str().unwrap_or("").trim());
            if !d.starts_with('/') || d.len() > 500 || d.contains(['\n', '\0']) || n.is_empty() || n.chars().count() > 40 { return Err(super::trc_v("err.agent_account", p.name())); }
            let d = d.trim_end_matches('/').to_string();
            if dirs.contains(&d) { return Err(super::trc_v("err.agent_account_dir", p.name())); }
            dirs.push(d);
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
/// The account a conversation runs on: `cur` (its own, or the active one for a new conversation), also when it left
/// the list (its transcript is still there); with `auto` and `cur` used up, the next listed account after it that is
/// not and is `ready` (signed in), round the list, else `cur`.
pub fn pick_account(list: &[String], cur: &str, auto: bool, spent: impl Fn(&str) -> bool, ready: impl Fn(&str) -> bool) -> String {
    if !auto || !spent(cur) { return cur.to_string(); }
    let start = list.iter().position(|a| a == cur).map_or(0, |i| i + 1);
    (0..list.len()).map(|n| &list[(start + n) % list.len()]).filter(|a| *a != cur)
        .find(|a| !spent(a) && ready(a)).map_or_else(|| cur.to_string(), |a| a.clone())
}

/// Limits (`Limits::json`) that leave no room for a conversation on `model`: a window at 100% that applies to it. A
/// model's own window (weekly Opus) only counts for that model, never for the CLI's default ("", which falls back).
pub fn used_up(limits: &Value, model: &str) -> bool { full(limits, model).next().is_some() }
/// The windows of `limits` at 100% that apply to `model`, as in [`used_up`].
pub fn full<'a>(limits: &'a Value, model: &str) -> impl Iterator<Item = &'a Value> {
    let model = model.to_lowercase();
    limits["windows"].as_array().into_iter().flatten()
        .filter(move |w| w["name"].as_str().is_none_or(|n| !model.is_empty() && model.contains(&n.to_lowercase())))
        .filter(|w| w["pct"].as_f64().is_some_and(|x| x >= 100.0))
}
/// Limits read without a login: the account was never signed in (an expired token the CLI refreshes itself).
pub fn no_login(limits: &Value) -> bool { limits["ok"] == false && limits["reason"] == "no-login" }

/// A conversation's session: which provider, its session id there, the account (config folder, "" the CLI's own) and
/// the extra vault it runs in ("" the main one): a provider finds a session to resume by the folder it started in.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Sess { pub provider: String, pub sid: String, pub account: String, pub vault: String }

/// sessions.json: `{key: "<sid>"}` is Claude's on its own account (every file from before the providers),
/// `{key: {provider, sid, account?, vault?}}` the rest. Those stay strings, so an older build still reads the file.
pub fn load_sessions(raw: &str) -> HashMap<String, Sess> {
    let m: Map<String, Value> = serde_json::from_str(raw).unwrap_or_default();
    m.into_iter().filter_map(|(k, v)| match v {
        Value::String(sid) => Some((k, Sess { provider: FIRST.into(), sid, ..Default::default() })),
        Value::Object(o) => Some((k, Sess { provider: o.get("provider")?.as_str()?.into(), sid: o.get("sid")?.as_str()?.into(),
            account: o.get("account").and_then(Value::as_str).unwrap_or("").into(), vault: o.get("vault").and_then(Value::as_str).unwrap_or("").into() })),
        _ => None,
    }).collect()
}
pub fn save_sessions(m: &HashMap<String, Sess>) -> String {
    let o: Map<String, Value> = m.iter().map(|(k, s)| (k.clone(), if s.provider == FIRST && s.account.is_empty() && s.vault.is_empty() { json!(s.sid) } else {
        let mut o = json!({"provider": s.provider, "sid": s.sid});
        if !s.account.is_empty() { o["account"] = json!(s.account); }
        if !s.vault.is_empty() { o["vault"] = json!(s.vault); }
        o
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
        let m = load_sessions(r#"{"c:1": "36099ce4-d17c", "p": {"provider": "codex", "sid": "abc"}, "w": {"provider": "claude", "sid": "d1", "account": "/h/.claude-work"}, "v": {"provider": "claude", "sid": "d2", "vault": "/h/shared"}, "bad": 3}"#);
        assert_eq!(m["c:1"], Sess { provider: "claude".into(), sid: "36099ce4-d17c".into(), ..Default::default() });
        assert_eq!(m["p"].provider, "codex");
        assert_eq!(m["w"].account, "/h/.claude-work");
        assert_eq!(m["v"].vault, "/h/shared");
        assert_eq!(m.len(), 4);
        let back: Value = serde_json::from_str(&save_sessions(&m)).unwrap();
        assert_eq!(back["c:1"], "36099ce4-d17c");
        assert_eq!(back["p"], json!({"provider": "codex", "sid": "abc"}));
        assert_eq!(back["w"], json!({"provider": "claude", "sid": "d1", "account": "/h/.claude-work"}));
        assert_eq!(back["v"], json!({"provider": "claude", "sid": "d2", "vault": "/h/shared"}));
        assert!(load_sessions("").is_empty());
    }
    #[test]
    fn settings_fill_in_claude() {
        let mut v = json!({});
        migrate(&mut v);
        assert_eq!(v["agents"], json!({"default": "claude", "providers": {"claude": {"on": true, "bin": "", "accounts": [], "active": "", "auto": false}, "codex": {"on": false, "bin": ""}, "opencode": {"on": false, "bin": ""}, "pi": {"on": false, "bin": ""}}}));
        assert!(check(&v).is_ok());
        for bad in [json!([{"name": "Work", "dir": "relative"}]), json!([{"name": "  ", "dir": "/h/.claude-work"}]),
                    json!([{"name": "A", "dir": "/h/w"}, {"name": "B", "dir": "/h/w/"}]), json!([{"name": "Own", "dir": format!("{}/.claude/", crate::home())}])] {
            v["agents"]["providers"]["claude"]["accounts"] = bad;
            assert!(check(&v).is_err());
        }
        v["agents"]["providers"]["claude"]["accounts"] = json!([{"name": " ", "dir": "/h/.claude-work"}, {"dir": ""}]);
        v["agents"]["providers"]["claude"]["active"] = json!("/gone");
        migrate(&mut v);
        assert!(check(&v).is_ok());
        assert_eq!(v["agents"]["providers"]["claude"]["active"], "");
        assert_eq!(v["agents"]["providers"]["claude"]["accounts"][0]["name"], "claude-work");
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
    fn only_the_windows_of_the_model_count() {
        let w = |name: Value, pct: f64| json!({"name": name, "pct": pct});
        let opus_week = json!({"ok": true, "windows": [w(Value::Null, 40.0), w(json!("Opus"), 100.0)]});
        assert!(used_up(&opus_week, "opus") && used_up(&opus_week, "claude-opus-5-5"));
        assert!(!used_up(&opus_week, "sonnet") && !used_up(&opus_week, ""));
        assert!(used_up(&json!({"windows": [w(Value::Null, 100.0)]}), "sonnet"));
        assert!(no_login(&json!({"ok": false, "reason": "no-login"})) && !no_login(&json!({"ok": false, "reason": "expired"})));
    }
    #[test]
    fn accounts_switch_only_when_used_up() {
        let l: Vec<String> = ["", "/a", "/b"].map(String::from).to_vec();
        let ok = |_: &str| true;
        assert_eq!(pick_account(&l, "/a", true, |_| false, ok), "/a");
        assert_eq!(pick_account(&l, "/a", false, |_| true, ok), "/a");
        assert_eq!(pick_account(&l, "/a", true, |a| a == "/a", ok), "/b");
        assert_eq!(pick_account(&l, "/b", true, |a| a != "", ok), "");
        assert_eq!(pick_account(&l, "/b", true, |_| true, ok), "/b"); // all used up: stay
        // never signed in: skipped
        assert_eq!(pick_account(&l, "/a", true, |a| a == "/a", |a| a != "/b"), "");
        // a removed account keeps its conversations, and moves on to a listed one when used up
        assert_eq!(pick_account(&l, "/gone", true, |_| false, ok), "/gone");
        assert_eq!(pick_account(&l, "/gone", true, |a| a == "/gone", ok), "");
    }
}
