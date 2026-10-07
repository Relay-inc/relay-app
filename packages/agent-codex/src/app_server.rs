//! `codex app-server` (JSON-RPC 2.0 over stdio, v2 protocol of codex-cli 0.159) as the contract's events, the turns
//! the app sends, and the answers to its approval requests. bridge.rs does the handshake and fills in the thread id.

use agent_core::{pending::Request, Event, Turn, TurnUsage, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

/// The newest rate limits an app-server pushed (`account/rateLimits/updated`): epoch ms and the snapshot.
pub static LIVE_LIMITS: Mutex<Option<(i64, Value)>> = Mutex::new(None);

/// A turn as `turn/start`; bridge.rs fills in `threadId` (and the model and effort it was started with).
/// Images go inline as data URLs.
pub fn turn_start(turn: &Turn) -> Value {
    let mut input: Vec<Value> = vec![];
    if !turn.text.is_empty() { input.push(json!({"type": "text", "text": turn.text, "text_elements": []})); }
    for i in turn.images.iter().filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str())) {
        input.push(json!({"type": "image", "url": format!("data:{};base64,{}", i.media_type, i.data)}));
    }
    json!({"method": "turn/start", "params": {"threadId": "", "input": input}})
}

/// The request id as it goes in `tool_use_id`: which protocol (v2 item/*, v1 execCommand/applyPatch) and the JSON id.
fn ask_id(v2: bool, id: &Value) -> String { format!("{}:{id}", if v2 { "v2" } else { "v1" }) }

/// The JSON-RPC response to an approval request raised as [`Event::Permission`].
pub fn respond(req: &Request, decision: &Value) -> Option<String> {
    let (proto, id) = req.tool_use_id.as_deref()?.split_once(':')?;
    let id: Value = serde_json::from_str(id).ok()?;
    let allow = decision["behavior"] == "allow";
    let d = match (proto, allow) {
        ("v2", true) => json!("accept"),
        ("v2", false) => json!("decline"),
        ("v1", true) => json!("approved"),
        ("v1", false) => json!({"denied": {"rejection": decision["message"].as_str().unwrap_or("")}}),
        _ => return None,
    };
    Some(json!({"id": id, "result": {"decision": d}}).to_string())
}

fn tokens(b: &Value) -> TurnUsage {
    let n = |k: &str| b[k].as_u64().unwrap_or(0);
    // inputTokens includes the cached ones
    TurnUsage { input: n("inputTokens").saturating_sub(n("cachedInputTokens") + n("cacheWriteInputTokens")), output: n("outputTokens"),
        cache_read: n("cachedInputTokens"), cache_write: n("cacheWriteInputTokens"), cost: None }
}

/// A thread item as a tool call, in the canonical names where they match.
fn tool_call(item: &Value) -> Option<(String, Value)> {
    let s = |k: &str| item[k].as_str().unwrap_or("").to_string();
    Some(match item["type"].as_str()? {
        "commandExecution" => ("Bash".into(), json!({"command": s("command"), "cwd": s("cwd")})),
        "fileChange" => {
            let ch = item["changes"].as_array().cloned().unwrap_or_default();
            let add = !ch.is_empty() && ch.iter().all(|c| c["kind"]["type"] == "add");
            let path = ch.first().map(|c| c["path"].clone()).unwrap_or(Value::Null);
            let diff: Vec<&str> = ch.iter().filter_map(|c| c["diff"].as_str()).collect();
            (if add { "Write" } else { "Edit" }.into(), json!({"file_path": path, "files": ch.len(), "diff": diff.join("\n")}))
        }
        "mcpToolCall" => (format!("mcp__{}__{}", s("server"), s("tool")), item["arguments"].clone()),
        "webSearch" => ("WebSearch".into(), json!({"query": s("query")})),
        _ => return None,
    })
}
fn failed(item: &Value) -> bool {
    matches!(item["status"].as_str(), Some("failed" | "declined")) || item["exitCode"].as_i64().is_some_and(|c| c != 0) || !item["error"].is_null()
}

/// The parser of one process: streamed items become one block each (the first piece starts it, the rest are deltas).
#[derive(Default)]
pub struct State {
    session: Option<String>,
    streamed: HashMap<String, bool>,
    /// file changes by item id, for the approval card of that item
    changes: HashMap<String, Value>,
    /// the thread's token total at the last turn end, and the latest total
    base: Option<TurnUsage>,
    total: Option<TurnUsage>,
}

fn minus(a: &TurnUsage, b: &TurnUsage) -> TurnUsage {
    TurnUsage { input: a.input.saturating_sub(b.input), output: a.output.saturating_sub(b.output),
        cache_read: a.cache_read.saturating_sub(b.cache_read), cache_write: a.cache_write.saturating_sub(b.cache_write), cost: None }
}

impl State {
    fn piece(&mut self, item: &str, text: &str, thinking: bool) -> Option<Event> {
        if text.is_empty() { return None; }
        let delta = self.streamed.insert(item.into(), true).is_some();
        Some(if thinking { Event::Thinking { text: text.into(), delta } } else { Event::Text { text: text.into(), delta } })
    }
    fn session(&mut self, id: Option<&str>, out: &mut Vec<Event>) {
        if let Some(id) = id.filter(|i| !i.is_empty() && self.session.as_deref() != Some(i)) {
            self.session = Some(id.into());
            out.push(Event::Session { id: id.into() });
        }
    }

    pub fn parse(&mut self, line: &str) -> Vec<Event> {
        let Ok(m) = serde_json::from_str::<Value>(line) else { return vec![] };
        let mut out = vec![];
        let p = &m["params"];
        let Some(method) = m["method"].as_str() else {
            // a response: the thread bridge.rs started or resumed, or an error (a turn that could not start)
            if let Some(e) = m.get("error") {
                let text = e["message"].as_str().unwrap_or("codex error").to_string();
                out.push(Event::Error { text: text.clone() });
                agent_core::limited(Some(&text), &mut out);
                out.push(Event::TurnEnd { ok: false, error: Some(text), usage: None, duration_ms: None });
            }
            self.session(m["result"]["thread"]["id"].as_str(), &mut out);
            if let Some(model) = m["result"]["model"].as_str() {
                out.push(Event::Resolved { model: model.into(), effort: m["result"]["reasoningEffort"].as_str().map(Into::into) });
            }
            return out;
        };
        let ask = m.get("id").filter(|_| m.get("params").is_some()).cloned();
        match method {
            "thread/started" => self.session(p["thread"]["id"].as_str(), &mut out),
            // a resumed thread reports its old total first: the turn's tokens are what it adds
            "turn/started" => { self.base = self.total.clone(); out.push(Event::Working); },
            "item/agentMessage/delta" => out.extend(self.piece(p["itemId"].as_str().unwrap_or(""), p["delta"].as_str().unwrap_or(""), false)),
            "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" =>
                out.extend(self.piece(p["itemId"].as_str().unwrap_or(""), p["delta"].as_str().unwrap_or(""), true)),
            "item/started" => {
                let it = &p["item"];
                if it["type"] == "fileChange" { self.changes.insert(it["id"].as_str().unwrap_or("").into(), it["changes"].clone()); }
                if let Some((name, input)) = tool_call(it) { out.push(Event::ToolCall { id: it["id"].as_str().unwrap_or("").into(), name, input }); }
            }
            "item/completed" => {
                let it = &p["item"];
                let id = it["id"].as_str().unwrap_or("");
                match it["type"].as_str().unwrap_or("") {
                    "contextCompaction" => out.push(Event::Text { text: "Conversation context compacted.".into(), delta: false }),
                    "exitedReviewMode" => if let Some(text) = it["review"].as_str() { out.push(Event::Text { text: text.into(), delta: false }); },
                    // not streamed (or only in part): the whole message
                    "agentMessage" if !self.streamed.contains_key(id) => out.extend(self.piece(id, it["text"].as_str().unwrap_or(""), false)),
                    "reasoning" if !self.streamed.contains_key(id) => {
                        let s: Vec<&str> = it["summary"].as_array().into_iter().flatten().filter_map(|x| x.as_str()).collect();
                        out.extend(self.piece(id, &s.join("\n\n"), true));
                    }
                    _ if tool_call(it).is_some() => { self.changes.remove(id); out.push(Event::ToolResult { id: id.into(), error: failed(it) }); }
                    _ => {}
                }
            }
            "item/commandExecution/requestApproval" if ask.is_some() => {
                let input = json!({"command": p["command"], "cwd": p["cwd"], "reason": p["reason"]});
                let mut r = Request::new("tool", "Bash", input);
                r.tool_use_id = Some(ask_id(true, ask.as_ref().unwrap()));
                out.push(Event::Permission { request: r });
            }
            "item/fileChange/requestApproval" if ask.is_some() => {
                let ch = self.changes.get(p["itemId"].as_str().unwrap_or("")).cloned().unwrap_or(Value::Null);
                let (_, mut input) = tool_call(&json!({"type": "fileChange", "changes": ch})).unwrap();
                input["reason"] = p["reason"].clone();
                input["grantRoot"] = p["grantRoot"].clone();
                let mut r = Request::new("tool", "Edit", input);
                r.tool_use_id = Some(ask_id(true, ask.as_ref().unwrap()));
                out.push(Event::Permission { request: r });
            }
            // the v1 names, still sent by some versions
            "execCommandApproval" if ask.is_some() => {
                let cmd = p["command"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                let mut r = Request::new("tool", "Bash", json!({"command": cmd, "cwd": p["cwd"], "reason": p["reason"]}));
                r.tool_use_id = Some(ask_id(false, ask.as_ref().unwrap()));
                out.push(Event::Permission { request: r });
            }
            "applyPatchApproval" if ask.is_some() => {
                let files: Vec<&String> = p["fileChanges"].as_object().map(|o| o.keys().collect()).unwrap_or_default();
                let mut r = Request::new("tool", "Edit", json!({"file_path": files.first(), "files": files.len(), "reason": p["reason"]}));
                r.tool_use_id = Some(ask_id(false, ask.as_ref().unwrap()));
                out.push(Event::Permission { request: r });
            }
            "thread/tokenUsage/updated" => self.total = Some(tokens(&p["tokenUsage"]["total"])),
            "account/rateLimits/updated" => { *LIVE_LIMITS.lock().unwrap() = Some((agent_core::usage::now_ms(), p["rateLimits"].clone())); }
            "error" if p["willRetry"] != true => out.push(Event::Error { text: p["error"]["message"].as_str().unwrap_or("codex error").into() }),
            "turn/completed" => {
                let t = &p["turn"];
                let ok = t["status"] == "completed";
                let error = (!ok).then(|| t["error"]["message"].as_str().or(t["status"].as_str()).unwrap_or("").to_string());
                let usage = self.total.as_ref().map(|tot| self.base.as_ref().map_or(tot.clone(), |b| minus(tot, b)));
                self.streamed.clear();
                agent_core::limited(error.as_deref(), &mut out);
                out.push(Event::TurnEnd { ok, error, usage, duration_ms: t["durationMs"].as_u64() });
            }
            _ => {}
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::Image;
    const LIVE: &str = include_str!("../tests/fixtures/app-server.jsonl");

    #[test]
    fn a_usage_limit_error_is_a_limited_event_before_the_turn_end() {
        let ended = |msg: &str| json!({"method": "turn/completed", "params": {"turn": {"status": "failed", "error": {"message": msg}}}}).to_string();
        let ev = State::default().parse(&ended("You've hit your usage limit. Try again at 9pm."));
        assert!(matches!(&ev[..], [Event::TurnLimited, Event::TurnEnd { ok: false, .. }]), "{ev:?}");
        assert!(!State::default().parse(&ended("boom")).iter().any(|e| matches!(e, Event::TurnLimited)));
        // a turn that could not start
        let refused = json!({"id": 3, "error": {"message": "usage limit reached"}}).to_string();
        assert!(State::default().parse(&refused).iter().any(|e| matches!(e, Event::TurnLimited)));
    }

    #[test]
    fn app_server_to_events() {
        let mut st = State::default();
        let ev: Vec<Event> = LIVE.lines().flat_map(|l| st.parse(l)).collect();
        let mut it = ev.iter();
        assert_eq!(it.next(), Some(&Event::Session { id: "019a0000-aaaa-7000-8000-000000000001".into() })); // once, not again for thread/started
        assert_eq!(it.next(), Some(&Event::Resolved { model: "gpt-6.1-sol".into(), effort: Some("medium".into()) }));
        assert_eq!(it.next(), Some(&Event::Working));
        assert_eq!(it.next(), Some(&Event::Thinking { text: "Looking at".into(), delta: false }));
        assert_eq!(it.next(), Some(&Event::Thinking { text: " the notes".into(), delta: true }));
        assert!(matches!(it.next(), Some(Event::ToolCall { id, name, input }) if id == "call_1" && name == "Bash" && input["command"] == "ls -la"));
        let Some(Event::Permission { request: r }) = it.next() else { panic!() };
        assert_eq!((r.kind.as_str(), r.tool_name.as_str(), r.relay, r.tool_use_id.as_deref()), ("tool", "Bash", true, Some("v2:7")));
        assert_eq!(r.input["command"], "ls -la");
        assert_eq!(it.next(), Some(&Event::ToolResult { id: "call_1".into(), error: false }));
        assert!(matches!(it.next(), Some(Event::ToolCall { name, input, .. }) if name == "Edit" && input["file_path"] == "/v/Inbox.md"));
        let Some(Event::Permission { request: r }) = it.next() else { panic!() };
        assert_eq!((r.tool_name.as_str(), r.tool_use_id.as_deref()), ("Edit", Some("v2:\"req-8\"")));
        assert_eq!(r.input["file_path"], "/v/Inbox.md"); // from the item that started before the request
        assert!(r.input["diff"].as_str().unwrap().contains("+- [ ] bel Jelle"));
        assert_eq!(it.next(), Some(&Event::ToolResult { id: "patch_1".into(), error: true })); // declined
        assert!(matches!(it.next(), Some(Event::ToolCall { name, .. }) if name == "mcp__linear__list_issues"));
        assert_eq!(it.next(), Some(&Event::ToolResult { id: "mcp_1".into(), error: false }));
        assert_eq!(it.next(), Some(&Event::Text { text: "Twee".into(), delta: false }));
        assert_eq!(it.next(), Some(&Event::Text { text: " dingen.".into(), delta: true }));
        let Some(Event::TurnEnd { ok: true, error: None, usage: Some(u), duration_ms: Some(5100) }) = it.next() else { panic!() };
        assert_eq!((u.input, u.cache_read, u.output), (800, 1200, 150));
        // a second turn: only what it added, a message that came whole, and a failure
        assert_eq!(it.next(), Some(&Event::Working));
        assert_eq!(it.next(), Some(&Event::Text { text: "Klaar.".into(), delta: false }));
        let Some(Event::TurnEnd { ok: false, error: Some(e), usage: Some(u), .. }) = it.next() else { panic!() };
        assert_eq!((e.as_str(), u.input, u.output), ("stream disconnected", 100, 10));
        assert_eq!(it.next(), Some(&Event::Error { text: "unknown thread".into() }));
        assert!(matches!(it.next(), Some(Event::TurnEnd { ok: false, .. })));
        assert_eq!(it.next(), None); // deltas of other kinds, retried errors, unknown methods give nothing
        let live = LIVE_LIMITS.lock().unwrap().clone().unwrap();
        assert_eq!(live.1["primary"]["usedPercent"], 12.0);

        // what codex-cli 0.159.2 wrote in the one live run (README: What ran live)
        let mut st = State::default();
        let ev: Vec<Event> = include_str!("../tests/fixtures/app-server-live.jsonl").lines().flat_map(|l| st.parse(l)).collect();
        assert_eq!(ev[0], Event::Session { id: "01a0f39b-6f2e-7661-9201-994c88076205".into() });
        let text: String = ev.iter().filter_map(|e| if let Event::Text { text, .. } = e { Some(text.as_str()) } else { None }).collect();
        assert_eq!(text, "ok");
        let Some(Event::TurnEnd { ok: true, error: None, usage: Some(u), .. }) = ev.last() else { panic!("{ev:?}") };
        assert_eq!((u.input, u.cache_read, u.output), (14903 - 12288, 12288, 5));
        assert!(!ev.iter().any(|e| matches!(e, Event::Error { .. } | Event::Permission { .. })));
        assert_eq!(LIVE_LIMITS.lock().unwrap().clone().unwrap().1["primary"]["windowDurationMins"], 10080);

        // the second live run: that thread resumed, a command asked for and declined
        let mut st = State::default();
        let ev: Vec<Event> = include_str!("../tests/fixtures/app-server-live-resume.jsonl").lines().flat_map(|l| st.parse(l)).collect();
        assert_eq!(ev[0], Event::Session { id: "01a0f39b-6f2e-7661-9201-994c88076205".into() });
        let call = ev.iter().position(|e| matches!(e, Event::ToolCall { name, .. } if name == "Bash")).unwrap();
        let Event::Permission { request: r } = &ev[call + 1] else { panic!("{:?}", ev[call + 1]) };
        assert!(r.tool_use_id.as_deref().is_some_and(|i| i.starts_with("v2:")) && r.input["command"].is_string());
        assert!(matches!(&ev[call + 2], Event::ToolResult { error: true, .. }));
        let Some(Event::TurnEnd { ok: true, usage: Some(u), .. }) = ev.last() else { panic!("{ev:?}") };
        // the resumed thread's first total (the first run's 14908) is not this turn's
        let last: Value = include_str!("../tests/fixtures/app-server-live-resume.jsonl").lines().filter(|l| l.contains("thread/tokenUsage/updated"))
            .last().and_then(|l| serde_json::from_str(l).ok()).unwrap();
        assert_eq!(u.input + u.cache_read + u.output, last["params"]["tokenUsage"]["total"]["totalTokens"].as_u64().unwrap() - 14908);
    }

    #[test]
    fn turns_and_answers() {
        let t = Turn { text: "kijk".into(), images: vec![Image { media_type: "image/png".into(), data: "AA==".into() }, Image { media_type: "text/html".into(), data: "x".into() }] };
        let m = turn_start(&t);
        assert_eq!(m["params"]["threadId"], "");
        assert_eq!(m["params"]["input"][0], json!({"type": "text", "text": "kijk", "text_elements": []}));
        assert_eq!(m["params"]["input"][1], json!({"type": "image", "url": "data:image/png;base64,AA=="}));
        assert_eq!(m["params"]["input"].as_array().unwrap().len(), 2);
        let mut r = Request::new("tool", "Bash", json!({}));
        r.tool_use_id = Some("v2:7".into());
        let a: Value = serde_json::from_str(&respond(&r, &json!({"behavior": "allow", "updatedInput": {}})).unwrap()).unwrap();
        assert_eq!(a, json!({"id": 7, "result": {"decision": "accept"}}));
        r.tool_use_id = Some("v2:\"req-8\"".into());
        let a: Value = serde_json::from_str(&respond(&r, &json!({"behavior": "deny", "message": "no"})).unwrap()).unwrap();
        assert_eq!(a, json!({"id": "req-8", "result": {"decision": "decline"}}));
        r.tool_use_id = Some("v1:3".into());
        let a: Value = serde_json::from_str(&respond(&r, &json!({"behavior": "deny", "message": "no"})).unwrap()).unwrap();
        assert_eq!(a["result"]["decision"], json!({"denied": {"rejection": "no"}}));
        r.tool_use_id = None;
        assert!(respond(&r, &json!({"behavior": "allow"})).is_none());
    }
}
