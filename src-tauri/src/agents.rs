// The agent providers live in relay-core (packages/relay-core/src/agents.rs); this adds what the app says about
// them in the UI language.

use agent_core::AgentProvider;
use serde_json::Value;
pub use relay_core::agents::*;

pub fn get(id: &str) -> Result<&'static dyn AgentProvider, String> { find(id).ok_or_else(|| super::trc_v("err.no_agent", id)) }

/// At least one provider on, and every binary override an absolute path.
pub fn check(v: &Value) -> Result<(), String> {
    if !PROVIDERS.iter().any(|p| v["agents"]["providers"][p.id()]["on"] == true) { return Err(super::trc("err.agent_none")); }
    for p in PROVIDERS {
        let b = v["agents"]["providers"][p.id()]["bin"].as_str().unwrap_or("");
        if !b.is_empty() && (!b.starts_with('/') || b.len() > 500 || b.contains(['\n', '\0'])) { return Err(super::trc_v("err.agent_bin", p.name())); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn check_wants_one_provider_and_absolute_bins() {
        let mut v = json!({});
        migrate(&mut v);
        assert!(check(&v).is_ok());
        v["agents"]["providers"]["claude"]["bin"] = json!("relative/claude");
        assert!(check(&v).is_err());
        v["agents"]["providers"]["claude"] = json!({"on": false, "bin": ""});
        assert!(check(&v).is_err());
    }
}
