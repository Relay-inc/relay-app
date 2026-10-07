// One conversation's agent process: the decision to start, keep, switch or restart it (plan.rs), the turns it has
// running (Turns), its frame loop (frames.rs, started by tauri_sink.rs) and what happens to it when the app quits,
// restarts or loses the connection. The process itself is run by its broker (relay_remote::broker) so it outlives the app.
// The commands in lib.rs are thin wrappers around send and stop here.

mod account;
mod frames;
mod pipe;
mod plan;
mod tauri_sink;
#[cfg(test)]
mod tests;

pub(crate) use account::{account_of, limit_key};
pub(crate) use pipe::pipe_reply;

use crate::{actions, agents, broker, commonwealth, cw_on, env_of, home, machines, mirror, need_vault, orch, provider_of, repo_projects, tr, trc, trc_v, ui_lang_of, App, EnvBuf};
use agent_core::{AgentProvider, Image, Launch, Turn, IMAGE_TYPES};
use plan::{Running, Step};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The messages a process has not answered yet. `running`: sent and not answered, also in the broker's file so a
/// restart takes them from there; at quit only an agent with a turn running stays. `picked`: the messages Claude
/// took up in the turn running (Event::Picked), the ones its turn end answers.
/// Every change that moves `running` is returned, for the caller to persist.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Turns { running: u32, picked: u32 }
impl Turns {
    pub fn new(running: u32) -> Self { Turns { running, picked: 0 } }
    pub fn busy(&self) -> bool { self.running > 0 }
    pub fn count(&self) -> u32 { self.running }
    fn set(&mut self, n: u32) -> Option<u32> { (n != self.running).then(|| { self.running = n; n }) }
    /// Live work, also a replayed one: a turn is running. Repeated model steps are no extra message.
    pub fn working(&mut self) -> Option<u32> { self.set(self.running.max(1)) }
    pub fn picked(&mut self) { self.picked += 1; }
    /// A turn end answers every message its turn took up, at least the one that started it.
    pub fn ended(&mut self) -> Option<u32> { let n = self.running.saturating_sub(self.picked.max(1)); self.picked = 0; self.set(n) }
    /// A message went in.
    pub fn sent(&mut self) -> Option<u32> { self.set(self.running + 1) }
}

/// A conversation's agent. opts: the model and effort it runs with. tainted: it holds mail text (see mark_tainted),
/// kept in its broker file for after a restart. account: the config folder it runs on ("" the CLI's own), see
/// agents::accounts. remote: on a work machine (machines.rs), stopped and taken back through its relay-server.
pub(crate) struct Proc { pub child: broker::Agent, pub stdin: Box<dyn Write + Send>, pub opts: (String, String), pub provider: &'static str, pub tainted: bool, pub key: String, pub turns: Turns, pub account: String, pub remote: bool }
impl Proc {
    fn save(&self, turns: Option<u32>) { if let Some(n) = turns { broker::save_turns(&self.key, self.child.id(), n); } }
    pub fn working(&mut self) { let n = self.turns.working(); self.save(n); }
    pub fn turn_ended(&mut self) { let n = self.turns.ended(); self.save(n); }
    fn sent(&mut self) { let n = self.turns.sent(); self.save(n); }
    fn running(&self) -> Running<'_> { Running { provider: self.provider, account: &self.account, remote: self.remote, opts: &self.opts, busy: self.turns.busy() } }
    /// A process the app takes back after a restart: the turns its broker file says are running, not one assumed.
    fn of_meta(agent: broker::Agent, stdin: Box<dyn Write + Send>, m: broker::Meta, provider: &'static str) -> Proc {
        Proc { child: agent, stdin, opts: (m.model, m.effort), provider, tainted: m.tainted, key: m.key, turns: Turns::new(m.turns), account: m.account, remote: false }
    }
    /// Marks a session that holds mail text: it stays on this Mac (see send) and a worker's report says so. Its
    /// permissions do not change, it runs in the user's own mode.
    pub fn mark_tainted(&mut self) {
        self.tainted = true;
        if let Some(m) = broker::load_meta(&broker::meta_path(&self.key)) { broker::save_meta(&broker::Meta { tainted: true, ..m }); }
    }
}

/// What a new process reads: the frames of its broker, the first `backlog` buffered while the app was away, and
/// whether the model and the effort were left to the CLI.
struct Feed { frames: Box<dyn BufRead + Send>, backlog: usize, inherit: (bool, bool) }

/// What a process starts with, beyond its provider.
struct Start<'a> {
    project: &'a str, name: &'a str, fork: Option<&'a str>, opts: (String, String), turn: Option<&'a Turn>,
    from_mail: bool, account: &'a str, machine: Option<&'a str>, about: Option<&'a str>,
}

/// A process started with a turn has it running, one started for later has none.
fn start_turns(turn: Option<&Turn>) -> u32 { u32::from(turn.is_some()) }

fn spawn(app: &AppHandle, state: &App, p: &'static dyn AgentProvider, s: Start) -> Result<Proc, String> {
    let Start { project, name, fork, opts, turn, from_mail, account, machine, about } = s;
    let dir = need_vault(state)?;
    let resume = state.sids.lock().unwrap().get(project).filter(|s| s.provider == p.id() && p.valid_session(&s.sid)).map(|s| s.sid.clone());
    let fork = fork.filter(|f| resume.is_none() && p.caps().fork && p.valid_session(f));
    let l = Launch { key: project, name, model: &opts.0, effort: &opts.1, resume: resume.as_deref(), fork, turn };
    let caps = p.caps();
    let settings = state.settings.lock().unwrap().clone();
    // where the composer or Settings › Machines says (machines.rs); a fork copies a session of this Mac, so stays
    let remote = if caps.remote && fork.is_none() { state.machines.bind_for(&settings, project, resume.is_some(), machine) } else { None };
    // a work machine has its own login: no account of this Mac goes along
    let account = if remote.is_some() { "" } else { account };
    let meta = broker::Meta { key: project.into(), provider: p.id().into(), model: opts.0.clone(), effort: opts.1.clone(), tainted: false, pid: 0, account: account.into(), turns: start_turns(turn) };
    let (c, mail_on, remote) = if let Some((m, mut bind)) = remote {
        if from_mail { return Err(trc("err.machine_mail")); }
        let info = state.machines.info(&m).map_err(|e| trc_v("err.machine_down", &format!("{}: {e}", m["name"].as_str().unwrap_or(""))))?;
        bind.cwd = machines::cwd_or_vault(bind.cwd, &info);
        let mut eb = env_of(app, state, p);
        // that machine's paths and its claude; no mail tools there
        eb.opts["mail"] = json!(false);
        let eb = EnvBuf { home: info.home.clone(), vault: bind.cwd.clone(), path: info.path.clone(), bin: info.claude.clone(), pending: PathBuf::from(&info.pending), opts: eb.opts };
        let mut cmd = p.command(&eb.env(), &l)?;
        cmd.current_dir(&bind.cwd).env("PATH", &info.path);
        // the mirror gives the session there what Claude Code here has: context, plugins, permissions, the vault's memory
        let (args, env) = mirror::session_args(&info, &bind.cwd);
        cmd.args(args).envs(env);
        let c = state.machines.client(&m).launch(&meta, &broker::Spec::of(&cmd)).map_err(|e| format!("{} start ({}): {e}", p.id(), m["name"].as_str().unwrap_or("")))?;
        state.machines.set_bind(project, bind);
        (c, false, true)
    } else {
        let mut eb = env_of(app, state, p);
        if p.caps().accounts { eb.opts["account"] = json!(account); }
        if caps.control && orch::is_orch(project) { orch::flags(&mut eb.opts, project, &dir, &orch::shared(app, &dir)); } // the orchestrator's coordinator and workers (orch.rs)
        // the brain of the project this conversation is about, when Commonwealth's registry routes it (commonwealth.rs).
        // Only on this Mac (a brain is a local path), and not for a chat that starts out holding a mail
        if caps.brain && !from_mail && cw_on(state) {
            if let Some((b, repo)) = about.and_then(|a| commonwealth::session(&home(), &repo_projects(&dir), a)) {
                eb.opts["commonwealth_brain"] = json!(b);
                eb.opts["commonwealth_source"] = json!(repo);
            }
        }
        let mut cmd = p.command(&eb.env(), &l)?;
        // `relay` (actions.rs) first on the PATH, and which conversation it speaks for
        let bin = actions::bin_dir(app).map(|b| format!("{}:", b.display())).unwrap_or_default();
        cmd.current_dir(&dir).env("PATH", format!("{bin}{}", state.path)).env(actions::CONVERSATION, project);
        (broker::launch(&meta, &cmd).map_err(|e| format!("{} start: {e}", p.id()))?, eb.opts["mail"] == true, false)
    };
    let broker::Conn { agent, mut stdin, frames, backlog } = c;
    // the orchestrator's tools are answered over this Mac's pipe: its conversations never run on a machine (see send)
    if caps.control {
        let servers: Vec<&str> = [(mail_on, "relay-mail"), (!remote && orch::is_orch(project), "relay-orch")].into_iter().filter(|s| s.0).map(|s| s.1).collect();
        if let Some(line) = p.control_init(&servers) { writeln!(stdin, "{line}").and_then(|_| stdin.flush()).map_err(|e| format!("{} start: {e}", p.id()))?; }
    }
    // a resumed or forked session may keep its own model: only a fresh one shows the CLI's defaults
    let fresh = resume.is_none() && fork.is_none();
    let inherit = (fresh && opts.0.is_empty(), fresh && opts.1.is_empty());
    let pid = agent.id();
    let mut proc = Proc { child: agent, stdin, opts, provider: p.id(), tainted: false, key: project.into(), turns: Turns::new(start_turns(turn)), account: account.into(), remote };
    tauri_sink::read_agent(app, project, p, pid, Feed { frames, backlog, inherit }, account);
    // a chat about a mail, or one that read mail before a restart, starts restricted
    if from_mail { proc.mark_tainted(); }
    Ok(proc)
}

/// A message for a conversation, as the webview's `send` command gives it.
pub(crate) struct Msg {
    pub project: String, pub text: String, pub images: Option<Vec<Value>>, pub name: Option<String>, pub fork: Option<String>,
    pub model: Option<String>, pub effort: Option<String>, pub provider: Option<String>, pub mail: Option<bool>,
    pub told: Option<String>, pub context: Option<String>, pub machine: Option<String>, pub about: Option<String>,
}

/// Sends a message to a conversation: starts its process, keeps it, switches its model or restarts it (plan.rs), and
/// writes the turn to its stdin.
pub(crate) fn send(app: &AppHandle, state: &App, r: Msg) -> Result<(), String> {
    let Msg { project, text, images, name, fork, model, effort, provider, mail, told, context, machine, about } = r;
    let p = provider_of(state, &project, provider.as_deref());
    // the orchestrator's conversations stay on this Mac, its tools are answered over this pipe (orch.rs)
    let machine = if orch::is_orch(&project) { Some(String::new()) } else { machine };
    // the project the agent is told about: the line in front of the message (agent_core::envelope)
    let text = match told.filter(|t| !t.is_empty()) { Some(t) => agent_core::envelope::wrap(&t, context.as_deref().unwrap_or(""), &text), None => text };
    // pasted images, only the types the webview allows, for a provider that takes them
    let images: Vec<Image> = if !p.caps().images { vec![] } else {
        images.unwrap_or_default().into_iter().filter_map(|i| Some(Image { media_type: i["media_type"].as_str()?.into(), data: i["data"].as_str()?.into() }))
            .filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str())).collect()
    };
    if images.is_empty() && text.trim().is_empty() { return Err(tr(ui_lang_of(&state.settings.lock().unwrap()), "err.empty")); }
    let turn = Turn { text, images };
    // empty = the CLI default from its settings. Only aliases and model ids, never a stray flag
    let model = model.filter(|m| agent_core::safe_model(m)).unwrap_or_default();
    let effort = effort.filter(|e| p.efforts().iter().any(|c| c.id == *e)).unwrap_or_default();
    let opts = (model, effort);
    let name = name.unwrap_or_else(|| project.clone());
    // an orchestrator conversation that heard a stranger's text stays restricted, also in a new process (orch.rs)
    let orch_taint = orch::is_orch(&project) && orch::tainted(app, &project);
    let mut account = account_of(state, p, &project, &opts.0);
    let mut procs = state.procs.lock().unwrap();
    account = plan::account_for(account, procs.get(&project).map(Proc::running).as_ref(), p.id());
    if !p.caps().persistent {
        // one process per turn: the next message waits for this one
        if procs.contains_key(&project) { return Err(trc("err.agent_busy")); }
        let x = spawn(app, state, p, Start { project: &project, name: &name, fork: fork.as_deref(), opts, turn: Some(&turn), from_mail: false, account: &account, machine: machine.as_deref(), about: about.as_deref() })?;
        procs.insert(project, x);
        return Ok(());
    }
    let mut was_tainted = false;
    if let Some(x) = procs.get_mut(&project) {
        let step = plan::step(&x.running(), p.id(), p.caps().live_model, &account, &opts);
        match step {
            Step::Restart => { if let Some(mut x) = procs.remove(&project) { x.child.kill().ok(); was_tainted = x.tainted; } }
            Step::SetModel => {
                if let Some(line) = p.set_model(&opts.0) { writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())?; }
                x.opts.0 = opts.0.clone();
            }
            Step::Keep => {}
        }
    }
    if !procs.contains_key(&project) {
        let x = spawn(app, state, p, Start { project: &project, name: &name, fork: fork.as_deref(), opts, turn: None, from_mail: mail.unwrap_or(false) || was_tainted || orch_taint, account: &account, machine: machine.as_deref(), about: about.as_deref() })?;
        procs.insert(project.clone(), x);
    }
    let line = p.input(&turn).ok_or_else(|| format!("{}: no input", p.id()))?;
    let x = procs.get_mut(&project).unwrap();
    writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())?;
    x.sent();
    Ok(())
}

pub(crate) fn stop(app: &AppHandle, state: &App, project: &str) {
    if orch::is_worker(project) { orch::stop(app, project); return; }
    if let Some(mut p) = state.procs.lock().unwrap().remove(project) { p.child.kill().ok(); }
}

/// Relay itself writes a turn into a conversation of the app (the orchestrator's briefs and reports): its process
/// is started when it is not running, on this Mac, on the model it runs with, else `model`. `taint`: the text may
/// carry a stranger's words, so the conversation is restricted first. False, and nothing written, while a turn runs.
pub(crate) fn spawn_or_get(app: &AppHandle, key: &str, name: &str, model: &str, taint: bool, text: &str) -> Result<bool, String> {
    let state = app.state::<App>();
    // the orchestrator's tools are answered over a provider's control pipe: Claude Code's, unless the conversation has another
    let p = provider_of(&state, key, Some("claude"));
    if !p.caps().control { return Err("the orchestrator runs on Claude Code".into()); }
    let model = if agent_core::safe_model(model) { model.to_string() } else { String::new() };
    let account = account_of(&state, p, key, &model);
    let taint = taint || orch::tainted(app, key);
    let mut procs = state.procs.lock().unwrap();
    if procs.get(key).is_some_and(|x| x.turns.busy()) { return Ok(false); }
    if !procs.contains_key(key) {
        let x = spawn(app, &state, p, Start { project: key, name, fork: None, opts: (model, String::new()), turn: None, from_mail: taint, account: &account, machine: Some(""), about: None })?;
        procs.insert(key.to_string(), x);
    }
    let x = procs.get_mut(key).unwrap();
    if taint && !x.tainted { x.mark_tainted(); }
    let line = p.input(&Turn { text: text.to_string(), images: vec![] }).ok_or_else(|| format!("{}: no input", p.id()))?;
    writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())?;
    x.sent();
    Ok(true)
}

/// The agent behind `pid` ended: takes its process out of the slot. A process replaced for a model or effort switch
/// exits quietly, its successor keeps the slot: false then.
fn release(procs: &mut HashMap<String, Proc>, key: &str, pid: u32) -> bool {
    if procs.get(key).is_some_and(|x| x.child.id() != pid) { return false; }
    procs.remove(key);
    true
}

/// Only a running turn keeps a local agent alive past the app; a work machine's agents stay.
fn dies_at_quit(x: &Proc) -> bool { !x.turns.busy() && !x.remote }

/// The app quits: an agent with no turn running stops (the next message resumes its session, nothing is lost), so
/// only a running turn keeps an agent and its broker alive while the app is closed.
pub(crate) fn quit(app: &AppHandle) {
    // a work machine's agents stay: that is what the machine is for, and its server winds an idle one down itself
    for (_, mut x) in app.state::<App>().procs.lock().unwrap().drain().filter(|(_, x)| dies_at_quit(x)) { x.child.kill().ok(); broker::forget(&x.key, x.child.id()); }
}

/// Take a work machine's conversation back after its connection dropped: every few seconds while its slot still holds
/// this agent, for at most an hour. False when it is gone (it ended there, or was stopped).
fn reconnect(app: &AppHandle, key: &str, p: &'static dyn AgentProvider, pid: u32) -> bool {
    let st = app.state::<App>();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3600);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if !st.procs.lock().unwrap().get(key).is_some_and(|x| x.child.id() == pid) { return true; } // stopped or replaced: nothing to do
        let Some(m) = st.machines.bind_of(key).and_then(|b| machines::Machines::find(&st.settings.lock().unwrap(), &b.machine)) else { return false };
        match st.machines.client(&m).attach(key) {
            Ok(Some(c)) if c.agent.id() == pid => {
                let broker::Conn { agent, stdin, frames, backlog } = c;
                if let Some(x) = st.procs.lock().unwrap().get_mut(key) { x.stdin = stdin; x.child = agent; }
                tauri_sink::read_agent(app, key, p, pid, Feed { frames, backlog, inherit: (false, false) }, "");
                return true;
            }
            Ok(_) => return false,
            Err(_) => continue,
        }
    }
    false
}

/// After a restart, a work machine's conversations: the ones whose broker still runs there are the app's again.
/// Off the setup thread, a machine that does not answer only delays its own conversations.
pub(crate) fn reattach_remote(app: &AppHandle) {
    let st = app.state::<App>();
    let list = st.settings.lock().unwrap()["machines"].as_array().cloned().unwrap_or_default();
    for m in list {
        let c = st.machines.client(&m);
        let Ok(metas) = c.list() else { continue };
        for meta in metas.into_iter().filter(|x| st.machines.bind_of(&x.key).is_some_and(|b| m["id"] == b.machine.as_str())) {
            let (Ok(p), Ok(Some(conn))) = (agents::get(&meta.provider), c.attach(&meta.key)) else { continue };
            if st.procs.lock().unwrap().contains_key(&meta.key) { continue; }
            let broker::Conn { agent, stdin, frames, backlog } = conn;
            let pid = agent.id();
            let x = Proc { child: agent, stdin, opts: (meta.model, meta.effort), provider: p.id(), tainted: false, key: meta.key.clone(), turns: Turns::new(1), account: String::new(), remote: true };
            st.procs.lock().unwrap().insert(meta.key.clone(), x);
            tauri_sink::read_agent(app, &meta.key, p, pid, Feed { frames, backlog, inherit: (false, false) }, "");
        }
    }
}

/// After a restart: the conversations whose broker is still there are the app's again, the files of the others go.
/// Each with the turns its file says are running: a turn that ended before the restart is not running again, one that
/// ended while the app was away ends with its replayed turn end.
pub(crate) fn reattach(app: &AppHandle) {
    let Ok(dir) = fs::read_dir(broker::dir()) else { return };
    for f in dir.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")) {
        let Some(m) = broker::load_meta(&f) else { fs::remove_file(&f).ok(); continue };
        let (Ok(p), Some(c)) = (agents::get(&m.provider), broker::reattach(&m.key)) else { fs::remove_file(&f).ok(); continue };
        let broker::Conn { agent, stdin, frames, backlog } = c;
        let pid = agent.id();
        let (key, account) = (m.key.clone(), m.account.clone());
        let x = Proc::of_meta(agent, stdin, m, p.id());
        app.state::<App>().procs.lock().unwrap().insert(key.clone(), x);
        tauri_sink::read_agent(app, &key, p, pid, Feed { frames, backlog, inherit: (false, false) }, &account);
    }
}
