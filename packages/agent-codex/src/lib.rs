//! OpenAI Codex as an agent provider. Every conversation is one `codex app-server` (JSON-RPC over stdio) behind
//! the bridge (bridge.rs, run as `relay --codex-bridge`), in the vault, on the ChatGPT login (OPENAI_API_KEY removed unless the settings say otherwise).
//! Command and patch approvals come in as server requests and go to the permission cards ([`Event::Permission`]),
//! the answer back through [`AgentProvider::respond`]. History, the session list, token usage and rate limits are
//! read from `$CODEX_HOME` (default `~/.codex`): the rollouts under sessions/ and the thread index state_5.sqlite.

use agent_core::{usage, AgentProvider, Caps, Choice, Detect, Env, Event, Launch, Parser, Terminal, Turn};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

pub mod app_server;
pub mod bridge;
pub mod rollout;
pub mod state;

pub struct Codex;
pub static PROVIDER: Codex = Codex;

/// The settings' choices (Settings › Agents), the first one the default: what codex may do without asking, when it
/// asks, and whether an OPENAI_API_KEY in the environment is used instead of the ChatGPT login.
pub const SANDBOX: [&str; 3] = ["workspace-write", "read-only", "danger-full-access"];
pub const APPROVAL: [&str; 3] = ["on-request", "untrusted", "never"];
pub const AUTH: [&str; 2] = ["chatgpt", "api-key"];
fn pick<'a>(env: &'a Env, key: &str, from: &[&'a str]) -> &'a str { from.iter().copied().find(|c| *c == env.opt(key)).unwrap_or(from[0]) }

pub fn codex_home(home: &str) -> PathBuf { std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(format!("{home}/.codex"))) }
/// Relay's own /compact and /review, then one `skill:<name>` per enabled skill (never shadowing a built-in).
fn codex_commands(skills: &Value) -> Value {
    let mut commands = vec![json!({"name": "compact", "description": "Compact the conversation context"}),
        json!({"name": "review", "description": "Review uncommitted changes"})];
    let mut names: Vec<String> = vec!["compact".into(), "review".into()];
    for skill in skills["data"].as_array().into_iter().flatten().flat_map(|g| g["skills"].as_array().into_iter().flatten()) {
        let name = format!("skill:{}", skill["name"].as_str().unwrap_or_default());
        if skill["enabled"].as_bool().unwrap_or(true) && !names.contains(&name) {
            commands.push(json!({"name": name, "description": skill["description"].as_str().unwrap_or(""), "argumentHint": "<instructions>"}));
            names.push(name);
        }
    }
    Value::Array(commands)
}
fn home() -> String { std::env::var("HOME").unwrap_or_default() }

static LOGS: Mutex<Option<rollout::Logs>> = Mutex::new(None);
fn with_logs<T>(env: &Env, since: i64, f: impl FnOnce(&rollout::Logs) -> T) -> T {
    let mut l = LOGS.lock().unwrap();
    let logs = l.get_or_insert_with(Default::default);
    logs.refresh(&codex_home(env.home).join("sessions"), env.vault, since);
    f(logs)
}

/// The models the CLI offers (its own cache of the model list), best first, and the efforts any of them takes.
fn cached_models(dir: &Path) -> (Vec<Choice>, Vec<Choice>) {
    let v: Value = std::fs::read_to_string(dir.join("models_cache.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut ms: Vec<&Value> = v["models"].as_array().into_iter().flatten().filter(|m| m["visibility"] == "list" && m["slug"].is_string()).collect();
    ms.sort_by_key(|m| m["priority"].as_i64().unwrap_or(i64::MAX));
    let models = ms.iter().map(|m| { let s = m["slug"].as_str().unwrap(); Choice::new(s, m["display_name"].as_str().unwrap_or(s)) }).collect();
    let has = |e: &str| ms.iter().any(|m| m["supported_reasoning_levels"].as_array().into_iter().flatten().any(|l| l["effort"] == e));
    let all = [("minimal", "Minimal"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max"), ("ultra", "Ultra")];
    let mut efforts: Vec<Choice> = all.iter().filter(|(e, _)| has(e)).map(|(i, l)| Choice::new(i, l)).collect();
    if efforts.is_empty() { efforts = all[1..4].iter().map(|(i, l)| Choice::new(i, l)).collect(); }
    (models, efforts)
}

impl AgentProvider for Codex {
    fn id(&self) -> &'static str { "codex" }
    fn name(&self) -> &'static str { "Codex" }
    fn caps(&self) -> Caps {
        Caps { persistent: true, images: true, thinking: true, permissions: true, questions: false, subagents: false, fork: false,
            terminal: true, background: true, effort: true, limits: true, title: false, write: true, accounts: false, ..Caps::default() }
    }
    fn npm_package(&self) -> Option<&'static str> { Some("@openai/codex") }
    fn default_bin(&self, home: &str) -> String {
        let c = ["/opt/homebrew/bin/codex".to_string(), "/usr/local/bin/codex".into(), format!("{home}/.local/bin/codex"), format!("{home}/.npm-global/bin/codex")];
        c.iter().find(|p| Path::new(p).is_file()).unwrap_or(&c[0]).clone()
    }
    fn detect(&self, env: &Env) -> Detect {
        let installed = Path::new(env.bin).is_file();
        let version = if installed { agent_core::version(env.bin, env.path) } else { None };
        // only whether the login file is there: its contents are credentials
        let logged_in = codex_home(env.home).join("auth.json").is_file() || (pick(env, "auth", &AUTH) == "api-key" && std::env::var_os("OPENAI_API_KEY").is_some());
        let note = if !installed { Some("npm install -g @openai/codex".into()) } else if !logged_in { Some("codex login".into()) } else { None };
        Detect { installed, bin: env.bin.into(), version, logged_in: Some(logged_in), note }
    }
    fn models(&self) -> Vec<Choice> { cached_models(&codex_home(&home())).0 }
    fn commands(&self, env: &Env) -> Value {
        agent_core::discover_commands(env, |p| {
            let mut cmd = Command::new(env.bin);
            cmd.arg("app-server").current_dir(env.vault);
            let c = p.start(cmd)?;
            p.rpc(c, 0, "initialize", json!({"clientInfo": {"name": "relay", "version": "0.1.0"}}))?;
            p.send(c, json!({"method": "initialized"}))?;
            let skills = p.rpc(c, 1, "skills/list", json!({"cwds": [env.vault], "forceReload": true}))?;
            Ok(codex_commands(&skills))
        })
    }
    fn efforts(&self) -> Vec<Choice> { cached_models(&codex_home(&home())).1 }

    fn command(&self, env: &Env, l: &Launch) -> Result<Command, String> {
        let cfg = json!({"cwd": env.vault, "model": l.model, "effort": l.effort, "resume": l.resume,
            "sandbox": pick(env, "sandbox", &SANDBOX), "approval": pick(env, "approval", &APPROVAL), "instructions": agent_core::envelope::HINT});
        let mut cmd = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        cmd.arg("--codex-bridge").arg(env.bin).arg(cfg.to_string());
        if pick(env, "auth", &AUTH) == "chatgpt" { cmd.env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY"); }
        Ok(cmd)
    }
    fn text_only_commands(&self) -> Vec<&'static str> { vec!["compact", "review"] }
    fn input(&self, turn: &Turn) -> Option<String> { Some(app_server::turn_start(turn).to_string()) }
    fn parser(&self) -> Parser {
        let mut st = app_server::State::default();
        Box::new(move |l| st.parse(l))
    }
    fn respond(&self, req: &agent_core::pending::Request, decision: &Value) -> Option<String> { app_server::respond(req, decision) }

    fn history(&self, env: &Env, sid: &str, from: u64) -> (Vec<Event>, u64) {
        if !agent_core::safe_id(sid) { return (vec![], 0); }
        let dir = codex_home(env.home);
        let path = state::query(&dir.join("state_5.sqlite"), &state::rollout_sql(sid))
            .and_then(|r| r.first().and_then(|r| r["rollout_path"].as_str()).map(PathBuf::from))
            .filter(|p| p.is_file()).or_else(|| rollout::find(&dir.join("sessions"), sid));
        path.map_or((vec![], 0), |p| rollout::history(&p, from))
    }
    /// The vault's Codex threads, from the thread index, else from the rollouts read for the usage.
    fn sessions(&self, env: &Env) -> Vec<Value> {
        if env.vault.is_empty() { return vec![]; }
        // the index keeps the folder's real path
        let real = std::fs::canonicalize(env.vault).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        if let Some(rows) = state::query(&codex_home(env.home).join("state_5.sqlite"), &state::threads_sql(env.vault, &real)) { return state::sessions_of(&rows); }
        with_logs(env, usage::now_ms() - usage::KEEP_MS, |l| {
            let mut m: Vec<&rollout::Meta> = l.meta.values().filter(|m| rollout::in_vault(&m.cwd, env.vault) && agent_core::safe_id(&m.session)).collect();
            m.sort_by_key(|m| -m.updated);
            m.iter().map(|m| state::session(&m.session, &m.title, m.updated / 1000)).collect()
        })
    }
    fn terminal(&self, env: &Env, t: Terminal) -> Option<String> {
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let bin = if env.bin == self.default_bin(env.home) { "codex".to_string() } else { q(env.bin) };
        match t {
            Terminal::Resume(s) if agent_core::safe_id(s) => Some(format!("cd {} && {bin} resume {s}", q(env.vault))),
            Terminal::New(_) => Some(format!("cd {} && {bin}", q(env.vault))),
            _ => None,
        }
    }

    /// The newest rate limits: pushed by a running app-server, else the last token_count of the rollouts.
    /// `codex exec` on the instruction and the text, isolated like Claude's: no user config, rules, session or tools
    /// (shell, browser, apps and code mode off, read-only sandbox in the temp folder), the answer from `-o`.
    fn write(&self, env: &Env, system: &str, text: &str) -> Result<String, String> {
        use std::io::Write;
        let text: String = text.chars().take(agent_core::WRITE_MAX).collect();
        let out_file = std::env::temp_dir().join(format!("relay-codex-write-{}-{}.txt", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
        let mut cmd = Command::new(env.bin);
        cmd.args(["exec", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-c", "web_search=disabled"]);
        if pick(env, "auth", &AUTH) == "chatgpt" { cmd.env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY"); }
        for f in ["shell_tool", "unified_exec", "apps", "browser_use", "computer_use", "in_app_browser", "code_mode_host", "tool_suggest", "sleep_tool"] { cmd.args(["--disable", f]); }
        let mut child = cmd.arg("-o").arg(&out_file).arg("-").current_dir(std::env::temp_dir()).env("PATH", env.path)
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped())
            .spawn().map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("no stdin")?.write_all(format!("{system}\n\n{text}").as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let t = std::fs::read_to_string(&out_file).unwrap_or_default().trim().to_string();
        let _ = std::fs::remove_file(&out_file);
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("codex exec failed").to_string()) }
    }
    /// `codex exec` in the checkout like `write`, but with its shell in the read-only sandbox, so it can read the code
    /// and run git around the diff; still no user config, rules, session, browser or apps.
    fn review(&self, env: &Env, dir: &str, system: &str, text: &str) -> Result<String, String> {
        use std::io::Write;
        let out_file = std::env::temp_dir().join(format!("relay-codex-review-{}-{}.txt", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
        let mut cmd = Command::new(env.bin);
        cmd.args(["exec", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-c", "web_search=disabled"]);
        if pick(env, "auth", &AUTH) == "chatgpt" { cmd.env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY"); }
        // code mode stays on: it is how codex reads files (with it off, it tries and fails, and reviews the diff blind)
        for f in ["apps", "browser_use", "computer_use", "in_app_browser", "tool_suggest", "sleep_tool"] { cmd.args(["--disable", f]); }
        let mut child = cmd.arg("-o").arg(&out_file).arg("-").current_dir(dir).env("PATH", env.path)
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped())
            .spawn().map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("no stdin")?.write_all(format!("{system}\n\n{text}").as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let t = std::fs::read_to_string(&out_file).unwrap_or_default().trim().to_string();
        let _ = std::fs::remove_file(&out_file);
        if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("codex exec failed").to_string()) }
    }
    fn limits(&self, env: &Env) -> usage::Limits {
        let now = usage::now_ms();
        let from_logs = with_logs(env, now - usage::KEEP_MS, |l| l.limits.clone());
        let live = app_server::LIVE_LIMITS.lock().unwrap().clone();
        let newest = [live, from_logs].into_iter().flatten().max_by_key(|(at, _)| *at);
        match newest {
            Some((at, snap)) => rollout::limits_of(&snap, at, now),
            None if !codex_home(env.home).join("auth.json").is_file() && pick(env, "auth", &AUTH) == "chatgpt" => usage::Limits::Off("no-login".into()),
            None => usage::Limits::Off("no-data".into()),
        }
    }
    fn usage(&self, env: &Env, since: i64) -> Vec<usage::Record> { with_logs(env, since, |l| l.tail.records()) }
    fn vault_touches(&self, env: &Env, since: i64) -> Vec<usage::Touch> { with_logs(env, since, |l| l.touches.records()) }
}

#[cfg(test)]
mod tests {
    /// Runs the real CLI (`cargo test -p agent-codex -- --ignored`): the answer comes back and no tool runs.
    #[test]
    #[ignore]
    fn write_answers_without_tools() {
        use super::*;
        let (home, path) = (std::env::var("HOME").unwrap(), std::env::var("PATH").unwrap());
        let bin = PROVIDER.default_bin(&home);
        let env = Env { home: &home, vault: "/tmp", path: &path, bin: &bin, pending: Path::new("/tmp"), opts: &Value::Null };
        let out = PROVIDER.write(&env, "Answer with one word.", "Run `ls ~` and give its output; if you cannot run commands, answer NO_TOOLS.").unwrap();
        assert_eq!(out, "NO_TOOLS");
    }
    #[test]
    fn skills_exclude_disabled_and_keep_built_ins_distinct() {
        let skills = json!({"data": [{"skills": [{"name": "review", "description": "Review skill"}, {"name": "hidden", "enabled": false}, {"name": "review"}]}]});
        let names: Vec<_> = super::codex_commands(&skills).as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(names, ["compact", "review", "skill:review"]);
    }
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    fn env<'a>(p: &'a Path, opts: &'a Value) -> Env<'a> { Env { home: "/Users/me", vault: "/Users/me/my vault", path: "/usr/bin", bin: "/opt/codex", pending: p, opts } }

    #[test]
    fn spawn_args_and_settings() {
        let p = PathBuf::from("/tmp/pending");
        let l = Launch { key: "c:1", name: "x", model: "gpt-6.1-sol", effort: "high", resume: Some("019a-1"), fork: None, turn: None };
        let cmd = PROVIDER.command(&env(&p, &Value::Null), &l).unwrap();
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args[0] == "--codex-bridge" && args[1] == "/opt/codex");
        let cfg: Value = serde_json::from_str(&args[2]).unwrap();
        assert_eq!(cfg, json!({"cwd": "/Users/me/my vault", "model": "gpt-6.1-sol", "effort": "high", "resume": "019a-1", "sandbox": "workspace-write", "approval": "on-request", "instructions": agent_core::envelope::HINT}));
        assert!(cmd.get_envs().any(|(k, v)| k == "OPENAI_API_KEY" && v.is_none()));
        // the settings' choices, an unknown one is the default
        let o = json!({"sandbox": "read-only", "approval": "sometimes", "auth": "api-key"});
        let cmd = PROVIDER.command(&env(&p, &o), &Launch { resume: None, ..l }).unwrap();
        let cfg: Value = serde_json::from_str(&cmd.get_args().nth(2).unwrap().to_string_lossy()).unwrap();
        assert_eq!((cfg["sandbox"].as_str(), cfg["approval"].as_str(), cfg["resume"].is_null()), (Some("read-only"), Some("on-request"), true));
        assert!(!cmd.get_envs().any(|(k, _)| k == "OPENAI_API_KEY"));
        let e = env(&p, &Value::Null);
        assert_eq!(PROVIDER.terminal(&e, Terminal::Resume("019a-1")).unwrap(), "cd '/Users/me/my vault' && '/opt/codex' resume 019a-1");
        assert!(PROVIDER.terminal(&e, Terminal::Resume("x; rm")).is_none() && PROVIDER.terminal(&e, Terminal::Attach("a")).is_none());
    }

    #[test]
    fn models_from_the_cli_cache() {
        let d = std::env::temp_dir().join(format!("vault-codex-models-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("models_cache.json"), r#"{"models":[{"slug":"b","display_name":"B","visibility":"list","priority":2,"supported_reasoning_levels":[{"effort":"low"},{"effort":"xhigh"}]},
            {"slug":"hidden","visibility":"hide","priority":0,"supported_reasoning_levels":[{"effort":"ultra"}]},{"slug":"a","display_name":"A","visibility":"list","priority":1,"supported_reasoning_levels":[{"effort":"medium"}]}]}"#).unwrap();
        let (m, e) = cached_models(&d);
        assert_eq!(m, [Choice::new("a", "A"), Choice::new("b", "B")]);
        assert_eq!(e.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["low", "medium", "xhigh"]);
        let (m, e) = cached_models(Path::new("/nonexistent"));
        assert!(m.is_empty() && e.len() == 3);
        std::fs::remove_dir_all(d).ok();
    }

    /// The bridge against a stand-in for `codex app-server` (tests/fixtures/fake-app-server.py): the handshake, the
    /// thread id filled in, an approval answered, an unknown server request declined.
    #[test]
    fn bridge_speaks_to_an_app_server() {
        let fake = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fake-app-server.py");
        if !Path::new("/usr/bin/python3").exists() { return; } // the stand-in is python: nothing to test
        let cfg = json!({"cwd": "/v", "model": "m1", "effort": "high", "resume": "019a-gone"});
        let (stdin_r, mut stdin) = std::io::pipe().unwrap();
        let (out_r, out_w) = std::io::pipe().unwrap();
        let bridge = std::thread::spawn(move || bridge::run(fake, &cfg, BufReader::new(stdin_r), out_w, |_| {}));
        let mut lines = BufReader::new(out_r).lines().map_while(Result::ok);
        let mut st = app_server::State::default();
        let mut next = || { let l = lines.next().expect("bridge ended"); (serde_json::from_str::<Value>(&l).unwrap(), st.parse(&l)) };
        // the resume fails, so a new thread; its response is the session
        let (_, ev) = next();
        assert_eq!(ev, [Event::Session { id: "019a0000-ffff-7000-8000-00000000000f".into() }, Event::Resolved { model: "m1".into(), effort: None }]);
        writeln!(stdin, "{}", PROVIDER.input(&Turn { text: "hoi".into(), images: vec![] }).unwrap()).unwrap();
        // the fake echoes the turn/start it got, then asks for an approval
        let (echo, _) = next();
        assert_eq!(echo["method"], "echo");
        assert_eq!(echo["params"]["threadId"], "019a0000-ffff-7000-8000-00000000000f");
        assert_eq!((echo["params"]["model"].as_str(), echo["params"]["effort"].as_str()), (Some("m1"), Some("high")));
        assert_eq!(echo["params"]["input"][0]["text"], "hoi");
        assert_eq!(echo["seen"], json!(["initialize", "initialized", "thread/resume", "thread/start", "skills/list", "turn/start"]));
        let (_, ev) = next();
        let Some(Event::Permission { request }) = ev.first() else { panic!("{ev:?}") };
        writeln!(stdin, "{}", PROVIDER.respond(request, &json!({"behavior": "allow", "updatedInput": {}})).unwrap()).unwrap();
        let got = loop { let (m, _) = next(); if m["method"] == "got" { break m; } }; // the request without a card passes by
        assert_eq!(got["params"], json!([{"id": 5, "result": {"decision": "accept"}}, {"id": 6, "error": {"code": -32601, "message": "not supported by the vault app"}}]));
        drop(stdin); // the app closed it: codex is stopped, the bridge ends
        assert!(lines.next().is_none());
        bridge.join().unwrap();
    }
}
