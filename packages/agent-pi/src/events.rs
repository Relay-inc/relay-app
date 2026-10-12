//! The events of `pi --mode rpc` (JSON lines on stdout) as the contract's events, and the turns the app sends.
//! Written against pi 0.85.1; tests/fixtures/rpc-live*.jsonl are live runs.

use agent_core::{Event, Turn, TurnUsage, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::HashSet;

/// A turn as the stdin lines for pi: `get_state` first (its answer carries the session id, which nothing else in
/// the output does), then the prompt. A prompt sent while pi is running is queued as a follow-up, not refused.
pub fn input(turn: &Turn) -> String {
    let images: Vec<Value> = turn.images.iter().filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str()))
        .map(|i| json!({"type": "image", "data": i.data, "mimeType": i.media_type})).collect();
    if let Some(args) = turn.text.strip_prefix("/compact").filter(|s| s.is_empty() || s.starts_with(char::is_whitespace)) {
        if turn.images.is_empty() {
            return format!("{}\n{}", json!({"type": "get_state"}), json!({"type": "compact", "customInstructions": args.trim()}));
        }
    }
    let mut prompt = json!({"type": "prompt", "message": turn.text, "streamingBehavior": "followUp"});
    if let Some(name) = turn.text.strip_prefix('/').and_then(|s| s.split_whitespace().next()) {
        prompt["id"] = json!(format!("relay-slash:{name}"));
    }
    if !images.is_empty() { prompt["images"] = json!(images); }
    let discovery = if prompt["id"].is_string() { format!("{}\n", json!({"type": "get_commands"})) } else { String::new() };
    format!("{}\n{discovery}{prompt}", json!({"type": "get_state"}))
}

/// pi's tool names as the canonical ones, and its `path` as the contract's `file_path`.
pub fn tool(name: &str, input: &Value) -> (String, Value) {
    let n = match name { "bash" => "Bash", "read" => "Read", "write" => "Write", "edit" => "Edit", "grep" => "Grep", "find" | "ls" => "Glob", _ => name };
    let mut input = input.clone();
    if let Some(o) = input.as_object_mut() {
        if matches!(n, "Read" | "Write" | "Edit") { if let Some(p) = o.remove("path") { o.insert("file_path".into(), p); } }
        if n == "Glob" && !o.contains_key("pattern") { if let Some(p) = o.get("path").cloned() { o.insert("pattern".into(), p); } }
    }
    (n.into(), input)
}

/// An assistant message's tokens as pi counts them: `output` includes the reasoning ones. The cost is pi's own,
/// from its model prices at API list prices; None where a model has no price (0).
pub fn tokens(usage: &Value) -> TurnUsage {
    let n = |k: &str| usage[k].as_u64().or_else(|| usage[k].as_f64().map(|f| f as u64)).unwrap_or(0);
    TurnUsage { input: n("input"), output: n("output"), cache_read: n("cacheRead"), cache_write: n("cacheWrite"),
        cost: usage["cost"]["total"].as_f64().filter(|c| *c > 0.0) }
}

/// The parser of one process. Text and thinking stream as deltas (the first piece starts the block); a block that
/// did not stream is shown whole when it ends. pi settles once for everything queued, so one turn end goes out for
/// every prompt it accepted.
#[derive(Default)]
pub struct State {
    session: Option<String>,
    extensions: HashSet<String>,
    running: bool,
    /// "text0", "thinking1": the blocks of this message that streamed
    streamed: HashSet<String>,
    called: HashSet<String>,
    /// prompts accepted and not yet answered by a settled run
    sent: u32,
    usage: TurnUsage,
    /// first and last message time of the run, epoch ms
    span: Option<(i64, i64)>,
    error: Option<String>,
}

impl State {
    fn call(&mut self, id: &str, name: &str, args: &Value, out: &mut Vec<Event>) {
        if !self.called.insert(id.into()) { return; }
        let (name, input) = tool(name, args);
        out.push(Event::ToolCall { id: id.into(), name, input });
    }

    fn end(&mut self, out: &mut Vec<Event>) {
        let u = std::mem::take(&mut self.usage);
        let error = self.error.take();
        let span = self.span.take();
        let used = u.input + u.output + u.cache_read + u.cache_write > 0;
        for i in 0..self.sent.max(1) {
            // every queued message's end is limited, as each one is spent and retried
            agent_core::limited(error.as_deref(), out);
            out.push(Event::TurnEnd { ok: error.is_none(), error: error.clone(), usage: (i == 0 && used).then(|| u.clone()),
                duration_ms: span.filter(|(a, b)| i == 0 && b > a).map(|(a, b)| (b - a) as u64) });
        }
        self.sent = 0;
        self.called.clear();
    }

    pub fn parse(&mut self, line: &str) -> Vec<Event> {
        let Ok(m) = serde_json::from_str::<Value>(line) else { return vec![] };
        let mut out = vec![];
        match m["type"].as_str().unwrap_or("") {
            "response" => match (m["command"].as_str().unwrap_or(""), m["success"] == true) {
                ("get_state", true) => {
                    let d = &m["data"];
                    if let Some(id) = d["sessionId"].as_str().filter(|i| self.session.as_deref() != Some(*i)) {
                        self.session = Some(id.into());
                        out.push(Event::Session { id: id.into() });
                    }
                    if let (Some(p), Some(id)) = (d["model"]["provider"].as_str(), d["model"]["id"].as_str()) {
                        out.push(Event::Resolved { model: format!("{p}/{id}"), effort: d["thinkingLevel"].as_str().map(Into::into) });
                    }
                }
                ("get_commands", true) => {
                    self.extensions = m["data"]["commands"].as_array().into_iter().flatten()
                        .filter(|c| c["source"] == "extension").filter_map(|c| c["name"].as_str().map(String::from)).collect();
                },
                ("compact", ok) => {
                    if let Some(summary) = m["data"]["summary"].as_str() { out.push(Event::Text { text: summary.into(), delta: false }); }
                    agent_core::limited(m["error"].as_str(), &mut out);
                    out.push(Event::TurnEnd { ok, error: m["error"].as_str().map(String::from), usage: None, duration_ms: None });
                },
                ("prompt", true) => {
                    let extension = m["id"].as_str().and_then(|id| id.strip_prefix("relay-slash:")).is_some_and(|name| self.extensions.contains(name));
                    if extension && !self.running {
                        out.push(Event::TurnEnd { ok: true, error: None, usage: None, duration_ms: None });
                    } else { self.sent += 1; }
                },
                // a prompt that was not accepted: no run is coming to end on its own
                ("prompt", false) => {
                    let text = m["error"].as_str().unwrap_or("pi refused the message").to_string();
                    out.push(Event::Error { text: text.clone() });
                    agent_core::limited(Some(&text), &mut out);
                    out.push(Event::TurnEnd { ok: false, error: Some(text), usage: None, duration_ms: None });
                }
                _ => {}
            },
            "agent_start" => { self.running = true; out.push(Event::Working); },
            "message_start" => self.streamed.clear(),
            "message_update" => {
                let e = &m["assistantMessageEvent"];
                let kind = e["type"].as_str().unwrap_or("");
                let key = format!("{}{}", kind.split('_').next().unwrap_or(""), e["contentIndex"]);
                let piece = |text: &str, delta: bool| if kind.starts_with("text") { Event::Text { text: text.into(), delta } } else { Event::Thinking { text: text.into(), delta } };
                match kind {
                    "text_delta" | "thinking_delta" => {
                        let first = self.streamed.insert(key);
                        if let Some(d) = e["delta"].as_str().filter(|d| !d.is_empty()) { out.push(piece(d, !first)); }
                    }
                    "text_end" | "thinking_end" => if self.streamed.insert(key) {
                        if let Some(t) = e["content"].as_str().filter(|t| !t.is_empty()) { out.push(piece(t, false)); }
                    },
                    "toolcall_end" => {
                        let c = &e["toolCall"];
                        self.call(c["id"].as_str().unwrap_or(""), c["name"].as_str().unwrap_or(""), &c["arguments"], &mut out);
                    }
                    _ => {}
                }
            }
            "message_end" => {
                let msg = &m["message"];
                if let Some(t) = msg["timestamp"].as_i64() { self.span = Some(self.span.map_or((t, t), |(a, b)| (a.min(t), b.max(t)))); }
                if msg["role"] == "assistant" {
                    let u = tokens(&msg["usage"]);
                    self.usage.input += u.input; self.usage.output += u.output; self.usage.cache_read += u.cache_read; self.usage.cache_write += u.cache_write;
                    if let Some(c) = u.cost { self.usage.cost = Some(self.usage.cost.unwrap_or(0.0) + c); }
                    // a failed message, until a later one (a retry) succeeds
                    self.error = match msg["stopReason"].as_str() {
                        Some("error") => Some(msg["errorMessage"].as_str().unwrap_or("pi error").to_string()),
                        Some("aborted") => Some(msg["errorMessage"].as_str().unwrap_or("Aborted").to_string()),
                        _ => None,
                    };
                    // calls that never streamed
                    for c in msg["content"].as_array().into_iter().flatten().filter(|c| c["type"] == "toolCall") {
                        self.call(c["id"].as_str().unwrap_or(""), c["name"].as_str().unwrap_or(""), &c["arguments"], &mut out);
                    }
                }
            }
            "tool_execution_end" => out.push(Event::ToolResult { id: m["toolCallId"].as_str().unwrap_or("").into(), error: m["isError"] == true, output: None }),
            "agent_settled" => { self.running = false; self.end(&mut out); },
            _ => {}
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(fixture: &str) -> Vec<Event> {
        let mut st = State::default();
        fixture.lines().flat_map(|l| st.parse(l)).collect()
    }
    fn text(ev: &[Event]) -> String {
        ev.iter().filter_map(|e| if let Event::Text { text, .. } = e { Some(text.as_str()) } else { None }).collect()
    }
    fn calls(ev: &[Event]) -> Vec<(&str, &Value, &str)> {
        ev.iter().filter_map(|e| if let Event::ToolCall { name, input, id } = e { Some((name.as_str(), input, id.as_str())) } else { None }).collect()
    }

    #[test]
    fn a_refused_prompt_with_a_limit_text_is_a_limited_event() {
        let ev = State::default().parse(r#"{"type":"response","command":"prompt","success":false,"error":"You've hit your usage limit"}"#);
        assert!(matches!(&ev[..], [Event::Error { .. }, Event::TurnLimited, Event::TurnEnd { ok: false, .. }]), "{ev:?}");
    }

    #[test]
    fn every_queued_message_ends_limited() {
        let mut st = State { sent: 2, error: Some("You've hit your usage limit".into()), ..State::default() };
        let mut ev = vec![];
        st.end(&mut ev);
        assert!(matches!(&ev[..], [Event::TurnLimited, Event::TurnEnd { .. }, Event::TurnLimited, Event::TurnEnd { .. }]), "{ev:?}");
    }

    #[test]
    fn slash_compaction_and_extension_completion() {
        let compact = input(&Turn { text: "/compact keep decisions".into(), images: vec![] });
        let command: Value = serde_json::from_str(compact.lines().last().unwrap()).unwrap();
        assert_eq!(command, json!({"type": "compact", "customInstructions": "keep decisions"}));
        let mut st = State::default();
        let ev = st.parse(r#"{"type":"response","command":"compact","success":true,"data":{"summary":"Summary"}}"#);
        assert!(matches!(ev.last(), Some(Event::TurnEnd { ok: true, .. })));
        st.parse(r#"{"type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"hello","source":"extension"}]}}"#);
        let ev = st.parse(r#"{"type":"response","command":"prompt","id":"relay-slash:hello","success":true}"#);
        assert!(matches!(ev.last(), Some(Event::TurnEnd { ok: true, .. })));
        st.parse(r#"{"type":"agent_start"}"#);
        assert!(st.parse(r#"{"type":"response","command":"prompt","id":"relay-slash:hello","success":true}"#).is_empty());
        assert!(matches!(st.parse(r#"{"type":"agent_settled"}"#).last(), Some(Event::TurnEnd { ok: true, .. })));
    }

    #[test]
    fn a_live_turn_with_a_command() {
        let ev = run(include_str!("../tests/fixtures/rpc-live.jsonl"));
        assert!(matches!(&ev[0], Event::Session { id } if id == "0198aaaa-bbbb-cccc-dddd-000000000010"));
        // the prompt itself is not echoed
        assert_eq!(text(&ev), "done");
        let c = calls(&ev);
        assert_eq!((c[0].0, c[0].1["command"].as_str()), ("Bash", Some("echo hi")));
        assert!(ev.contains(&Event::ToolResult { id: c[0].2.into(), error: false, output: None }));
        // one turn end, the two model calls' tokens summed, priced by pi
        let ends: Vec<&Event> = ev.iter().filter(|e| matches!(e, Event::TurnEnd { .. })).collect();
        assert_eq!(ends.len(), 1);
        let Event::TurnEnd { ok, usage: Some(u), duration_ms, .. } = ends[0] else { panic!() };
        assert!(*ok);
        assert_eq!((u.input, u.output, u.cache_read, u.cache_write), (1800 + 296, 19 + 5, 1536, 0));
        assert!((u.cost.unwrap() - (0.00957 + 0.002398)).abs() < 1e-9);
        assert_eq!(*duration_ms, Some(1790888124015 - 1790888122356));
        assert!(matches!(ev.last(), Some(Event::TurnEnd { .. })));
    }

    #[test]
    fn a_resumed_session_and_the_file_tools() {
        let ev = run(include_str!("../tests/fixtures/rpc-live-resume.jsonl"));
        assert_eq!(text(&ev), "hi");
        // the first piece of a streamed block starts it, the rest is appended
        assert!(ev.iter().any(|e| matches!(e, Event::Text { delta: false, .. })));
        let ev = run(include_str!("../tests/fixtures/rpc-live-tools.jsonl"));
        let c = calls(&ev);
        assert_eq!(c.iter().map(|c| c.0).collect::<Vec<_>>(), ["Write", "Edit", "Read"]);
        assert_eq!((c[0].1["file_path"].as_str(), c[0].1["content"].as_str()), (Some("note.txt"), Some("hello")));
        assert_eq!(c[1].1["edits"][0]["newText"], "world");
        assert!(c.iter().all(|c| ev.contains(&Event::ToolResult { id: c.2.into(), error: false, output: None })));
        assert_eq!(text(&ev), "world");
        assert_eq!(ev.iter().filter(|e| matches!(e, Event::TurnEnd { .. })).count(), 1);
    }

    #[test]
    fn a_failed_turn() {
        let ev = run(include_str!("../tests/fixtures/rpc-live-error.jsonl"));
        let Some(Event::TurnEnd { ok: false, error: Some(e), usage: None, .. }) = ev.last() else { panic!("{ev:?}") };
        assert!(e.contains("out of extra usage"));
        assert_eq!(ev.iter().filter(|e| matches!(e, Event::TurnEnd { .. })).count(), 1);
        // a refused prompt ends its turn at once; a later successful message clears a failed one
        let mut st = State::default();
        let ev = st.parse(r#"{"type":"response","command":"prompt","success":false,"error":"Agent is already processing"}"#);
        assert!(matches!(&ev[1], Event::TurnEnd { ok: false, error: Some(e), .. } if e == "Agent is already processing"));
        st.parse(r#"{"type":"message_end","message":{"role":"assistant","content":[],"usage":{},"stopReason":"error","errorMessage":"529"}}"#);
        st.parse(r#"{"type":"message_end","message":{"role":"assistant","content":[],"usage":{},"stopReason":"stop"}}"#);
        assert!(matches!(&st.parse(r#"{"type":"agent_settled"}"#)[..], [Event::TurnEnd { ok: true, .. }]));
    }

    /// Two prompts, the second sent while the first ran: pi settles once, the app is owed two turn ends.
    #[test]
    fn queued_prompts_end_one_turn_each() {
        let ev = run(include_str!("../tests/fixtures/rpc-live-queued.jsonl"));
        let ends: Vec<&Event> = ev.iter().filter(|e| matches!(e, Event::TurnEnd { .. })).collect();
        assert_eq!(ends.len(), 2);
        assert!(matches!(ends[0], Event::TurnEnd { ok: true, usage: Some(_), .. }) && matches!(ends[1], Event::TurnEnd { ok: true, usage: None, .. }));
        assert!(text(&ev).ends_with("second"));
    }

    #[test]
    fn deltas_whole_blocks_and_input() {
        let mut st = State::default();
        let mut go = |l: &str| st.parse(l);
        let up = |e: Value| json!({"type": "message_update", "assistantMessageEvent": e}).to_string();
        assert_eq!(go(&up(json!({"type": "thinking_delta", "contentIndex": 0, "delta": "hm"}))), [Event::Thinking { text: "hm".into(), delta: false }]);
        assert_eq!(go(&up(json!({"type": "thinking_delta", "contentIndex": 0, "delta": "m"}))), [Event::Thinking { text: "m".into(), delta: true }]);
        // not streamed: whole at its end; streamed: nothing again
        assert_eq!(go(&up(json!({"type": "text_end", "contentIndex": 1, "content": "ok"}))), [Event::Text { text: "ok".into(), delta: false }]);
        assert!(go(&up(json!({"type": "thinking_end", "contentIndex": 0, "content": "hmm"}))).is_empty());
        // a call that only shows in the finished message
        let ev = go(r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"find","arguments":{"pattern":"*.rs","path":"src"}}],"usage":{},"stopReason":"toolUse"}}"#);
        assert_eq!(ev, [Event::ToolCall { id: "c1".into(), name: "Glob".into(), input: json!({"pattern": "*.rs", "path": "src"}) }]);
        assert_eq!(tool("ls", &json!({"path": "/a"})).1["pattern"], "/a");

        let lines = input(&Turn { text: "hoi".into(), images: vec![agent_core::Image { media_type: "image/png".into(), data: "AAA".into() }, agent_core::Image { media_type: "image/bmp".into(), data: "B".into() }] });
        let l: Vec<Value> = lines.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(l[0], json!({"type": "get_state"}));
        assert_eq!(l[1], json!({"type": "prompt", "message": "hoi", "streamingBehavior": "followUp", "images": [{"type": "image", "data": "AAA", "mimeType": "image/png"}]}));
    }
}
