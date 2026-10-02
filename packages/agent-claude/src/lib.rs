//! Claude Code as an agent provider. Every conversation is one `claude -p` process in stream-json mode, in the
//! vault, on the user's subscription (ANTHROPIC_API_KEY removed). Permission requests and questions come in
//! through perm_server.py (the --permission-prompt-tool) as files in the pending folder. Transcripts, subagents
//! and token usage are read from ~/.claude/projects/<vault-slug>/, and from the same folder in every other
//! account's config folder (CLAUDE_CONFIG_DIR).

use agent_core::{usage, AgentProvider, Caps, Choice, Detect, Env, Event, Launch, Parser, Terminal, Turn};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

pub mod stream;
pub mod subagents;
pub mod usage_log;

// ponytail: perm_server.py is read from this checkout, fine as long as the app runs from its own checkout. A
// relay-server writes its own copy (PERM_SERVER_PY) and the app passes that path as opts.perm_server.
const PERM_SERVER: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/perm_server.py");
pub const PERM_SERVER_PY: &str = include_str!("../perm_server.py");

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
const RELAY_HINT: &str = "The Relay app gives you its extensions as a shell command: `relay help` lists the actions available in this conversation (creating tickets in Productive, Trello or Linear, booking time in Productive, vault reminders, mail drafts), `relay <action> key=value ...` runs one. Use it instead of other tools for these when an action fits. Some actions ask the user first; a denied one stays denied, do not work around it.";

pub struct Claude;
pub static PROVIDER: Claude = Claude;

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
        Caps { persistent: true, images: true, thinking: false, permissions: true, questions: true, subagents: true, fork: true,
            terminal: true, background: true, effort: true, limits: true, title: true, accounts: true }
    }
    fn default_bin(&self, home: &str) -> String { format!("{home}/.local/bin/claude") }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        let logged_in = usage_log::credentials(env.home, account(env)).is_some();
        let note = if !installed { Some("curl -fsSL https://claude.ai/install.sh | bash".into()) } else if !logged_in { Some("claude /login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: Some(logged_in), note }
    }
    fn models(&self) -> Vec<Choice> {
        [("fable", "Fable"), ("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")].iter().map(|(i, l)| Choice::new(i, l)).collect()
    }
    fn commands(&self, env: &Env) -> Value {
        agent_core::discover_commands(env, include_str!("../commands.py"))
    }
    fn efforts(&self) -> Vec<Choice> {
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")].iter().map(|(i, l)| Choice::new(i, l)).collect()
    }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        let mut mcp = json!({"mcpServers": {"vaultperm": {
            "command": "/usr/bin/python3", "args": [if env.opt("perm_server").is_empty() { PERM_SERVER } else { env.opt("perm_server") }],
            "env": {"PENDING": env.pending.to_string_lossy(), "PROJECT": l.key}}}});
        // opts.mail, set by the app: the relay-mail tools, answered by the app over this pipe
        if env.opts["mail"] == true { mcp["mcpServers"]["relay-mail"] = json!({"type": "sdk", "name": "relay-mail"}); }
        let mut cmd = Command::new(env.bin);
        cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                  "--permission-prompt-tool", "mcp__vaultperm__approve", "--mcp-config"])
            .arg(mcp.to_string()).arg("--allowedTools").args(MAIL_TOOLS).arg(RELAY_TOOL).arg("--disallowedTools").args(DENIED)
            .args(["--append-system-prompt", RELAY_HINT, "-n", l.name]);
        if !l.model.is_empty() { cmd.args(["--model", l.model]); }
        if !l.effort.is_empty() { cmd.args(["--effort", l.effort]); }
        if let Some(sid) = l.resume { carry(env, sid)?; cmd.args(["--resume", sid]); }
        // continue a terminal conversation as a copy: full history, new session id, the terminal one untouched
        else if let Some(f) = l.fork { carry(env, f)?; cmd.args(["--resume", f, "--fork-session"]); }
        on_account(&mut cmd, account(env));
        cmd.env_remove("ANTHROPIC_API_KEY").env("MCP_TOOL_TIMEOUT", "86400000"); // a permission may wait a day for the user
        Ok(cmd)
    }
    fn input(&self, turn: &Turn) -> Option<String> { Some(stream::user_message(turn).to_string()) }
    fn parser(&self) -> Parser { Box::new(stream::parse) }

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
    fn spawn_args_stay_as_before() {
        let p = PathBuf::from("/tmp/pending");
        let l = Launch { key: "c:1", name: "Algemeen: x", model: "opus", effort: "high", resume: Some("abc-1"), fork: Some("def"), turn: None };
        let cmd = PROVIDER.command(&env(&p), &l).unwrap();
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[..8], ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "mcp__vaultperm__approve"]);
        assert!(args[9].contains("perm_server.py") && args[9].contains("\"PROJECT\":\"c:1\""));
        assert!(!args[9].contains("relay-mail"));
        assert_eq!(args[10], "--allowedTools");
        assert_eq!((args[16].as_str(), args[17].as_str(), args[21].as_str()), (RELAY_TOOL, "--disallowedTools", "--append-system-prompt"));
        assert_eq!(&args[23..], ["-n", "Algemeen: x", "--model", "opus", "--effort", "high", "--resume", "abc-1"]);
        assert!(cmd.get_envs().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v.is_none()));
        assert!(cmd.get_envs().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v.is_none()));
        let l = Launch { resume: None, model: "", effort: "", ..l };
        let args: Vec<String> = PROVIDER.command(&env(&p), &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[23..], ["-n", "Algemeen: x", "--resume", "def", "--fork-session"]);
        let opts = json!({"mail": true});
        let args: Vec<String> = PROVIDER.command(&Env { opts: &opts, ..env(&p) }, &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[9].contains("\"relay-mail\":{\"name\":\"relay-mail\",\"type\":\"sdk\"}"));
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
