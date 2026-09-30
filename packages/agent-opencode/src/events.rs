//! The events of `opencode serve` (GET /event, as bridge.py passes them on: `{type, properties}` per line) as the
//! contract's events, the turns the app sends, and the answers to its permission requests and questions.
//! Written against opencode 1.18.33; tests/fixtures/serve-live*.jsonl are three live runs.

use agent_core::{pending::Request, Event, Turn, TurnUsage, IMAGE_TYPES};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// A turn as bridge.py's `prompt` line; it fills in the model and variant. Images go as data-URL file parts.
pub fn prompt(turn: &Turn) -> Value {
    let mut parts: Vec<Value> = vec![];
    if !turn.text.is_empty() { parts.push(json!({"type": "text", "text": turn.text})); }
    for (n, i) in turn.images.iter().filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str())).enumerate() {
        let ext = i.media_type.trim_start_matches("image/");
        parts.push(json!({"type": "file", "mime": i.media_type, "filename": format!("image-{}.{ext}", n + 1), "url": format!("data:{};base64,{}", i.media_type, i.data)}));
    }
    json!({"type": "prompt", "parts": parts})
}

/// The bridge line answering a request raised as [`Event::Permission`]: `tool_use_id` is opencode's request id,
/// `per_…` for a permission (once or reject), `que_…` for a question (the chosen labels per question, or reject).
pub fn respond(req: &Request, decision: &Value) -> Option<String> {
    let id = req.tool_use_id.as_deref()?;
    let allow = decision["behavior"] == "allow";
    let v = if id.starts_with("per") {
        let mut v = json!({"type": "permission", "id": id, "reply": if allow { "once" } else { "reject" }});
        if let Some(m) = decision["message"].as_str().filter(|m| !allow && !m.is_empty()) { v["message"] = json!(m); }
        v
    } else if id.starts_with("que") {
        if !allow { return Some(json!({"type": "question", "id": id, "reject": true}).to_string()); }
        let answers = &decision["updatedInput"]["answers"];
        let per: Vec<Vec<String>> = req.input["questions"].as_array().into_iter().flatten().map(|q| {
            let a = answers[q["question"].as_str().unwrap_or("")].as_str().unwrap_or("");
            a.split(", ").filter(|s| !s.is_empty()).map(String::from).collect()
        }).collect();
        json!({"type": "question", "id": id, "answers": per})
    } else { return None };
    Some(v.to_string())
}

/// opencode's tool names as the canonical ones, and its input keys (filePath) as the contract's (file_path).
pub fn tool(name: &str, input: &Value) -> (String, Value) {
    let n = match name {
        "bash" => "Bash", "read" => "Read", "write" => "Write", "edit" | "multiedit" | "patch" | "apply_patch" => "Edit",
        "glob" | "list" => "Glob", "grep" => "Grep", "webfetch" => "WebFetch", "websearch" => "WebSearch", "task" => "Agent",
        "todowrite" => "TodoWrite", "skill" => "Skill", _ => name,
    };
    let mut input = input.clone();
    if let Some(o) = input.as_object_mut() {
        if let Some(p) = o.remove("filePath") { o.insert("file_path".into(), p); }
        if n == "Glob" && !o.contains_key("pattern") { if let Some(p) = o.get("path").cloned() { o.insert("pattern".into(), p); } }
    }
    (n.into(), input)
}

/// A permission request (`permission.asked`) as a card: the tool it is for and what it would do.
fn permission(p: &Value) -> Request {
    let md = &p["metadata"];
    let patterns = p["patterns"].clone();
    let (name, input) = match p["permission"].as_str().unwrap_or("") {
        "bash" => ("Bash".to_string(), json!({"command": md["command"].as_str().map(String::from)
            .unwrap_or_else(|| patterns.as_array().into_iter().flatten().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("\n"))})),
        "edit" => ("Edit".into(), json!({"file_path": md["filepath"], "diff": md["diff"]})),
        "webfetch" => ("WebFetch".into(), json!({"url": md["url"].as_str().or(patterns[0].as_str())})),
        other => (other.to_string(), json!({"patterns": patterns, "metadata": md})),
    };
    let mut r = Request::new("tool", &name, input);
    r.tool_use_id = p["id"].as_str().map(String::from);
    r
}

/// A question (`question.asked`) in the contract's shape (Claude's AskUserQuestion).
fn question(p: &Value) -> Request {
    let qs: Vec<Value> = p["questions"].as_array().into_iter().flatten().map(|q| json!({
        "question": q["question"], "header": q["header"], "multiSelect": q["multiple"].as_bool().unwrap_or(false),
        "options": q["options"].as_array().into_iter().flatten().map(|o| json!({"label": o["label"], "description": o["description"]})).collect::<Vec<_>>(),
    })).collect();
    let mut r = Request::new("question", "AskUserQuestion", json!({"questions": qs}));
    r.tool_use_id = p["id"].as_str().map(String::from);
    r
}

/// An assistant message's error (`info.error` or `session.error`'s `error`): its message, else its name.
pub fn error_text(e: &Value) -> Option<String> {
    if e.is_null() { return None; }
    Some(e["data"]["message"].as_str().or(e["message"].as_str()).or(e["name"].as_str()).unwrap_or("opencode error").to_string())
}

/// An assistant message's tokens: `input` is without the cached ones, reasoning counts as output.
pub fn tokens(info: &Value) -> TurnUsage {
    let t = &info["tokens"];
    let n = |v: &Value| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)).unwrap_or(0);
    TurnUsage { input: n(&t["input"]), output: n(&t["output"]) + n(&t["reasoning"]), cache_read: n(&t["cache"]["read"]),
        cache_write: n(&t["cache"]["write"]), cost: info["cost"].as_f64() }
}

/// The parser of one process. Text and reasoning parts stream as `message.part.delta` (the first piece starts the
/// block); a part that did not stream is shown whole when it ends. The turn ends at `session.idle`.
#[derive(Default)]
pub struct State {
    session: Option<String>,
    /// part id → its type ("text", "reasoning", "tool"), for the deltas
    kinds: HashMap<String, String>,
    streamed: HashSet<String>,
    users: HashSet<String>,
    called: HashSet<String>,
    done: HashSet<String>,
    /// this turn's assistant messages: id → (created, completed, tokens)
    msgs: HashMap<String, (i64, i64, TurnUsage)>,
    busy: bool,
    error: Option<String>,
}

impl State {
    fn piece(&mut self, part: &str, text: &str, out: &mut Vec<Event>) {
        if text.is_empty() { return; }
        let delta = !self.streamed.insert(part.into());
        out.push(if self.kinds.get(part).is_some_and(|k| k == "reasoning") { Event::Thinking { text: text.into(), delta } } else { Event::Text { text: text.into(), delta } });
    }

    fn end(&mut self, out: &mut Vec<Event>) {
        let mut usage = TurnUsage::default();
        let (mut from, mut to, mut cost) = (i64::MAX, 0, None::<f64>);
        for (c, e, u) in self.msgs.values() {
            usage.input += u.input; usage.output += u.output; usage.cache_read += u.cache_read; usage.cache_write += u.cache_write;
            if let Some(x) = u.cost { cost = Some(cost.unwrap_or(0.0) + x); }
            from = from.min(*c); to = to.max(*e);
        }
        usage.cost = cost;
        let error = self.error.take();
        out.push(Event::TurnEnd { ok: error.is_none(), error, usage: (!self.msgs.is_empty()).then_some(usage),
            duration_ms: (to > from).then(|| (to - from) as u64) });
        self.msgs.clear();
        self.busy = false;
    }

    pub fn parse(&mut self, line: &str) -> Vec<Event> {
        let Ok(m) = serde_json::from_str::<Value>(line) else { return vec![] };
        let mut out = vec![];
        let p = &m["properties"];
        match m["type"].as_str().unwrap_or("") {
            "bridge.session" => if let Some(id) = m["id"].as_str().filter(|i| self.session.as_deref() != Some(*i)) {
                self.session = Some(id.into());
                out.push(Event::Session { id: id.into() });
            },
            "bridge.error" => {
                let text = m["message"].as_str().unwrap_or("opencode error").to_string();
                out.push(Event::Error { text: text.clone() });
                // a prompt that could not be sent: no turn is coming to end on its own
                if !self.busy { out.push(Event::TurnEnd { ok: false, error: Some(text), usage: None, duration_ms: None }); }
            }
            "session.status" => if p["status"]["type"] == "busy" { self.busy = true; },
            "message.updated" => {
                let info = &p["info"];
                let id = info["id"].as_str().unwrap_or("").to_string();
                if info["role"] == "user" { self.users.insert(id); }
                else if info["role"] == "assistant" {
                    self.busy = true;
                    let (c, e) = (info["time"]["created"].as_i64().unwrap_or(0), info["time"]["completed"].as_i64().unwrap_or(0));
                    self.msgs.insert(id, (c, e, tokens(info)));
                    if let Some(e) = error_text(&info["error"]) { self.error.get_or_insert(e); }
                }
            }
            "message.part.updated" => {
                let part = &p["part"];
                let (id, mid) = (part["id"].as_str().unwrap_or(""), part["messageID"].as_str().unwrap_or(""));
                // the user's own message comes back too, as do synthetic parts
                if self.users.contains(mid) || part["synthetic"] == true { return out; }
                let kind = part["type"].as_str().unwrap_or("");
                self.kinds.insert(id.into(), kind.into());
                match kind {
                    "text" | "reasoning" if !part["time"]["end"].is_null() && !self.streamed.contains(id) =>
                        self.piece(id, part["text"].as_str().unwrap_or(""), &mut out),
                    "tool" => {
                        let st = &part["state"];
                        let status = st["status"].as_str().unwrap_or("");
                        if status != "pending" && self.called.insert(id.into()) {
                            let (name, input) = tool(part["tool"].as_str().unwrap_or(""), &st["input"]);
                            out.push(Event::ToolCall { id: id.into(), name, input });
                        }
                        if matches!(status, "completed" | "error") && self.done.insert(id.into()) {
                            out.push(Event::ToolResult { id: id.into(), error: status == "error" });
                        }
                    }
                    _ => {}
                }
            }
            "message.part.delta" if p["field"] == "text" => {
                let part = p["partID"].as_str().unwrap_or("").to_string();
                if !self.users.contains(p["messageID"].as_str().unwrap_or("")) { self.piece(&part, p["delta"].as_str().unwrap_or(""), &mut out); }
            }
            "permission.asked" => out.push(Event::Permission { request: permission(p) }),
            "question.asked" => out.push(Event::Permission { request: question(p) }),
            "session.error" => if let Some(e) = error_text(&p["error"]) {
                out.push(Event::Error { text: e.clone() });
                self.error.get_or_insert(e);
            },
            "session.idle" if self.busy || !self.msgs.is_empty() => self.end(&mut out),
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

    #[test]
    fn a_live_turn_with_a_command_and_its_permission() {
        let ev = run(include_str!("../tests/fixtures/serve-live.jsonl"));
        assert_eq!(ev[0], Event::Session { id: "ses_f0c5bbf85ffe6aFOOEAgKslvWD".into() });
        // streamed: the prompt itself is not echoed, the first piece starts the block
        assert_eq!(text(&ev), "I'll run the command first.done");
        assert!(ev.iter().any(|e| matches!(e, Event::Text { text, delta: false } if text == "I'll")));
        let call = ev.iter().find_map(|e| if let Event::ToolCall { name, input, id } = e { Some((name, input, id)) } else { None }).unwrap();
        assert_eq!((call.0.as_str(), call.1["command"].as_str()), ("Bash", Some("echo hi")));
        assert!(ev.contains(&Event::ToolResult { id: call.2.clone(), error: false }));
        let Some(Event::Permission { request }) = ev.iter().find(|e| matches!(e, Event::Permission { .. })) else { panic!() };
        assert_eq!((request.kind.as_str(), request.tool_name.as_str(), request.input["command"].as_str()), ("tool", "Bash", Some("echo hi")));
        assert_eq!(request.tool_use_id.as_deref(), Some("per_0f3a473f7001rRwTVGWNzWv0wd"));
        // one turn end, the two model calls' tokens summed (reasoning counted as output)
        let ends: Vec<&Event> = ev.iter().filter(|e| matches!(e, Event::TurnEnd { .. })).collect();
        assert_eq!(ends.len(), 1);
        let Event::TurnEnd { ok, usage: Some(u), duration_ms, .. } = ends[0] else { panic!() };
        assert!(*ok);
        assert_eq!((u.input, u.output, u.cache_read, u.cache_write, u.cost), (6739, 29 + 481 + 8 + 43, 167 + 6870, 0, Some(0.0)));
        assert_eq!(*duration_ms, Some(1790794038538 - 1790794023305));
        assert!(matches!(ev.last(), Some(Event::TurnEnd { .. })));
    }

    #[test]
    fn a_resumed_session_and_a_rejected_edit() {
        let ev = run(include_str!("../tests/fixtures/serve-live-resume.jsonl"));
        assert_eq!(text(&ev), "done");
        let ev = run(include_str!("../tests/fixtures/serve-live-reject.jsonl"));
        let Some(Event::Permission { request }) = ev.iter().find(|e| matches!(e, Event::Permission { .. })) else { panic!() };
        assert_eq!((request.tool_name.as_str(), request.input["file_path"].as_str()), ("Edit", Some("/private/tmp/oc-probe/work/hello.txt")));
        assert!(request.input["diff"].as_str().unwrap().contains("+hi"));
        let write = ev.iter().find_map(|e| if let Event::ToolCall { name, input, id } = e { Some((name, input, id)) } else { None }).unwrap();
        assert_eq!((write.0.as_str(), write.1["file_path"].as_str()), ("Write", Some("/private/tmp/oc-probe/work/hello.txt")));
        assert!(ev.contains(&Event::ToolResult { id: write.2.clone(), error: true }));
        assert!(matches!(ev.last(), Some(Event::TurnEnd { ok: true, .. })));
    }

    #[test]
    fn answers_permissions_and_questions() {
        let mut r = Request::new("tool", "Bash", json!({}));
        r.tool_use_id = Some("per_1".into());
        assert_eq!(respond(&r, &json!({"behavior": "allow", "updatedInput": {}})).unwrap(), r#"{"id":"per_1","reply":"once","type":"permission"}"#);
        let v: Value = serde_json::from_str(&respond(&r, &json!({"behavior": "deny", "message": "no"})).unwrap()).unwrap();
        assert_eq!((v["reply"].as_str(), v["message"].as_str()), (Some("reject"), Some("no")));
        let asked = json!({"type": "question.asked", "properties": {"id": "que_1", "sessionID": "ses_1", "questions": [
            {"question": "Which?", "header": "Pick", "multiple": true, "options": [{"label": "A", "description": "a"}, {"label": "B", "description": "b"}]},
            {"question": "Sure?", "header": "Ok", "options": [{"label": "Yes", "description": ""}]}]}});
        let ev = State::default().parse(&asked.to_string());
        let Some(Event::Permission { request }) = ev.first() else { panic!() };
        assert_eq!((request.kind.as_str(), request.input["questions"][0]["multiSelect"].as_bool()), ("question", Some(true)));
        let a = respond(request, &json!({"behavior": "allow", "updatedInput": {"answers": {"Which?": "A, B", "Sure?": "Yes"}}})).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&a).unwrap(), json!({"type": "question", "id": "que_1", "answers": [["A", "B"], ["Yes"]]}));
        assert_eq!(respond(request, &json!({"behavior": "deny", "message": ""})).unwrap(), r#"{"id":"que_1","reject":true,"type":"question"}"#);
    }

    #[test]
    fn prompts_errors_and_a_failed_send() {
        let p = prompt(&Turn { text: "hoi".into(), images: vec![agent_core::Image { media_type: "image/png".into(), data: "AAA".into() }] });
        assert_eq!(p["parts"][1], json!({"type": "file", "mime": "image/png", "filename": "image-1.png", "url": "data:image/png;base64,AAA"}));
        let mut st = State::default();
        let ev = st.parse(r#"{"type":"bridge.error","message":"HTTP Error 400"}"#);
        assert!(matches!(&ev[1], Event::TurnEnd { ok: false, error: Some(e), .. } if e == "HTTP Error 400"));
        st.parse(r#"{"type":"session.status","properties":{"sessionID":"s","status":{"type":"busy"}}}"#);
        let ev = st.parse(r#"{"type":"session.error","properties":{"sessionID":"s","error":{"name":"ProviderAuthError","data":{"providerID":"x","message":"no key"}}}}"#);
        assert_eq!(ev, [Event::Error { text: "no key".into() }]);
        let ev = st.parse(r#"{"type":"session.idle","properties":{"sessionID":"s"}}"#);
        assert!(matches!(&ev[0], Event::TurnEnd { ok: false, error: Some(e), usage: None, .. } if e == "no key"));
        // an idle without a turn (a fresh server) ends nothing
        assert!(st.parse(r#"{"type":"session.idle","properties":{"sessionID":"s"}}"#).is_empty());
    }
}
