//! OpenCode (sst/opencode) as an agent provider. Every conversation is one private `opencode serve` in the vault
//! behind its bridge (bridge.rs, run as `relay --opencode-bridge`): the session's server-sent events become the contract's events, permission requests and
//! questions go to the cards ([`Event::Permission`]) and back through [`AgentProvider::respond`]. Models come from
//! `opencode models` (the configured providers); history, the session list and token usage with cost from its
//! SQLite storage (see [`store`]). OpenCode reports no plan or rate limits.

use agent_core::{usage, AgentProvider, Caps, Choice, Detect, Env, Event, Launch, Parser, Terminal, Turn};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

pub mod bridge;
pub mod events;
pub mod store;


pub struct OpenCode;
pub static PROVIDER: OpenCode = OpenCode;

/// Settings › Agents, the first one the default: the app makes edits, commands and web fetches ask (so they come to
/// the permission cards), or leaves permissions to the user's own OpenCode config.
pub const PERMS: [&str; 2] = ["ask", "config"];
fn pick<'a>(env: &'a Env, key: &str, from: &[&'a str]) -> &'a str { from.iter().copied().find(|c| *c == env.opt(key)).unwrap_or(from[0]) }
fn home() -> String { std::env::var("HOME").unwrap_or_default() }

/// The program the last `detect` saw (the settings' override), for the model list, which has no env.
static BIN: Mutex<String> = Mutex::new(String::new());
/// `opencode models --verbose` takes a second or two: kept for a few minutes per program.
static MODELS: Mutex<Option<(String, Instant, (Vec<Choice>, Vec<Choice>))>> = Mutex::new(None);
fn models_of(bin: &str) -> (Vec<Choice>, Vec<Choice>) {
    if !Path::new(bin).is_file() { return (vec![], vec![]); }
    let mut m = MODELS.lock().unwrap();
    if let Some((b, at, v)) = m.as_ref() { if b == bin && at.elapsed() < Duration::from_secs(300) { return v.clone(); } }
    let path = std::env::var("PATH").unwrap_or_default();
    let v = agent_core::run(bin, &path, &["models", "--verbose"]).map(|s| store::parse_models(&s)).unwrap_or_default();
    *m = Some((bin.into(), Instant::now(), v.clone()));
    v
}

/// The usage query, again only when the database changed (its -wal file is where new messages land first).
static USAGE: Mutex<Option<(String, Vec<usage::Record>)>> = Mutex::new(None);
fn stamp(db: &Path) -> String {
    let m = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis());
    format!("{}:{}", m(db), m(&db.with_extension("db-wal")))
}
fn dirs(vault: &str) -> [String; 2] {
    [vault.to_string(), std::fs::canonicalize(vault).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()]
}

impl AgentProvider for OpenCode {
    fn id(&self) -> &'static str { "opencode" }
    fn name(&self) -> &'static str { "OpenCode" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: true, permissions: true, questions: true, subagents: false, fork: true,
            terminal: true, background: true, effort: true, limits: false, title: false, accounts: false, ..Caps::default() }
    }
    fn npm_package(&self) -> Option<&'static str> { Some("opencode-ai") }
    fn self_update(&self) -> &'static [&'static str] { &["upgrade"] }
    fn default_bin(&self, home: &str) -> String {
        let c = [format!("{home}/.opencode/bin/opencode"), "/opt/homebrew/bin/opencode".into(), "/usr/local/bin/opencode".into(),
            format!("{home}/.local/bin/opencode"), format!("{home}/.npm-global/bin/opencode"), format!("{home}/.bun/bin/opencode")];
        c.iter().find(|p| Path::new(p).is_file()).unwrap_or(&c[0]).clone()
    }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        *BIN.lock().unwrap() = env.bin.into();
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        // providers log in with `opencode auth login` or run on an API key in the environment, and OpenCode Zen's free
        // models need neither: there is no one login to check
        let note = if !installed { Some("npm install -g opencode-ai".into()) }
            else if models_of(env.bin).0.is_empty() { Some("opencode auth login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: None, note }
    }
    fn models(&self) -> Vec<Choice> { models_of(&self.bin()).0 }
    fn commands(&self, env: &Env) -> Value {
        agent_core::discover_commands(env, |p| {
            let (addr, auth) = p.http_server(env.bin, env.vault)?;
            let commands = agent_core::http_get(&addr, &auth, "/command")?;
            Ok(Value::Array(commands.as_array().ok_or("Unexpected commands")?.iter().map(|c| json!({
                "name": c["name"], "description": c["description"].as_str().unwrap_or(""),
                "argumentHint": c["hints"].as_array().map_or(String::new(), |h| h.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))})).collect()))
        })
    }
    fn efforts(&self) -> Vec<Choice> { models_of(&self.bin()).1 }
    fn valid_session(&self, id: &str) -> bool { store::valid(id) }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        fn ok(s: Option<&str>) -> Option<&str> { s.filter(|s| store::valid(s)) }
        // opencode models are provider/model: anything else is its default
        let model = if l.model.contains('/') && agent_core::safe_model(l.model) { l.model } else { "" };
        let cfg = json!({"cwd": env.vault, "model": model, "variant": l.effort, "resume": ok(l.resume), "fork": ok(l.fork),
            "ask": pick(env, "permissions", &PERMS) == "ask", "system": agent_core::envelope::HINT});
        let mut cmd = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        cmd.arg("--opencode-bridge").arg(env.bin).arg(cfg.to_string());
        Ok(cmd)
    }
    fn input(&self, turn: &Turn) -> Option<String> { Some(events::prompt(turn).to_string()) }
    fn parser(&self) -> Parser {
        let mut st = events::State::default();
        Box::new(move |l| st.parse(l))
    }
    fn respond(&self, req: &agent_core::pending::Request, decision: &Value) -> Option<String> { events::respond(req, decision) }

    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !store::valid(sid) { return (vec![], 0); }
        store::query(&store::db(env.home), &store::history_sql(sid)).map_or((vec![], from), |r| store::history(&r, from))
    }
    fn sessions(&self, env: &Env) -> Vec<Value> {
        if env.vault.is_empty() { return vec![]; }
        let d = dirs(env.vault);
        store::query(&store::db(env.home), &store::sessions_sql(&[&d[0], &d[1]])).map(|r| store::sessions_of(&r)).unwrap_or_default()
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let bin = if env.bin == self.default_bin(env.home) { "opencode".to_string() } else { q(env.bin) };
        match t {
            Terminal::Resume(s) if store::valid(s) => Some(format!("cd {} && {bin} --session {s}", q(env.vault))),
            Terminal::New(_) => Some(format!("cd {} && {bin}", q(env.vault))),
            _ => None,
        }
    }

    fn limits(&self, _env: &Env) -> usage::Limits { usage::Limits::Off("none".into()) }
    /// Every assistant message of the week with its tokens and the cost opencode recorded.
    fn usage(&self, env: &Env, since: i64) -> Vec<usage::Record> {
        let db = store::db(env.home);
        let key = format!("{}|{}", stamp(&db), env.vault);
        let mut c = USAGE.lock().unwrap();
        if c.as_ref().is_none_or(|(k, _)| *k != key) {
            let d = dirs(env.vault);
            let rows = store::query(&db, &store::usage_sql(usage::now_ms() - usage::KEEP_MS)).unwrap_or_default();
            *c = Some((key, store::records(&rows, &[&d[0], &d[1]])));
        }
        c.as_ref().map(|(_, r)| r.iter().filter(|r| r.at >= since).cloned().collect()).unwrap_or_default()
    }
}

impl OpenCode {
    fn bin(&self) -> String {
        let b = BIN.lock().unwrap().clone();
        if b.is_empty() { self.default_bin(&home()) } else { b }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;
    fn env<'a>(p: &'a Path, opts: &'a Value) -> Env<'a> { Env { home: "/Users/me", vault: "/Users/me/my vault", path: "/usr/bin", bin: "/opt/opencode", pending: p, opts } }

    #[test]
    fn spawn_args_settings_and_terminal() {
        let p = PathBuf::from("/tmp/pending");
        let sid = "ses_f0c5bbf85ffe6aFOOEAgKslvWD";
        let l = Launch { key: "c:1", name: "x", model: "anthropic/claude-sonnet-5-5", effort: "high", resume: Some(sid), fork: None, turn: None };
        let cmd = PROVIDER.command(&env(&p, &Value::Null), &l).unwrap();
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[0] == "--opencode-bridge" && args[1] == "/opt/opencode");
        let cfg: Value = serde_json::from_str(&args[2]).unwrap();
        assert_eq!(cfg, json!({"cwd": "/Users/me/my vault", "model": "anthropic/claude-sonnet-5-5", "variant": "high", "resume": sid, "fork": null, "ask": true, "system": agent_core::envelope::HINT}));
        // a model without a provider, a bad session id, permissions left to the config
        let o = json!({"permissions": "config"});
        let cmd = PROVIDER.command(&env(&p, &o), &Launch { model: "sonnet", resume: Some("x; rm"), fork: Some(sid), ..l }).unwrap();
        let cfg: Value = serde_json::from_str(&cmd.get_args().nth(2).unwrap().to_string_lossy()).unwrap();
        assert_eq!((cfg["model"].as_str(), cfg["resume"].is_null(), cfg["fork"].as_str(), cfg["ask"].as_bool()), (Some(""), true, Some(sid), Some(false)));
        let e = env(&p, &Value::Null);
        assert_eq!(PROVIDER.terminal(&e, Terminal::Resume(sid)).unwrap(), format!("cd '/Users/me/my vault' && '/opt/opencode' --session {sid}"));
        assert!(PROVIDER.terminal(&e, Terminal::Resume("x; rm")).is_none() && PROVIDER.terminal(&e, Terminal::Attach("a")).is_none());
        assert!(PROVIDER.valid_session(sid) && !PROVIDER.valid_session("019a-1") && !PROVIDER.valid_session("ses_"));
    }

    #[test]
    fn not_installed() {
        let p = PathBuf::from("/tmp/pending");
        let e = Env { bin: "/nonexistent/opencode", ..env(&p, &Value::Null) };
        let d = PROVIDER.detect(&e);
        assert_eq!((d.installed, d.version, d.logged_in, d.note.as_deref()), (false, None, None, Some("npm install -g opencode-ai")));
        assert!(PROVIDER.models().is_empty() && PROVIDER.efforts().is_empty());
        assert_eq!(PROVIDER.limits(&e), usage::Limits::Off("none".into()));
        assert!(PROVIDER.history(&e, "ses_nothere", 0).0.is_empty());
    }

    /// The bridge against a stand-in for `opencode serve` (tests/fixtures/fake-serve.py): the password, the session
    /// made after a failed resume, the prompt with model and variant, the events of other sessions left out, a
    /// permission answered, a failed request reported.
    #[test]
    fn bridge_speaks_to_a_server() {
        let fake = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fake-serve.py");
        let cfg = json!({"cwd": "/tmp", "model": "anthropic/m1", "variant": "high", "resume": "ses_gone", "ask": true});
        if !Path::new("/usr/bin/python3").exists() { return; } // the stand-in is python: nothing to test
        let (stdin_r, mut stdin) = std::io::pipe().unwrap();
        let (out_r, out_w) = std::io::pipe().unwrap();
        let bridge = std::thread::spawn(move || bridge::run(fake, &cfg, BufReader::new(stdin_r), out_w, |_| {}));
        let mut lines = BufReader::new(out_r).lines().map_while(Result::ok);
        let mut st = events::State::default();
        let mut next = || { let l = lines.next().expect("bridge ended"); (serde_json::from_str::<Value>(&l).unwrap(), st.parse(&l)) };
        let (_, ev) = next();
        assert_eq!(ev, [Event::Session { id: "ses_new1".into() }]);
        writeln!(stdin, "{}", PROVIDER.input(&Turn { text: "hoi".into(), images: vec![] }).unwrap()).unwrap();
        // the fake echoes what it got as an event of our session, after one of another session (left out)
        let (echo, _) = next();
        assert_eq!(echo["type"], "echo");
        let got = &echo["properties"];
        assert_eq!(got["seen"], json!(["GET /command", "GET /session/ses_gone", "POST /session", "GET /event", "POST /session/ses_new1/prompt_async"]));
        assert_eq!(got["body"], json!({"parts": [{"type": "text", "text": "hoi"}], "model": {"providerID": "anthropic", "modelID": "m1"}, "variant": "high"}));
        assert_eq!((got["auth"].as_bool(), got["ask"].as_str()), (Some(true), Some("ask")));
        let (_, ev) = next();
        let Some(Event::Permission { request }) = ev.first() else { panic!("{ev:?}") };
        writeln!(stdin, "{}", PROVIDER.respond(request, &json!({"behavior": "allow", "updatedInput": {}})).unwrap()).unwrap();
        let (reply, _) = next();
        assert_eq!(reply["properties"]["seen"], json!("POST /permission/per_1/reply"));
        assert_eq!(reply["properties"]["body"], json!({"reply": "once"}));
        writeln!(stdin, "{}", json!({"type": "permission", "id": "per_bad", "reply": "once"})).unwrap();
        let (_, ev) = next();
        assert!(matches!(&ev[0], Event::Error { text } if text.contains("404")));
        writeln!(stdin, "{}", PROVIDER.input(&Turn { text: "/check src/main.rs".into(), images: vec![] }).unwrap()).unwrap();
        let (command, _) = next();
        assert_eq!(command["properties"]["body"], json!({"command": "check", "arguments": "src/main.rs", "model": "anthropic/m1", "variant": "high"}));
        let (_, ev) = next();
        let Some(Event::Permission { request }) = ev.first() else { panic!("{ev:?}") };
        writeln!(stdin, "{}", PROVIDER.respond(request, &json!({"behavior": "allow"})).unwrap()).unwrap();
        assert_eq!(next().0["type"], "command.allowed");
        drop(stdin); // the app closed it: the server is stopped, the bridge ends
        let extra = lines.next(); assert!(extra.is_none(), "{extra:?}");
        assert_eq!(bridge.join().unwrap(), 0);
    }
}
