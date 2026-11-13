//! The agent contract: what the app needs from a coding-agent CLI (Claude Code, Codex, OpenCode, …), and
//! nothing specific to one of them. A provider is one package (`packages/agent-<id>`) with a `pub static
//! PROVIDER` implementing [`AgentProvider`], registered in `src-tauri/src/agents.rs`.
//!
//! The app owns the process table, sessions.json, the pending folder, the settings and the Tauri commands.
//! A provider builds the command line, turns its output into [`Event`]s, reads its own transcripts and logs,
//! and reports its limits and token usage.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};
use std::process::{Command, Stdio};

/// The most characters of text a provider's `write` takes: it cuts the rest (the instruction does not count).
/// Callers budget from this so what matters is not what gets cut. Same value as `WRITE_MAX` in limits.ts.
pub const WRITE_MAX: usize = 20_000;
pub mod discover;
pub use discover::{discover_commands, http_get, Probe};
pub mod envelope;
#[cfg(windows)]
pub mod job;
pub mod peer;
pub mod pending;
pub mod prompt;
pub mod usage;
pub mod util;
pub use util::*;

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
    /// Can write a text from an instruction in one call without tools ([`AgentProvider::write`]).
    pub write: bool,
    /// Runs on more than one login: `opts.accounts` lists the extra config folders, the app sets `opts.account`
    /// to the one a process or a limits call is for ("" for the CLI's own folder).
    pub accounts: bool,
    /// Switches a running process to another model ([`AgentProvider::set_model`]); false: a new model restarts the process.
    pub live_model: bool,
    /// Has a control pipe on stdin/stdout where the app answers the in-process MCP servers it offers (mail, the
    /// orchestrator): [`AgentProvider::control_init`], [`Event::Control`], [`AgentProvider::control_reply`].
    pub control: bool,
    /// Echoes a message when it takes it up ([`Event::Picked`]): one sent during a turn waits below the conversation
    /// until then, and often joins that turn.
    pub picked: bool,
    /// Can run on a work machine (Settings › Machines) and be moved there.
    pub remote: bool,
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
    /// What the app grants or fences for this conversation.
    pub grants: &'a Grants,
    /// The provider's own settings, `settings.agents.providers.<id>` (`on`, `bin` and the keys of its
    /// options, see `options` in src/types.ts), and the account keys of [`Caps::accounts`]. Null when there are none.
    pub opts: &'a Value,
}
impl Env<'_> {
    /// A string option, "" when unset.
    pub fn opt(&self, key: &str) -> &str { self.opts[key].as_str().unwrap_or("") }
}

/// What the app grants or fences for one conversation, as opposed to the provider's own settings ([`Env::opts`]):
/// set per start by the app, read by the provider that can honour it (so far Claude Code's `command` and `terminal`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Grants {
    /// Extra tool rules the conversation may never use (the fence around other vaults and the app's own data).
    pub deny: Vec<String>,
    /// A shared vault, or another vault than the main one: only the app's own MCP servers, no hooks, no auto memory.
    pub fenced: bool,
    /// The relay-mail tools, answered by the app over the control pipe.
    pub mail: bool,
    /// The relay-design tools, answered by the app over the control pipe.
    pub design: bool,
    /// Runs on a work machine: the mode comes with the machine's mirrored settings.
    pub machine: bool,
    /// The orchestrator's role, "coordinator" or "worker": the relay-orch tools.
    pub orch: Option<String>,
    /// Appended to the system prompt (after [`envelope::HINT`]).
    pub system: Option<String>,
}
/// No grants, for a call that is not a conversation (and for tests).
pub static NO_GRANTS: Grants = Grants { deny: Vec::new(), fenced: false, mail: false, design: false, machine: false, orch: None, system: None };

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
    /// Live: the agent took up a user message sent to it, at this point of its work (Claude Code only, the echo of
    /// `--replay-user-messages`). A message sent while a turn runs can join that turn instead of starting its own.
    Picked { text: String },
    /// Assistant text: a whole block, or with `delta` a piece appended to the last one.
    Text { text: String, delta: bool },
    Thinking { text: String, delta: bool },
    ToolCall { id: String, name: String, input: Value },
    ToolResult { id: String, error: bool },
    /// The change a file tool made, as unified-diff hunks with line numbers, when the provider reports it.
    Patch { id: String, hunks: Vec<Hunk> },
    /// The images a tool returned (a Read of a picture, a screenshot), inline as base64, when the provider keeps them.
    ToolImages { id: String, images: Vec<Image> },
    /// What a command printed, as the agent got it back (Claude Code, Bash only).
    ToolOutput { id: String, text: String },
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
    /// The provider began compacting the conversation (summarising it to free context); `Compacted` ends it.
    Compacting,
    /// The account's limit is used up: the turn is refused, and the app moves the next message to another account or
    /// retries once it resets. `resets_at` (epoch ms) when the provider says. Not shown in the webview.
    Limited { resets_at: Option<i64> },
    /// The turn that ends next was refused for the limit, going by its error text ([`limited`]). Unlike
    /// [`Event::Limited`] it names no reset: one that came before stays. Not shown in the webview.
    TurnLimited,
    /// The events of this stdout line are the provider's own message (a refusal, a notice), not work the turn did.
    /// Not shown in the webview.
    Synthetic,
    /// A request on the control pipe ([`Caps::control`]): `server` the in-process MCP server it is for with the JSON-RPC
    /// `message` for it, None for any other request, which the app answers as unsupported. `id` goes back to
    /// [`AgentProvider::control_reply`]. Not shown in the webview.
    Control { id: Value, server: Option<String>, message: Value },
    /// A control request the app sent failed: what the provider said, for the log. Shown as stderr.
    Stderr { text: String },
    /// The slash commands and skills the vault has, as the provider's control pipe lists them on opening.
    Commands { commands: Value },
    /// The conversation was compacted: what triggered it ("manual" or "auto") and the context's size in tokens before and after.
    Compacted { trigger: Option<String>, pre_tokens: Option<u64>, post_tokens: Option<u64> },
    /// How full the context is: tokens in use now and/or the model's window, each when the provider says. Claude Code only.
    Context { used: Option<u64>, window: Option<u64> },
    /// The model (and effort, when the CLI says) it runs on, its own defaults resolved. The app passes it on as
    /// `resolved` with which of the two the conversation left to the CLI, so the composer can name the defaults.
    Resolved { model: String, effort: Option<String> },
}

/// One hunk of a change: where it starts in the old and the new file, and its lines prefixed " ", "-" or "+".
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk { pub old_start: u64, pub new_start: u64, pub lines: Vec<String> }

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
    /// The npm package the CLI is published as, for its latest version (Settings › Updates).
    fn npm_package(&self) -> Option<&'static str> { None }
    /// The CLI's own update command, for an install outside npm and Homebrew (the native installer).
    fn self_update(&self) -> &'static [&'static str] { &[] }
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
    /// `caps.control`: the stdin line that opens the control pipe, naming the in-process MCP servers the app answers for.
    fn control_init(&self, _servers: &[&str]) -> Option<String> { None }
    /// `caps.control`: the stdin line answering an [`Event::Control`] with the MCP server's JSON-RPC reply, or an error.
    fn control_reply(&self, _id: &Value, _reply: Result<Value, String>) -> Option<String> { None }
    /// `caps.live_model`: the stdin line that changes the model for the turns after it ("": the CLI's own).
    fn set_model(&self, _model: &str) -> Option<String> { None }
    /// Slash commands (without the slash) that take no attachments: refused in the webview before they are sent.
    fn text_only_commands(&self) -> Vec<&'static str> { vec![] }
    /// The stdin line answering a request this provider raised as [`Event::Permission`] (relay = true).
    /// `decision` is `{behavior:"allow", updatedInput}` or `{behavior:"deny", message}`.
    fn respond(&self, _req: &pending::Request, _decision: &Value) -> Option<String> { None }

    /// A session's messages from byte offset `from` of its transcript, and the offset to continue from.
    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64);
    /// `caps.remote`: a session's whole transcript, as moving the conversation to another machine takes it along.
    fn read_session(&self, _env: &Env, _sid: &str) -> Result<Vec<u8>, String> { Err("unsupported".into()) }
    /// `caps.remote`: stores a transcript as the session's own for `env`'s vault and account, so a resume finds it.
    fn write_session(&self, _env: &Env, _sid: &str, _bytes: &[u8]) -> Result<(), String> { Err("unsupported".into()) }
    /// `caps.remote`: the folder of the provider's own memory for `env`'s vault, whose paths move with a conversation.
    fn memory_dir(&self, _env: &Env) -> Option<String> { None }
    /// Sessions outside the app (terminal, background), each `{id, sessionId, name?, kind, status, state?}`
    /// with status "busy" | "idle" and kind "interactive" | "background".
    fn sessions(&self, _env: &Env) -> Vec<Value> { vec![] }
    /// The subagents of a session: `{id, description, agentType?, model?, running, started_at, last_at, tool?, input?, text?}`.
    fn subagents(&self, _env: &Env, _sid: &str) -> Vec<Value> { vec![] }
    /// A subagent's messages from byte offset `from` of its transcript, and the offset to continue from.
    fn agent_history(&self, _env: &Env, _sid: &str, _id: &str, _from: u64) -> (Vec<Event>, u64) { (vec![], 0) }
    /// The shell command for the terminal, None when the provider has none.
    fn terminal(&self, _env: &Env, _t: Terminal) -> Option<String> { None }
    /// Stop a background session, keeping its conversation.
    fn stop_background(&self, _env: &Env, _id: &str) -> Result<(), String> { Err("unsupported".into()) }
    /// A 2 to 5 word title for a conversation that starts with `text`.
    fn title(&self, _env: &Env, _text: &str) -> Result<String, String> { Err("unsupported".into()) }
    /// A text written from `text` following `system`, with no tools: a reply draft, a rewrite.
    fn write(&self, _env: &Env, _system: &str, _text: &str) -> Result<String, String> { Err("unsupported".into()) }
    /// An answer about the checkout `dir` following `system`: it may read there (files, git), not write, no network.
    /// The board pipeline's review of a worker's diff with the code around it.
    fn review(&self, _env: &Env, _dir: &str, _system: &str, _text: &str) -> Result<String, String> { Err("unsupported".into()) }

    /// Plan or rate limits. The app calls it at most once a minute.
    fn limits(&self, _env: &Env) -> usage::Limits { usage::Limits::Off("unsupported".into()) }
    /// Token usage since `since` (epoch ms), read incrementally from the provider's logs ([`usage::Tail`]).
    fn usage(&self, _env: &Env, _since: i64) -> Vec<usage::Record> { vec![] }
    /// The files its tool calls read, wrote and searched since `since` (epoch ms), read incrementally like `usage`;
    /// the app keeps the vault's for the Usage view's Vault tab.
    fn vault_touches(&self, _env: &Env, _since: i64) -> Vec<usage::Touch> { vec![] }
}

/// A turn's error that says the account's limit is used up: "You've hit your limit", "You've hit your weekly limit ·
/// resets 9pm", "usage limit reached". Every parser pushes [`Event::TurnLimited`] before the [`Event::TurnEnd`] it applies to.
pub fn limit_text(error: &str) -> bool {
    let e = error.to_lowercase();
    e.contains("usage limit") || (e.contains("hit your") && e.contains("limit"))
}
/// `Event::TurnLimited` when `error` says the limit is used up.
pub fn limited(error: Option<&str>, out: &mut Vec<Event>) {
    if error.is_some_and(limit_text) { out.push(Event::TurnLimited); }
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
/// Windows: the PATH as it stands now for this machine and user (where npm, winget and the CLIs' installers add
/// themselves), not the one this process inherited at its start, so a CLI installed meanwhile is found. Read through
/// PowerShell, UTF-8 so a folder with an accent survives. None when that fails. The app and relay-server both use it.
// ponytail: PowerShell over cmd, which has no way to read the stored PATH but `reg query` output to parse. A folder
// added only in a PowerShell profile is missed (-NoProfile keeps it fast and quiet), load the profile if users ask
#[cfg(windows)]
pub fn stored_path() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const READ: &str = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')";
    Command::new("powershell.exe").args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", READ]).creation_flags(job::NO_WINDOW)
        .stdin(Stdio::null()).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().trim_matches(';').to_string())
        .filter(|p| !p.is_empty())
}
/// What separates the folders of a PATH.
pub const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };
/// A program by name on the PATH. On Windows also with the extensions it runs a bare name with (`claude.exe`,
/// `codex.cmd` from npm).
pub fn which(name: &str, path: &str) -> Option<String> {
    let exts: &[&str] = if cfg!(windows) { &["", ".exe", ".cmd", ".bat", ".com"] } else { &[""] };
    path.split(PATH_SEP).flat_map(|d| exts.iter().map(move |e| format!("{d}/{name}{e}")))
        .find(|p| Path::new(p).is_file())
}
/// The first line of `bin --version`, the way most CLIs answer it. Read once per binary file and modification time:
/// a conversation start asks every time, and each ask would spawn the CLI.
pub fn version(bin: &str, path: &str) -> Option<String> {
    type Seen = HashMap<(PathBuf, SystemTime), Option<String>>;
    static SEEN: LazyLock<Mutex<Seen>> = LazyLock::new(Default::default);
    let file = if bin.contains('/') { Some(bin.to_string()) } else { which(bin, path) };
    let key = file.and_then(|f| { let f = PathBuf::from(f); let m = f.metadata().and_then(|m| m.modified()).ok()?; Some((f, m)) });
    if let Some(v) = key.as_ref().and_then(|k| SEEN.lock().unwrap().get(k).cloned()) { return v; }
    let v = run(bin, path, &["--version"]).and_then(|o| o.lines().next().map(|l| l.trim().to_string())).filter(|l| !l.is_empty());
    if let Some(k) = key { SEEN.lock().unwrap().insert(k, v.clone()); }
    v
}

/// `run`, but killed (and None) when it has not exited within `within`.
pub fn run_within(bin: &str, path: &str, args: &[&str], within: Duration) -> Option<String> {
    use std::io::Read;
    let mut child = Command::new(bin).args(args).env("PATH", path).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut out = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let mut b = vec![]; out.read_to_end(&mut b).ok(); tx.send(b).ok(); });
    let Ok(raw) = rx.recv_timeout(within) else { child.kill().ok(); child.wait().ok(); return None };
    child.wait().ok().filter(|s| s.success())?;
    Some(String::from_utf8_lossy(&raw).into_owned())
}

/// `run` (at most 15 s), but a result younger than `ttl` is returned as it was. Callers that ask within it share one
/// spawn, also when they ask at the same time: the lock is held while it runs. Only the last result is kept, per command.
// ponytail: one lock for every command; per-command locks if a second caller with a slow command shows up
pub fn run_cached(bin: &str, path: &str, args: &[&str], ttl: Duration) -> Option<String> {
    type Last = HashMap<String, (Instant, Option<String>)>;
    static LAST: LazyLock<Mutex<Last>> = LazyLock::new(Default::default);
    let key = format!("{bin}\0{path}\0{}", args.join("\0"));
    let mut last = LAST.lock().unwrap();
    if let Some((_, out)) = last.get(&key).filter(|(at, _)| at.elapsed() < ttl) { return out.clone(); }
    let out = run_within(bin, path, args, Duration::from_secs(15));
    last.insert(key, (Instant::now(), out.clone()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn script(name: &str, body: &str) -> (PathBuf, PathBuf) {
        let d = std::env::temp_dir().join(format!("agent-core-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let (bin, log) = (d.join("tool"), d.join("calls"));
        std::fs::write(&log, "").unwrap();
        std::fs::write(&bin, format!("#!/bin/sh\necho x >> '{}'\n{body}\n", log.display())).unwrap();
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        (bin, log)
    }
    fn calls(log: &Path) -> usize { std::fs::read_to_string(log).unwrap().lines().count() }
    #[test]
    fn version_is_read_once_per_binary_and_mtime() {
        let (bin, log) = script("version", "echo '1.2.3 (Tool)'");
        let b = bin.to_str().unwrap();
        assert_eq!(version(b, "/usr/bin:/bin").as_deref(), Some("1.2.3 (Tool)"));
        assert_eq!(version(b, "/usr/bin:/bin").as_deref(), Some("1.2.3 (Tool)"));
        assert_eq!(calls(&log), 1);
        std::fs::File::options().write(true).open(&bin).unwrap().set_modified(SystemTime::now() + Duration::from_secs(5)).unwrap();
        version(b, "/usr/bin:/bin");
        assert_eq!(calls(&log), 2, "a changed binary is asked again");
    }
    #[test]
    fn run_cached_answers_within_the_ttl_and_refreshes_after() {
        let (bin, log) = script("cached", "echo out");
        let b = bin.to_str().unwrap();
        let long = Duration::from_secs(60);
        assert_eq!(run_cached(b, "/bin", &["a"], long).as_deref(), Some("out\n"));
        run_cached(b, "/bin", &["a"], long);
        assert_eq!(calls(&log), 1);
        run_cached(b, "/bin", &["a"], Duration::ZERO);
        assert_eq!(calls(&log), 2);
    }
    #[test]
    fn run_within_gives_up_on_a_hung_command() {
        let (bin, _) = script("hung", "exec sleep 30");
        let at = Instant::now();
        assert_eq!(run_within(bin.to_str().unwrap(), "/bin", &[], Duration::from_millis(300)), None);
        assert!(at.elapsed() < Duration::from_secs(5));
        let (bin, _) = script("fails", "echo half; exit 1");
        assert_eq!(run_within(bin.to_str().unwrap(), "/bin", &[], Duration::from_secs(5)), None);
    }
    #[test]
    fn events_serialise_for_the_webview() {
        let e = serde_json::to_value(Event::ToolCall { id: "t1".into(), name: "Read".into(), input: serde_json::json!({"file_path": "/a"}) }).unwrap();
        assert_eq!(e, serde_json::json!({"type": "tool_call", "id": "t1", "name": "Read", "input": {"file_path": "/a"}}));
        let e = serde_json::to_value(Event::TurnEnd { ok: true, error: None, usage: Some(TurnUsage { input: 1, cache_read: 2, ..Default::default() }), duration_ms: Some(5) }).unwrap();
        assert_eq!(e["usage"]["cacheRead"], 2);
        let e = serde_json::to_value(Event::Patch { id: "t1".into(), hunks: vec![Hunk { old_start: 4, new_start: 5, lines: vec!["+a".into()] }] }).unwrap();
        assert_eq!(e, serde_json::json!({"type": "patch", "id": "t1", "hunks": [{"oldStart": 4, "newStart": 5, "lines": ["+a"]}]}));
        assert_eq!(serde_json::to_value(Caps { persistent: true, ..Default::default() }).unwrap()["persistent"], true);
    }
    #[test]
    fn limit_texts() {
        for t in ["You've hit your limit \u{b7} resets 9pm", "You've hit your weekly limit", "Claude AI usage limit reached|1760000000", "You've hit your usage limit"] { assert!(limit_text(t), "{t}"); }
        assert!(!limit_text("error_max_turns") && !limit_text("hit your head"));
        let mut out = vec![];
        limited(None, &mut out);
        limited(Some("boom"), &mut out);
        assert!(out.is_empty());
        limited(Some("Usage limit reached"), &mut out);
        assert_eq!(out, [Event::TurnLimited]);
    }
    #[test]
    fn ids_and_models() {
        assert!(safe_id("36099ce4-d17c-482a") && !safe_id("") && !safe_id("a b"));
        assert!(safe_model("opus") && safe_model("claude-opus-5-5[1m]") && safe_model("openai/gpt-5") && !safe_model("--x") && !safe_model("a b"));
    }
}
