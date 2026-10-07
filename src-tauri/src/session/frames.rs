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
    /// the turn was refused for the account's limit, and the reset Claude named (epoch ms)
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
    /// A control_request of the CLI: the pipe's mail and orchestrator tools, answered by the app.
    fn pipe(&self, req: &Value);
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
    /// Claude's pipe and rate limit lines are read here, the other providers have none
    claude: bool,
    parse: Parser,
    /// the first `backlog` frames came in while the app was closed: their effects still happen, but the webview
    /// only hears the turn end, it reads the rest from the transcript
    backlog: usize,
    /// whether the model and the effort were left to the CLI
    inherit: (bool, bool),
    /// the checkouts the git snapshots look at
    root: PathBuf,
    // this turn: refused for the account's limit (and the reset Claude named, epoch ms), and whether it did anything
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
    pub fn new(p: &dyn AgentProvider, backlog: usize, inherit: (bool, bool), root: PathBuf) -> Self { Self::with_parser(p.id() == "claude", p.parser(), backlog, inherit, root) }
    pub fn with_parser(claude: bool, parse: Parser, backlog: usize, inherit: (bool, bool), root: PathBuf) -> Self {
        Reader { claude, parse, backlog, inherit, root, limited: false, hint: None, worked: false, last: String::new(), wt_before: HashMap::new(), commit_before: HashMap::new(), err: vec![] }
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
        // the refusal itself comes as an assistant message of model "<synthetic>": not work the turn did
        let synthetic = self.claude && line.contains("\"<synthetic>\"");
        // Claude's pipe traffic stays between the CLI and the app: the relay-mail MCP server and its restrictions
        if self.claude && self.pipe(sink, &line) { return Flow::Next; }
        for ev in (self.parse)(&line) { self.event(sink, ev, replay, synthetic); }
        Flow::Next
    }

    /// Claude's rate limit event and pipe lines. True when the line was pipe traffic, which no provider parser sees.
    fn pipe(&mut self, sink: &dyn Sink, line: &str) -> bool {
        let Ok(ev) = serde_json::from_str::<Value>(line) else { return false };
        if ev["type"] == "rate_limit_event" && ev["rate_limit_info"]["status"] == "rejected" {
            sink.spend();
            self.limited = true;
            self.hint = ev["rate_limit_info"]["resetsAt"].as_i64().map(|s| if s < 1_000_000_000_000 { s * 1000 } else { s });
        }
        if ev["type"] == "control_request" { sink.pipe(&ev); return true; }
        if ev["type"] == "control_response" {
            if ev["response"]["subtype"] == "error" {
                let rid = ev["response"]["request_id"].as_str().unwrap_or("");
                sink.emit(json!({"type": "stderr", "text": format!("relay-mail ({rid}): {}", ev["response"]["error"])}));
            }
            // the slash commands and skills this vault has, for the composer's completion
            if ev["response"]["request_id"] == "init" && ev["response"]["response"]["commands"].is_array() {
                sink.emit(json!({"type": "commands", "commands": ev["response"]["response"]["commands"]}));
            }
            return true;
        }
        false
    }

    fn event(&mut self, sink: &dyn Sink, ev: Event, replay: bool, synthetic: bool) {
        // Replayed activity restores turns surviving an app restart. Repeated model steps never
        // count as extra user messages; Claude's assistant blocks also provide this signal.
        if !synthetic && matches!(&ev, Event::Text { .. } | Event::Thinking { .. } | Event::ToolCall { .. }) { self.worked = true; }
        if matches!(&ev, Event::Working | Event::Text { .. } | Event::Thinking { .. } | Event::ToolCall { .. }) { sink.working(); }
        self.git(sink, &ev, replay);
        match &ev {
            Event::Session { id } => sink.session(id),
            // raised in the provider's own protocol: a card like any other, answered through respond()
            Event::Permission { request } => sink.permission(request),
            Event::Resolved { model, effort } => {
                if !replay { sink.emit(json!({"type": "resolved", "model": model, "effort": effort, "default_model": self.inherit.0, "default_effort": self.inherit.1})); }
                return;
            }
            Event::Text { text, delta } => { if !delta { self.last.clear(); } self.last.push_str(text); }
            // a turn end answers every message taken up in its turn, at least the one that started it
            Event::Picked { .. } => sink.picked(),
            Event::TurnEnd { error, .. } => self.turn_end(sink, error.as_deref(), replay),
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

    fn turn_end(&mut self, sink: &dyn Sink, error: Option<&str>, replay: bool) {
        let e = error.unwrap_or("").to_lowercase();
        // "usage limit" (Codex), "You've hit your limit" and "You've hit your weekly limit · resets 9pm" (Claude)
        if e.contains("usage limit") || (e.contains("hit your") && e.contains("limit")) { sink.spend(); self.limited = true; }
        let model = sink.turn_ended();
        sink.after_turn(&TurnEnd { model, limited: self.limited, hint: self.hint, fresh: !self.worked, replay, last: &self.last });
        (self.limited, self.hint, self.worked) = (false, None, false);
        // ponytail: a turn end replayed after a restart counts again, fine while reports are rare
        self.last.clear();
    }
}
