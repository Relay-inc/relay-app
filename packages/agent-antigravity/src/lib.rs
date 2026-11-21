//! Google's Antigravity CLI (`agy`) as an agent provider. Every conversation is one `agy acp` (the Agent Client
//! Protocol, JSON-RPC over stdio) behind the bridge (bridge.rs, run as `relay --antigravity-bridge`), in the vault, on
//! the login `agy` has. Commands and file changes come in as permission requests and go to the permission cards
//! ([`Event::Permission`]), the answer back through [`AgentProvider::respond`]. History and token usage are read from
//! the log the bridge keeps per conversation, next to the app's pending folder. Antigravity reports its plan, not how
//! much of it is left.

use agent_core::usage::{self, Record, Tail};
use agent_core::{AgentProvider, Caps, Choice, Detect, Env, Event, LastBin, Launch, Memo, Parser, Terminal, Turn};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

pub mod acp;
pub mod bridge;

pub struct Antigravity;
pub static PROVIDER: Antigravity = Antigravity;

/// Where the bridge keeps a conversation's log, `<session id>.jsonl`: beside the app's pending folder.
pub fn log_dir(env: &Env) -> PathBuf { env.pending.parent().unwrap_or(env.pending).join("antigravity") }

/// `agy models`: one `id<tab>name` per line, after a line that says it is fetching.
fn parse_models(out: &str) -> Vec<Choice> {
    out.lines().filter_map(|l| l.split_once('\t')).map(|(id, name)| (id.trim(), name.trim()))
        .filter(|(id, _)| agent_core::safe_model(id) && !id.is_empty()).map(|(id, name)| Choice::new(id, if name.is_empty() { id } else { name })).collect()
}
/// The program the last `detect` saw (the settings' override), for the model list, which has no env.
static BIN: LastBin = LastBin::new();
/// `agy models`, kept for a few minutes per program: it asks the account.
static MODELS: Memo<Vec<Choice>> = Memo::new();
fn models_of(bin: &str) -> Vec<Choice> {
    if !Path::new(bin).is_file() { return vec![]; }
    MODELS.get(bin, Duration::from_secs(300), || {
        let path = std::env::var("PATH").unwrap_or_default();
        agent_core::run_within(bin, &path, &["models"], Duration::from_secs(15)).map(|s| parse_models(&s)).unwrap_or_default()
    })
}

/// A session log from byte offset `from`, up to its last whole line, and where to continue.
pub fn history(path: &Path, from: u64) -> (Vec<Event>, u64) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return (vec![], 0) };
    if f.seek(SeekFrom::Start(from)).is_err() { return (vec![], from); }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    let mut st = acp::State::history();
    let mut out: Vec<Event> = String::from_utf8_lossy(&buf[..end]).lines().flat_map(|l| st.parse(l)).collect();
    out.extend(st.finish());
    // the session line is how a live process learns its id, not a message
    out.retain(|e| !matches!(e, Event::Session { .. } | Event::Resolved { .. }));
    (out, from + end as u64)
}

/// Whole new lines of one session log as token records: one per turn's end, as the bridge stamped it.
fn records(path: &Path, text: &str, vault: &str) -> Vec<Record> {
    let session = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    text.lines().filter(|l| l.contains("\"stopReason\"")).filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter_map(|m| {
        let u = &m["result"]["usage"];
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let r = Record { at: m["at"].as_str().and_then(usage::parse_ts)?, model: m["model"].as_str().filter(|m| !m.is_empty()).unwrap_or("antigravity").into(),
            session: session.clone(), vault: usage::in_vault(m["cwd"].as_str().unwrap_or(""), vault),
            input: n("inputTokens"), output: n("outputTokens"), cache_read: n("cachedReadTokens"), cache_write: n("cachedWriteTokens"), cost: None };
        (r.total() > 0).then_some(r)
    }).collect()
}
#[derive(Default)]
struct Logs { vault: String, tail: Tail<Record> }
static LOGS: Mutex<Option<Logs>> = Mutex::new(None);

impl AgentProvider for Antigravity {
    fn id(&self) -> &'static str { "antigravity" }
    fn name(&self) -> &'static str { "Antigravity" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: true, permissions: true, terminal: true, limits: true, ..Caps::default() }
    }
    fn default_bin(&self, home: &str) -> String {
        let c = [format!("{home}/.local/bin/agy"), "/opt/homebrew/bin/agy".into(), "/usr/local/bin/agy".into()];
        c.iter().find(|p| Path::new(p).is_file()).unwrap_or(&c[0]).clone()
    }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        BIN.set(env.bin);
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        // the login is in the system's keychain, which is agy's to read: a model list is the sign that it has one
        let note = if !installed { Some("curl -fsSL https://antigravity.google/cli/install.sh | bash".into()) }
            else if models_of(env.bin).is_empty() { Some("agy acp --login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: None, note }
    }
    fn self_update(&self) -> &'static [&'static str] { &["update"] }
    fn models(&self) -> Vec<Choice> { models_of(&BIN.get_or(|| self.default_bin(&agent_core::home()))) }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        let model = if agent_core::safe_model(l.model) { l.model } else { "" };
        // like Claude Code in Relay, a conversation starts in the agent's auto mode unless the settings say otherwise:
        // its own default asks before every command, also an `ls`
        let mode = match env.opt("mode") { "default" => "", "accept-edits" => "accept-edits", _ => "auto" };
        let cfg = json!({"cwd": env.vault, "model": model, "mode": mode, "resume": l.resume.filter(|s| self.valid_session(s)),
            "instructions": agent_core::envelope::HINT, "log": log_dir(env)});
        let mut cmd = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        cmd.arg("--antigravity-bridge").arg(env.bin).arg(cfg.to_string());
        // on the login agy has: a key in the environment would bill that key instead
        cmd.env_remove("GEMINI_API_KEY").env_remove("GOOGLE_API_KEY");
        Ok(cmd)
    }
    fn input(&self, turn: &Turn) -> Option<String> { Some(acp::prompt(turn).to_string()) }
    fn parser(&self) -> Parser {
        let mut st = acp::State::default();
        Box::new(move |l| st.parse(l))
    }
    fn respond(&self, req: &agent_core::pending::Request, decision: &Value) -> Option<String> { acp::respond(req, decision) }

    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !self.valid_session(sid) { return (vec![], 0); }
        history(&log_dir(env).join(format!("{sid}.jsonl")), from)
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let (q, bin) = (agent_core::quote_sh, agent_core::command_for(env, &self.default_bin(env.home), "agy"));
        match t {
            Terminal::Resume(s) if self.valid_session(s) => Some(format!("cd {} && {bin} --conversation {s}", q(env.vault))),
            Terminal::New(_) => Some(format!("cd {} && {bin}", q(env.vault))),
            _ => None,
        }
    }

    /// The plan a session was opened on. Antigravity has no way to ask how much of it is left, so there are no windows.
    fn limits(&self, _env: &Env) -> usage::Limits {
        match acp::TIER.lock().unwrap().clone() {
            Some(plan) => usage::Limits::On { plan: Some(plan), windows: vec![] },
            None => usage::Limits::Off("unavailable".into()),
        }
    }
    fn usage(&self, env: &Env, since: i64) -> Vec<Record> {
        let mut l = LOGS.lock().unwrap();
        if l.as_ref().is_none_or(|l| l.vault != env.vault) { *l = Some(Logs { vault: env.vault.into(), ..Default::default() }); }
        let Logs { vault, tail } = l.as_mut().unwrap();
        tail.refresh(&log_dir(env), "jsonl", since, |r| r.at, |p, text, _| records(p, text, vault));
        tail.records()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    fn env<'a>(p: &'a Path, opts: &'a Value) -> Env<'a> { Env { home: "/Users/me", vault: "/Users/me/my vault", path: "/usr/bin", bin: "/opt/agy", pending: p, grants: &agent_core::NO_GRANTS, opts } }

    #[test]
    fn spawn_args_settings_and_terminal() {
        let p = PathBuf::from("/data/pending");
        let l = Launch { key: "c:1", name: "x", model: "gemini-3.8-flash-low", effort: "", resume: Some("7a64a414-9c82"), fork: None, turn: None };
        let cmd = PROVIDER.command(&env(&p, &Value::Null), &l).unwrap();
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[0] == "--antigravity-bridge" && args[1] == "/opt/agy");
        let cfg: Value = serde_json::from_str(&args[2]).unwrap();
        assert_eq!(cfg, json!({"cwd": "/Users/me/my vault", "model": "gemini-3.8-flash-low", "mode": "auto", "resume": "7a64a414-9c82",
            "instructions": agent_core::envelope::HINT, "log": "/data/antigravity"}));
        assert!(cmd.get_envs().any(|(k, v)| k == "GEMINI_API_KEY" && v.is_none()));
        // the settings' mode: "default" is the agent's own (it asks for everything), an unknown one is auto; a model or
        // session that is no id is left out
        let arg = |o: &Value, l: &Launch| -> Value { serde_json::from_str(&PROVIDER.command(&env(&p, o), l).unwrap().get_args().nth(2).unwrap().to_string_lossy()).unwrap() };
        assert_eq!(arg(&json!({"mode": "default"}), &l)["mode"], "");
        assert_eq!(arg(&json!({"mode": "accept-edits"}), &l)["mode"], "accept-edits");
        let cfg = arg(&json!({"mode": "yolo"}), &Launch { model: "--x", resume: Some("x; rm"), ..l });
        assert_eq!((cfg["mode"].as_str(), cfg["model"].as_str(), cfg["resume"].is_null()), (Some("auto"), Some(""), true));
        let e = env(&p, &Value::Null);
        assert_eq!(PROVIDER.terminal(&e, Terminal::Resume("7a64a414-9c82")).unwrap(), "cd '/Users/me/my vault' && '/opt/agy' --conversation 7a64a414-9c82");
        assert!(PROVIDER.terminal(&e, Terminal::Resume("x; rm")).is_none() && PROVIDER.terminal(&e, Terminal::Attach("a")).is_none());
    }

    #[test]
    fn models_as_agy_lists_them() {
        let m = parse_models(include_str!("../tests/fixtures/models.txt"));
        assert_eq!(m[0], Choice::new("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"));
        assert_eq!(m.len(), 6);
        assert!(parse_models("Fetching available models...\n").is_empty() && parse_models("--flag\tx\n").is_empty());
    }

    /// Runs the real CLI on its login (`cargo test -p agent-antigravity -- --ignored`): a session in a temp folder, one
    /// answer without tools, then the same session resumed in a new process, and the log read back.
    #[test]
    #[ignore]
    fn live_a_turn_and_a_resume() {
        let (home, path) = (std::env::var("HOME").unwrap(), std::env::var("PATH").unwrap());
        let bin = PROVIDER.default_bin(&home);
        let dir = std::env::temp_dir().join(format!("relay-antigravity-live-{}", std::process::id()));
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let turn = |resume: Option<&str>, text: &str| -> (String, String) {
            let cfg = json!({"cwd": ws, "model": "", "mode": "", "resume": resume, "instructions": "The code word is walnut.", "log": dir.join("antigravity")});
            let (stdin_r, mut stdin) = std::io::pipe().unwrap();
            let (out_r, out_w) = std::io::pipe().unwrap();
            let b = bin.clone();
            let bridge = std::thread::spawn(move || bridge::run(&b, &cfg, BufReader::new(stdin_r), out_w, |_| {}));
            writeln!(stdin, "{}", PROVIDER.input(&Turn { text: text.into(), images: vec![] }).unwrap()).unwrap();
            let mut st = acp::State::default();
            let (mut sid, mut said) = (String::new(), String::new());
            for l in BufReader::new(out_r).lines().map_while(Result::ok) {
                let ev = st.parse(&l);
                for e in &ev {
                    match e { Event::Session { id } => sid = id.clone(), Event::Text { text, .. } => said.push_str(text), Event::Error { text } => panic!("{text}"), _ => {} }
                }
                if ev.iter().any(|e| matches!(e, Event::TurnEnd { .. })) { break; }
            }
            drop(stdin);
            bridge.join().unwrap();
            (sid, said)
        };
        let (sid, said) = turn(None, "What is the code word? Answer with that one word, use no tools.");
        assert!(PROVIDER.valid_session(&sid) && said.to_lowercase().contains("walnut"), "{sid} {said}");
        let (again, said) = turn(Some(&sid), "Say the code word once more, one word, no tools.");
        assert_eq!(again, sid);
        assert!(said.to_lowercase().contains("walnut"), "{said}");
        let p = dir.join("pending");
        let e = Env { home: &home, vault: ws.to_str().unwrap(), path: &path, bin: &bin, pending: &p, grants: &agent_core::NO_GRANTS, opts: &Value::Null };
        let users = PROVIDER.history(&e, &sid, 0).0.iter().filter(|e| matches!(e, Event::User { .. })).count();
        assert_eq!((users, PROVIDER.usage(&e, 0).len()), (2, 2));
        std::fs::remove_dir_all(dir).ok();
    }

    /// The bridge against a stand-in for `agy acp` (tests/fixtures/fake-acp.py): the handshake, the session id filled in,
    /// a permission answered, another request declined, and the log that is the history and the usage afterwards.
    #[test]
    fn bridge_speaks_acp_and_keeps_the_log() {
        let fake = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fake-acp.py");
        if !Path::new("/usr/bin/python3").exists() { return; } // the stand-in is python: nothing to test
        let dir = std::env::temp_dir().join(format!("relay-antigravity-{}", std::process::id()));
        let cfg = json!({"cwd": "/v", "model": "m2", "mode": "auto", "resume": "5e55-90e", "instructions": "hint", "log": dir.join("antigravity")});
        let (stdin_r, mut stdin) = std::io::pipe().unwrap();
        let (out_r, out_w) = std::io::pipe().unwrap();
        let bridge = std::thread::spawn(move || bridge::run(fake, &cfg, BufReader::new(stdin_r), out_w, |_| {}));
        let mut lines = BufReader::new(out_r).lines().map_while(Result::ok);
        let mut st = acp::State::default();
        let mut next = || { let l = lines.next().expect("bridge ended"); (serde_json::from_str::<Value>(&l).unwrap(), st.parse(&l)) };
        // the resume fails, so a new session; its response is the session, on the model that was asked for
        let (_, ev) = next();
        assert_eq!(ev, [Event::Session { id: "5e55-0001".into() }, Event::Resolved { model: "m2".into(), effort: None }]);
        writeln!(stdin, "{}", PROVIDER.input(&Turn { text: "hoi".into(), images: vec![] }).unwrap()).unwrap();
        // the fake echoes the prompt it got, then asks for a permission
        let (echo, _) = next();
        assert_eq!(echo["method"], "echo");
        assert_eq!((echo["params"]["sessionId"].as_str(), echo["params"]["prompt"][0]["text"].as_str()), (Some("5e55-0001"), Some("hoi")));
        assert_eq!(echo["seen"], json!(["initialize", "session/resume", "session/new", "session/set_model", "session/set_mode", "session/prompt"]));
        assert_eq!(echo["opened"], json!({"cwd": "/v", "mcpServers": [], "_meta": {"antigravity": {"systemPrompt": {"append": "hint"}}}}));
        // the command list and the tool call come first, then the request
        let mut before = vec![];
        let request = loop { let (_, ev) = next(); match ev.into_iter().next() { Some(Event::Permission { request }) => break request, e => before.extend(e) } };
        assert!(matches!(&before[..], [Event::Commands { .. }, Event::ToolCall { name, .. }] if name == "Bash"), "{before:?}");
        let request = &request;
        writeln!(stdin, "{}", PROVIDER.respond(request, &json!({"behavior": "allow", "updatedInput": {}})).unwrap()).unwrap();
        let got = loop { let (m, _) = next(); if m["method"] == "got" { break m; } }; // the request without a card passes by
        let mut end = vec![];
        while !matches!(end.last(), Some(Event::TurnEnd { .. })) { end.extend(next().1); }
        assert_eq!(got["params"], json!([{"jsonrpc": "2.0", "id": "p1", "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}},
            {"jsonrpc": "2.0", "id": "x1", "error": {"code": -32601, "message": "not supported by Relay"}}]));
        assert!(matches!(&end[..], [Event::ToolResult { error: false, .. }, Event::Text { delta: false, .. }, Event::Text { delta: true, .. }, Event::TurnEnd { ok: true, usage: Some(u), .. }]
            if u.input == 100 && u.cache_read == 40), "{end:?}");
        drop(stdin); // the app closed it: the agent is stopped, the bridge ends
        assert!(lines.next().is_none());
        bridge.join().unwrap();

        // the log: the user's message with its time, the tool call, the answer; and one usage record for the turn
        let p = dir.join("pending");
        let e = Env { vault: "/v", ..env(&p, &Value::Null) };
        let (ev, at) = PROVIDER.history(&e, "5e55-0001", 0);
        assert!(matches!(&ev[..], [Event::Time { .. }, Event::User { text, .. }, Event::ToolCall { name, .. }, Event::ToolResult { error: false, .. }, Event::Text { text: said, delta: false }, Event::TurnEnd { ok: true, .. }]
            if text == "hoi" && name == "Bash" && said == "Klaar."), "{ev:?}");
        assert_eq!(PROVIDER.history(&e, "5e55-0001", at), (vec![], at));
        assert!(PROVIDER.history(&e, "../x", 0).0.is_empty());
        let recs = PROVIDER.usage(&e, 0);
        assert_eq!(recs.len(), 1);
        assert_eq!((recs[0].model.as_str(), recs[0].session.as_str(), recs[0].vault, recs[0].input, recs[0].output), ("m2", "5e55-0001", true, 100, 20));
        std::fs::remove_dir_all(dir).ok();
    }
}
