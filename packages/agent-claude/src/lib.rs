//! Claude Code as an agent provider. Every conversation is one `claude -p` process in stream-json mode, in the
//! vault, on the user's subscription (ANTHROPIC_API_KEY removed). Permission requests and questions come in
//! through perm_server.py (the --permission-prompt-tool) as files in the pending folder. Transcripts, subagents
//! and token usage are read from ~/.claude/projects/<vault-slug>/.

use agent_core::{usage, AgentProvider, Caps, Choice, Detect, Env, Event, Launch, Parser, Terminal, Turn};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

pub mod stream;
pub mod subagents;
pub mod usage_log;

// ponytail: perm_server.py is read from this checkout, fine as long as the app runs from its own checkout
const PERM_SERVER: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/perm_server.py");

/// Tools no app session may call: mail only ever becomes a draft (hard wall) and the mailbox is never touched, so
/// the whole Gmail connector goes, and in the app mail goes through relay-mail, never himalaya.
/// Enforced by the CLI at call time, before the app hears of it (scripts/pipe-check.py).
pub const DENIED: [&str; 2] = ["mcp__claude_ai_Gmail__*", "Bash(himalaya*)"];
/// The mail tools run without a card, also once the session holds mail text: none can send, a draft only lands in Drafts.
pub const MAIL_TOOLS: [&str; 5] = ["mcp__relay-mail__search", "mcp__relay-mail__read", "mcp__relay-mail__thread", "mcp__relay-mail__attachment", "mcp__relay-mail__save_draft"];

pub struct Claude;
pub static PROVIDER: Claude = Claude;

/// Claude Code's transcript folder for a vault: the path with every non-alphanumeric char as `-`.
pub fn slug(vault: &str) -> String { vault.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect() }
pub fn transcripts(env: &Env) -> String {
    if env.vault.is_empty() { return String::new(); } // no vault: never fall back to ~/.claude/projects itself
    format!("{}/.claude/projects/{}", env.home, slug(env.vault))
}

static SUBS: Mutex<Option<subagents::SubCache>> = Mutex::new(None);

impl AgentProvider for Claude {
    fn id(&self) -> &'static str { "claude" }
    fn name(&self) -> &'static str { "Claude Code" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: false, permissions: true, questions: true, subagents: true, fork: true,
            terminal: true, background: true, effort: true, limits: true, title: true }
    }
    fn default_bin(&self, home: &str) -> String { format!("{home}/.local/bin/claude") }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        let logged_in = usage_log::credentials(env.home).is_some();
        let note = if !installed { Some("curl -fsSL https://claude.ai/install.sh | bash".into()) } else if !logged_in { Some("claude /login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: Some(logged_in), note }
    }
    fn models(&self) -> Vec<Choice> {
        [("fable", "Fable"), ("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")].iter().map(|(i, l)| Choice::new(i, l)).collect()
    }
    fn defaults(&self, env: &Env, model: &str) -> Value {
        agent_core::probe(env, model, include_str!("../defaults.py"))
    }
    fn efforts(&self) -> Vec<Choice> {
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")].iter().map(|(i, l)| Choice::new(i, l)).collect()
    }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        let mut mcp = json!({"mcpServers": {"vaultperm": {
            "command": "/usr/bin/python3", "args": [PERM_SERVER],
            "env": {"PENDING": env.pending.to_string_lossy(), "PROJECT": l.key}}}});
        // opts.mail, set by the app: the relay-mail tools, answered by the app over this pipe
        if env.opts["mail"] == true { mcp["mcpServers"]["relay-mail"] = json!({"type": "sdk", "name": "relay-mail"}); }
        let mut cmd = Command::new(env.bin);
        cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                  "--permission-prompt-tool", "mcp__vaultperm__approve", "--mcp-config"])
            .arg(mcp.to_string()).arg("--allowedTools").args(MAIL_TOOLS).arg("--disallowedTools").args(DENIED).args(["-n", l.name]);
        if !l.model.is_empty() { cmd.args(["--model", l.model]); }
        if !l.effort.is_empty() { cmd.args(["--effort", l.effort]); }
        if let Some(sid) = l.resume { cmd.args(["--resume", sid]); }
        // continue a terminal conversation as a copy: full history, new session id, the terminal one untouched
        else if let Some(f) = l.fork { cmd.args(["--resume", f, "--fork-session"]); }
        cmd.env_remove("ANTHROPIC_API_KEY").env("MCP_TOOL_TIMEOUT", "86400000"); // a permission may wait a day for the user
        Ok(cmd)
    }
    fn input(&self, turn: &Turn) -> Option<String> { Some(stream::user_message(turn).to_string()) }
    fn parser(&self) -> Parser { Box::new(stream::parse) }

    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !agent_core::safe_id(sid) { return (vec![], 0); }
        stream::history(&PathBuf::from(format!("{}/{sid}.jsonl", transcripts(env))), from)
    }
    /// Sessions Claude Code knows about, including the ones in the terminal and in the background.
    fn sessions(&self, env: &Env) -> Vec<Value> {
        let mut list: Vec<Value> = agent_core::run(env.bin, env.path, &["agents", "--json"]).and_then(|o| serde_json::from_str(&o).ok()).unwrap_or_default();
        let dir = transcripts(env);
        for a in list.iter_mut() {
            let sid = a["sessionId"].as_str().unwrap_or("").to_string();
            if a["status"] == "busy" && !sid.is_empty() && subagents::turn_ended(&PathBuf::from(format!("{dir}/{sid}.jsonl"))) { a["status"] = json!("idle"); }
        }
        list
    }
    fn subagents(&self, env: &Env, sid: &str) -> Vec<Value> {
        let mut c = SUBS.lock().unwrap();
        subagents::subagents_of(&transcripts(env), sid, c.get_or_insert_with(Default::default))
    }
    fn agent_log(&self, env: &Env, sid: &str, id: &str) -> Vec<String> {
        if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return vec![]; }
        subagents::agent_log(&PathBuf::from(format!("{}/{sid}/subagents/agent-{id}.jsonl", transcripts(env))))
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        // the user's own `claude`, unless the settings point elsewhere
        let bin = if env.bin == self.default_bin(env.home) { "claude".to_string() } else { q(env.bin) };
        Some(match t {
            Terminal::Resume(s) if agent_core::safe_id(s) => format!("cd {} && {bin} --resume {s}", q(env.vault)),
            Terminal::Resume(_) => return None,
            Terminal::New(name) => format!("cd {} && {bin} -n {}", q(env.vault), q(name)),
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
        let out = Command::new(env.bin)
            .args(["-p", "--model", "haiku", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "",
                   "--system-prompt", "Geef een korte titel (2 tot 5 woorden, in de taal van het bericht, geen aanhalingstekens, geen punt) voor een gesprek dat met dit bericht begint. Antwoord enkel met de titel."])
            .arg(text).current_dir(std::env::temp_dir()).env("PATH", env.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        let t = String::from_utf8_lossy(&out.stdout);
        let t: String = t.lines().next().unwrap_or("").trim().trim_matches(|c| c == '"' || c == '\'' || c == '.').chars().take(60).collect();
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    fn limits(&self, env: &Env) -> usage::Limits { usage_log::fetch_limits(env.home) }
    fn usage(&self, env: &Env, since: i64) -> Vec<usage::Record> {
        usage_log::records(&PathBuf::from(format!("{}/.claude/projects", env.home)), &slug(env.vault), since)
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
        assert_eq!(args[16], "--disallowedTools");
        assert_eq!(&args[19..], ["-n", "Algemeen: x", "--model", "opus", "--effort", "high", "--resume", "abc-1"]);
        assert!(cmd.get_envs().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v.is_none()));
        let l = Launch { resume: None, model: "", effort: "", ..l };
        let args: Vec<String> = PROVIDER.command(&env(&p), &l).unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[19..], ["-n", "Algemeen: x", "--resume", "def", "--fork-session"]);
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
    }
}
