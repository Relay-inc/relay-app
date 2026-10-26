//! Claude Code's subagents, from <transcripts>/<session>/subagents/agent-<id>.jsonl, and whether a session's
//! turn ended (`claude agents` keeps a session busy while a background shell of it runs).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::io::BufReader;
use std::path::PathBuf;

/// Subagent rows per agent file (reparsed only when mtime or size changes), and per parent session
/// the byte offset read so far plus the last task-notification time per agent id.
#[derive(Default)]
pub struct SubCache {
    files: HashMap<PathBuf, (std::time::SystemTime, u64, Value)>,
    notes: HashMap<String, (u64, HashMap<String, String>)>,
}

/// Complete JSON lines from the last `n` bytes of a file, the first cut line dropped.
fn tail_lines(path: &std::path::Path, n: u64) -> (Vec<Value>, bool) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = fs::File::open(path) else { return (vec![], true) };
    let start = f.metadata().map(|m| m.len()).unwrap_or(0).saturating_sub(n);
    f.seek(SeekFrom::Start(start)).ok();
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let s = String::from_utf8_lossy(&buf);
    let rows = s.lines().skip(if start > 0 { 1 } else { 0 }).filter_map(|l| serde_json::from_str(l).ok()).collect();
    (rows, start == 0)
}

/// One subagent from its transcript tail and meta file. `ended`: the last message is Claude's and
/// its turn stopped for a reason other than a tool call, so the agent handed back.
fn agent_row(path: &std::path::Path) -> Value {
    let id = path.file_stem().unwrap_or_default().to_string_lossy().trim_start_matches("agent-").to_string();
    let meta: Value = fs::read_to_string(path.with_extension("meta.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({}));
    let mut first = String::new();
    fs::File::open(path).map(|f| BufReader::new(f).read_line(&mut first)).ok();
    let started = serde_json::from_str::<Value>(&first).ok().map(|e| e["timestamp"].clone()).unwrap_or(Value::Null);
    let mut row = json!({"id": id, "description": meta["description"], "agentType": meta["agentType"], "model": meta["model"],
        "started_at": started, "last_at": started, "ended": false});
    // widen the window until the last user or assistant line and the last visible step are in it
    for n in [64u64 << 10, 1 << 20, 8 << 20] {
        let (ev, whole) = tail_lines(path, n);
        let msgs: Vec<&Value> = ev.iter().filter(|e| e["type"] == "user" || e["type"] == "assistant").collect();
        if let Some(last) = msgs.last() {
            row["last_at"] = last["timestamp"].clone();
            let stop = last["message"]["stop_reason"].as_str();
            row["ended"] = json!(last["type"] == "assistant" && stop.is_some_and(|s| s != "tool_use"));
        }
        // the context of its latest request, and whether that answer hit the output limit
        if let Some(a) = msgs.iter().rev().find(|e| e["type"] == "assistant") {
            let u = &a["message"]["usage"];
            let n = |k: &str| u[k].as_u64().unwrap_or(0);
            let ctx = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens") + n("output_tokens");
            if ctx > 0 { row["ctx"] = json!(ctx); }
            row["cut"] = json!(a["message"]["stop_reason"] == "max_tokens");
        }
        let step = msgs.iter().rev().filter(|e| e["type"] == "assistant")
            .flat_map(|e| e["message"]["content"].as_array().into_iter().flatten().rev())
            .find(|c| c["type"] == "tool_use" || (c["type"] == "text" && c["text"].as_str().is_some_and(|t| !t.trim().is_empty())));
        if let Some(c) = step {
            if c["type"] == "tool_use" {
                // only the small fields the tool line needs, never a file's content
                let input: serde_json::Map<String, Value> = ["file_path", "command", "pattern", "query", "url", "description", "skill", "subagent_type"].iter()
                    .filter_map(|k| c["input"][*k].as_str().map(|v| (k.to_string(), json!(v.chars().take(120).collect::<String>())))).collect();
                row["tool"] = c["name"].clone();
                row["input"] = Value::Object(input);
            } else { row["text"] = json!(c["text"].as_str().unwrap_or("").trim().chars().take(80).collect::<String>()); }
        }
        if (step.is_some() && !msgs.is_empty()) || whole { break; }
    }
    row
}

/// Last task-notification per agent id in a parent transcript, read incrementally from the saved offset.
fn notifications<'a>(dir: &str, sid: &str, notes: &'a mut HashMap<String, (u64, HashMap<String, String>)>) -> &'a HashMap<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let e = notes.entry(sid.to_string()).or_default();
    if let Ok(mut f) = fs::File::open(format!("{dir}/{sid}.jsonl")) {
        if f.metadata().map(|m| m.len()).unwrap_or(0) < e.0 { *e = Default::default(); }
        let mut buf = Vec::new();
        if f.seek(SeekFrom::Start(e.0)).is_ok() && f.read_to_end(&mut buf).is_ok() {
            let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
            for l in String::from_utf8_lossy(&buf[..end]).lines().filter(|l| l.contains("\"queue-operation\"") && l.contains("<task-id>")) {
                let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
                let c = v["content"].as_str().unwrap_or("");
                if v["operation"] != "enqueue" || c.contains("<status>running</status>") { continue; }
                let Some(id) = c.split("<task-id>").nth(1).and_then(|x| x.split('<').next()) else { continue };
                let ts = v["timestamp"].as_str().unwrap_or("").to_string();
                let cur = e.1.entry(id.to_string()).or_default();
                if ts > *cur { *cur = ts; }
            }
            e.0 += end as u64;
        }
    }
    &e.1
}

/// The subagents of one session. Running unless the agent handed back, the parent got a notification
/// (completed, failed, killed) after its last line, or its file has been silent for 15 minutes.
pub fn subagents_of(dir: &str, sid: &str, cache: &mut SubCache) -> Vec<Value> {
    let Ok(rd) = fs::read_dir(format!("{dir}/{sid}/subagents")) else { return vec![] };
    let notes = notifications(dir, sid, &mut cache.notes).clone();
    let now = std::time::SystemTime::now();
    let mut rows: Vec<Value> = rd.flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("agent-")))
        .filter_map(|p| {
            let m = p.metadata().ok()?;
            let (mt, len) = (m.modified().ok()?, m.len());
            let mut row = match cache.files.get(&p) {
                Some((a, b, r)) if *a == mt && *b == len => r.clone(),
                _ => { let r = agent_row(&p); cache.files.insert(p.clone(), (mt, len, r.clone())); r }
            };
            let last = row["last_at"].as_str().unwrap_or("").to_string();
            let noted = row["id"].as_str().and_then(|id| notes.get(id)).is_some_and(|t| *t >= last);
            let stale = now.duration_since(mt).map_or(false, |d| d.as_secs() > 900);
            row["running"] = json!(!(row["ended"] == true || noted || stale));
            Some(row)
        }).collect();
    rows.sort_by(|a, b| a["started_at"].as_str().cmp(&b["started_at"].as_str()));
    rows
}

/// `claude agents` keeps a session busy while a background shell of it still runs, also after the turn
/// ended. The transcript closes every turn with a `turn_duration` line: when that comes after the last
/// prompt (typed, or a notification that starts a new turn), Claude is done.
pub fn turn_ended(path: &std::path::Path) -> bool {
    let (rows, _) = tail_lines(path, 256 << 10);
    for v in rows.iter().rev() {
        if v["type"] == "system" && v["subtype"] == "turn_duration" { return true; }
        if v["type"] != "user" || v["isSidechain"] == true || v["isMeta"] == true { continue; }
        let c = &v["message"]["content"];
        let prompt = c.is_string() || c.as_array().is_some_and(|b| b.iter().all(|x| x["type"] != "tool_result"));
        if prompt { return false; }
    }
    false
}

#[cfg(test)]
mod tests {
    // runs against the transcripts of the vault in $VAULT, skipped without it
    #[test]
    fn subagents_of_example_session() {
        let Ok(v) = std::env::var("VAULT") else { return };
        let slug: String = v.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
        let dir = format!("{}/.claude/projects/{slug}", std::env::var("HOME").unwrap_or_default());
        let sid = "36099ce4-d17c-482a-8907-23790cc0e8db";
        if !std::path::Path::new(&format!("{dir}/{sid}/subagents")).is_dir() { return; }
        let mut c = super::SubCache::default();
        let t = std::time::Instant::now();
        let rows = super::subagents_of(&dir, sid, &mut c);
        let first = t.elapsed();
        let t = std::time::Instant::now();
        super::subagents_of(&dir, sid, &mut c);
        for r in &rows { println!("{} {:5} {} {} | {}", r["id"], r["running"], r["started_at"], r["last_at"], r["description"]); }
        println!("{} agents, first {:?}, cached {:?}", rows.len(), first, t.elapsed());
        let get = |id: &str| rows.iter().find(|r| r["id"] == id).unwrap();
        assert_eq!(get("a13a6342c4ed7b3e7")["running"], false); // ended with end_turn
        assert_eq!(get("a896673643d285b30")["running"], false); // no end_turn, finished per the parent's notification
        assert!(rows.iter().all(|r| r["description"].is_string() && r["started_at"].is_string()));
    }
}

#[cfg(test)]
mod turn_tests {
    #[test]
    fn turn_ended_follows_the_last_marker() {
        let d = std::env::temp_dir().join("vault-turn-test.jsonl");
        let prompt = r#"{"type":"user","message":{"content":"doe iets"}}"#;
        let tool = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
        let done = r#"{"type":"system","subtype":"turn_duration"}"#;
        std::fs::write(&d, format!("{prompt}\n{tool}\n{done}\n")).unwrap();
        assert!(super::turn_ended(&d));
        std::fs::write(&d, format!("{done}\n{prompt}\n{tool}\n")).unwrap();
        assert!(!super::turn_ended(&d));
    }
}
