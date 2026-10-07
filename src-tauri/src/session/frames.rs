// The frame loop of one agent process: each stdout line from its broker through the provider's parser, the effects
// the events have (session id, permission cards, turn accounting, limits, the git snapshots around tool calls) and
// the events that go on to the webview. The loop knows the world only through a Sink, so it runs against recorded
// frames in the tests (tests.rs); tauri_sink.rs is the real one.
use crate::{commits, worktrees};
use agent_core::{pending, AgentProvider, Event, Parser};
use relay_remote::broker;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::path::PathBuf;

/// A turn that ended, for whatever follows one: the limit retry and the orchestrator.
pub(crate) struct TurnEnd<'a> {
    /// the model the process runs on, "" when its slot is gone
    pub model: String,
    /// the turn was refused for the account's limit, and the reset the provider named (epoch ms)
    pub limited: bool,
    pub hint: Option<i64>,
    /// the turn did nothing yet
    pub fresh: bool,
    /// a turn end that was buffered while the app was closed
    pub replay: bool,
    /// the agent's last text block, for a worker that ends without a report (orch.rs)
    pub last: &'a str,
}

/// What the loop does outside itself. The real one is TauriSink (the webview, the app's state and files); a test's
/// records the calls.
pub(crate) trait Sink {
    /// An `agent` event for the webview: {type, ..}.
    fn emit(&self, ev: Value);
    /// The account's limits are used up: the next message moves to another one (with auto-switch on).
    fn spend(&self);
    /// A request of the CLI on its control pipe (Event::Control): the mail and orchestrator tools, answered by the app.
    fn control(&self, id: &Value, server: Option<&str>, message: &Value);
    /// Turn accounting, see Turns. `turn_ended` gives the model the process runs on.
    fn working(&self);
    fn picked(&self);
    fn turn_ended(&self) -> String;
    /// The provider's session id, kept for resume.
    fn session(&self, sid: &str);
    /// A permission card or question raised in the provider's own protocol.
    fn permission(&self, req: &pending::Request);
    /// Repos whose reflog changed around a tool call, and the git worktrees a tool call made.
    fn committed(&self, repos: Vec<PathBuf>);
    fn worktrees(&self, made: Vec<String>);
    fn after_turn(&self, end: &TurnEnd);
    /// The frames ended: `exited` the agent said so, else the connection dropped. Takes the slot back, or goes on
    /// reading through a reconnect.
    fn closed(&self, exited: bool);
}

enum Flow { Next, Exit }

pub(crate) struct Reader {
    parse: Parser,
    /// the first `backlog` frames came in while the app was closed: their effects still happen, but the webview
    /// only hears the turn end, it reads the rest from the transcript
    backlog: usize,
    /// whether the model and the effort were left to the CLI
    inherit: (bool, bool),
    /// the checkouts the git snapshots look at
    root: PathBuf,
    // this turn: refused for the account's limit (and the reset the provider named, epoch ms), and whether it did anything
    limited: bool,
    hint: Option<i64>,
    worked: bool,
    last: String,
    // worktrees there were before each tool call that may add one, by call id (see worktrees.rs)
    wt_before: HashMap<String, HashSet<PathBuf>>,
    // the same for the repos' reflogs around a tool call that may commit (see commits.rs)
    commit_before: HashMap<String, commits::Snapshot>,
    err: Vec<String>,
}

impl Reader {
    pub fn new(p: &dyn AgentProvider, backlog: usize, inherit: (bool, bool), root: PathBuf) -> Self { Self::with_parser(p.parser(), backlog, inherit, root) }
    pub fn with_parser(parse: Parser, backlog: usize, inherit: (bool, bool), root: PathBuf) -> Self {
        Reader { parse, backlog, inherit, root, limited: false, hint: None, worked: false, last: String::new(), wt_before: HashMap::new(), commit_before: HashMap::new(), err: vec![] }
    }

    /// Reads until the broker says the agent exited or the connection ends, then reports it to the sink.
    pub fn run(&mut self, sink: &dyn Sink, frames: impl BufRead) {
        let mut exited = false;
        for (n, f) in frames.lines().map_while(Result::ok).enumerate() {
            if let Flow::Exit = self.frame(sink, n, &f) { exited = true; break; }
        }
        // stderr, collected for when it ends
        if !self.err.is_empty() { sink.emit(json!({"type": "stderr", "text": self.err.join("\n")})); }
        sink.closed(exited);
    }

    fn frame(&mut self, sink: &dyn Sink, n: usize, f: &str) -> Flow {
        let line = match broker::frame(f) { broker::Frame::Out(l) => l, broker::Frame::Err(l) => { self.err.push(l); return Flow::Next; } broker::Frame::Exit => return Flow::Exit };
        let replay = n < self.backlog;
        // the events of a provider's own message (a refusal) are not work the turn did
        let mut synthetic = false;
        for ev in (self.parse)(&line) {
            if ev == Event::Synthetic { synthetic = true; } else { self.event(sink, ev, replay, synthetic); }
        }
        Flow::Next
    }

    fn event(&mut self, sink: &dyn Sink, ev: Event, replay: bool, synthetic: bool) {
        // Replayed activity restores turns surviving an app restart. Repeated model steps never
        // count as extra user messages; Claude's assistant blocks also provide this signal.
        if !synthetic && matches!(&ev, Event::Text { .. } | Event::Thinking { .. } | Event::ToolCall { .. }) { self.worked = true; }
        if matches!(&ev, Event::Working | Event::Text { .. } | Event::Thinking { .. } | Event::ToolCall { .. }) { sink.working(); }
        self.git(sink, &ev, replay);
        match &ev {
            Event::Session { id } => sink.session(id),
            // the provider says the account's limit is used up; replayed or not, the account is spent
            Event::Limited { resets_at } => {
                sink.spend();
                self.limited = true;
                self.hint = *resets_at;
                return;
            }
            // the turn's error text says the same, with no reset to name
            Event::TurnLimited => { sink.spend(); self.limited = true; return; }
            // the control pipe's traffic stays between the CLI and the app, the webview only hears the commands and the failures
            Event::Control { id, server, message } => { sink.control(id, server.as_deref(), message); return; }
            Event::Stderr { .. } | Event::Commands { .. } => { sink.emit(serde_json::to_value(&ev).unwrap_or_default()); return; }
            // raised in the provider's own protocol: a card like any other, answered through respond()
            Event::Permission { request } => sink.permission(request),
            Event::Resolved { model, effort } => {
                if !replay { sink.emit(json!({"type": "resolved", "model": model, "effort": effort, "default_model": self.inherit.0, "default_effort": self.inherit.1})); }
                return;
            }
            Event::Text { text, delta } => { if !delta { self.last.clear(); } self.last.push_str(text); }
            // a turn end answers every message taken up in its turn, at least the one that started it
            Event::Picked { .. } => sink.picked(),
            Event::TurnEnd { .. } => self.turn_end(sink, replay),
            _ => {}
        }
        if !replay || matches!(ev, Event::TurnEnd { .. }) { sink.emit(serde_json::to_value(&ev).unwrap_or_default()); }
    }

    /// The snapshots around a tool call that may commit or add a worktree, and what changed by its result.
    fn git(&mut self, sink: &dyn Sink, ev: &Event, replay: bool) {
        match ev {
            Event::ToolCall { id, input, .. } => {
                if !replay && commits::may_commit(input) { self.commit_before.insert(id.clone(), commits::snapshot(&self.root)); }
                if worktrees::may_add(input) { self.wt_before.insert(id.clone(), worktrees::snapshot(&self.root)); }
            }
            Event::ToolResult { id, .. } => {
                if let Some(before) = self.commit_before.remove(id) {
                    let repos = commits::changed(&before, &commits::snapshot(&self.root));
                    sink.committed(repos);
                }
                if let Some(before) = self.wt_before.remove(id) {
                    let made: Vec<String> = worktrees::snapshot(&self.root).difference(&before).map(|p| p.to_string_lossy().into()).collect();
                    if !made.is_empty() { sink.worktrees(made); }
                }
            }
            _ => {}
        }
    }

    fn turn_end(&mut self, sink: &dyn Sink, replay: bool) {
        let model = sink.turn_ended();
        sink.after_turn(&TurnEnd { model, limited: self.limited, hint: self.hint, fresh: !self.worked, replay, last: &self.last });
        (self.limited, self.hint, self.worked) = (false, None, false);
        // ponytail: a turn end replayed after a restart counts again, fine while reports are rare
        self.last.clear();
    }
}
