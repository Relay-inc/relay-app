//! Claude Code's stream-json, in and out, and its transcripts, as the contract's events.

use agent_core::envelope::strip;
use agent_core::{Event, Hunk, Image, Turn, TurnUsage, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

/// A turn as stream-json takes it: pasted images as base64 image blocks before the text.
pub fn user_message(turn: &Turn) -> Value {
    let mut content: Vec<Value> = turn.images.iter().filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str()))
        .map(|i| json!({"type": "image", "source": {"type": "base64", "media_type": i.media_type, "data": i.data}})).collect();
    if !turn.text.is_empty() { content.push(json!({"type": "text", "text": turn.text})); }
    json!({"type": "user", "message": {"role": "user", "content": content}})
}

/// The blocks of an assistant message: text (not blank, unless it streamed already) and tool calls.
fn assistant(content: &Value, streamed: bool, out: &mut Vec<Event>) {
    for c in content.as_array().into_iter().flatten() {
        if c["type"] == "text" && !streamed { if let Some(t) = c["text"].as_str().filter(|t| !t.trim().is_empty()) { out.push(Event::Text { text: t.into(), delta: false }); } }
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

/// The parser of one process. With `--include-partial-messages` text and thinking arrive as `stream_event` deltas
/// first (the first piece of a block starts it, the next ones append), then the whole `assistant` message: its text
/// is skipped for a message that streamed, or it would show twice.
#[derive(Default)]
pub struct State {
    /// the message the deltas belong to, and the messages whose text streamed
    message: String,
    streamed: HashSet<String>,
    /// a text or thinking block began and has no piece yet
    fresh: bool,
}

impl State {
    /// A `stream_event` of the top-level conversation (a subagent's has a `parent_tool_use_id`, its message comes whole).
    fn delta(&mut self, ev: &Value, out: &mut Vec<Event>) {
        if !ev["parent_tool_use_id"].is_null() { return; }
        let e = &ev["event"];
        match e["type"].as_str().unwrap_or("") {
            "message_start" => self.message = e["message"]["id"].as_str().unwrap_or("").into(),
            "content_block_start" => self.fresh = true,
            "content_block_delta" => {
                let d = &e["delta"];
                let piece = |text: &str, this: &mut Self| { let delta = !this.fresh; this.fresh = false; (text.to_string(), delta) };
                if let Some(t) = d["text"].as_str().filter(|_| d["type"] == "text_delta") {
                    let (text, delta) = piece(t, self);
                    self.streamed.insert(self.message.clone());
                    out.push(Event::Text { text, delta });
                // a model that keeps its thinking to itself still streams empty thinking deltas
                } else if let Some(t) = d["thinking"].as_str().filter(|t| d["type"] == "thinking_delta" && !t.is_empty()) {
                    let (text, delta) = piece(t, self);
                    out.push(Event::Thinking { text, delta });
                }
            }
            _ => {}
        }
    }

    /// One stdout line of `claude -p --output-format stream-json --include-partial-messages`.
    pub fn parse(&mut self, line: &str) -> Vec<Event> {
        let Ok(ev) = serde_json::from_str::<Value>(line) else { return vec![] };
        let mut out = vec![];
        match ev["type"].as_str().unwrap_or("") {
            "stream_event" => self.delta(&ev, &mut out),
            "assistant" => {
                let streamed = ev["message"]["id"].as_str().is_some_and(|id| self.streamed.contains(id));
                assistant(&ev["message"]["content"], streamed, &mut out);
                if ev["parent_tool_use_id"].is_null() { out.extend(context(&ev["message"]["usage"])); }
            }
            _ => out = parse(&ev),
        }
        out
    }
}

fn parse(ev: &Value) -> Vec<Event> {
    let mut out = vec![];
    match ev["type"].as_str().unwrap_or("") {
        "system" if ev["subtype"] == "init" => {
            if let Some(id) = ev["session_id"].as_str() { out.push(Event::Session { id: id.into() }); }
            if let Some(m) = ev["model"].as_str() { out.push(Event::Resolved { model: m.into(), effort: None }); }
        }
        "conversation_reset" => out.push(Event::Reset),
        "system" if ev["subtype"] == "status" && ev["status"] == "compacting" => out.push(Event::Compacting),
        "system" if ev["subtype"] == "compact_boundary" => out.push(compacted(&ev["compact_metadata"], "pre_tokens", "post_tokens")),
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
            // ponytail: the largest window of the models that ran (a subagent may use another), the main model's in practice
            let window = ev["modelUsage"].as_object().and_then(|m| m.values().filter_map(|u| u["contextWindow"].as_u64()).max());
            if window.is_some() { out.push(Event::Context { used: None, window }); }
            out.push(Event::TurnEnd { ok, error, usage, duration_ms: ev["duration_ms"].as_u64() });
        }
        _ => {}
    }
    out
}

/// The context a message fills: everything it read plus what it wrote, which the next message reads as well.
fn context(usage: &Value) -> Option<Event> {
    let n = |k: &str| usage[k].as_u64().unwrap_or(0);
    let used = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens") + n("output_tokens");
    (used > 0).then_some(Event::Context { used: Some(used), window: None })
}

/// A `compact_boundary`'s metadata, whose keys are snake_case in stream-json and camelCase in the transcript.
fn compacted(m: &Value, pre: &str, post: &str) -> Event {
    Event::Compacted { trigger: m["trigger"].as_str().map(String::from), pre_tokens: m[pre].as_u64(), post_tokens: m[post].as_u64() }
}

/// Text the harness put in the user's turn: `<…>` lines, and a subagent's or teammate's message.
fn harness(t: &str) -> bool { t.starts_with('<') || t.starts_with("Another Claude session sent a message") }

/// One transcript line as history: the user's messages (not the harness's ones), Claude's blocks and the diffs of its edits.
pub fn history_line(e: &Value, out: &mut Vec<Event>) {
    if e["type"] == "system" && e["subtype"] == "compact_boundary" { return out.push(compacted(&e["compactMetadata"], "preTokens", "postTokens")); }
    if e["isCompactSummary"] == true { return; } // the summary Claude wrote for itself, not something the user said
    if (e["type"] != "user" && e["type"] != "assistant") || e["isSidechain"] == true || e["isMeta"] == true { return; }
    if let Some(at) = e["timestamp"].as_str() { out.push(Event::Time { at: at.into() }); }
    let c = &e["message"]["content"];
    if e["type"] == "assistant" { assistant(c, false, out); out.extend(context(&e["message"]["usage"])); return; }
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
    fn stream_json_to_events() {
        let mut st = State::default();
        let mut ev: Vec<Event> = STREAM.lines().flat_map(|l| st.parse(l)).collect();
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
    fn partial_messages_stream_and_the_whole_message_does_not_repeat_them() {
        let delta = |t: &str, d: Value, parent: Value| json!({"type": "stream_event", "parent_tool_use_id": parent, "event": {"type": t, "delta": d}}).to_string();
        let text = |s: &str| delta("content_block_delta", json!({"type": "text_delta", "text": s}), Value::Null);
        let start = json!({"type": "stream_event", "parent_tool_use_id": null, "event": {"type": "message_start", "message": {"id": "m1"}}}).to_string();
        let block = delta("content_block_start", json!({}), Value::Null);
        let whole = json!({"type": "assistant", "message": {"id": "m1", "content": [{"type": "text", "text": "Hallo daar"}, {"type": "tool_use", "id": "t1", "name": "Read", "input": {}}]}}).to_string();
        let mut st = State::default();
        let mut go = |l: &str| st.parse(l);
        assert_eq!(go(&start), vec![]);
        assert_eq!(go(&block), vec![]);
        assert_eq!(go(&delta("content_block_delta", json!({"type": "thinking_delta", "thinking": ""}), Value::Null)), vec![]);
        assert_eq!(go(&delta("content_block_delta", json!({"type": "thinking_delta", "thinking": "hm"}), Value::Null)), vec![Event::Thinking { text: "hm".into(), delta: false }]);
        assert_eq!(go(&delta("content_block_delta", json!({"type": "thinking_delta", "thinking": "m"}), Value::Null)), vec![Event::Thinking { text: "m".into(), delta: true }]);
        assert_eq!(go(&block), vec![]);
        assert_eq!(go(&text("Hallo")), vec![Event::Text { text: "Hallo".into(), delta: false }]);
        assert_eq!(go(&text(" daar")), vec![Event::Text { text: " daar".into(), delta: true }]);
        assert_eq!(go(&delta("content_block_delta", json!({"type": "text_delta", "text": "sub"}), json!("toolu_9"))), vec![]); // a subagent's
        let after = go(&whole);
        assert!(matches!(&after[..], [Event::ToolCall { name, .. }] if name == "Read")); // the text is not shown twice
        // a message that did not stream still shows its text
        assert!(matches!(&go(&whole.replace("m1", "m2"))[..], [Event::Text { delta: false, .. }, Event::ToolCall { .. }]));
    }

    #[test]
    fn compaction_and_context_from_the_real_cli() {
        // shapes as `claude -p --output-format stream-json` emitted them for a /compact (2026-10-05)
        let mut st = State::default();
        let mut go = |l: Value| st.parse(&l.to_string());
        let usage = json!({"input_tokens": 10, "cache_creation_input_tokens": 12947, "cache_read_input_tokens": 14160, "output_tokens": 6});
        let top = go(json!({"type": "assistant", "parent_tool_use_id": null, "message": {"id": "m1", "content": [], "usage": usage}}));
        assert_eq!(top, vec![Event::Context { used: Some(27123), window: None }]);
        // a subagent's message is not the conversation's context
        assert_eq!(go(json!({"type": "assistant", "parent_tool_use_id": "toolu_1", "message": {"id": "m2", "content": [], "usage": usage}})), vec![]);
        assert_eq!(go(json!({"type": "system", "subtype": "status", "status": "compacting"})), vec![Event::Compacting]);
        assert_eq!(go(json!({"type": "system", "subtype": "status", "status": null, "compact_result": "success"})), vec![]);
        assert_eq!(go(json!({"type": "system", "subtype": "compact_boundary", "compact_metadata": {"trigger": "manual", "pre_tokens": 27319, "post_tokens": 7963}})),
            vec![Event::Compacted { trigger: Some("manual".into()), pre_tokens: Some(27319), post_tokens: Some(7963) }]);
        let end = go(json!({"type": "result", "subtype": "success", "usage": {}, "modelUsage": {"claude-haiku-4-5-20251001": {"contextWindow": 200000}}}));
        assert_eq!(end[0], Event::Context { used: None, window: Some(200000) });
        assert!(matches!(end[1], Event::TurnEnd { ok: true, .. }));
    }

    #[test]
    fn a_transcript_shows_the_boundary_not_the_summary() {
        let mut out = vec![];
        for l in [
            json!({"type": "system", "subtype": "compact_boundary", "compactMetadata": {"trigger": "auto", "preTokens": 170000, "postTokens": 9000}}),
            json!({"type": "user", "isCompactSummary": true, "message": {"content": "This session is being continued from a previous conversation"}}),
            json!({"type": "assistant", "message": {"content": [], "usage": {"input_tokens": 5, "cache_read_input_tokens": 9000, "output_tokens": 20}}}),
        ] { history_line(&l, &mut out); }
        assert_eq!(out, vec![
            Event::Compacted { trigger: Some("auto".into()), pre_tokens: Some(170000), post_tokens: Some(9000) },
            Event::Context { used: Some(9025), window: None },
        ]);
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
