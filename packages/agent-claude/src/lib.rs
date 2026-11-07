//! Claude Code as an agent provider. Every conversation is one `claude -p` process in stream-json mode, in the
//! vault, on the user's subscription (ANTHROPIC_API_KEY removed). Permission requests and questions come in
//! over the same pipe (permission.rs, `--permission-prompt-tool stdio`). Transcripts, subagents
//! and token usage are read from ~/.claude/projects/<vault-slug>/, and from the same folder in every other
//! account's config folder (CLAUDE_CONFIG_DIR).

use agent_core::{usage, AgentProvider, Caps, Choice, Detect, Env, Event, Launch, Parser, Terminal, Turn};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

pub mod permission;
pub mod stream;
pub mod subagents;
pub mod usage_log;


/// Tools no app session may call: mail only ever becomes a draft (hard wall) and the mailbox is never touched, so
/// the whole Gmail connector goes, and in the app mail goes through relay-mail, never himalaya.
/// The vault's .relay/ holds the agent's own permissions (`actions` in config.json), so no session edits it.
/// Enforced by the CLI at call time, before the app hears of it (scripts/pipe-check.py).
pub const DENIED: [&str; 3] = ["mcp__claude_ai_Gmail__*", "Bash(himalaya*)", "Edit(./.relay/**)"];
/// The mail tools run without a card, also once the session holds mail text: none can send, a draft only lands in Drafts.
pub const MAIL_TOOLS: [&str; 5] = ["mcp__relay-mail__search", "mcp__relay-mail__read", "mcp__relay-mail__thread", "mcp__relay-mail__attachment", "mcp__relay-mail__save_draft"];

/// The relay-design tools (src-tauri design.rs), without a Claude Code card: the app asks for the two that act on the
/// user's claude.ai account itself, by the policy under `design` in the vault's `actions`.
pub const DESIGN_TOOLS: [&str; 4] = ["mcp__relay-design__design_read", "mcp__relay-design__design_snapshot", "mcp__relay-design__design_prompt", "mcp__relay-design__design_create"];

/// CLAUDE_CONFIG_DIR for an account, and not inherited for ~/.claude.
fn on_account(cmd: &mut Command, account: &str) {
    if account.is_empty() { cmd.env_remove("CLAUDE_CONFIG_DIR"); } else { cmd.env("CLAUDE_CONFIG_DIR", account); }
}

/// The app's `relay` command (src-tauri/src/actions.rs) runs without a Bash card: each action has its own policy,
/// and the app asks on a card for the ones that need it.
pub const RELAY_TOOL: &str = "Bash(relay *)";

/// The relay-orch tools of the orchestrator's coordinator and of its workers, without a card (src-tauri orch.rs).
pub const ORCH_COORD_TOOLS: [&str; 4] = ["mcp__relay-orch__dispatch", "mcp__relay-orch__workers", "mcp__relay-orch__message", "mcp__relay-orch__stop"];
pub const ORCH_WORKER_TOOLS: [&str; 2] = ["mcp__relay-orch__step", "mcp__relay-orch__report"];

pub struct Claude;
pub static PROVIDER: Claude = Claude;

/// `claude agents --json`, as the last 2.5 s read it: the sidebar's polls and the vault snapshot ask within seconds
/// of each other, and each ask spawns claude.
pub fn agents_raw(env: &Env) -> Option<String> {
    agent_core::run_cached(env.bin, env.path, &["agents", "--json"], std::time::Duration::from_millis(2500))
}
/// The oldest Claude Code seen taking every flag `command` passes (`--thinking-display` is not in its changelog, so
/// this is the oldest build checked, not the release that added it). An older one stops each turn on "unknown option".
const MIN_VERSION: [u32; 3] = [2, 1, 294];
// the title call's prompts (prompts/conversation/): the system prompt, and the message in quotes as data
const TITLE: &str = agent_core::prompt::text(include_str!("../../../prompts/conversation/title.md"));
const TITLE_SYSTEM: &str = agent_core::prompt::text(include_str!("../../../prompts/conversation/title-system.md"));
/// `claude --version` ("2.1.296 (Claude Code)") older than MIN_VERSION. Unreadable counts as new enough.
fn too_old(version: &str) -> bool {
    let v: Vec<u32> = version.split_whitespace().next().unwrap_or("").split('.').map_while(|n| n.parse().ok()).collect();
    v.len() == 3 && v[..] < MIN_VERSION[..]
}

/// Claude Code's transcript folder for a vault: the path with every non-alphanumeric char as `-`.
pub fn slug(vault: &str) -> String { vault.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect() }
/// The account this call is for, set by the app: a config folder (CLAUDE_CONFIG_DIR), "" for ~/.claude.
fn account<'a>(env: &'a Env) -> &'a str { env.opt("account") }
fn config_dir(home: &str, account: &str) -> String { if account.is_empty() { format!("{home}/.claude") } else { account.to_string() } }
/// Every account's config folder, ~/.claude first.
pub fn config_dirs(env: &Env) -> Vec<String> {
    let extra = env.opts["accounts"].as_array().into_iter().flatten().filter_map(|a| a["dir"].as_str()).filter(|d| !d.is_empty()).map(String::from);
    std::iter::once(config_dir(env.home, "")).chain(extra).collect()
}
/// The `--settings` of a fenced conversation (grants.fenced: a shared vault, or another vault than the main one): no hook
/// runs, wherever it is defined (settings, a skill's or agent's frontmatter), since a member could have put one in the
/// vault for every other member's Mac, and no auto memory is loaded or written there.
pub fn fenced_settings() -> &'static str { r#"{"disableAllHooks":true,"autoMemoryEnabled":false}"# }
fn transcripts_in(dir: &str, vault: &str) -> String {
    if vault.is_empty() { return String::new(); } // no vault: never fall back to <config>/projects itself
    format!("{dir}/projects/{}", slug(vault))
}
/// A defaultMode Claude Code takes: in the account's settings, or in the vault's (.claude/settings.json and
/// settings.local.json), where it ignores auto and bypassPermissions.
fn mode_set(env: &Env) -> bool {
    let mode = |f: String| std::fs::read_to_string(f).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["permissions"]["defaultMode"].as_str().map(String::from));
    mode(format!("{}/settings.json", config_dir(env.home, account(env)))).is_some()
        || ["settings.json", "settings.local.json"].iter().filter_map(|f| mode(format!("{}/.claude/{f}", env.vault)))
            .any(|m| m != "auto" && m != "bypassPermissions")
}
/// The vault's transcript folder on the env's account.
pub fn transcripts(env: &Env) -> String { transcripts_in(&config_dir(env.home, account(env)), env.vault) }
/// The config folder a session lives in: of the accounts that have its transcript, the one written last (a
/// conversation that moved accounts leaves a copy in the old one), else the env's account.
fn session_dir(env: &Env, sid: &str) -> String {
    config_dirs(env).into_iter()
        .filter_map(|d| Some((std::fs::metadata(format!("{}/{sid}.jsonl", transcripts_in(&d, env.vault))).ok()?.modified().ok()?, d)))
        .max().map(|(_, d)| d).unwrap_or_else(|| config_dir(env.home, account(env)))
}
pub fn transcripts_of(env: &Env, sid: &str) -> String { transcripts_in(&session_dir(env, sid), env.vault) }
/// A session continued on another account: its latest transcript goes along (over an older copy from an earlier
/// move), so `--resume` finds it there. The copy in the old account stays as it was.
fn carry(env: &Env, sid: &str) -> Result<(), String> {
    let to = transcripts(env);
    let from = transcripts_of(env, sid);
    if to.is_empty() || from == to || !Path::new(&format!("{from}/{sid}.jsonl")).is_file() { return Ok(()); }
    std::fs::create_dir_all(&to).and_then(|_| std::fs::copy(format!("{from}/{sid}.jsonl"), format!("{to}/{sid}.jsonl")))
        .map(|_| ()).map_err(|e| format!("claude: moving the conversation to the other account: {e}"))
}

/// One `claude -p` call that answers once, no conversation: the title, a review, a text, a page's website, a capture.
/// What they share is in [`oneshot`]; what differs is here. Everything else (flags) is the same for all.
#[derive(Default)]
pub struct OneShot<'a> {
    /// The working folder; None: the temp folder, outside any vault.
    pub cwd: Option<&'a str>,
    /// `--model`; None: the CLI's default.
    pub model: Option<&'a str>,
    /// `--tools`: the tools there are, none when empty.
    pub tools: &'a [&'a str],
    /// `--allowedTools`: the ones that run without asking (in print mode the others are refused, nobody is asked).
    pub allowed: &'a [&'a str],
    /// `--system-prompt`, replacing Claude Code's own.
    pub system: Option<&'a str>,
    /// With the user's and the vault's own settings (CLAUDE.md, rules, hooks); false: none of them, and no transcript.
    pub own_settings: bool,
    /// Continue a copy of this session (not kept).
    pub fork_of: Option<&'a str>,
    /// The prompt as an argument; None: the caller writes it to stdin. Only after a `system`: `--tools` and
    /// `--allowedTools` take a list and would swallow it.
    pub prompt: Option<&'a str>,
}
/// The one-shot `claude -p` command for `o`, without stdio (the caller sets those): on the subscription
/// (ANTHROPIC_API_KEY removed), on the env's account, with the login PATH, and with the fence of `env.grants`
/// (its denies, and no hooks or auto memory when fenced) when the call may read the vault.
pub fn oneshot(env: &Env, o: OneShot) -> Command {
    let mut cmd = Command::new(env.bin);
    cmd.arg("-p");
    if let Some(sid) = o.fork_of { cmd.args(["--resume", sid, "--fork-session"]); }
    if let Some(m) = o.model { cmd.args(["--model", m]); }
    cmd.arg("--no-session-persistence");
    if !o.own_settings { cmd.args(["--setting-sources", ""]); }
    cmd.args(["--strict-mcp-config", "--tools"]);
    if o.tools.is_empty() { cmd.arg(""); } else { cmd.args(o.tools); }
    if !o.allowed.is_empty() { cmd.arg("--allowedTools").args(o.allowed); }
    if !env.grants.deny.is_empty() { cmd.arg("--disallowedTools").args(&env.grants.deny); }
    // in a shared vault no hook runs here either, as in the conversation it belongs to
    if env.grants.fenced { cmd.args(["--settings", fenced_settings()]); }
    if let Some(s) = o.system { cmd.args(["--system-prompt", s]); }
    if let Some(p) = o.prompt { cmd.arg(p); }
    on_account(&mut cmd, account(env));
    cmd.current_dir(o.cwd.map_or_else(std::env::temp_dir, PathBuf::from)).env("PATH", env.path).env_remove("ANTHROPIC_API_KEY");
    cmd
}
/// A one-shot call run to its end, on no stdin.
fn finish(mut cmd: Command) -> Result<std::process::Output, String> { cmd.stdin(Stdio::null()).output().map_err(|e| e.to_string()) }
/// The text a one-shot call answered, or what it said on stderr.
fn answered(out: std::process::Output) -> Result<String, String> {
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

static SUBS: Mutex<Option<subagents::SubCache>> = Mutex::new(None);

impl AgentProvider for Claude {
    fn id(&self) -> &'static str { "claude" }
    fn name(&self) -> &'static str { "Claude Code" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: true, permissions: true, questions: true, subagents: true, fork: true,
            terminal: true, background: true, effort: true, limits: true, title: true, write: true, accounts: true,
            live_model: true, control: true, picked: true, steer: true, remote: true }
    }
    fn npm_package(&self) -> Option<&'static str> { Some("@anthropic-ai/claude-code") }
    fn self_update(&self) -> &'static [&'static str] { &["update"] }
    fn default_bin(&self, home: &str) -> String { format!("{home}/.local/bin/claude") }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        let logged_in = usage_log::credentials(env.home, account(env)).is_some();
        let note = if !installed { Some("curl -fsSL https://claude.ai/install.sh | bash".into()) }
            else if version.as_deref().is_some_and(too_old) { Some("claude update".into()) } else if !logged_in { Some("claude /login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: Some(logged_in), note }
    }
    fn models(&self) -> Vec<Choice> {
        [("fable", "Fable"), ("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")].iter().map(|(i, l)| Choice::new(i, l)).collect()
    }
    fn commands(&self, env: &Env) -> Value {
        agent_core::discover_commands(env, |p| {
            let mut cmd = Command::new(env.bin);
            cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                "--settings", r#"{"disableAllHooks":true}"#, "--no-session-persistence"]).current_dir(env.vault).env_remove("ANTHROPIC_API_KEY");
            let c = p.start(cmd)?;
            p.send(c, json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize"}}))?;
            let v = p.receive(c, |v| v["type"] == "control_response")?;
            let commands = &v["response"]["response"]["commands"];
            Ok(if commands.is_null() { json!([]) } else { commands.clone() })
        })
    }
    fn efforts(&self) -> Vec<Choice> {
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")].iter().map(|(i, l)| Choice::new(i, l)).collect()
    }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        // ponytail: runs this Mac's `--version`, so for a work machine (machines.rs) it reads a path that is usually
        // missing here and lets it through. Check there too once proto::Info carries the machine's claude version.
        if let Some(line) = agent_core::version(env.bin, env.path).filter(|v| too_old(v)) {
            let v = line.split_whitespace().next().unwrap_or_default();
            let [a, b, c] = MIN_VERSION;
            return Err(format!("claude: Claude Code {v} is too old for Relay, it needs {a}.{b}.{c} or newer. Run `claude update` and start the conversation again."));
        }
        let mut mcp = json!({"mcpServers": {}});
        // grants.mail, set by the app: the relay-mail tools, answered by the app over this pipe
        if env.grants.mail { mcp["mcpServers"]["relay-mail"] = json!({"type": "sdk", "name": "relay-mail"}); }
        // grants.orch, set by the app for the orchestrator's coordinator and workers: the relay-orch tools, their
        // role prompt, and the denies and asks that hold whatever the user's settings allow (ask beats allow)
        let strs = |k: &str| env.opts[k].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect::<Vec<_>>();
        let mut allowed: Vec<String> = MAIL_TOOLS.iter().chain([RELAY_TOOL].iter()).map(|t| t.to_string()).collect();
        // grants.design, set by the app: the relay-design tools, answered over this pipe too
        if env.grants.design {
            mcp["mcpServers"]["relay-design"] = json!({"type": "sdk", "name": "relay-design"});
            allowed.extend(DESIGN_TOOLS.iter().map(|t| t.to_string()));
        }
        if let Some(role) = env.grants.orch.as_deref() {
            mcp["mcpServers"]["relay-orch"] = json!({"type": "sdk", "name": "relay-orch"});
            allowed.extend(if role == "coordinator" { &ORCH_COORD_TOOLS[..] } else { &ORCH_WORKER_TOOLS[..] }.iter().map(|t| t.to_string()));
        }
        let denied: Vec<String> = DENIED.iter().map(|d| d.to_string()).chain(env.grants.deny.iter().cloned()).collect();
        let system = match env.grants.system.as_deref() { Some(s) => format!("{}\n\n{s}", agent_core::envelope::HINT), None => agent_core::envelope::HINT.to_string() };
        let fenced = env.grants.fenced;
        let mut cmd = Command::new(env.bin);
        cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                  "--permission-prompt-tool", "stdio", "--thinking-display", "summarized"])
            .arg("--allowedTools").args(&allowed).arg("--disallowedTools").args(&denied)
            .arg("--append-system-prompt").arg(&system).args(["-n", l.name])
            // each message echoed when Claude takes it up: one sent during a turn often joins that turn
            .arg("--replay-user-messages");
        if !mcp["mcpServers"].as_object().is_some_and(|m| m.is_empty()) { cmd.arg("--mcp-config").arg(mcp.to_string()); }
        // grants.fenced, set by the app in a shared vault: only the servers above, none of the user's own or claude.ai's
        if fenced { cmd.arg("--strict-mcp-config"); }
        let ask = strs("ask");
        let mut settings: serde_json::Map<String, Value> = if fenced { serde_json::from_str(fenced_settings()).unwrap() } else { Default::default() };
        if !ask.is_empty() { settings.insert("permissions".into(), json!({"ask": ask})); }
        if !settings.is_empty() { cmd.arg("--settings").arg(Value::Object(settings).to_string()); }
        // no mode set: auto, as a terminal window starts; `-p` would start in manual and ask for every edit. A work
        // machine (grants.machine) gets the mode with this Mac's mirrored settings (src-tauri mirror.rs)
        // a shared vault (grants.fenced) always: a mode like bypassPermissions has no auto classifier, and that is
        // what stops a script reading another vault where no deny rule reaches (Bash)
        if !env.grants.machine && (fenced || !mode_set(env)) { cmd.args(["--permission-mode", "auto"]); }
        if !l.model.is_empty() { cmd.args(["--model", l.model]); }
        if !l.effort.is_empty() { cmd.args(["--effort", l.effort]); }
        if let Some(sid) = l.resume { carry(env, sid)?; cmd.args(["--resume", sid]); }
        // continue a terminal conversation as a copy: full history, new session id, the terminal one untouched
        else if let Some(f) = l.fork { carry(env, f)?; cmd.args(["--resume", f, "--fork-session"]); }
        on_account(&mut cmd, account(env));
        cmd.env_remove("ANTHROPIC_API_KEY");
        Ok(cmd)
    }
    fn control_init(&self, servers: &[&str]) -> Option<String> {
        Some(json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": servers}}).to_string())
    }
    fn control_reply(&self, id: &Value, reply: Result<Value, String>) -> Option<String> {
        let response = match reply {
            Ok(r) => json!({"subtype": "success", "request_id": id, "response": {"mcp_response": r}}),
            Err(e) => json!({"subtype": "error", "request_id": id, "error": e}),
        };
        Some(json!({"type": "control_response", "response": response}).to_string())
    }
    fn set_model(&self, model: &str) -> Option<String> {
        Some(json!({"type": "control_request", "request_id": "model", "request": {"subtype": "set_model", "model": if model.is_empty() { "default" } else { model }}}).to_string())
    }
    fn interrupt(&self) -> Option<String> {
        Some(json!({"type": "control_request", "request_id": "interrupt", "request": {"subtype": "interrupt"}}).to_string())
    }
    fn respond(&self, req: &agent_core::pending::Request, decision: &Value) -> Option<String> { permission::respond(req, decision) }
    fn input(&self, turn: &Turn) -> Option<String> { Some(stream::user_message(turn).to_string()) }
    fn parser(&self) -> Parser {
        let mut st = stream::State::default();
        Box::new(move |l| st.parse(l))
    }

    fn read_session(&self, env: &Env, sid: &str) -> Result<Vec<u8>, String> {
        if !agent_core::safe_id(sid) { return Err("transcript: bad session id".into()); }
        std::fs::read(format!("{}/{sid}.jsonl", transcripts_of(env, sid))).map_err(|e| format!("transcript: {e}"))
    }
    fn write_session(&self, env: &Env, sid: &str, bytes: &[u8]) -> Result<(), String> {
        let dir = transcripts(env);
        if dir.is_empty() || !agent_core::safe_id(sid) { return Err("transcript: no vault or bad session id".into()); }
        // written beside the file and renamed, so a resume never reads half of it
        let (to, tmp) = (format!("{dir}/{sid}.jsonl"), format!("{dir}/.{sid}.jsonl.tmp"));
        std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&tmp, bytes)).and_then(|_| std::fs::rename(&tmp, &to))
            .map_err(|e| { std::fs::remove_file(&tmp).ok(); format!("transcript: {e}") })
    }
    fn memory_dir(&self, env: &Env) -> Option<String> { Some(format!("{}/.claude/projects/{}/memory", env.home, slug(env.vault))) }
    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !agent_core::safe_id(sid) { return (vec![], 0); }
        stream::history(&PathBuf::from(format!("{}/{sid}.jsonl", transcripts_of(env, sid))), from)
    }
    /// Sessions Claude Code knows about, including the ones in the terminal and in the background.
    fn sessions(&self, env: &Env) -> Vec<Value> {
        let mut list: Vec<Value> = agents_raw(env).and_then(|o| serde_json::from_str(&o).ok()).unwrap_or_default();
        for a in list.iter_mut() {
            let sid = a["sessionId"].as_str().unwrap_or("").to_string();
            if a["status"] == "busy" && agent_core::safe_id(&sid) && subagents::turn_ended(&PathBuf::from(format!("{}/{sid}.jsonl", transcripts_of(env, &sid)))) { a["status"] = json!("idle"); }
        }
        list
    }
    fn subagents(&self, env: &Env, sid: &str) -> Vec<Value> {
        let mut c = SUBS.lock().unwrap();
        subagents::subagents_of(&transcripts_of(env, sid), sid, c.get_or_insert_with(Default::default))
    }
    fn agent_history(&self, env: &Env, sid: &str, id: &str, from: u64) -> (Vec<Event>, u64) {
        if !agent_core::safe_id(sid) || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return (vec![], 0); }
        stream::agent_history(&PathBuf::from(format!("{}/{sid}/subagents/agent-{id}.jsonl", transcripts_of(env, sid))), from)
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let q = agent_core::quote_sh;
        // the user's own `claude`, unless the settings point elsewhere
        let bin = agent_core::command_for(env, &self.default_bin(env.home), "claude");
        // on another account than ~/.claude: the terminal's claude gets its config folder too
        let on = |dir: &str| if dir == config_dir(env.home, "") { bin.clone() } else { format!("CLAUDE_CONFIG_DIR={} {bin}", q(dir)) };
        // the fence the app set (grants.deny, grants.fenced) goes along, so the terminal reaches no further than Relay
        let deny: Vec<String> = env.grants.deny.iter().map(|d| q(d)).collect();
        let fence = format!("{}{}", if deny.is_empty() { String::new() } else { format!(" --disallowedTools {}", deny.join(" ")) },
            // a shared vault runs in auto whatever the account's default mode, as in command(): bypass has no classifier
            if env.grants.fenced { format!(" --strict-mcp-config --permission-mode auto --settings '{}'", fenced_settings()) } else { String::new() });
        Some(match t {
            Terminal::Resume(s) if agent_core::safe_id(s) => format!("cd {} && {} --resume {s}{fence}", q(env.vault), on(&session_dir(env, s))),
            Terminal::Resume(_) => return None,
            Terminal::New(name) => format!("cd {} && {} -n {}{fence}", q(env.vault), on(&config_dir(env.home, account(env))), q(name)),
            Terminal::Attach(id) if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => format!("{bin} attach {id}"),
            Terminal::Attach(_) => return None,
        })
    }
    /// `stop` keeps the conversation, `claude attach <id>` resumes it later. No `rm`, that deletes.
    fn stop_background(&self, env: &Env, id: &str) -> Result<(), String> {
        if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
        let out = Command::new(env.bin).args(["stop", id]).env("PATH", env.path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    /// The way the terminal gets its ai-title: one Haiku call on the subscription, outside the vault, without
    /// settings, tools, MCP or a transcript. The message goes in as quoted data: given bare, Haiku answers it instead
    /// (org instructions still reach a `-p` call and make it act as an assistant).
    fn title(&self, env: &Env, text: &str) -> Result<String, String> {
        let text: String = text.chars().take(2000).collect();
        let prompt = agent_core::prompt::fill(TITLE, &[("text", &text)]);
        let out = finish(oneshot(env, OneShot { model: Some("haiku"), system: Some(TITLE_SYSTEM), prompt: Some(&prompt), ..Default::default() }))?;
        let t = String::from_utf8_lossy(&out.stdout);
        let t: String = t.lines().next().unwrap_or("").trim().trim_matches(|c| c == '"' || c == '\'' || c == '.').chars().take(60).collect();
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    /// One call in the checkout without settings, MCP or a transcript, on the CLI's default model: Read, Grep, Glob and
    /// read-only git, the rest refused (in print mode a tool that is not allowed is denied, nobody is asked).
    fn review(&self, env: &Env, dir: &str, system: &str, text: &str) -> Result<String, String> {
        let one = OneShot { cwd: Some(dir), tools: &["Read", "Grep", "Glob", "Bash"],
            allowed: &["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)"],
            system: Some(system), prompt: Some(text), ..Default::default() };
        answered(finish(oneshot(env, one))?)
    }
    /// Like `title`: one call outside the vault without settings, tools, MCP or a transcript, here on Sonnet.
    fn write(&self, env: &Env, system: &str, text: &str) -> Result<String, String> {
        let text: String = text.chars().take(agent_core::WRITE_MAX).collect();
        answered(finish(oneshot(env, OneShot { model: Some("sonnet"), system: Some(system), prompt: Some(&text), ..Default::default() }))?)
    }
    fn limits(&self, env: &Env) -> usage::Limits { usage_log::fetch_limits(env.home, account(env)) }
    fn usage(&self, env: &Env, since: i64) -> Vec<usage::Record> {
        let roots: Vec<PathBuf> = config_dirs(env).iter().map(|d| PathBuf::from(format!("{d}/projects"))).collect();
        usage_log::records(&roots, &slug(env.vault), since)
    }
    fn vault_touches(&self, env: &Env, since: i64) -> Vec<usage::Touch> {
        let roots: Vec<PathBuf> = config_dirs(env).iter().map(|d| PathBuf::from(format!("{d}/projects"))).collect();
        usage_log::touches(&roots, since)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::{Grants, NO_GRANTS};
    fn env<'a>(p: &'a Path) -> Env<'a> { Env { home: "/Users/me", vault: "/Users/me/my vault", path: "/usr/bin", bin: "/Users/me/.local/bin/claude", pending: p, grants: &agent_core::NO_GRANTS, opts: &Value::Null } }
    #[test]
    fn the_title_prompt_holds_the_message_as_data() {
        let p = agent_core::prompt::fill(TITLE, &[("text", "wat is {{dit}}?")]);
        assert!(p.ends_with("<message>\nwat is {{dit}}?\n</message>") && !TITLE_SYSTEM.is_empty());
    }
    #[test]
    fn too_old_reads_the_version_line() {
        assert!(too_old("2.1.200 (Claude Code)") && too_old("1.9.999"));
        assert!(!too_old("2.1.294 (Claude Code)") && !too_old("2.2.0") && !too_old("3.0.1 (Claude Code)"));
        assert!(!too_old("") && !too_old("Claude Code") && !too_old("2.1"));
        // an old claude on disk: no process, the update hint instead
        let dir = std::env::temp_dir().join(format!("relay-old-claude-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("claude");
        std::fs::write(&bin, "#!/bin/sh\necho '2.1.200 (Claude Code)'\n").unwrap();
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let p = PathBuf::from("/tmp/pending");
        let l = Launch { key: "c:1", name: "x", model: "", effort: "", resume: None, fork: None, turn: None };
        let err = PROVIDER.command(&Env { bin: bin.to_str().unwrap(), ..env(&p) }, &l).err().unwrap();
        assert_eq!(err, "claude: Claude Code 2.1.200 is too old for Relay, it needs 2.1.294 or newer. Run `claude update` and start the conversation again.");
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn auto_mode_only_when_no_mode_is_set() {
        let d = std::env::temp_dir().join(format!("relay-mode-{}", std::process::id()));
        let (home, vault) = (d.join("home"), d.join("vault"));
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(vault.join(".claude")).unwrap();
        let p = PathBuf::from("/tmp/pending");
        let l = Launch { key: "c:1", name: "x", model: "", effort: "", resume: None, fork: None, turn: None };
        let auto = |grants: &Grants| {
            let e = Env { home: home.to_str().unwrap(), vault: vault.to_str().unwrap(), grants, ..env(&p) };
            PROVIDER.command(&e, &l).unwrap().get_args().any(|a| a == "--permission-mode")
        };
        let mode = |f: &Path, m: &str| std::fs::write(f, json!({"permissions": {"defaultMode": m}}).to_string()).unwrap();
        assert!(auto(&NO_GRANTS), "nothing set: auto");
        assert!(!auto(&Grants { machine: true, ..Default::default() }), "a work machine takes the mirrored mode");
        mode(&vault.join(".claude/settings.json"), "auto");
        assert!(auto(&NO_GRANTS), "the CLI ignores auto in a project's settings");
        mode(&vault.join(".claude/settings.local.json"), "acceptEdits");
        assert!(!auto(&NO_GRANTS), "the vault's own mode stays");
        std::fs::remove_file(vault.join(".claude/settings.local.json")).unwrap();
        mode(&home.join(".claude/settings.json"), "manual");
        assert!(!auto(&NO_GRANTS), "the user's own mode stays");
        std::fs::remove_dir_all(&d).ok();
    }
    #[test]
    fn spawn_args_stay_as_before() {
        let p = PathBuf::from("/tmp/pending");
        let l = Launch { key: "c:1", name: "Algemeen: x", model: "opus", effort: "high", resume: Some("abc-1"), fork: Some("def"), turn: None };
        let cmd = PROVIDER.command(&env(&p), &l).unwrap();
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[..11], ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-prompt-tool", "stdio", "--thinking-display", "summarized"]);
        // no MCP config until the app has servers to answer for; the permission tool is no server any more
        assert!(!args.contains(&"--mcp-config".to_string()) && !args.iter().any(|a| a.contains("vaultperm")));
        assert_eq!(args[11], "--allowedTools");
        assert_eq!((args[17].as_str(), args[18].as_str(), args[22].as_str()), (RELAY_TOOL, "--disallowedTools", "--append-system-prompt"));
        assert_eq!(&args[24..], ["-n", "Algemeen: x", "--replay-user-messages", "--permission-mode", "auto", "--model", "opus", "--effort", "high", "--resume", "abc-1"]);
        assert!(cmd.get_envs().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v.is_none()));
        assert!(cmd.get_envs().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v.is_none()));
        assert!(!cmd.get_envs().any(|(k, _)| k == "MCP_TOOL_TIMEOUT"));
        let l = Launch { resume: None, model: "", effort: "", ..l };
        let args: Vec<String> = PROVIDER.command(&env(&p), &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[24..], ["-n", "Algemeen: x", "--replay-user-messages", "--permission-mode", "auto", "--resume", "def", "--fork-session"]);
        let at = |args: &[String], f: &str| args.iter().position(|a| a == f).unwrap();
        let grants = Grants { mail: true, ..Default::default() };
        let args: Vec<String> = PROVIDER.command(&Env { grants: &grants, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[at(&args, "--mcp-config") + 1].contains("\"relay-mail\":{\"name\":\"relay-mail\",\"type\":\"sdk\"}"));
        let grants = Grants { design: true, ..Default::default() };
        let args: Vec<String> = PROVIDER.command(&Env { grants: &grants, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[at(&args, "--mcp-config") + 1].contains("\"relay-design\":{\"name\":\"relay-design\",\"type\":\"sdk\"}") && args.contains(&"mcp__relay-design__design_snapshot".to_string()));
        let grants = Grants { orch: Some("worker".into()), system: Some("be a worker".into()), deny: vec!["Edit(//v/x)".into()], ..Default::default() };
        let opts = json!({"ask": ["Bash(git push*)"]});
        let args: Vec<String> = PROVIDER.command(&Env { grants: &grants, opts: &opts, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[at(&args, "--mcp-config") + 1].contains("\"relay-orch\":{\"name\":\"relay-orch\",\"type\":\"sdk\"}"));
        let at = |f: &str| at(&args, f);
        assert_eq!(args[at("--allowedTools") + 1..at("--disallowedTools")].last().unwrap(), "mcp__relay-orch__report");
        assert_eq!(args[at("--disallowedTools") + 1..at("--append-system-prompt")].last().unwrap(), "Edit(//v/x)");
        assert!(args[at("--append-system-prompt") + 1].starts_with(agent_core::envelope::HINT) && args[at("--append-system-prompt") + 1].ends_with("be a worker"));
        assert_eq!(args[at("--settings") + 1], r#"{"permissions":{"ask":["Bash(git push*)"]}}"#);
        assert!(!args.contains(&"--strict-mcp-config".to_string()));
        // in a shared vault: the fence's rules among the denies, and only Relay's own MCP servers
        let grants = Grants { mail: true, deny: vec!["Read(//Users/me/my vault/**)".into()], fenced: true, ..Default::default() };
        let opts = json!({"ask": ["Bash(git push*)"]});
        let args: Vec<String> = PROVIDER.command(&Env { grants: &grants, opts: &opts, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"Read(//Users/me/my vault/**)".to_string()) && args.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(args[args.iter().position(|a| a == "--permission-mode").unwrap() + 1], "auto", "a shared vault runs in auto, whatever the account says");
        let settings: Value = serde_json::from_str(&args[args.iter().position(|a| a == "--settings").unwrap() + 1]).unwrap();
        assert_eq!(settings, json!({"disableAllHooks": true, "autoMemoryEnabled": false, "permissions": {"ask": ["Bash(git push*)"]}}), "no hook and no auto memory there, the asks kept");
        assert!(args[args.iter().position(|a| a == "--mcp-config").unwrap() + 1].contains("relay-mail"));
    }
    #[test]
    fn one_shot_calls_keep_their_flags() {
        let p = PathBuf::from("/tmp/pending");
        let args = |c: &Command| c.get_args().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let cwd = |c: &Command| c.get_current_dir().map(|d| d.to_path_buf());
        let e = env(&p);
        let c = oneshot(&e, OneShot { model: Some("haiku"), system: Some("sys"), prompt: Some("hi"), ..Default::default() });
        assert_eq!(args(&c), ["-p", "--model", "haiku", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "", "--system-prompt", "sys", "hi"]);
        assert_eq!(cwd(&c), Some(std::env::temp_dir()));
        assert!(c.get_envs().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v.is_none()) && c.get_envs().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v.is_none()));
        let c = oneshot(&e, OneShot { cwd: Some("/repo"), tools: &["Read", "Bash"], allowed: &["Read", "Bash(git diff:*)"], system: Some("sys"), prompt: Some("hi"), ..Default::default() });
        assert_eq!(args(&c), ["-p", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "Read", "Bash", "--allowedTools", "Read", "Bash(git diff:*)", "--system-prompt", "sys", "hi"]);
        assert_eq!(cwd(&c), Some(PathBuf::from("/repo")));
        // a job in the vault: own settings, a fork, the fence's denies and settings, on another account
        let grants = Grants { deny: vec!["Read(//x/**)".into()], fenced: true, ..Default::default() };
        let opts = json!({"account": "/Users/me/.claude-work"});
        let c = oneshot(&Env { grants: &grants, opts: &opts, ..e }, OneShot { cwd: Some("/v"), model: Some("sonnet"), tools: &["Read", "Edit"], allowed: &["Read", "Edit"], own_settings: true, fork_of: Some("ab-1"), ..Default::default() });
        assert_eq!(args(&c), ["-p", "--resume", "ab-1", "--fork-session", "--model", "sonnet", "--no-session-persistence", "--strict-mcp-config", "--tools", "Read", "Edit",
            "--allowedTools", "Read", "Edit", "--disallowedTools", "Read(//x/**)", "--settings", fenced_settings()]);
        assert!(c.get_envs().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v.is_some_and(|v| v == "/Users/me/.claude-work")));
    }
    #[test]
    fn a_session_moves_through_the_provider() {
        let root = std::env::temp_dir().join(format!("relay-session-io-{}", std::process::id()));
        let home = root.to_string_lossy().into_owned();
        let p = PathBuf::from("/tmp/pending");
        let e = Env { home: &home, vault: "/v", ..env(&p) };
        assert_eq!(PROVIDER.memory_dir(&e).unwrap(), format!("{home}/.claude/projects/-v/memory"));
        assert!(PROVIDER.read_session(&e, "ab-1").is_err());
        PROVIDER.write_session(&e, "ab-1", b"{}\n").unwrap();
        assert_eq!(PROVIDER.read_session(&e, "ab-1").unwrap(), b"{}\n");
        assert!(PROVIDER.write_session(&e, "x/../y", b"").is_err());
        std::fs::remove_dir_all(&root).ok();
    }
    #[test]
    fn the_control_pipe_lines() {
        let line = |s: Option<String>| serde_json::from_str::<Value>(&s.unwrap()).unwrap();
        let init = line(PROVIDER.control_init(&["relay-mail", "relay-orch"]));
        assert_eq!((init["type"].as_str(), init["request_id"].as_str(), init["request"]["subtype"].as_str()), (Some("control_request"), Some("init"), Some("initialize")));
        assert_eq!(init["request"]["sdkMcpServers"], json!(["relay-mail", "relay-orch"]));
        assert_eq!(line(PROVIDER.control_init(&[]))["request"]["sdkMcpServers"], json!([]));
        let ok = line(PROVIDER.control_reply(&json!("r1"), Ok(json!({"jsonrpc": "2.0", "id": 1, "result": {}}))));
        assert_eq!(ok, json!({"type": "control_response", "response": {"subtype": "success", "request_id": "r1", "response": {"mcp_response": {"jsonrpc": "2.0", "id": 1, "result": {}}}}}));
        let err = line(PROVIDER.control_reply(&json!("r2"), Err("unsupported".into())));
        assert_eq!(err, json!({"type": "control_response", "response": {"subtype": "error", "request_id": "r2", "error": "unsupported"}}));
        let model = line(PROVIDER.set_model("sonnet"));
        assert_eq!((model["type"].as_str(), model["request"]["subtype"].as_str(), model["request"]["model"].as_str()), (Some("control_request"), Some("set_model"), Some("sonnet")));
        assert_eq!(line(PROVIDER.set_model(""))["request"]["model"], "default");
        let stop = line(PROVIDER.interrupt());
        assert_eq!((stop["type"].as_str(), stop["request"]["subtype"].as_str()), (Some("control_request"), Some("interrupt")));
        assert!(PROVIDER.caps().steer);
    }
    #[test]
    fn terminal_commands() {
        let p = PathBuf::from("/tmp");
        assert_eq!(PROVIDER.terminal(&env(&p), Terminal::Resume("ab-12")).unwrap(), "cd '/Users/me/my vault' && claude --resume ab-12");
        assert_eq!(PROVIDER.terminal(&env(&p), Terminal::New("It's")).unwrap(), "cd '/Users/me/my vault' && claude -n 'It'\\''s'");
        assert_eq!(PROVIDER.terminal(&env(&p), Terminal::Attach("bg1")).unwrap(), "claude attach bg1");
        assert!(PROVIDER.terminal(&env(&p), Terminal::Resume("x; rm")).is_none());
        // a fenced conversation's terminal gets the same fence
        let grants = Grants { deny: vec!["Read(//Users/me/team/**)".into()], fenced: true, ..Default::default() };
        let e = Env { grants: &grants, ..env(&p) };
        assert_eq!(PROVIDER.terminal(&e, Terminal::Resume("ab-12")).unwrap(),
            "cd '/Users/me/my vault' && claude --resume ab-12 --disallowedTools 'Read(//Users/me/team/**)' --strict-mcp-config --permission-mode auto --settings '{\"disableAllHooks\":true,\"autoMemoryEnabled\":false}'");
        assert_eq!(transcripts(&env(&p)), "/Users/me/.claude/projects/-Users-me-my-vault");
        let opts = json!({"account": "/Users/me/.claude-work"});
        let work = Env { opts: &opts, ..env(&p) };
        assert_eq!(PROVIDER.terminal(&work, Terminal::New("x")).unwrap(), "cd '/Users/me/my vault' && CLAUDE_CONFIG_DIR='/Users/me/.claude-work' claude -n 'x'");
    }
    #[test]
    fn a_conversation_moves_to_another_account() {
        let root = std::env::temp_dir().join(format!("relay-acct-{}", std::process::id()));
        let (own, work) = (root.join("own"), root.join("work"));
        let (home, vault) = (root.to_string_lossy().to_string(), "/v".to_string());
        // ~/.claude is <home>/.claude: point the test's home there
        std::fs::create_dir_all(root.join(".claude/projects/-v")).unwrap();
        std::fs::write(root.join(".claude/projects/-v/ab-1.jsonl"), "{}\n").unwrap();
        let opts = json!({"account": work.to_string_lossy(), "accounts": [{"name": "Work", "dir": work.to_string_lossy()}]});
        let env = Env { home: &home, vault: &vault, path: "/usr/bin", bin: "/bin/claude", pending: &own, grants: &NO_GRANTS, opts: &opts };
        let l = Launch { key: "c:1", name: "x", model: "", effort: "", resume: Some("ab-1"), fork: None, turn: None };
        let cmd = PROVIDER.command(&env, &l).unwrap();
        assert!(work.join("projects/-v/ab-1.jsonl").is_file());
        assert!(cmd.get_envs().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v.is_some_and(|v| v == work.as_os_str())));
        assert!(transcripts_of(&env, "ab-1").ends_with("work/projects/-v"));
        // more turns on Work, then back to ~/.claude: its older copy is replaced by the latest
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(work.join("projects/-v/ab-1.jsonl"), "{}\n{}\n").unwrap();
        let back = json!({"account": "", "accounts": opts["accounts"]});
        PROVIDER.command(&Env { opts: &back, ..env }, &l).unwrap();
        assert_eq!(std::fs::read_to_string(root.join(".claude/projects/-v/ab-1.jsonl")).unwrap(), "{}\n{}\n");
        std::fs::remove_dir_all(&root).ok();
    }
}
