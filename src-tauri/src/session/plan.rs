// What a send asks of the conversation's process: keep it, change its model over the pipe, or start a new one.
// Pure, so the rules behind the "model switch killed a running turn" bug are tested without a process.

/// What the process in a conversation's slot runs with.
pub(crate) struct Running<'a> { pub provider: &'a str, pub account: &'a str, pub remote: bool, pub opts: &'a (String, String), pub busy: bool }

#[derive(Debug, PartialEq)]
pub(crate) enum Step { Keep, SetModel, Restart }

/// What a changed model or effort asks of a running process: a restart, and/or a set_model over its pipe.
#[derive(Debug, PartialEq)]
pub(crate) struct SwitchPlan { pub restart: bool, pub model: bool }
pub(crate) fn switch_plan(cur: &(String, String), want: &(String, String), live_model: bool, busy: bool) -> SwitchPlan {
    if !live_model { return SwitchPlan { restart: cur != want, model: false }; }
    // ponytail: effort is not changed live (apply_flag_settings accepts it but its effect is unverified), so it waits for an idle moment
    SwitchPlan { restart: cur.1 != want.1 && !busy, model: cur.0 != want.0 }
}

/// The step for a message to a conversation whose process runs: account is a start flag, so is effort (a switch
/// restarts the process on the same session). A provider with `caps.live_model` takes a new model over its pipe, so a
/// model switch never kills a turn; an effort switch waits until the turn is over. A work machine's conversation runs on that
/// machine's login, so this Mac's account never restarts it.
pub(crate) fn step(cur: &Running, provider: &str, live_model: bool, account: &str, opts: &(String, String)) -> Step {
    let moved = cur.provider != provider || (cur.account != account && !cur.remote);
    let plan = switch_plan(cur.opts, opts, live_model, cur.busy);
    if moved || plan.restart { Step::Restart } else if plan.model { Step::SetModel } else { Step::Keep }
}

/// The account a message runs on: a turn still running stays where it is, the account moves once the conversation is idle.
pub(crate) fn account_for(chosen: String, cur: Option<&Running>, provider: &str) -> String {
    match cur.filter(|x| x.busy && x.provider == provider) { Some(x) => x.account.to_string(), None => chosen }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn o(m: &str, e: &str) -> (String, String) { (m.into(), e.into()) }
    fn run<'a>(provider: &'a str, account: &'a str, remote: bool, opts: &'a (String, String), busy: bool) -> Running<'a> { Running { provider, account, remote, opts, busy } }

    #[test]
    fn model_goes_over_the_pipe_effort_waits_for_idle() {
        let (idle, busy) = (false, true);
        assert_eq!(switch_plan(&o("opus", "high"), &o("opus", "high"), true, busy), SwitchPlan { restart: false, model: false });
        assert_eq!(switch_plan(&o("opus", "high"), &o("sonnet", "high"), true, busy), SwitchPlan { restart: false, model: true });
        assert_eq!(switch_plan(&o("opus", "high"), &o("sonnet", "high"), true, idle), SwitchPlan { restart: false, model: true });
        // a running turn is never killed for an effort switch, the model part still applies
        assert_eq!(switch_plan(&o("opus", "high"), &o("sonnet", "low"), true, busy), SwitchPlan { restart: false, model: true });
        assert_eq!(switch_plan(&o("opus", "high"), &o("opus", "low"), true, idle), SwitchPlan { restart: true, model: false });
        // other providers: any change restarts, as before
        assert_eq!(switch_plan(&o("a", ""), &o("b", ""), false, idle), SwitchPlan { restart: true, model: false });
    }

    // 146984b: a model switch while a turn runs changes the model over the pipe and leaves the process alone
    #[test]
    fn a_model_switch_never_kills_a_running_turn() {
        let cur = o("opus", "high");
        assert_eq!(step(&run("claude", "", false, &cur, true), "claude", true, "", &o("sonnet", "high")), Step::SetModel);
        assert_eq!(step(&run("claude", "", false, &cur, true), "claude", true, "", &o("sonnet", "low")), Step::SetModel);
        assert_eq!(step(&run("claude", "", false, &cur, true), "claude", true, "", &o("opus", "low")), Step::Keep);
        assert_eq!(step(&run("claude", "", false, &cur, false), "claude", true, "", &o("opus", "low")), Step::Restart);
        assert_eq!(step(&run("claude", "", false, &cur, true), "claude", true, "", &cur), Step::Keep);
    }

    #[test]
    fn another_provider_or_account_restarts_but_not_on_a_work_machine() {
        let cur = o("opus", "");
        assert_eq!(step(&run("claude", "", false, &cur, false), "codex", false, "", &cur), Step::Restart);
        assert_eq!(step(&run("claude", "/a", false, &cur, true), "claude", true, "/b", &cur), Step::Restart);
        // a work machine runs on its own login: this Mac's account never restarts it
        assert_eq!(step(&run("claude", "", true, &cur, false), "claude", true, "/b", &cur), Step::Keep);
        // other providers restart for any change of model
        assert_eq!(step(&run("codex", "", false, &o("a", ""), true), "codex", false, "", &o("b", "")), Step::Restart);
    }

    #[test]
    fn a_running_turn_keeps_its_account() {
        let cur = o("opus", "");
        assert_eq!(account_for("/b".into(), Some(&run("claude", "/a", false, &cur, true)), "claude"), "/a");
        assert_eq!(account_for("/b".into(), Some(&run("claude", "/a", false, &cur, false)), "claude"), "/b");
        assert_eq!(account_for("/b".into(), Some(&run("codex", "/a", false, &cur, true)), "claude"), "/b");
        assert_eq!(account_for("/b".into(), None, "claude"), "/b");
    }
}
