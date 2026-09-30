//! Codex's session rollouts, `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`: one
//! `{timestamp, type, payload}` per line (session_meta, turn_context, response_item, event_msg, compacted). They give
//! the history of a thread, the token records (event_msg token_count) and the rate limits (its rate_limits).

use agent_core::usage::{parse_ts, Limits, Record, Tail, Window};
use agent_core::{Event, Image, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

fn text_of(content: &Value, kind: &str) -> Vec<String> {
    content.as_array().into_iter().flatten().filter(|c| c["type"] == kind).filter_map(|c| c["text"].as_str()).map(String::from).collect()
}

/// A function call's arguments: a JSON string, sometimes already an object.
fn args(v: &Value) -> Value { v.as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_else(|| v.clone()) }

/// The file an apply_patch touches first, and whether it only adds files.
fn patch_file(patch: &str) -> (Option<String>, bool) {
    let mut first = None;
    let mut add_only = true;
    for l in patch.lines() {
        for (pre, add) in [("*** Add File: ", true), ("*** Update File: ", false), ("*** Delete File: ", false)] {
            if let Some(f) = l.strip_prefix(pre) { first.get_or_insert_with(|| f.trim().to_string()); add_only &= add; }
        }
    }
    (first.clone(), add_only && first.is_some())
}

/// One rollout line as history: the user's messages (not the harness's `<environment_context>` and the like), the
/// assistant's text, tool calls and their results. Every such line starts with its time.
pub fn history_line(e: &Value, out: &mut Vec<Event>) {
    if e["type"] != "response_item" { return; }
    let p = &e["payload"];
    let mut ev = vec![];
    match p["type"].as_str().unwrap_or("") {
        "message" if p["role"] == "user" => {
            let texts: Vec<String> = text_of(&p["content"], "input_text").into_iter().filter(|t| !t.trim_start().starts_with('<')).collect();
            let images: Vec<Option<Image>> = p["content"].as_array().into_iter().flatten().filter(|c| c["type"] == "input_image").map(|c| {
                let url = c["image_url"].as_str().unwrap_or("");
                let (mt, data) = url.strip_prefix("data:").and_then(|r| r.split_once(";base64,")).unwrap_or(("", ""));
                IMAGE_TYPES.contains(&mt).then(|| Image { media_type: mt.into(), data: data.into() })
            }).collect();
            if !texts.is_empty() || !images.is_empty() { ev.push(Event::User { text: texts.join("\n\n"), images }); }
        }
        "message" if p["role"] == "assistant" => {
            for t in text_of(&p["content"], "output_text").into_iter().filter(|t| !t.trim().is_empty()) { ev.push(Event::Text { text: t, delta: false }); }
        }
        "function_call" | "local_shell_call" => {
            let a = args(if p["type"] == "local_shell_call" { &p["action"] } else { &p["arguments"] });
            let id = p["call_id"].as_str().unwrap_or("").to_string();
            let (name, input) = match p["name"].as_str().unwrap_or("shell") {
                "shell" | "container.exec" | "exec_command" | "local_shell" | "shell_command" => {
                    let cmd = a["command"].as_array().map(|c| {
                        let c: Vec<&str> = c.iter().filter_map(|x| x.as_str()).collect();
                        // ["bash", "-lc", "ls"] is "ls"
                        if c.len() == 3 && c[1] == "-lc" { c[2].to_string() } else { c.join(" ") }
                    }).or_else(|| a["command"].as_str().or(a["cmd"].as_str()).map(String::from)).unwrap_or_default();
                    ("Bash".to_string(), json!({"command": cmd}))
                }
                n => (n.to_string(), a),
            };
            ev.push(Event::ToolCall { id, name, input });
        }
        "custom_tool_call" => {
            let id = p["call_id"].as_str().unwrap_or("").to_string();
            let input = p["input"].as_str().unwrap_or("");
            if p["name"] == "apply_patch" {
                let (file, add) = patch_file(input);
                ev.push(Event::ToolCall { id, name: if add { "Write" } else { "Edit" }.into(), input: json!({"file_path": file, "diff": input}) });
            } else {
                ev.push(Event::ToolCall { id, name: p["name"].as_str().unwrap_or("").into(), input: json!({"input": input}) });
            }
        }
        "function_call_output" | "custom_tool_call_output" => {
            let o = args(&p["output"]);
            let code = o["metadata"]["exit_code"].as_i64().or(o["exit_code"].as_i64());
            ev.push(Event::ToolResult { id: p["call_id"].as_str().unwrap_or("").into(), error: code.is_some_and(|c| c != 0) || o["success"] == false });
        }
        _ => {}
    }
    if ev.is_empty() { return; }
    if let Some(at) = e["timestamp"].as_str() { out.push(Event::Time { at: at.into() }); }
    out.extend(ev);
}

/// A rollout from byte offset `from`, up to its last whole line, and where to continue.
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

/// The thread id at the end of a rollout's file name.
pub fn sid_of(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    if stem.len() >= 36 { stem[stem.len() - 36..].to_string() } else { stem }
}
/// A thread's rollout, by its file name, when the state database does not say.
pub fn find(dir: &Path, sid: &str) -> Option<PathBuf> {
    let want = format!("-{sid}.jsonl");
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() { if let Some(f) = find(&p, sid) { return Some(f); } }
        else if p.to_string_lossy().ends_with(&want) { return Some(p); }
    }
    None
}

/// What a rollout said before the lines read now: its thread, folder and model.
#[derive(Clone, Default)]
pub struct Meta { pub session: String, pub cwd: String, pub model: String, pub updated: i64, pub title: String }

/// The rollouts read so far: the token records, each file's meta, and the newest rate limits (epoch ms, snapshot).
#[derive(Default)]
pub struct Logs { pub vault: String, pub tail: Tail<Record>, pub meta: HashMap<PathBuf, Meta>, pub limits: Option<(i64, Value)> }

fn in_vault(cwd: &str, vault: &str) -> bool { !vault.is_empty() && (cwd == vault || cwd.starts_with(&format!("{vault}/"))) }

/// Whole new lines of one rollout as token records. token_count carries the thread's running total: one already
/// counted (the same total again, as after a rate-limit-only update) is skipped.
pub fn parse_chunk(path: &Path, text: &str, seen: &mut HashSet<String>, meta: &mut Meta, vault: &str, limits: &mut Option<(i64, Value)>) -> Vec<Record> {
    if meta.session.is_empty() { meta.session = sid_of(path); }
    let mut out = vec![];
    for l in text.lines() {
        let Ok(e) = serde_json::from_str::<Value>(l) else { continue };
        let p = &e["payload"];
        let at = e["timestamp"].as_str().and_then(parse_ts).unwrap_or(0);
        meta.updated = meta.updated.max(at);
        match (e["type"].as_str().unwrap_or(""), p["type"].as_str().unwrap_or("")) {
            ("session_meta", _) => {
                if let Some(id) = p["id"].as_str() { meta.session = id.into(); }
                if let Some(c) = p["cwd"].as_str() { meta.cwd = c.into(); }
            }
            ("turn_context", _) => {
                if let Some(m) = p["model"].as_str() { meta.model = m.into(); }
                if let Some(c) = p["cwd"].as_str() { meta.cwd = c.into(); }
            }
            ("event_msg", "user_message") if meta.title.is_empty() => {
                meta.title = p["message"].as_str().unwrap_or("").lines().next().unwrap_or("").chars().take(80).collect();
            }
            ("event_msg", "token_count") => {
                if p["rate_limits"].is_object() && limits.as_ref().is_none_or(|(t, _)| at >= *t) { *limits = Some((at, p["rate_limits"].clone())); }
                let info = &p["info"];
                let Some(total) = info["total_token_usage"]["total_tokens"].as_u64() else { continue };
                if !seen.insert(format!("{}#{total}", path.display())) { continue; }
                let u = &info["last_token_usage"];
                let n = |k: &str| u[k].as_u64().unwrap_or(0);
                out.push(Record { at, model: if meta.model.is_empty() { "codex".into() } else { meta.model.clone() }, session: meta.session.clone(),
                    vault: in_vault(&meta.cwd, vault), input: n("input_tokens").saturating_sub(n("cached_input_tokens")), output: n("output_tokens"),
                    cache_read: n("cached_input_tokens"), cache_write: 0, cost: None });
            }
            _ => {}
        }
    }
    out
}

impl Logs {
    /// Read what the rollouts under `dir` gained since the last call.
    pub fn refresh(&mut self, dir: &Path, vault: &str, since: i64) {
        if self.vault != vault { *self = Logs { vault: vault.into(), ..Default::default() }; }
        let Logs { tail, meta, limits, vault, .. } = self;
        // a file read again from the start (it shrank) sets its meta again from its first lines
        tail.refresh(dir, "jsonl", since, |r| r.at, |p, text, seen| parse_chunk(p, text, seen, meta.entry(p.to_path_buf()).or_default(), vault, limits));
    }
}

/// "2026-09-30T19:00:00Z" for epoch seconds.
pub fn iso(secs: i64) -> String {
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // civil from days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// The windows of a rate-limit snapshot, from a rollout (snake_case) or the app-server (camelCase), taken at `at`
/// (epoch ms). A window whose reset has passed is empty again.
pub fn limits_of(snap: &Value, at: i64, now: i64) -> Limits {
    let mut windows = vec![];
    for (id, w) in [("primary", &snap["primary"]), ("secondary", &snap["secondary"])] {
        let Some(pct) = w["used_percent"].as_f64().or(w["usedPercent"].as_f64()) else { continue };
        let mins = w["window_minutes"].as_i64().or(w["windowDurationMins"].as_i64());
        let resets = w["resets_at"].as_i64().or(w["resetsAt"].as_i64())
            .or_else(|| w["resets_in_seconds"].as_i64().map(|s| at / 1000 + s));
        let passed = resets.is_some_and(|r| r * 1000 <= now);
        let (label, name) = match mins {
            Some(300) => ("limit.5h", None),
            Some(10080) => ("limit.week", None),
            Some(m) if m % 1440 == 0 => ("limit.window", Some(format!("{} d", m / 1440))),
            Some(m) if m % 60 == 0 => ("limit.window", Some(format!("{} h", m / 60))),
            Some(m) => ("limit.window", Some(format!("{m} min"))),
            None => ("limit.window", Some(id.to_string())),
        };
        windows.push(Window { id: id.into(), label: label.into(), name, pct: if passed { 0.0 } else { pct }, resets: resets.filter(|_| !passed).map(iso) });
    }
    if windows.is_empty() { return Limits::Off("no-data".into()); }
    let plan = snap["plan_type"].as_str().or(snap["planType"].as_str()).map(String::from);
    Limits::On { plan, windows }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ROLLOUT: &str = include_str!("../tests/fixtures/rollout.jsonl");
    const SID: &str = "019a0000-aaaa-7000-8000-000000000001";

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vault-codex-{name}-{}", std::process::id()));
        std::fs::create_dir_all(d.join("2026/09/30")).unwrap();
        d
    }

    #[test]
    fn rollout_to_history() {
        let d = tmp("hist");
        let p = d.join(format!("2026/09/30/rollout-2026-09-30T08-00-00-{SID}.jsonl"));
        std::fs::write(&p, format!("{ROLLOUT}{{\"timestamp\":\"x\",\"type\":\"response_item\",\"payload\":{{\"type\":\"mess")).unwrap();
        assert_eq!(find(&d, SID).as_deref(), Some(p.as_path()));
        assert_eq!(sid_of(&p), SID);
        let (all, next) = history(&p, 0);
        assert_eq!(next as usize, ROLLOUT.len());
        assert_eq!(all[0], Event::Time { at: "2026-09-30T08:00:01.000Z".into() });
        let ev: Vec<Event> = all.into_iter().filter(|e| !matches!(e, Event::Time { .. })).collect();
        assert_eq!(ev[0], Event::User { text: "Wat staat er open?".into(), images: vec![Some(Image { media_type: "image/png".into(), data: "AA==".into() })] });
        assert_eq!(ev[1], Event::ToolCall { id: "call_1".into(), name: "Bash".into(), input: json!({"command": "ls -la"}) });
        assert_eq!(ev[2], Event::ToolResult { id: "call_1".into(), error: false });
        assert_eq!(ev[3], Event::ToolCall { id: "call_2".into(), name: "Bash".into(), input: json!({"command": "rg todo"}) });
        assert_eq!(ev[4], Event::ToolResult { id: "call_2".into(), error: true });
        assert!(matches!(&ev[5], Event::ToolCall { id, name, input } if id == "call_3" && name == "Edit" && input["file_path"] == "/v/Inbox.md"));
        assert_eq!(ev[6], Event::ToolResult { id: "call_3".into(), error: false });
        assert_eq!(ev[7], Event::Text { text: "Drie dingen.".into(), delta: false });
        assert_eq!(ev.len(), 8); // no environment context, reasoning, event_msg copies or other types
        assert_eq!(history(&p, next).0.len(), 0);
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn token_records_and_rate_limits() {
        let d = tmp("usage");
        let p = d.join(format!("2026/09/30/rollout-2026-09-30T08-00-00-{SID}.jsonl"));
        let (head, tail) = ROLLOUT.split_at(ROLLOUT.find("\"token_count\"").unwrap());
        let cut = head.rfind('\n').unwrap() + 1;
        std::fs::write(&p, &ROLLOUT[..cut]).unwrap();
        let mut logs = Logs::default();
        logs.refresh(&d, "/v", 0);
        assert!(logs.tail.records().is_empty() && logs.limits.is_none());
        std::fs::write(&p, format!("{head}{tail}")).unwrap(); // the rest appended: meta from the first read still applies
        logs.refresh(&d, "/v", 0);
        let mut recs = logs.tail.records();
        recs.sort_by_key(|r| r.at);
        assert_eq!(recs.len(), 2); // the repeated total and the info-less update are not counted again
        assert_eq!(recs[0], Record { at: parse_ts("2026-09-30T08:00:09.000Z").unwrap(), model: "gpt-6.1-sol".into(), session: SID.into(), vault: true,
            input: 250, output: 50, cache_read: 600, cache_write: 0, cost: None });
        assert_eq!((recs[1].input, recs[1].output, recs[1].model.as_str()), (100, 10, "gpt-6.1-sol"));
        let m = &logs.meta[&p];
        assert_eq!((m.cwd.as_str(), m.title.as_str()), ("/v", "Wat staat er open?"));
        // the newest rate limits: the info-less update
        let (at, snap) = logs.limits.clone().unwrap();
        assert_eq!(at, parse_ts("2026-09-30T08:00:12.000Z").unwrap());
        let Limits::On { plan, windows } = limits_of(&snap, at, at) else { panic!() };
        assert_eq!(plan.as_deref(), Some("plus"));
        assert_eq!(windows[0], Window { id: "primary".into(), label: "limit.5h".into(), name: None, pct: 14.0, resets: Some("2026-09-30T13:00:00Z".into()) });
        assert_eq!((windows[1].label.as_str(), windows[1].pct), ("limit.week", 41.0));
        // another vault: not in the vault
        let mut other = Logs::default();
        other.refresh(&d, "/elsewhere", 0);
        assert!(other.tail.records().iter().all(|r| !r.vault));
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn limit_windows() {
        let now = 1790755200000; // 2026-09-30T08:00:00Z
        assert_eq!(iso(1790755200), "2026-09-30T08:00:00Z");
        // an older version: resets_in_seconds, from the line's time; an odd window length
        let old = json!({"primary": {"used_percent": 5.0, "window_minutes": 120, "resets_in_seconds": 600}, "secondary": null});
        let Limits::On { plan: None, windows } = limits_of(&old, now, now) else { panic!() };
        assert_eq!((windows[0].label.as_str(), windows[0].name.as_deref(), windows[0].resets.as_deref()), ("limit.window", Some("2 h"), Some("2026-09-30T08:10:00Z")));
        // the app-server's camelCase, a window already reset
        let live = json!({"primary": {"usedPercent": 90.0, "windowDurationMins": 300, "resetsAt": 1790755100}, "planType": "pro"});
        let Limits::On { windows, .. } = limits_of(&live, now, now) else { panic!() };
        assert_eq!((windows[0].pct, windows[0].resets.clone()), (0.0, None));
        assert_eq!(limits_of(&json!({}), now, now), Limits::Off("no-data".into()));
    }
}
