//! The Agent Client Protocol (JSON-RPC 2.0 over stdio, protocol version 1, as `agy acp` 1.5 speaks it) as the
//! contract's events, the turns the app sends and the answers to its permission requests. bridge.rs does the handshake
//! and fills in the session id. The same parser reads the session log bridge.rs keeps, as history ([`State::history`]).

use agent_core::{pending::Request, Event, Hunk, Image, Turn, TurnUsage, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

/// The plan the last session was opened on ("Antigravity Starter Quota"), as `session/new` names it.
pub static TIER: Mutex<Option<String>> = Mutex::new(None);

/// A turn as `session/prompt`; bridge.rs fills in `sessionId` and the request id. Images go inline as base64.
pub fn prompt(turn: &Turn) -> Value {
    let mut blocks = vec![json!({"type": "text", "text": turn.text})];
    for i in turn.images.iter().filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str())) {
        blocks.push(json!({"type": "image", "mimeType": i.media_type, "data": i.data}));
    }
    json!({"jsonrpc": "2.0", "method": "session/prompt", "params": {"sessionId": "", "prompt": blocks}})
}

/// The JSON-RPC response to a `session/request_permission` raised as [`Event::Permission`]: the option the agent
/// offered for allowing or refusing once, by its own id. Without such an option the request is cancelled.
pub fn respond(req: &Request, decision: &Value) -> Option<String> {
    let ask: Value = serde_json::from_str(req.request_id.as_deref()?).ok()?;
    let option = &ask[if decision["behavior"] == "allow" { "allow" } else { "deny" }];
    let outcome = if option.is_string() { json!({"outcome": "selected", "optionId": option}) } else { json!({"outcome": "cancelled"}) };
    Some(json!({"jsonrpc": "2.0", "id": ask["id"], "result": {"outcome": outcome}}).to_string())
}

/// A tool call in the canonical names where they match. Antigravity's own tools by name, anything else by the
/// protocol's `kind` when it names a file, else as it is.
fn tool(call: &Value) -> (String, Value) {
    let args = if call["rawInput"].is_object() { &call["rawInput"] } else { &call["args"] };
    let path = || args["Path"].as_str().or_else(|| call["locations"][0]["path"].as_str()).unwrap_or("").to_string();
    let name = call["name"].as_str().unwrap_or("");
    match (name, call["kind"].as_str().unwrap_or("")) {
        ("read_file", _) => ("Read".into(), json!({"file_path": path()})),
        ("write_file", _) => ("Write".into(), json!({"file_path": path(), "content": args["Content"]})),
        ("edit_file", _) => ("Edit".into(), json!({"file_path": path(), "old_string": args["Target"], "new_string": args["Replacement"]})),
        ("run_command", _) => ("Bash".into(), json!({"command": args["CommandLine"], "description": args["toolSummary"]})),
        (_, "edit") if !path().is_empty() => ("Edit".into(), json!({"file_path": path()})),
        (_, "read") if !path().is_empty() => ("Read".into(), json!({"file_path": path()})),
        _ => (if name.is_empty() { call["title"].as_str().unwrap_or("tool").to_string() } else { name.to_string() }, args.clone()),
    }
}

/// The change between two versions of a file as one hunk, with three lines around it.
// ponytail: one hunk from the first changed line to the last, so two far-apart edits show what lies between as
// changed too. A real line diff when a tool reports several edits at once
pub fn hunks(old: &str, new: &str) -> Vec<Hunk> {
    let (a, b): (Vec<&str>, Vec<&str>) = (old.lines().collect(), new.lines().collect());
    let head = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let tail = a[head..].iter().rev().zip(b[head..].iter().rev()).take_while(|(x, y)| x == y).count();
    if head == a.len() && head == b.len() { return vec![]; }
    let (from, a_end, b_end) = (head.saturating_sub(3), a.len() - tail, b.len() - tail);
    let mut lines: Vec<String> = a[from..head].iter().map(|l| format!(" {l}")).collect();
    lines.extend(a[head..a_end].iter().map(|l| format!("-{l}")));
    lines.extend(b[head..b_end].iter().map(|l| format!("+{l}")));
    lines.extend(a[a_end..(a_end + 3).min(a.len())].iter().map(|l| format!(" {l}")));
    vec![Hunk { old_start: from as u64 + 1, new_start: from as u64 + 1, lines }]
}

/// What a command printed, without the times and exit line `run_command` puts in front of it.
fn output(raw: &str) -> &str { raw.split_once("Command output:\n").map_or(raw, |(_, o)| o) }

fn tokens(u: &Value) -> Option<TurnUsage> {
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    // inputTokens is without the cached ones, outputTokens includes the thinking
    u.is_object().then(|| TurnUsage { input: n("inputTokens"), output: n("outputTokens"), cache_read: n("cachedReadTokens"), cache_write: n("cachedWriteTokens"), cost: None })
}

/// The parser of one process, or of one read of a session log.
#[derive(Default)]
pub struct State {
    /// Reading a session log: the user's prompts are events, text comes as whole blocks, and nothing is asked or metered.
    history: bool,
    session: Option<String>,
    /// Live: whether the last piece was thinking, so the next one of the same kind is a delta.
    last: Option<bool>,
    /// History: the block being put together.
    block: Option<(bool, String)>,
    /// Tool calls seen, true once their result is out.
    calls: HashMap<String, bool>,
}

impl State {
    pub fn history() -> Self { State { history: true, ..Default::default() } }

    /// The block still open at the end of a history read.
    pub fn finish(&mut self) -> Vec<Event> {
        self.last = None;
        self.block.take().filter(|(_, t)| !t.trim().is_empty())
            .map(|(thinking, text)| if thinking { Event::Thinking { text, delta: false } } else { Event::Text { text, delta: false } }).into_iter().collect()
    }

    fn piece(&mut self, text: &str, thinking: bool, out: &mut Vec<Event>) {
        if text.is_empty() { return; }
        if self.history {
            if self.block.as_ref().is_some_and(|(t, _)| *t != thinking) { out.extend(self.finish()); }
            self.block.get_or_insert((thinking, String::new())).1.push_str(text);
            return;
        }
        let delta = self.last == Some(thinking);
        self.last = Some(thinking);
        out.push(if thinking { Event::Thinking { text: text.into(), delta } } else { Event::Text { text: text.into(), delta } });
    }

    fn tool_update(&mut self, u: &Value, out: &mut Vec<Event>) {
        let Some(id) = u["toolCallId"].as_str().filter(|i| !i.is_empty()) else { return };
        if !self.calls.contains_key(id) {
            let (name, input) = tool(u);
            self.calls.insert(id.into(), false);
            out.push(Event::ToolCall { id: id.into(), name, input });
        }
        let status = u["status"].as_str().unwrap_or("");
        if !matches!(status, "completed" | "failed") || self.calls.get(id) == Some(&true) { return; }
        self.calls.insert(id.into(), true);
        for c in u["content"].as_array().into_iter().flatten().filter(|c| c["type"] == "diff") {
            if let (Some(old), Some(new)) = (c["oldText"].as_str(), c["newText"].as_str()) {
                let h = hunks(old, new);
                if !h.is_empty() { out.push(Event::Patch { id: id.into(), hunks: h }); }
            }
        }
        if let Some(o) = u["rawOutput"]["output"].as_str().map(output).filter(|o| !o.trim().is_empty()) { out.push(Event::ToolOutput { id: id.into(), text: o.into() }); }
        out.push(Event::ToolResult { id: id.into(), error: status == "failed" });
    }

    pub fn parse(&mut self, line: &str) -> Vec<Event> {
        let Ok(m) = serde_json::from_str::<Value>(line) else { return vec![] };
        let mut out = vec![];
        let p = &m["params"];
        let Some(method) = m["method"].as_str() else {
            // a response: the session bridge.rs opened, a turn that ended, or an error
            out.extend(self.finish());
            let r = &m["result"];
            if let Some(e) = m.get("error") {
                let text = e["message"].as_str().unwrap_or("Antigravity error").to_string();
                out.push(Event::Error { text: text.clone() });
                agent_core::limited(Some(&text), &mut out);
                out.push(Event::TurnEnd { ok: false, error: Some(text), usage: None, duration_ms: None });
            }
            if let Some(id) = r["sessionId"].as_str().filter(|i| !i.is_empty() && self.session.as_deref() != Some(i)) {
                self.session = Some(id.into());
                out.push(Event::Session { id: id.into() });
                if let Some(model) = r["models"]["currentModelId"].as_str() { out.push(Event::Resolved { model: model.into(), effort: None }); }
                if let (false, Some(t)) = (self.history, r["_meta"]["antigravity"]["tier"]["name"].as_str()) { *TIER.lock().unwrap() = Some(t.into()); }
            }
            if let Some(stop) = r["stopReason"].as_str() {
                let ok = matches!(stop, "end_turn" | "cancelled");
                let error = (!ok).then(|| stop.to_string());
                agent_core::limited(error.as_deref(), &mut out);
                out.push(Event::TurnEnd { ok, error, usage: tokens(&r["usage"]), duration_ms: None });
            }
            return out;
        };
        let u = &p["update"];
        match (method, u["sessionUpdate"].as_str().unwrap_or("")) {
            // the app's own prompt, as bridge.rs logged it with its time
            ("session/prompt", _) if self.history => {
                out.extend(self.finish());
                let blocks = p["prompt"].as_array().cloned().unwrap_or_default();
                let text: Vec<&str> = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).map(agent_core::envelope::strip).collect();
                let images = blocks.iter().filter(|b| b["type"] == "image").map(|b| {
                    let mt = b["mimeType"].as_str().unwrap_or("");
                    IMAGE_TYPES.contains(&mt).then(|| Image { media_type: mt.into(), data: b["data"].as_str().unwrap_or("").into() })
                }).collect();
                if let Some(at) = m["at"].as_str() { out.push(Event::Time { at: at.into() }); }
                out.push(Event::User { text: text.join("\n"), images });
            }
            ("session/update", "agent_message_chunk") => self.piece(u["content"]["text"].as_str().unwrap_or(""), false, &mut out),
            ("session/update", "agent_thought_chunk") => self.piece(u["content"]["text"].as_str().unwrap_or(""), true, &mut out),
            ("session/update", "tool_call" | "tool_call_update") => { out.extend(self.finish()); self.tool_update(u, &mut out); }
            ("session/update", "usage_update") if !self.history => out.push(Event::Context { used: u["used"].as_u64(), window: u["size"].as_u64() }),
            ("session/update", "available_commands_update") if !self.history => {
                let commands: Vec<Value> = u["availableCommands"].as_array().into_iter().flatten().filter(|c| c["name"].is_string())
                    .map(|c| json!({"name": c["name"], "description": c["description"].as_str().unwrap_or("")})).collect();
                out.push(Event::Commands { commands: commands.into() });
            }
            ("session/request_permission", _) if !self.history && m.get("id").is_some() => {
                let call = &p["toolCall"];
                let (name, mut input) = tool(call);
                // an edit's card shows what changes: the request carries it, the call's arguments may not
                if let Some(d) = call["content"].as_array().into_iter().flatten().find(|c| c["type"] == "diff") {
                    if name == "Edit" && input["old_string"].is_null() { input["old_string"] = d["oldText"].clone(); input["new_string"] = d["newText"].clone(); }
                }
                let option = |kind: &str| p["options"].as_array().into_iter().flatten().find(|o| o["kind"] == kind).map(|o| o["optionId"].clone()).unwrap_or(Value::Null);
                let mut r = Request::new("tool", &name, input);
                r.tool_use_id = call["toolCallId"].as_str().map(String::from);
                r.request_id = Some(json!({"id": m["id"], "allow": option("allow_once"), "deny": option("reject_once")}).to_string());
                out.push(Event::Permission { request: r });
            }
            _ => {}
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const LIVE: &str = include_str!("../tests/fixtures/acp-live.jsonl");

    #[test]
    fn a_live_session_as_events() {
        let mut st = State::default();
        let ev: Vec<Event> = LIVE.lines().flat_map(|l| st.parse(l)).collect();
        assert_eq!(ev[0], Event::Session { id: "7a64a414-9c82-4b94-a9d5-7c0711db227f".into() });
        assert_eq!(ev[1], Event::Resolved { model: "gemini-3.8-flash-high".into(), effort: None });
        assert_eq!(TIER.lock().unwrap().as_deref(), Some("Antigravity Starter Quota"));
        let names: Vec<&str> = ev.iter().filter_map(|e| if let Event::ToolCall { name, .. } = e { Some(name.as_str()) } else { None }).collect();
        assert_eq!(names, ["Read", "Bash", "Edit", "Bash", "Write"]);
        // one call and one result per tool, whatever the number of updates
        let results: Vec<bool> = ev.iter().filter_map(|e| if let Event::ToolResult { error, .. } = e { Some(*error) } else { None }).collect();
        assert_eq!(results, [false, false, false, false, true]); // the refused write failed
        let Some(Event::ToolCall { input, .. }) = ev.iter().find(|e| matches!(e, Event::ToolCall { name, .. } if name == "Edit")) else { panic!() };
        assert_eq!(*input, json!({"file_path": "/tmp/agy-probe/ws4/notes.md", "old_string": "beta", "new_string": "BETA"}));
        let Some(Event::Patch { hunks, .. }) = ev.iter().find(|e| matches!(e, Event::Patch { .. })) else { panic!("no patch") };
        assert_eq!(hunks[0].lines, [" alpha", "-beta", "+BETA", " gamma"]);
        assert!(ev.iter().any(|e| matches!(e, Event::ToolOutput { text, .. } if text.contains("./other.txt:1:one"))));
        // every command and change asked for, answered by the option ids the agent offered
        let asks: Vec<&Request> = ev.iter().filter_map(|e| if let Event::Permission { request } = e { Some(request) } else { None }).collect();
        assert_eq!(asks.iter().map(|r| r.tool_name.as_str()).collect::<Vec<_>>(), ["Bash", "Edit", "Bash", "Write"]);
        assert!(asks.iter().all(|r| r.relay && r.kind == "tool" && r.tool_use_id.is_some()));
        assert_eq!(asks[0].input["command"], "grep -rn \"one\" .");
        let a: Value = serde_json::from_str(&respond(asks[0], &json!({"behavior": "allow", "updatedInput": {}})).unwrap()).unwrap();
        assert_eq!(a, json!({"jsonrpc": "2.0", "id": "1", "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}}));
        let d: Value = serde_json::from_str(&respond(asks[3], &json!({"behavior": "deny", "message": "no"})).unwrap()).unwrap();
        assert_eq!(d["result"]["outcome"], json!({"outcome": "selected", "optionId": "deny"}));
        // text streams: the first piece starts the block, the rest are deltas
        let text: String = ev.iter().filter_map(|e| if let Event::Text { text, .. } = e { Some(text.as_str()) } else { None }).collect();
        assert!(text.contains("the secret word is hazelnut"), "{text}");
        assert!(ev.iter().any(|e| matches!(e, Event::Text { delta: true, .. })) && ev.iter().any(|e| matches!(e, Event::Thinking { .. })));
        let ends: Vec<&Event> = ev.iter().filter(|e| matches!(e, Event::TurnEnd { .. })).collect();
        let Event::TurnEnd { ok: true, error: None, usage: Some(u), .. } = ends[0] else { panic!("{:?}", ends[0]) };
        assert_eq!((u.input, u.output, u.cache_read), (19840, 2535, 32185));
        assert_eq!(ends.len(), 2);
        assert!(ev.iter().any(|e| matches!(e, Event::Context { used: Some(_), window: Some(1048576) })));
        assert!(ev.iter().any(|e| matches!(e, Event::Commands { commands } if commands.as_array().is_some_and(|c| c.iter().any(|x| x["name"] == "compact")))));
    }

    #[test]
    fn the_same_lines_as_history() {
        let mut st = State::history();
        let logged = [
            json!({"jsonrpc": "2.0", "id": 11, "method": "session/prompt", "at": "2026-11-21T00:10:00.000Z", "params": {"sessionId": "s", "prompt": [
                {"type": "text", "text": "<relay-project>This conversation is about the vault project \"X\".</relay-project>\n\nhoi"}, {"type": "image", "mimeType": "image/png", "data": "AA=="}]}}),
            json!({"method": "session/update", "params": {"update": {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "Even "}}}}),
            json!({"method": "session/update", "params": {"update": {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "denken"}}}}),
            json!({"method": "session/update", "params": {"update": {"sessionUpdate": "usage_update", "used": 5, "size": 10}}}),
            json!({"id": "1", "method": "session/request_permission", "params": {"toolCall": {"toolCallId": "c1", "name": "run_command", "rawInput": {"CommandLine": "ls"}}, "options": []}}),
            json!({"method": "session/update", "params": {"update": {"sessionUpdate": "tool_call_update", "toolCallId": "c1", "name": "run_command", "status": "completed", "rawInput": {"CommandLine": "ls"}}}}),
            json!({"method": "session/update", "params": {"update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Kl"}}}}),
            json!({"method": "session/update", "params": {"update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "aar."}}}}),
        ];
        let mut ev: Vec<Event> = logged.iter().flat_map(|l| st.parse(&l.to_string())).collect();
        ev.extend(st.finish());
        assert_eq!(ev, [
            Event::Time { at: "2026-11-21T00:10:00.000Z".into() },
            Event::User { text: "hoi".into(), images: vec![Some(Image { media_type: "image/png".into(), data: "AA==".into() })] },
            Event::Thinking { text: "Even denken".into(), delta: false },
            Event::ToolCall { id: "c1".into(), name: "Bash".into(), input: json!({"command": "ls", "description": null}) },
            Event::ToolResult { id: "c1".into(), error: false },
            Event::Text { text: "Klaar.".into(), delta: false },
        ]);
        // live, the app's own prompt is no event
        assert!(State::default().parse(&logged[0].to_string()).is_empty());
    }

    #[test]
    fn turns_answers_and_errors() {
        let t = Turn { text: "kijk".into(), images: vec![Image { media_type: "image/png".into(), data: "AA==".into() }, Image { media_type: "text/html".into(), data: "x".into() }] };
        let m = prompt(&t);
        assert_eq!(m["params"], json!({"sessionId": "", "prompt": [{"type": "text", "text": "kijk"}, {"type": "image", "mimeType": "image/png", "data": "AA=="}]}));
        // an agent that offers no way to refuse: the request is cancelled
        let mut r = Request::new("tool", "Bash", json!({}));
        r.request_id = Some(json!({"id": 7, "allow": "yes", "deny": null}).to_string());
        let a: Value = serde_json::from_str(&respond(&r, &json!({"behavior": "deny", "message": "no"})).unwrap()).unwrap();
        assert_eq!(a, json!({"jsonrpc": "2.0", "id": 7, "result": {"outcome": {"outcome": "cancelled"}}}));
        r.request_id = None;
        assert!(respond(&r, &json!({"behavior": "allow"})).is_none());
        // a refused turn, and one stopped for its length
        let ev = State::default().parse(&json!({"id": 12, "error": {"code": -32000, "message": "You've hit your usage limit"}}).to_string());
        assert!(matches!(&ev[..], [Event::Error { .. }, Event::TurnLimited, Event::TurnEnd { ok: false, .. }]), "{ev:?}");
        let ev = State::default().parse(&json!({"id": 12, "result": {"stopReason": "max_tokens"}}).to_string());
        assert_eq!(ev, [Event::TurnEnd { ok: false, error: Some("max_tokens".into()), usage: None, duration_ms: None }]);
    }

    #[test]
    fn one_hunk_around_the_change() {
        assert!(hunks("a\nb\n", "a\nb\n").is_empty());
        let h = hunks("1\n2\n3\n4\n5\n6\n7\n8\n9\n", "1\n2\n3\n4\nfive\n6\n7\n8\n9\n");
        assert_eq!((h[0].old_start, h[0].new_start), (2, 2));
        assert_eq!(h[0].lines, [" 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8"]);
        assert_eq!(hunks("a\n", "a\nb\n")[0].lines, [" a", "+b"]);
        assert_eq!(hunks("a\nb\n", "b\n")[0].lines, ["-a", " b"]);
    }
}
