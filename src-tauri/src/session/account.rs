// Which account a conversation's process runs on, and whether it has room: what the limits last said.
use crate::{agents, App};
use agent_core::AgentProvider;

/// The key of a provider's account in `limits` and `spent`.
pub(crate) fn limit_key(p: &dyn AgentProvider, account: &str) -> String { format!("{}:{account}", p.id()) }
/// An account with no room for `model`: a turn was refused on it, or a window it last read that applies is at 100%.
pub(crate) fn is_spent(st: &App, p: &dyn AgentProvider, account: &str, model: &str) -> bool {
    let k = limit_key(p, account);
    st.spent.lock().unwrap().contains(&k) || st.limits.lock().unwrap().get(&k).is_some_and(|(_, v)| agents::used_up(v, model))
}
/// An account auto-switch may move to: its limits did not come back without a login (not read yet counts as fine).
pub(crate) fn is_ready(st: &App, p: &dyn AgentProvider, account: &str) -> bool {
    !st.limits.lock().unwrap().get(&limit_key(p, account)).is_some_and(|(_, v)| agents::no_login(v))
}
/// The account a conversation runs on: its session's, else the active one; with auto-switch on and that one used up
/// for `model`, the next signed-in one that is not. Reads what the limits last said, never asks (no network in a send).
/// ponytail: the limits are at most 5 minutes old (the webview's poll); a refused turn marks an account at once
pub(crate) fn account_of(st: &App, p: &dyn AgentProvider, key: &str, model: &str) -> String {
    if !p.caps().accounts { return String::new(); }
    let own = st.sids.lock().unwrap().get(key).filter(|x| x.provider == p.id()).map(|x| x.account.clone());
    let (list, cur, auto) = {
        let s = st.settings.lock().unwrap();
        let c = &s["agents"]["providers"][p.id()];
        (agents::accounts(&s, p), own.unwrap_or_else(|| c["active"].as_str().unwrap_or("").into()), c["auto"] == true)
    };
    agents::pick_account(&list, &cur, auto, |a| is_spent(st, p, a, model), |a| is_ready(st, p, a))
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_spent_key_is_provider_and_account() {
        let p = crate::agents::get("claude").unwrap();
        assert_eq!(super::limit_key(p, "/a"), "claude:/a");
        assert_ne!(super::limit_key(p, "/a"), super::limit_key(p, "/b"));
    }
}
