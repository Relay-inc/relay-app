//! Pi's session files, `~/.pi/agent/sessions/--<folder>--/<time>_<session id>.jsonl` (version 3): a header
//! `{type:"session", id, timestamp, cwd}`, then one entry per line (`message` with a user, assistant or toolResult
//! message, `model_change`, `thinking_level_change`, `session_info`, …). They give the history of a session, the token
//! records (an assistant message's `usage`, with pi's cost) and the session list. And the model list of
//! `pi --list-models`.

use agent_core::usage::{parse_ts, Record, Tail};
use agent_core::{Choice, Event, Image, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// `$PI_CODING_AGENT_SESSION_DIR`, else `sessions` in `$PI_CODING_AGENT_DIR` (default `~/.pi/agent`).
pub fn sessions_dir(home: &str) -> PathBuf {
    let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    var("PI_CODING_AGENT_SESSION_DIR").unwrap_or_else(|| var("PI_CODING_AGENT_DIR").unwrap_or_else(|| PathBuf::from(format!("{home}/.pi/agent"))).join("sessions"))
}

/// A user message's content: a string, or text and image blocks.
fn user(content: &Value) -> Event {
    let blocks = content.as_array().cloned().unwrap_or_default();
    let text: Vec<&str> = if let Some(s) = content.as_str() { vec![s] } else { blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect() };
    let images = blocks.iter().filter(|b| b["type"] == "image").map(|b| {
        let mt = b["mimeType"].as_str().unwrap_or("");
        IMAGE_TYPES.contains(&mt).then(|| Image { media_type: mt.into(), data: b["data"].as_str().unwrap_or("").into() })
    }).collect();
    Event::User { text: text.join("\n"), images }
}

/// One session line as history: the user's messages, the assistant's text, thinking and tool calls, the tool
/// results and a failed message's error. Every such line starts with its time.
pub fn history_line(e: &Value, out: &mut Vec<Event>) {
    if e["type"] != "message" { return; }
    let m = &e["message"];
    let mut ev = vec![];
    match m["role"].as_str().unwrap_or("") {
        "user" => ev.push(user(&m["content"])),
        "assistant" => {
            for c in m["content"].as_array().into_iter().flatten() {
                match c["type"].as_str().unwrap_or("") {
                    "text" => ev.extend(c["text"].as_str().filter(|t| !t.trim().is_empty()).map(|t| Event::Text { text: t.into(), delta: false })),
                    "thinking" => ev.extend(c["thinking"].as_str().filter(|t| !t.trim().is_empty()).map(|t| Event::Thinking { text: t.into(), delta: false })),
                    "toolCall" => {
                        let (name, input) = crate::events::tool(c["name"].as_str().unwrap_or(""), &c["arguments"]);
                        ev.push(Event::ToolCall { id: c["id"].as_str().unwrap_or("").into(), name, input });
                    }
                    _ => {}
                }
            }
            if m["stopReason"] == "error" { ev.push(Event::Error { text: m["errorMessage"].as_str().unwrap_or("pi error").into() }); }
        }
        "toolResult" => ev.push(Event::ToolResult { id: m["toolCallId"].as_str().unwrap_or("").into(), error: m["isError"] == true }),
        _ => {}
    }
    if ev.is_empty() { return; }
    if let Some(at) = e["timestamp"].as_str() { out.push(Event::Time { at: at.into() }); }
    out.extend(ev);
}

/// A session file from byte offset `from`, up to its last whole line, and where to continue.
pub fn history(path: &Path, from: u64) -> (Vec<Event>, u64) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return (vec![], 0) };
    if f.seek(SeekFrom::Start(from)).is_err() { return (vec![], from); }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    let mut out = vec![];
    for l in String::from_utf8_lossy(&buf[..end]).lines() { if let Ok(v) = serde_json::from_str::<Value>(l) { history_line(&v, &mut out); } }
    (out, from + end as u64)
}

/// The session id at the end of a file name, `<time>_<id>.jsonl`.
pub fn sid_of(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    stem.rsplit_once('_').map_or(stem.clone(), |(_, id)| id.to_string())
}
/// A session's file, by its name.
pub fn find(dir: &Path, sid: &str) -> Option<PathBuf> {
    let want = format!("_{sid}.jsonl");
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() { if let Some(f) = find(&p, sid) { return Some(f); } }
        else if p.to_string_lossy().ends_with(&want) { return Some(p); }
    }
    None
}

/// What a session file said before the lines read now: its session and folder, its name or first message.
#[derive(Clone, Default)]
pub struct Meta { pub session: String, pub cwd: String, pub updated: i64, pub title: String }

/// The session files read so far: the token records and each file's meta.
#[derive(Default)]
pub struct Logs { pub vault: String, pub tail: Tail<Record>, pub meta: HashMap<PathBuf, Meta> }

fn under(cwd: &str, dir: &str) -> bool { !dir.is_empty() && (cwd == dir || cwd.starts_with(&format!("{dir}/"))) }
/// In the vault: pi keeps the folder's real path (/tmp is /private/tmp).
pub fn in_vault(cwd: &str, vault: &str) -> bool {
    under(cwd, vault) || std::fs::canonicalize(vault).is_ok_and(|v| under(cwd, &v.to_string_lossy()))
}

/// Whole new lines of one session file as token records. A forked session starts with a copy of its parent's
/// entries (same ids and times): one already counted is skipped.
pub fn parse_chunk(path: &Path, text: &str, seen: &mut HashSet<String>, meta: &mut Meta, vault: &str) -> Vec<Record> {
    if meta.session.is_empty() { meta.session = sid_of(path); }
    let mut out = vec![];
    for l in text.lines() {
        let Ok(e) = serde_json::from_str::<Value>(l) else { continue };
        meta.updated = meta.updated.max(e["timestamp"].as_str().and_then(parse_ts).unwrap_or(0));
        match e["type"].as_str().unwrap_or("") {
            "session" => {
                if let Some(id) = e["id"].as_str() { meta.session = id.into(); }
                if let Some(c) = e["cwd"].as_str() { meta.cwd = c.into(); }
            }
            "session_info" => if let Some(n) = e["name"].as_str().filter(|n| !n.trim().is_empty()) { meta.title = n.lines().next().unwrap_or("").chars().take(80).collect(); },
            "message" => {
                let m = &e["message"];
                if m["role"] == "user" && meta.title.is_empty() {
                    if let Event::User { text, .. } = user(&m["content"]) { meta.title = text.lines().next().unwrap_or("").chars().take(80).collect(); }
                }
                let u = &m["usage"];
                if m["role"] != "assistant" || !u.is_object() { continue; }
                let at = m["timestamp"].as_i64().unwrap_or(0);
                if !seen.insert(format!("{}#{at}", e["id"].as_str().unwrap_or(""))) { continue; }
                let t = crate::events::tokens(u);
                let r = Record { at, model: format!("{}/{}", m["provider"].as_str().unwrap_or("?"), m["model"].as_str().unwrap_or("?")), session: meta.session.clone(),
                    vault: in_vault(&meta.cwd, vault), input: t.input, output: t.output, cache_read: t.cache_read, cache_write: t.cache_write, cost: t.cost };
                if r.total() > 0 { out.push(r); }
            }
            _ => {}
        }
    }
    out
}

impl Logs {
    /// Read what the session files under `dir` gained since the last call.
    pub fn refresh(&mut self, dir: &Path, vault: &str, since: i64) {
        if self.vault != vault { *self = Logs { vault: vault.into(), ..Default::default() }; }
        let Logs { tail, meta, vault, .. } = self;
        // a file read again from the start (it shrank) sets its meta again from its first lines
        tail.refresh(dir, "jsonl", since, |r| r.at, |p, text, seen| parse_chunk(p, text, seen, meta.entry(p.to_path_buf()).or_default(), vault));
    }
}

/// A session of the contract: idle, interactive (a terminal session).
pub fn session(sid: &str, name: &str, updated_ms: i64) -> Value {
    json!({"id": sid, "sessionId": sid, "name": name, "kind": "interactive", "status": "idle", "updatedAt": updated_ms})
}

/// `pi --list-models`: a header and per model `provider  model  context  max-out  thinking  images`. The models of
/// the providers pi has a login or key for, as `provider/model`.
pub fn parse_models(s: &str) -> Vec<Choice> {
    s.lines().skip(1).filter_map(|l| {
        let mut w = l.split_whitespace();
        let (provider, model) = (w.next()?, w.next()?);
        Some(Choice::new(&format!("{provider}/{model}"), &format!("{model} · {provider}")))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vault-pi-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(d.join("--v--")).unwrap();
        d
    }
    const LIVE: &str = include_str!("../tests/fixtures/session-live.jsonl");
    const RESUMED: &str = include_str!("../tests/fixtures/session-resumed.jsonl");
    const FORK: &str = include_str!("../tests/fixtures/session-fork.jsonl");

    #[test]
    fn history_of_a_live_session() {
        let d = tmp("history");
        let p = d.join("--v--/2026-10-01T20-56-27-389Z_0198aaaa-bbbb-cccc-dddd-000000000011.jsonl");
        std::fs::write(&p, LIVE).unwrap();
        let (ev, end) = history(&p, 0);
        assert_eq!(end, LIVE.len() as u64);
        assert_eq!(ev[0], Event::Time { at: "2026-10-01T20:56:27.418Z".into() });
        assert!(matches!(&ev[1], Event::User { text, .. } if text.starts_with("Create note.txt")));
        let calls: Vec<&str> = ev.iter().filter_map(|e| if let Event::ToolCall { name, .. } = e { Some(name.as_str()) } else { None }).collect();
        assert_eq!(calls, ["Write", "Edit", "Read"]);
        assert_eq!(ev.iter().filter(|e| matches!(e, Event::ToolResult { error: false, .. })).count(), 3);
        assert!(matches!(ev.last(), Some(Event::Text { text, .. }) if text == "world"));
        // from the offset on: nothing; a line still being written is left
        assert!(history(&p, end).0.is_empty());
        std::fs::write(&p, format!("{LIVE}{{\"type\":\"mess")).unwrap();
        assert_eq!(history(&p, 0).1, end);
        assert_eq!(find(&d, "0198aaaa-bbbb-cccc-dddd-000000000011"), Some(p.clone()));
        assert_eq!(sid_of(&p), "0198aaaa-bbbb-cccc-dddd-000000000011");
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn usage_and_sessions_of_live_files() {
        let d = tmp("usage");
        let (a, b) = (d.join("--v--/2026-10-01T20-55-22-316Z_0198aaaa-bbbb-cccc-dddd-000000000010.jsonl"), d.join("--v--/2026-10-01T20-56-21-586Z_01a0f940-ff51-77c6-88b0-1bedf80ca96d.jsonl"));
        // the first half of the file now, the rest appended later: the meta of the first read still applies
        let cut = RESUMED.match_indices('\n').nth(3).unwrap().0 + 1;
        std::fs::write(&a, &RESUMED[..cut]).unwrap();
        let mut logs = Logs::default();
        logs.refresh(&d, "/tmp/pi-probe/work", 0);
        assert!(logs.tail.records().is_empty());
        std::fs::write(&a, RESUMED).unwrap();
        std::fs::write(&b, FORK).unwrap();
        logs.refresh(&d, "/tmp/pi-probe/work", 0);
        let mut recs = logs.tail.records();
        recs.sort_by_key(|r| r.at);
        // three assistant messages in the first session; the fork repeats them and adds none of its own yet
        assert_eq!(recs.len(), 3, "{recs:?}");
        assert_eq!((recs[0].model.as_str(), recs[0].input, recs[0].output, recs[0].cache_read), ("openai-codex/gpt-5.5", 1800, 19, 0));
        assert!((recs[0].cost.unwrap() - 0.00957).abs() < 1e-9);
        assert!(recs.iter().all(|r| r.vault && r.session == "0198aaaa-bbbb-cccc-dddd-000000000010"));
        let m = &logs.meta[&b];
        assert_eq!((m.session.as_str(), m.cwd.as_str(), m.title.as_str()), ("01a0f940-ff51-77c6-88b0-1bedf80ca96d", "/private/tmp/pi-probe/work", "Use the bash tool to run: echo hi. Then reply with just the word done."));
        assert!(in_vault(&m.cwd, "/private/tmp/pi-probe") && !in_vault(&m.cwd, "/private/tmp/pi"));
        assert_eq!(session("s", "n", 5), json!({"id": "s", "sessionId": "s", "name": "n", "kind": "interactive", "status": "idle", "updatedAt": 5}));
        // another vault: not in the vault
        let mut other = Logs::default();
        other.refresh(&d, "/elsewhere", 0);
        assert!(other.tail.records().iter().all(|r| !r.vault));
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn a_session_name_and_the_models() {
        let mut meta = Meta::default();
        parse_chunk(Path::new("/s/t_x-1.jsonl"), "{\"type\":\"message\",\"id\":\"a\",\"timestamp\":\"2026-10-01T00:00:00.000Z\",\"message\":{\"role\":\"user\",\"content\":\"eerste vraag\\nmeer\"}}\n{\"type\":\"session_info\",\"id\":\"b\",\"timestamp\":\"2026-10-01T00:00:01.000Z\",\"name\":\"Refactor auth\"}", &mut HashSet::new(), &mut meta, "/v");
        assert_eq!((meta.session.as_str(), meta.title.as_str()), ("x-1", "Refactor auth"));
        let m = parse_models(include_str!("../tests/fixtures/list-models.txt"));
        assert_eq!(m[0], Choice::new("anthropic/claude-fable-5", "claude-fable-5 · anthropic"));
        assert_eq!(m.len(), 27);
        assert!(m.iter().any(|c| c.id == "openai-codex/gpt-5.5"));
        assert!(parse_models("").is_empty() && parse_models("provider model\n").is_empty());
    }
}
