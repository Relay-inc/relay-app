// The real Sink of the frame loop: the webview, the app's state and files. read_agent starts the loop on its thread.
use super::frames::{Reader, Sink, TurnEnd};
use super::{account::limit_key, pipe, reconnect, release, Feed};
use crate::{agents, broker, home, orch, pending_dir, retry, save_sids, save_worktrees, unlinked_repos, App};
use agent_core::{pending, AgentProvider};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

struct TauriSink { app: AppHandle, key: String, p: &'static dyn AgentProvider, pid: u32, account: String, pending: PathBuf }

impl TauriSink {
    /// This conversation's process, when it is still the one in its slot.
    fn with_proc<R>(&self, f: impl FnOnce(&mut super::Proc) -> R) -> Option<R> {
        self.app.state::<App>().procs.lock().unwrap().get_mut(&self.key).filter(|x| x.child.id() == self.pid).map(f)
    }
}

impl Sink for TauriSink {
    fn emit(&self, ev: Value) { self.app.emit("agent", json!({"project": self.key, "provider": self.p.id(), "event": ev})).ok(); }
    fn spend(&self) { self.app.state::<App>().spent.lock().unwrap().insert(limit_key(self.p, &self.account)); }
    fn pipe(&self, req: &Value) { pipe::control(&self.app, &self.key, self.pid, req); }
    fn working(&self) { self.with_proc(|x| x.working()); }
    fn picked(&self) { self.with_proc(|x| x.turns.picked()); }
    fn turn_ended(&self) -> String { self.with_proc(|x| { x.turn_ended(); x.opts.0.clone() }).unwrap_or_default() }
    fn session(&self, sid: &str) {
        let st = self.app.state::<App>();
        let mut sids = st.sids.lock().unwrap();
        sids.insert(self.key.clone(), agents::Sess { provider: self.p.id().into(), sid: sid.into(), account: self.account.clone() });
        save_sids(&self.app, &sids);
    }
    fn permission(&self, req: &pending::Request) {
        let mut r = req.clone();
        (r.project, r.provider, r.relay) = (self.key.clone(), self.p.id().into(), true);
        pending::write(&self.pending, &r).ok();
    }
    fn committed(&self, repos: Vec<PathBuf>) {
        for repo in unlinked_repos(&self.app, &self.key, repos) { self.app.emit("repo-unlinked", json!({"key": self.key, "repo": repo})).ok(); }
    }
    fn worktrees(&self, made: Vec<String>) {
        let st = self.app.state::<App>();
        let mut w = st.worktrees.lock().unwrap();
        w.entry(self.key.clone()).or_default().extend(made);
        save_worktrees(&self.app, &w);
    }
    fn after_turn(&self, end: &TurnEnd) {
        let (model, limited, hint, fresh) = retry_args(end);
        retry::turn_end(&self.app, &self.key, self.p, &self.account, model, limited, hint, fresh);
        if orch::is_worker(&self.key) { orch::turn_end(&self.app, &self.key, end.last); }
        if !end.replay && orch::is_orch(&self.key) { orch::flush(&self.app, &self.key); } // what Relay queued while the turn ran
    }
    fn closed(&self, exited: bool) {
        // a work machine's connection that dropped without the agent ending (the Mac slept, the wifi went): its
        // agent goes on there, take it back once the machine answers again
        if !exited && self.app.state::<App>().machines.bind_of(&self.key).is_some() && reconnect(&self.app, &self.key, self.p, self.pid) { return; }
        broker::forget(&self.key, self.pid);
        if !release(&mut self.app.state::<App>().procs.lock().unwrap(), &self.key, self.pid) { return; }
        if orch::is_worker(&self.key) { orch::exited(&self.app, &self.key); }
        self.emit(json!({"type": "exit"}));
    }
}

/// What retry hears of a turn end: the model, whether the limit refused it, the reset named, whether it did nothing.
fn retry_args<'a>(end: &'a TurnEnd) -> (&'a str, bool, Option<i64>, bool) { (&end.model, end.limited, end.hint, end.fresh) }

/// The agent's output, from its broker: each stdout line through the provider's parser to the webview as `agent`
/// events, stderr collected for when it ends (frames.rs). `account`: the one the process runs on.
pub(super) fn read_agent(app: &AppHandle, key: &str, p: &'static dyn AgentProvider, pid: u32, feed: Feed, account: &str) {
    let sink = TauriSink { app: app.clone(), key: key.into(), p, pid, account: account.into(), pending: pending_dir(app) };
    std::thread::spawn(move || Reader::new(p, feed.backlog, feed.inherit, PathBuf::from(home()).join("projects")).run(&sink, feed.frames));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retry_hears_the_limit_the_reset_and_whether_the_turn_was_fresh() {
        let end = TurnEnd { model: "opus".into(), limited: true, hint: Some(5), fresh: false, replay: true, last: "x" };
        assert_eq!(retry_args(&end), ("opus", true, Some(5), false));
        let end = TurnEnd { model: "".into(), limited: false, hint: None, fresh: true, replay: false, last: "" };
        assert_eq!(retry_args(&end), ("", false, None, true));
    }
}
