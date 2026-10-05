//! Claude Code's stream-json, in and out, and its transcripts, as the contract's events.

use agent_core::envelope::strip;
use agent_core::{Event, Hunk, Image, Turn, TurnUsage, IMAGE_TYPES};
use serde_json::{json, Value};
use std::path::Path;

/// A turn as stream-json takes it: pasted images as base64 image blocks before the text.
pub fn user_message(turn: &Turn) -> Value {
    let mut content: Vec<Value> = turn.images.iter().filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str()))
        .map(|i| json!({"type": "image", "source": {"type": "base64", "media_type": i.media_type, "data": i.data}})).collect();
    if !turn.text.is_empty() { content.push(json!({"type": "text", "text": turn.text})); }
    json!({"type": "user", "message": {"role": "user", "content": content}})
}

/// The blocks of an assistant message: text (not blank) and tool calls.
fn assistant(content: &Value, out: &mut Vec<Event>) {
    for c in content.as_array().into_iter().flatten() {
        if c["type"] == "text" { if let Some(t) = c["text"].as_str().filter(|t| !t.trim().is_empty()) { out.push(Event::Text { text: t.into(), delta: false }); } }
        if c["type"] == "tool_use" { out.push(Event::ToolCall { id: c["id"].as_str().unwrap_or("").into(), name: c["name"].as_str().unwrap_or("").into(), input: c["input"].clone() }); }
    }
}

/// The diff an Edit or Write made, from the result Claude Code keeps next to a tool result (`tool_use_result` in
/// stream-json, `toolUseResult` in the transcript). Only for a message with one tool result, the one it belongs to.
fn patch(content: &Value, result: &Value, out: &mut Vec<Event>) {
    let results: Vec<&Value> = content.as_array().into_iter().flatten().filter(|c| c["type"] == "tool_result").collect();
    let [r] = results[..] else { return };
    let Ok(hunks) = serde_json::from_value::<Vec<Hunk>>(result["structuredPatch"].clone()) else { return };
    if !hunks.is_empty() { out.push(Event::Patch { id: r["tool_use_id"].as_str().unwrap_or("").into(), hunks }); }
}

/// One stdout line of `claude -p --output-format stream-json`.
pub fn parse(line: &str) -> Vec<Event> {
    let Ok(ev) = serde_json::from_str::<Value>(line) else { return vec![] };
    let mut out = vec![];
    match ev["type"].as_str().unwrap_or("") {
        "system" if ev["subtype"] == "init" => {
            if let Some(id) = ev["session_id"].as_str() { out.push(Event::Session { id: id.into() }); }
            if let Some(m) = ev["model"].as_str() { out.push(Event::Resolved { model: m.into(), effort: None }); }
        }
        "conversation_reset" => out.push(Event::Reset),
        "assistant" => assistant(&ev["message"]["content"], &mut out),
        "user" => {
            for c in ev["message"]["content"].as_array().into_iter().flatten().filter(|c| c["type"] == "tool_result") {
                out.push(Event::ToolResult { id: c["tool_use_id"].as_str().unwrap_or("").into(), error: c["is_error"] == true });
            }
            patch(&ev["message"]["content"], &ev["tool_use_result"], &mut out);
        }
        "result" => {
            let ok = ev["is_error"] != true && ev["subtype"] == "success";
            let error = (!ok).then(|| ev["result"].as_str().filter(|s| !s.is_empty()).or(ev["subtype"].as_str()).unwrap_or("").to_string());
            let u = &ev["usage"];
            let n = |k: &str| u[k].as_u64().unwrap_or(0);
            let usage = u.is_object().then(|| TurnUsage { input: n("input_tokens"), output: n("output_tokens"), cache_read: n("cache_read_input_tokens"),
                cache_write: n("cache_creation_input_tokens"), cost: ev["total_cost_usd"].as_f64() });
            out.push(Event::TurnEnd { ok, error, usage, duration_ms: ev["duration_ms"].as_u64() });
        }
        _ => {}
    }
    out
}

/// Text the harness put in the user's turn: `<…>` lines, and a subagent's or teammate's message.
fn harness(t: &str) -> bool { t.starts_with('<') || t.starts_with("Another Claude session sent a message") }

/// One transcript line as history: the user's messages (not the harness's ones), Claude's blocks and the diffs of its edits.
pub fn history_line(e: &Value, out: &mut Vec<Event>) {
    if (e["type"] != "user" && e["type"] != "assistant") || e["isSidechain"] == true || e["isMeta"] == true { return; }
    if let Some(at) = e["timestamp"].as_str() { out.push(Event::Time { at: at.into() }); }
    let c = &e["message"]["content"];
    if e["type"] == "assistant" { return assistant(c, out); }
    patch(c, &e["toolUseResult"], out);
    if let Some(s) = c.as_str().map(strip) { if !harness(s) { out.push(Event::User { text: s.into(), images: vec![] }); } return; }
    let Some(blocks) = c.as_array() else { return };
    let texts: Vec<&str> = blocks.iter().filter(|x| x["type"] == "text").filter_map(|x| x["text"].as_str()).map(strip).filter(|t| !harness(t)).collect();
    // an image not inline as base64 is None: a placeholder
    let images: Vec<Option<Image>> = blocks.iter().filter(|x| x["type"] == "image").map(|x| {
        let s = &x["source"];
        let mt = s["media_type"].as_str().unwrap_or("");
        (s["type"] == "base64" && IMAGE_TYPES.contains(&mt)).then(|| s["data"].as_str().map(|d| Image { media_type: mt.into(), data: d.into() })).flatten()
    }).collect();
    if !texts.is_empty() || !images.is_empty() { out.push(Event::User { text: texts.join("\n\n"), images }); }
}

/// The timestamps (ISO, as written) of the user's own messages in a transcript: what `history_line` shows as the user's
/// text or images, so no tool results, harness text or sidechains. A permission answer leaves no line of its own.
pub fn user_times(text: &str) -> Vec<String> {
    text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter_map(|v| {
        let mut ev = vec![];
        history_line(&v, &mut ev);
        ev.iter().any(|e| matches!(e, Event::User { .. })).then(|| v["timestamp"].as_str().map(String::from)).flatten()
    }).collect()
}

/// A transcript from byte offset `from`, up to its last whole line, and where to continue: transcripts only grow at the end.
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

#[cfg(test)]
mod tests {
    use super::*;
    const STREAM: &str = include_str!("../tests/fixtures/stream.jsonl");
    const TRANSCRIPT: &str = include_str!("../tests/fixtures/transcript.jsonl");

    #[test]
    fn user_times_skip_tool_results_and_harness_text() {
        let t = r#"{"type":"user","timestamp":"2026-10-05T08:00:00.000Z","message":{"content":"hallo"}}
{"type":"assistant","timestamp":"2026-10-05T08:00:05.000Z","message":{"content":[{"type":"text","text":"ok"}]}}
{"type":"user","timestamp":"2026-10-05T08:00:09.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"x","content":"done"}]}}
{"type":"user","isMeta":true,"timestamp":"2026-10-05T08:00:10.000Z","message":{"content":"meta"}}
{"type":"user","timestamp":"2026-10-05T08:00:11.000Z","message":{"content":"<system-reminder>x</system-reminder>"}}
{"type":"user","timestamp":"2026-10-05T08:05:00.000Z","message":{"content":[{"type":"text","text":"en nu?"}]}}"#;
        assert_eq!(user_times(t), ["2026-10-05T08:00:00.000Z", "2026-10-05T08:05:00.000Z"]);
    }

    #[test]
    fn stream_json_to_events() {
        let mut ev: Vec<Event> = STREAM.lines().flat_map(parse).collect();
        assert_eq!(ev[0], Event::Session { id: "36099ce4-d17c-482a-8907-23790cc0e8db".into() });
        assert_eq!(ev.remove(1), Event::Resolved { model: "claude-opus-5-5".into(), effort: None });
        assert_eq!(ev[1], Event::Text { text: "Ik kijk even.".into(), delta: false });
        assert!(matches!(&ev[2], Event::ToolCall { id, name, input } if id == "toolu_1" && name == "Read" && input["file_path"] == "/v/a.md"));
        assert_eq!(ev[3], Event::ToolResult { id: "toolu_1".into(), error: false });
        assert_eq!(ev[4], Event::ToolResult { id: "toolu_2".into(), error: true });
        assert_eq!(ev[5], Event::Reset);
        assert!(matches!(&ev[6], Event::TurnEnd { ok: true, error: None, usage: Some(u), duration_ms: Some(4200) } if u.input == 12 && u.cache_read == 300 && u.cost == Some(0.25)));
        assert_eq!(ev[7], Event::TurnEnd { ok: false, error: Some("error_max_turns".into()), usage: None, duration_ms: None });
        assert_eq!(ev[8], Event::ToolResult { id: "toolu_3".into(), error: false });
        let lines = [" line one", " line two", "-line three", "+line 3", " line four", " line five"].map(String::from).to_vec();
        assert_eq!(ev[9], Event::Patch { id: "toolu_3".into(), hunks: vec![Hunk { old_start: 1, new_start: 1, lines }] });
        assert_eq!(ev.len(), 10); // blank text, rate-limit and unknown lines give nothing, a Read's result no patch
    }

    #[test]
    fn turn_as_stream_json() {
        let t = Turn { text: "kijk".into(), images: vec![Image { media_type: "image/png".into(), data: "AA==".into() }, Image { media_type: "text/html".into(), data: "x".into() }] };
        let m = user_message(&t);
        assert_eq!(m["message"]["content"][0]["source"]["media_type"], "image/png");
        assert_eq!(m["message"]["content"][1], json!({"type": "text", "text": "kijk"}));
        assert_eq!(m["message"]["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn the_project_line_is_not_the_message() {
        let line = json!({"type": "user", "message": {"content": [{"type": "text", "text": agent_core::envelope::wrap("Relay", "", "waarom?")}]}});
        let mut out = vec![];
        history_line(&line, &mut out);
        assert_eq!(out, vec![Event::User { text: "waarom?".into(), images: vec![] }]);
    }

    #[test]
    fn transcript_to_history() {
        let p = std::env::temp_dir().join(format!("vault-claude-hist-{}.jsonl", std::process::id()));
        std::fs::write(&p, format!("{TRANSCRIPT}{{\"type\":\"user\",\"message\":{{\"content\":\"half")).unwrap();
        let (all, next) = history(&p, 0);
        assert_eq!(next as usize, TRANSCRIPT.len());
        assert_eq!(all[0], Event::Time { at: "2026-09-30T08:00:00.000Z".into() }); // the timestamp comes before the line's events
        assert_eq!(all[5], Event::Time { at: "2026-09-30T08:00:07.000Z".into() }); // a tool result line gives only its time
        let ev: Vec<Event> = all.into_iter().filter(|e| !matches!(e, Event::Time { .. })).collect();
        assert_eq!(ev[0], Event::User { text: "Wat staat er open?".into(), images: vec![] });
        assert_eq!(ev[1], Event::User { text: "en dit".into(), images: vec![Some(Image { media_type: "image/png".into(), data: "AA==".into() }), None] });
        assert_eq!(ev[2], Event::Text { text: "Drie dingen.".into(), delta: false });
        assert!(matches!(&ev[3], Event::ToolCall { name, .. } if name == "Bash"));
        assert!(matches!(&ev[4], Event::ToolCall { name, .. } if name == "Edit"));
        let Event::Patch { id, hunks } = &ev[5] else { panic!("{:?}", ev[5]) };
        assert_eq!((id.as_str(), hunks.len(), hunks[0].old_start, hunks[1].new_start), ("toolu_10", 2, 40, 90));
        assert_eq!(hunks[0].lines[3], "-Contract until Q3.");
        assert_eq!(ev.len(), 6); // no <command>, meta or teammate lines, other tool results, sidechains or other types
        assert_eq!(history(&p, next).0.len(), 0);
        std::fs::remove_file(p).ok();
    }
}
