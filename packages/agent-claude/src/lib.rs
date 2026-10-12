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

/// CLAUDE_CONFIG_DIR for an account, and not inherited for ~/.claude.
fn on_account(cmd: &mut Command, account: &str) {
    if account.is_empty() { cmd.env_remove("CLAUDE_CONFIG_DIR"); } else { cmd.env("CLAUDE_CONFIG_DIR", account); }
}

/// The app's `relay` command (src-tauri/src/actions.rs) runs without a Bash card: each action has its own policy,
/// and the app asks on a card for the ones that need it.
pub const RELAY_TOOL: &str = "Bash(relay *)";

/// The relay-orch tools of the orchestrator's coordinator and of its workers, without a card (src-tauri orch.rs).
pub const ORCH_COORD_TOOLS: [&str; 4] = ["mcp__relay-orch__dispatch", "mcp__relay-orch__workers", "mcp__relay-orch__message", "mcp__relay-orch__stop"];
pub const ORCH_WORKER_TOOLS: [&str; 1] = ["mcp__relay-orch__report"];

/// The Commonwealth plugin's read tools run without a card in a session the app routed to a brain (opts.commonwealth_brain).
/// `remember` keeps its card: it stages into a brain the team shares, and a session can take in a mail's text after it
/// started, which --allowedTools (fixed at spawn) can no longer take back.
pub const COMMONWEALTH_TOOLS: [&str; 5] = ["mcp__plugin_commonwealth_commonwealth__ask", "mcp__plugin_commonwealth_commonwealth__search", "mcp__plugin_commonwealth_commonwealth__read", "mcp__plugin_commonwealth_commonwealth__list-work-state", "mcp__plugin_commonwealth_commonwealth__who-is"];

pub struct Claude;
pub static PROVIDER: Claude = Claude;

/// The oldest Claude Code seen taking every flag `command` passes (`--thinking-display` is not in its changelog, so
/// this is the oldest build checked, not the release that added it). An older one stops each turn on "unknown option".
const MIN_VERSION: [u32; 3] = [2, 1, 294];
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
fn config_dirs(env: &Env) -> Vec<String> {
    let extra = env.opts["accounts"].as_array().into_iter().flatten().filter_map(|a| a["dir"].as_str()).filter(|d| !d.is_empty()).map(String::from);
    std::iter::once(config_dir(env.home, "")).chain(extra).collect()
}
fn transcripts_in(dir: &str, vault: &str) -> String {
    if vault.is_empty() { return String::new(); } // no vault: never fall back to <config>/projects itself
    format!("{dir}/projects/{}", slug(vault))
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

static SUBS: Mutex<Option<subagents::SubCache>> = Mutex::new(None);

impl AgentProvider for Claude {
    fn id(&self) -> &'static str { "claude" }
    fn name(&self) -> &'static str { "Claude Code" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: true, permissions: true, questions: true, subagents: true, fork: true,
            terminal: true, background: true, effort: true, limits: true, title: true, write: true, accounts: true,
            live_model: true, control: true, picked: true, remote: true, brain: true }
    }
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
        if let Some(v) = agent_core::version(env.bin, env.path).filter(|v| too_old(v)) {
            let [a, b, c] = MIN_VERSION;
            return Err(format!("claude: Claude Code {v} is too old for Relay, it needs {a}.{b}.{c} or newer. Run `claude update` and start the conversation again."));
        }
        let mut mcp = json!({"mcpServers": {}});
        // opts.mail, set by the app: the relay-mail tools, answered by the app over this pipe
        if env.opts["mail"] == true { mcp["mcpServers"]["relay-mail"] = json!({"type": "sdk", "name": "relay-mail"}); }
        // opts.orch, set by the app for the orchestrator's coordinator and workers: the relay-orch tools, their
        // role prompt, and the denies and asks that hold whatever the user's settings allow (ask beats allow)
        let strs = |k: &str| env.opts[k].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect::<Vec<_>>();
        let mut allowed: Vec<String> = MAIL_TOOLS.iter().chain([RELAY_TOOL].iter()).map(|t| t.to_string()).collect();
        if let Some(role) = env.opts["orch"].as_str() {
            mcp["mcpServers"]["relay-orch"] = json!({"type": "sdk", "name": "relay-orch"});
            allowed.extend(if role == "coordinator" { &ORCH_COORD_TOOLS[..] } else { &ORCH_WORKER_TOOLS[..] }.iter().map(|t| t.to_string()));
        }
        // opts.commonwealth_brain, set by the app for a project whose repos the Commonwealth registry routes: the hooks and
        // the MCP server treat this vault session as in scope of that brain (COMMONWEALTH_BRAIN_DIR)
        let brain = env.opt("commonwealth_brain");
        if !brain.is_empty() { allowed.extend(COMMONWEALTH_TOOLS.iter().map(|t| t.to_string())); }
        let denied: Vec<String> = DENIED.iter().map(|d| d.to_string()).chain(strs("deny")).collect();
        let system = match env.opts["system"].as_str() { Some(s) => format!("{}\n\n{s}", agent_core::envelope::HINT), None => agent_core::envelope::HINT.to_string() };
        let mut cmd = Command::new(env.bin);
        cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                  "--permission-prompt-tool", "stdio", "--thinking-display", "summarized"])
            .arg("--allowedTools").args(&allowed).arg("--disallowedTools").args(&denied)
            .arg("--append-system-prompt").arg(&system).args(["-n", l.name])
            // each message echoed when Claude takes it up: one sent during a turn often joins that turn
            .arg("--replay-user-messages");
        if !mcp["mcpServers"].as_object().is_some_and(|m| m.is_empty()) { cmd.arg("--mcp-config").arg(mcp.to_string()); }
        if !brain.is_empty() { cmd.env("COMMONWEALTH_BRAIN_DIR", brain); }
        // and the repo its notes file under: Commonwealth stamps `source` from the cwd, which is the vault
        let source = env.opt("commonwealth_source");
        if !brain.is_empty() && !source.is_empty() { cmd.env("COMMONWEALTH_SOURCE", source); }
        let ask = strs("ask");
        if !ask.is_empty() { cmd.arg("--settings").arg(json!({"permissions": {"ask": ask}}).to_string()); }
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
    fn respond(&self, req: &agent_core::pending::Request, decision: &Value) -> Option<String> { permission::respond(req, decision) }
    fn input(&self, turn: &Turn) -> Option<String> { Some(stream::user_message(turn).to_string()) }
    fn parser(&self) -> Parser {
        let mut st = stream::State::default();
        Box::new(move |l| st.parse(l))
    }

    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !agent_core::safe_id(sid) { return (vec![], 0); }
        stream::history(&PathBuf::from(format!("{}/{sid}.jsonl", transcripts_of(env, sid))), from)
    }
    /// Sessions Claude Code knows about, including the ones in the terminal and in the background.
    fn sessions(&self, env: &Env) -> Vec<Value> {
        let mut list: Vec<Value> = agent_core::run(env.bin, env.path, &["agents", "--json"]).and_then(|o| serde_json::from_str(&o).ok()).unwrap_or_default();
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
    fn agent_log(&self, env: &Env, sid: &str, id: &str) -> Vec<String> {
        if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return vec![]; }
        subagents::agent_log(&PathBuf::from(format!("{}/{sid}/subagents/agent-{id}.jsonl", transcripts_of(env, sid))))
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        // the user's own `claude`, unless the settings point elsewhere
        let bin = if env.bin == self.default_bin(env.home) { "claude".to_string() } else { q(env.bin) };
        // on another account than ~/.claude: the terminal's claude gets its config folder too
        let on = |dir: &str| if dir == config_dir(env.home, "") { bin.clone() } else { format!("CLAUDE_CONFIG_DIR={} {bin}", q(dir)) };
        Some(match t {
            Terminal::Resume(s) if agent_core::safe_id(s) => format!("cd {} && {} --resume {s}", q(env.vault), on(&session_dir(env, s))),
            Terminal::Resume(_) => return None,
            Terminal::New(name) => format!("cd {} && {} -n {}", q(env.vault), on(&config_dir(env.home, account(env))), q(name)),
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
    /// settings, tools, MCP or a transcript.
    fn title(&self, env: &Env, text: &str) -> Result<String, String> {
        let text: String = text.chars().take(2000).collect();
        let mut cmd = Command::new(env.bin);
        on_account(&mut cmd, account(env));
        let out = cmd
            .args(["-p", "--model", "haiku", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "",
                   "--system-prompt", "Geef een korte titel (2 tot 5 woorden, in de taal van het bericht, geen aanhalingstekens, geen punt) voor een gesprek dat met dit bericht begint. Antwoord enkel met de titel."])
            .arg(text).current_dir(std::env::temp_dir()).env("PATH", env.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        let t = String::from_utf8_lossy(&out.stdout);
        let t: String = t.lines().next().unwrap_or("").trim().trim_matches(|c| c == '"' || c == '\'' || c == '.').chars().take(60).collect();
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    /// One call in the checkout without settings, MCP or a transcript, on the CLI's default model: Read, Grep, Glob and
    /// read-only git, the rest refused (in print mode a tool that is not allowed is denied, nobody is asked).
    fn review(&self, env: &Env, dir: &str, system: &str, text: &str) -> Result<String, String> {
        let mut cmd = Command::new(env.bin);
        on_account(&mut cmd, account(env));
        let out = cmd
            .args(["-p", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "Read", "Grep", "Glob", "Bash",
                "--allowedTools", "Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)",
                "--system-prompt", system])
            .arg(text).current_dir(dir).env("PATH", env.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    /// Like `title`: one call outside the vault without settings, tools, MCP or a transcript, here on Sonnet.
    fn write(&self, env: &Env, system: &str, text: &str) -> Result<String, String> {
        let text: String = text.chars().take(20_000).collect();
        let mut cmd = Command::new(env.bin);
        on_account(&mut cmd, account(env));
        let out = cmd
            .args(["-p", "--model", "sonnet", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "", "--system-prompt", system])
            .arg(text).current_dir(std::env::temp_dir()).env("PATH", env.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    fn limits(&self, env: &Env) -> usage::Limits { usage_log::fetch_limits(env.home, account(env)) }
    fn usage(&self, env: &Env, since: i64) -> Vec<usage::Record> {
        let roots: Vec<PathBuf> = config_dirs(env).iter().map(|d| PathBuf::from(format!("{d}/projects"))).collect();
        usage_log::records(&roots, &slug(env.vault), since)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn env<'a>(p: &'a Path) -> Env<'a> { Env { home: "/Users/me", vault: "/Users/me/my vault", path: "/usr/bin", bin: "/Users/me/.local/bin/claude", pending: p, opts: &Value::Null } }
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
        assert!(err.contains("2.1.200") && err.contains("claude update"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
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
        assert_eq!(&args[24..], ["-n", "Algemeen: x", "--replay-user-messages", "--model", "opus", "--effort", "high", "--resume", "abc-1"]);
        assert!(cmd.get_envs().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v.is_none()));
        assert!(cmd.get_envs().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v.is_none()));
        assert!(!cmd.get_envs().any(|(k, _)| k == "MCP_TOOL_TIMEOUT"));
        let l = Launch { resume: None, model: "", effort: "", ..l };
        let args: Vec<String> = PROVIDER.command(&env(&p), &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[24..], ["-n", "Algemeen: x", "--replay-user-messages", "--resume", "def", "--fork-session"]);
        let at = |args: &[String], f: &str| args.iter().position(|a| a == f).unwrap();
        let opts = json!({"mail": true});
        let args: Vec<String> = PROVIDER.command(&Env { opts: &opts, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[at(&args, "--mcp-config") + 1].contains("\"relay-mail\":{\"name\":\"relay-mail\",\"type\":\"sdk\"}"));
        let opts = json!({"orch": "worker", "system": "be a worker", "deny": ["Edit(//v/x)"], "ask": ["Bash(git push*)"]});
        let args: Vec<String> = PROVIDER.command(&Env { opts: &opts, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[at(&args, "--mcp-config") + 1].contains("\"relay-orch\":{\"name\":\"relay-orch\",\"type\":\"sdk\"}"));
        let at = |f: &str| at(&args, f);
        assert_eq!(args[at("--allowedTools") + 1..at("--disallowedTools")].last().unwrap(), "mcp__relay-orch__report");
        assert_eq!(args[at("--disallowedTools") + 1..at("--append-system-prompt")].last().unwrap(), "Edit(//v/x)");
        assert!(args[at("--append-system-prompt") + 1].starts_with(agent_core::envelope::HINT) && args[at("--append-system-prompt") + 1].ends_with("be a worker"));
        assert_eq!(args[at("--settings") + 1], r#"{"permissions":{"ask":["Bash(git push*)"]}}"#);
    }
    #[test]
    fn a_routed_project_gets_its_brain_and_the_commonwealth_tools() {
        let p = PathBuf::from("/tmp/pending");
        let l = Launch { key: "c:1", name: "x", model: "", effort: "", resume: None, fork: None, turn: None };
        let none = PROVIDER.command(&env(&p), &l).unwrap();
        assert!(!none.get_envs().any(|(k, _)| k == "COMMONWEALTH_BRAIN_DIR"));
        assert!(!none.get_args().any(|a| a.to_string_lossy().contains("mcp__plugin_commonwealth")));
        assert!(!none.get_envs().any(|(k, _)| k == "COMMONWEALTH_SOURCE"));
        let opts = json!({"commonwealth_brain": "/b/antenna", "commonwealth_source": "acme/web"});
        let cmd = PROVIDER.command(&Env { opts: &opts, ..env(&p) }, &l).unwrap();
        assert!(cmd.get_envs().any(|(k, v)| k == "COMMONWEALTH_BRAIN_DIR" && v.is_some_and(|v| v == "/b/antenna")));
        assert!(cmd.get_envs().any(|(k, v)| k == "COMMONWEALTH_SOURCE" && v.is_some_and(|v| v == "acme/web")));
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        let (allowed, denied) = (args.iter().position(|a| a == "--allowedTools").unwrap(), args.iter().position(|a| a == "--disallowedTools").unwrap());
        assert!(args[allowed..denied].contains(&"mcp__plugin_commonwealth_commonwealth__search".to_string()));
        // staging into a shared brain keeps its card
        assert!(!args.iter().any(|a| a.contains("commonwealth__remember")));
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
    }
    #[test]
    fn terminal_commands() {
        let p = PathBuf::from("/tmp");
        assert_eq!(PROVIDER.terminal(&env(&p), Terminal::Resume("ab-12")).unwrap(), "cd '/Users/me/my vault' && claude --resume ab-12");
        assert_eq!(PROVIDER.terminal(&env(&p), Terminal::New("It's")).unwrap(), "cd '/Users/me/my vault' && claude -n 'It'\\''s'");
        assert_eq!(PROVIDER.terminal(&env(&p), Terminal::Attach("bg1")).unwrap(), "claude attach bg1");
        assert!(PROVIDER.terminal(&env(&p), Terminal::Resume("x; rm")).is_none());
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
        let env = Env { home: &home, vault: &vault, path: "/usr/bin", bin: "/bin/claude", pending: &own, opts: &opts };
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
