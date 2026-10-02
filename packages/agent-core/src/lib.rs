//! The agent contract: what the app needs from a coding-agent CLI (Claude Code, Codex, OpenCode, …), and
//! nothing specific to one of them. A provider is one package (`packages/agent-<id>`) with a `pub static
//! PROVIDER` implementing [`AgentProvider`], registered in `src-tauri/src/agents.rs`.
//!
//! The app owns the process table, sessions.json, the pending folder, the settings and the Tauri commands.
//! A provider builds the command line, turns its output into [`Event`]s, reads its own transcripts and logs,
//! and reports its limits and token usage.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Stdio};

pub mod envelope;
pub mod pending;
pub mod usage;

/// What a provider can do. The webview hides what is false (the effort pick, the terminal button, the
/// subagents strip, image paste, …) and the app skips the calls.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    /// One long-lived process per conversation that takes each turn on stdin ([`AgentProvider::input`]).
    /// False: one process per turn, the message in its arguments ([`Launch::turn`]).
    pub persistent: bool,
    pub images: bool,
    pub thinking: bool,
    /// Asks before tool calls, through the pending folder (see [`pending`]).
    pub permissions: bool,
    /// Asks the user questions with options (kind "question" in the pending folder).
    pub questions: bool,
    pub subagents: bool,
    /// Can continue a terminal session as a copy ([`Launch::fork`]).
    pub fork: bool,
    /// Can continue a conversation in the terminal ([`AgentProvider::terminal`]).
    pub terminal: bool,
    /// Has sessions outside the app to list, attach to and stop ([`AgentProvider::sessions`]).
    pub background: bool,
    pub effort: bool,
    /// Reports plan or rate limits ([`AgentProvider::limits`]).
    pub limits: bool,
    /// Can title a new conversation with one quick call ([`AgentProvider::title`]).
    pub title: bool,
    /// Runs on more than one login: `opts.accounts` lists the extra config folders, the app sets `opts.account`
    /// to the one a process or a limits call is for ("" for the CLI's own folder).
    pub accounts: bool,
}

/// Where the provider runs. `bin` is the settings' override or [`AgentProvider::default_bin`].
pub struct Env<'a> {
    pub home: &'a str,
    /// The vault folder, "" before one is chosen. Conversations run with it as cwd.
    pub vault: &'a str,
    /// The login-shell PATH, so the agent's tools find gh, node, …
    pub path: &'a str,
    pub bin: &'a str,
    /// The pending folder: `<id>.json` requests, `<id>.answer.json` answers.
    pub pending: &'a Path,
    /// The provider's own settings, `settings.agents.providers.<id>` (`on`, `bin` and the keys of its
    /// options, see `options` in src/types.ts). Null when there are none.
    pub opts: &'a Value,
}
impl Env<'_> {
    /// A string option, "" when unset.
    pub fn opt(&self, key: &str) -> &str { self.opts[key].as_str().unwrap_or("") }
}

/// Installed, which version, logged in. `None` where the provider cannot tell.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detect {
    pub installed: bool,
    pub bin: String,
    pub version: Option<String>,
    pub logged_in: Option<bool>,
    /// One line on what is missing, in English (a command to run), or None.
    pub note: Option<String>,
}

/// A model or effort option for the composer: `id` goes to the CLI, `label` is shown.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Choice { pub id: String, pub label: String }
impl Choice { pub fn new(id: &str, label: &str) -> Self { Choice { id: id.into(), label: label.into() } } }

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Image { pub media_type: String, pub data: String }
/// The media types the webview pastes, base64 in `data`.
pub const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// One user message.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Turn { pub text: String, pub images: Vec<Image> }

/// Starting the process for a conversation. `model` and `effort` are "" for the CLI's default, else one of
/// [`AgentProvider::models`] (or a model id the user typed, checked by [`safe_model`]) and [`AgentProvider::efforts`].
pub struct Launch<'a> {
    /// The app's conversation key, for the pending requests of this process.
    pub key: &'a str,
    /// A readable name for the session ("Project: title").
    pub name: &'a str,
    pub model: &'a str,
    pub effort: &'a str,
    /// The provider's session id to continue.
    pub resume: Option<&'a str>,
    /// A session to copy into a new one (only with `caps.fork`, only without `resume`).
    pub fork: Option<&'a str>,
    /// Per-turn providers: the message this process answers. Always None for persistent ones.
    pub turn: Option<&'a Turn>,
}

/// What the webview draws, normalised. Emitted as the Tauri event `agent` with `{project, provider, event}`,
/// serialised with `type` in snake_case. The app adds `{"type":"stderr","text"}` and `{"type":"exit"}`.
/// History ([`AgentProvider::history`]) is the same events: `user` for the user's messages, tool calls as done.
///
/// Tool calls use the canonical names where they match, so the webview words them well: Read, Write, Edit,
/// Bash, Grep, Glob, WebSearch, WebFetch, Agent, Skill, TodoWrite, with input keys file_path, command,
/// pattern, query, url, description. Anything else is shown by its name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Live work began or resumed; idempotent, not another queued user message.
    Working,
    /// The provider's session id: stored in sessions.json, used for resume.
    Session { id: String },
    /// A user message (history only). An image that is not inline is None, shown as a placeholder.
    User { text: String, images: Vec<Option<Image>> },
    /// Assistant text: a whole block, or with `delta` a piece appended to the last one.
    Text { text: String, delta: bool },
    Thinking { text: String, delta: bool },
    ToolCall { id: String, name: String, input: Value },
    ToolResult { id: String, error: bool },
    /// A permission request or question raised in the provider's own protocol. The app writes it to the
    /// pending folder; the answer comes back through [`AgentProvider::respond`].
    Permission { request: pending::Request },
    /// The turn is over. `error` when it failed ("" when the provider gave no reason), `duration_ms` how long it took when the provider says.
    TurnEnd { ok: bool, error: Option<String>, usage: Option<TurnUsage>, duration_ms: Option<u64> },
    /// History only: when the transcript line after it was written (RFC 3339), also for a line that gives no
    /// other event, so the app can tell how long a turn it did not start has been running.
    Time { at: String },
    Error { text: String },
    /// The conversation started over (`/clear`): what came before is gone; a new Session follows.
    Reset,
    /// The model (and effort, when the CLI says) it runs on, its own defaults resolved. The app passes it on as
    /// `resolved` with which of the two the conversation left to the CLI, so the composer can name the defaults.
    Resolved { model: String, effort: Option<String> },
}

/// Tokens of one turn, as the provider reports them.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsage { pub input: u64, pub output: u64, pub cache_read: u64, pub cache_write: u64, pub cost: Option<f64> }

/// What to run in the terminal (iTerm): the app wraps the command in AppleScript.
pub enum Terminal<'a> { Resume(&'a str), New(&'a str), Attach(&'a str) }

/// A stdout line to events. One per process, so it may keep state (deltas, a request in flight).
pub type Parser = Box<dyn FnMut(&str) -> Vec<Event> + Send>;

pub trait AgentProvider: Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn caps(&self) -> Caps;
    /// Where the CLI is when the settings do not say.
    fn default_bin(&self, home: &str) -> String;
    fn detect(&self, env: &Env) -> Detect;
    fn models(&self) -> Vec<Choice>;
    /// Executable slash commands/skills in this vault, without starting a conversation.
    fn commands(&self, _env: &Env) -> Value { serde_json::json!([]) }
    fn efforts(&self) -> Vec<Choice> { vec![] }
    /// Whether a session id may go on a command line.
    fn valid_session(&self, id: &str) -> bool { safe_id(id) }

    /// The process for a conversation, without cwd, PATH and stdio: the app sets those (cwd = the vault).
    /// Remove API keys from the environment here when the provider should run on the user's subscription.
    fn command(&self, env: &Env, launch: &Launch) -> Result<Command, String>;
    /// Persistent providers: the stdin line (without newline) that sends a turn.
    fn input(&self, _turn: &Turn) -> Option<String> { None }
    fn parser(&self) -> Parser;
    /// The stdin line answering a request this provider raised as [`Event::Permission`] (relay = true).
    /// `decision` is `{behavior:"allow", updatedInput}` or `{behavior:"deny", message}`.
    fn respond(&self, _req: &pending::Request, _decision: &Value) -> Option<String> { None }

    /// A session's messages from byte offset `from` of its transcript, and the offset to continue from.
    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64);
    /// Sessions outside the app (terminal, background), each `{id, sessionId, name?, kind, status, state?}`
    /// with status "busy" | "idle" and kind "interactive" | "background".
    fn sessions(&self, _env: &Env) -> Vec<Value> { vec![] }
    /// The subagents of a session: `{id, description, agentType?, model?, running, started_at, last_at, tool?, input?, text?}`.
    fn subagents(&self, _env: &Env, _sid: &str) -> Vec<Value> { vec![] }
    /// The last few texts a subagent wrote.
    fn agent_log(&self, _env: &Env, _sid: &str, _id: &str) -> Vec<String> { vec![] }
    /// The shell command for the terminal, None when the provider has none.
    fn terminal(&self, _env: &Env, _t: Terminal) -> Option<String> { None }
    /// Stop a background session, keeping its conversation.
    fn stop_background(&self, _env: &Env, _id: &str) -> Result<(), String> { Err("unsupported".into()) }
    /// A 2 to 5 word title for a conversation that starts with `text`.
    fn title(&self, _env: &Env, _text: &str) -> Result<String, String> { Err("unsupported".into()) }

    /// Plan or rate limits. The app calls it at most once a minute.
    fn limits(&self, _env: &Env) -> usage::Limits { usage::Limits::Off("unsupported".into()) }
    /// Token usage since `since` (epoch ms), read incrementally from the provider's logs ([`usage::Tail`]).
    fn usage(&self, _env: &Env, _since: i64) -> Vec<usage::Record> { vec![] }
}

/// A session or request id: hex digits and dashes only.
pub fn safe_id(s: &str) -> bool { !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-') }
/// A model alias or id, never a stray flag.
pub fn safe_model(s: &str) -> bool { !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "-.[]/:_".contains(c)) }

/// `bin args…` with the login PATH and no stdin, its stdout when it exits 0.
pub fn run(bin: &str, path: &str, args: &[&str]) -> Option<String> {
    Command::new(bin).args(args).env("PATH", path).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()
        .filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
}
/// A program by name on the PATH.
pub fn which(name: &str, path: &str) -> Option<String> {
    path.split(':').map(|d| format!("{d}/{name}")).find(|p| Path::new(p).is_file())
}
/// The first line of `bin --version`, the way most CLIs answer it.
pub fn version(bin: &str, path: &str) -> Option<String> {
    run(bin, path, &["--version"]).and_then(|o| o.lines().next().map(|l| l.trim().to_string())).filter(|l| !l.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn events_serialise_for_the_webview() {
        let e = serde_json::to_value(Event::ToolCall { id: "t1".into(), name: "Read".into(), input: serde_json::json!({"file_path": "/a"}) }).unwrap();
        assert_eq!(e, serde_json::json!({"type": "tool_call", "id": "t1", "name": "Read", "input": {"file_path": "/a"}}));
        let e = serde_json::to_value(Event::TurnEnd { ok: true, error: None, usage: Some(TurnUsage { input: 1, cache_read: 2, ..Default::default() }), duration_ms: Some(5) }).unwrap();
        assert_eq!(e["usage"]["cacheRead"], 2);
        assert_eq!(serde_json::to_value(Caps { persistent: true, ..Default::default() }).unwrap()["persistent"], true);
    }
    #[test]
    fn ids_and_models() {
        assert!(safe_id("36099ce4-d17c-482a") && !safe_id("") && !safe_id("a b"));
        assert!(safe_model("opus") && safe_model("claude-opus-5-5[1m]") && safe_model("openai/gpt-5") && !safe_model("--x") && !safe_model("a b"));
    }
}

/// Discover commands with a shared deadline and child-process cleanup, without an inference turn.
pub fn discover_commands(env: &Env, script: &str) -> Value {
    if env.vault.is_empty() || !Path::new(env.bin).is_file() { return Value::Null; }
    let script = format!("{}\n{}\nmain()", include_str!("../discover.py"), script);
    Command::new("/usr/bin/python3").args(["-c", &script, env.bin, env.vault, ""])
        .env("PATH", env.path).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()
        .filter(|o| o.status.success()).and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or(Value::Null)
}
