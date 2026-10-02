//! Pi (pi-mono, `@earendil-works/pi-coding-agent`) as an agent provider. Every conversation is one `pi --mode rpc`
//! in the vault: JSON lines on stdin and stdout, the events become the contract's events ([`events`]). Pi has no
//! permission prompts of its own, so nothing is asked: every tool call runs. Models come from `pi --list-models`;
//! history, the session list and token usage with pi's cost are read from its session files (see [`session`]). Pi
//! reports no plan or rate limits.

use agent_core::{usage, AgentProvider, Caps, Choice, Detect, Env, Event, Launch, Parser, Terminal, Turn};
use serde_json::Value;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub mod events;
pub mod session;

pub struct Pi;
pub static PROVIDER: Pi = Pi;

/// The thinking levels of `--thinking`; "" is pi's own default (its settings, else the model's).
const EFFORTS: [(&str, &str); 7] = [("off", "Off"), ("minimal", "Minimal"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")];
fn home() -> String { std::env::var("HOME").unwrap_or_default() }

/// The program the last `detect` saw (the settings' override), for the model list, which has no env.
static BIN: Mutex<String> = Mutex::new(String::new());
/// `pi --list-models`, kept for a few minutes per program.
static MODELS: Mutex<Option<(String, Instant, Vec<Choice>)>> = Mutex::new(None);
fn models_of(bin: &str) -> Vec<Choice> {
    if !Path::new(bin).is_file() { return vec![]; }
    let mut m = MODELS.lock().unwrap();
    if let Some((b, at, v)) = m.as_ref() { if b == bin && at.elapsed() < Duration::from_secs(300) { return v.clone(); } }
    let path = std::env::var("PATH").unwrap_or_default();
    let v = agent_core::run(bin, &path, &["--list-models"]).map(|s| session::parse_models(&s)).unwrap_or_default();
    *m = Some((bin.into(), Instant::now(), v.clone()));
    v
}

static LOGS: Mutex<Option<session::Logs>> = Mutex::new(None);
fn with_logs<T>(env: &Env, since: i64, f: impl FnOnce(&session::Logs) -> T) -> T {
    let mut l = LOGS.lock().unwrap();
    let logs = l.get_or_insert_with(Default::default);
    logs.refresh(&session::sessions_dir(env.home), env.vault, since);
    f(logs)
}

impl AgentProvider for Pi {
    fn id(&self) -> &'static str { "pi" }
    fn name(&self) -> &'static str { "Pi" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: true, permissions: false, questions: false, subagents: false, fork: true,
            terminal: true, background: true, effort: true, limits: false, title: false, accounts: false }
    }
    fn default_bin(&self, home: &str) -> String {
        let c = [format!("{home}/.npm-global/bin/pi"), "/opt/homebrew/bin/pi".into(), "/usr/local/bin/pi".into(), format!("{home}/.local/bin/pi"), format!("{home}/.bun/bin/pi")];
        c.iter().find(|p| Path::new(p).is_file()).unwrap_or(&c[0]).clone()
    }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        *BIN.lock().unwrap() = env.bin.into();
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        // pi logs in per provider (`/login` in pi, or an API key in the environment): there is no one login to check
        let note = if !installed { Some("npm install -g @earendil-works/pi-coding-agent".into()) }
            else if models_of(env.bin).is_empty() { Some("pi, then /login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: None, note }
    }
    fn models(&self) -> Vec<Choice> { models_of(&self.bin()) }
    fn commands(&self, env: &Env) -> Value {
        agent_core::discover_commands(env, include_str!("../commands.py"))
    }
    fn efforts(&self) -> Vec<Choice> { EFFORTS.iter().map(|(i, l)| Choice::new(i, l)).collect() }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        let mut cmd = Command::new(env.bin);
        cmd.args(["--mode", "rpc", "--append-system-prompt", agent_core::envelope::HINT]);
        // pi models are provider/model; a resume pi no longer has starts a session with that id
        if let Some(s) = l.resume.filter(|s| self.valid_session(s)) { cmd.args(["--session-id", s]); }
        else if let Some(s) = l.fork.filter(|s| self.valid_session(s)) { cmd.args(["--fork", s]); }
        if l.model.contains('/') && agent_core::safe_model(l.model) { cmd.args(["--model", l.model]); }
        if let Some((e, _)) = EFFORTS.iter().find(|(e, _)| *e == l.effort) { cmd.args(["--thinking", e]); }
        Ok(cmd)
    }
    fn input(&self, turn: &Turn) -> Option<String> { Some(events::input(turn)) }
    fn parser(&self) -> Parser {
        let mut st = events::State::default();
        Box::new(move |l| st.parse(l))
    }

    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !self.valid_session(sid) { return (vec![], 0); }
        session::find(&session::sessions_dir(env.home), sid).map_or((vec![], 0), |p| session::history(&p, from))
    }
    /// The vault's pi sessions of the last days, the newest first.
    fn sessions(&self, env: &Env) -> Vec<Value> {
        if env.vault.is_empty() { return vec![]; }
        with_logs(env, usage::now_ms() - usage::KEEP_MS, |l| {
            let mut m: Vec<&session::Meta> = l.meta.values().filter(|m| session::in_vault(&m.cwd, env.vault) && self.valid_session(&m.session)).collect();
            m.sort_by_key(|m| -m.updated);
            m.iter().map(|m| session::session(&m.session, &m.title, m.updated)).collect()
        })
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let bin = if env.bin == self.default_bin(env.home) { "pi".to_string() } else { q(env.bin) };
        match t {
            Terminal::Resume(s) if self.valid_session(s) => Some(format!("cd {} && {bin} --session {s}", q(env.vault))),
            Terminal::New(_) => Some(format!("cd {} && {bin}", q(env.vault))),
            _ => None,
        }
    }

    fn limits(&self, _env: &Env) -> usage::Limits { usage::Limits::Off("none".into()) }
    fn usage(&self, env: &Env, since: i64) -> Vec<usage::Record> { with_logs(env, since, |l| l.tail.records()) }
}

impl Pi {
    fn bin(&self) -> String {
        let b = BIN.lock().unwrap().clone();
        if b.is_empty() { self.default_bin(&home()) } else { b }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn env<'a>(p: &'a Path, opts: &'a Value) -> Env<'a> { Env { home: "/Users/me", vault: "/Users/me/my vault", path: "/usr/bin", bin: "/opt/pi", pending: p, opts } }
    fn args(c: &Command) -> Vec<String> { c.get_args().map(|a| a.to_string_lossy().into_owned()).collect() }

    #[test]
    fn spawn_args_and_terminal() {
        let p = PathBuf::from("/tmp/pending");
        let sid = "0198aaaa-bbbb-cccc-dddd-000000000010";
        let l = Launch { key: "c:1", name: "x", model: "openai-codex/gpt-5.5", effort: "high", resume: Some(sid), fork: None, turn: None };
        let cmd = PROVIDER.command(&env(&p, &Value::Null), &l).unwrap();
        assert_eq!(cmd.get_program(), "/opt/pi");
        assert_eq!(args(&cmd), ["--mode", "rpc", "--append-system-prompt", agent_core::envelope::HINT, "--session-id", sid, "--model", "openai-codex/gpt-5.5", "--thinking", "high"]);
        // a fork, a model without a provider, an effort pi does not know, a bad session id
        let cmd = PROVIDER.command(&env(&p, &Value::Null), &Launch { model: "sonnet", effort: "ultra", resume: None, fork: Some(sid), ..l }).unwrap();
        assert_eq!(args(&cmd), ["--mode", "rpc", "--append-system-prompt", agent_core::envelope::HINT, "--fork", sid]);
        let cmd = PROVIDER.command(&env(&p, &Value::Null), &Launch { model: "--x/y", effort: "", resume: Some("x; rm"), ..l }).unwrap();
        assert_eq!(args(&cmd), ["--mode", "rpc", "--append-system-prompt", agent_core::envelope::HINT]);
        let e = env(&p, &Value::Null);
        assert_eq!(PROVIDER.terminal(&e, Terminal::Resume(sid)).unwrap(), format!("cd '/Users/me/my vault' && '/opt/pi' --session {sid}"));
        assert_eq!(PROVIDER.terminal(&e, Terminal::New("x")).unwrap(), "cd '/Users/me/my vault' && '/opt/pi'");
        assert!(PROVIDER.terminal(&e, Terminal::Resume("x; rm")).is_none() && PROVIDER.terminal(&e, Terminal::Attach("a")).is_none());
        assert!(PROVIDER.valid_session(sid) && !PROVIDER.valid_session("ses_1"));
        assert_eq!(PROVIDER.efforts().len(), 7);
    }

    #[test]
    fn not_installed() {
        let p = PathBuf::from("/tmp/pending");
        let e = Env { bin: "/nonexistent/pi", ..env(&p, &Value::Null) };
        let d = PROVIDER.detect(&e);
        assert_eq!((d.installed, d.version, d.logged_in, d.note.as_deref()), (false, None, None, Some("npm install -g @earendil-works/pi-coding-agent")));
        assert!(PROVIDER.models().is_empty());
        assert_eq!(PROVIDER.limits(&e), usage::Limits::Off("none".into()));
        assert!(PROVIDER.history(&e, "0198aaaa-bbbb-cccc-dddd-00000000ffff", 0).0.is_empty());
    }
}
