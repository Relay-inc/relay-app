//! Permission requests and questions over the pipe (`--permission-prompt-tool stdio`). The CLI sends a
//! `can_use_tool` control request on stdout and waits for a control response on stdin, for every tool call that needs
//! the user and for AskUserQuestion. The app turns the request into a card (agent-core's pending.rs, relay true) and
//! [`respond`] makes the answer a control response.
//!
//! The card's id comes from the CLI's request id, so a request seen twice (the broker's replay after a restart, over
//! a card already on disk) is the same card.

use agent_core::pending::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// The card's id: 12 hex digits of the conversation and the CLI's request id.
pub fn card_id(project: &str, request_id: &str) -> String {
    Sha256::digest(format!("{project}\0{request_id}")).iter().take(6).map(|b| format!("{b:02x}")).collect()
}

/// The card for a `can_use_tool` control request line, None for any other line.
pub fn card(project: &str, ev: &Value) -> Option<Request> {
    let (rid, req) = (ev["request_id"].as_str()?, &ev["request"]);
    if ev["type"] != "control_request" || req["subtype"] != "can_use_tool" { return None; }
    let name = req["tool_name"].as_str()?;
    let mut r = Request::new(if name == "AskUserQuestion" { "question" } else { "tool" }, name, req["input"].clone());
    (r.id, r.project, r.provider) = (card_id(project, rid), project.into(), "claude".into());
    r.tool_use_id = req["tool_use_id"].as_str().map(Into::into);
    r.request_id = Some(rid.into());
    r.suggestions = req["permission_suggestions"].as_array().cloned().unwrap_or_default();
    Some(r)
}

/// The control response line for the user's decision on a card: allow (with the input, a question's answers in it,
/// and `updatedPermissions` for "always allow") or deny.
pub fn respond(req: &Request, decision: &Value) -> Option<String> {
    let rid = req.request_id.as_deref()?;
    let answer = if decision["behavior"] == "allow" {
        let input = if decision["updatedInput"].is_object() { &decision["updatedInput"] } else { &req.input };
        let mut a = json!({"behavior": "allow", "updatedInput": input});
        if decision["updatedPermissions"].as_array().is_some_and(|p| !p.is_empty()) { a["updatedPermissions"] = decision["updatedPermissions"].clone(); }
        a
    } else {
        json!({"behavior": "deny", "message": decision["message"].as_str().filter(|m| !m.is_empty()).unwrap_or("Denied by the user.")})
    };
    Some(json!({"type": "control_response", "response": {"subtype": "success", "request_id": rid, "response": answer}}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    // the lines the real CLI sent (2.x, `--permission-prompt-tool stdio`)
    fn bash() -> Value {
        json!({"type": "control_request", "request_id": "1af60ce8", "request": {"subtype": "can_use_tool", "tool_name": "Bash", "display_name": "Bash",
            "input": {"command": "touch /tmp/pp/x.txt"}, "permission_suggestions": [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "touch /tmp/pp/x.txt"}],
            "behavior": "allow", "destination": "localSettings"}, {"type": "setMode", "mode": "acceptEdits", "destination": "session"}], "tool_use_id": "toolu_1"}})
    }
    fn ask() -> Value {
        json!({"type": "control_request", "request_id": "e1687ec1", "request": {"subtype": "can_use_tool", "tool_name": "AskUserQuestion",
            "input": {"questions": [{"question": "Which color?", "header": "Color", "options": [{"label": "Red", "description": ""}], "multiSelect": true}]},
            "tool_use_id": "toolu_2", "requires_user_interaction": true}})
    }
    #[test]
    fn a_request_becomes_a_card() {
        let r = card("c:1", &bash()).unwrap();
        assert_eq!((r.kind.as_str(), r.tool_name.as_str(), r.project.as_str(), r.provider.as_str(), r.relay), ("tool", "Bash", "c:1", "claude", true));
        assert_eq!((r.tool_use_id.as_deref(), r.request_id.as_deref(), r.input["command"].as_str(), r.suggestions.len()), (Some("toolu_1"), Some("1af60ce8"), Some("touch /tmp/pp/x.txt"), 2));
        // the same request again (a replay after a restart) is the same card; another conversation's is not
        assert_eq!(card("c:1", &bash()).unwrap().id, r.id);
        assert_ne!(card("c:2", &bash()).unwrap().id, r.id);
        assert!(agent_core::pending::valid_id(&r.id));
        let q = card("c:1", &ask()).unwrap();
        assert_eq!((q.kind.as_str(), q.suggestions.len()), ("question", 0));
        assert!(card("c:1", &json!({"type": "control_request", "request_id": "x", "request": {"subtype": "mcp_message"}})).is_none());
        assert!(card("c:1", &json!({"type": "assistant"})).is_none());
    }
    #[test]
    fn answers_are_control_responses() {
        let r = card("c:1", &bash()).unwrap();
        let v = |d: Value| serde_json::from_str::<Value>(&respond(&r, &d).unwrap()).unwrap();
        // allow: the input goes back, and without updatedInput the request's own
        let allow = v(json!({"behavior": "allow", "updatedInput": r.input}));
        assert_eq!(allow, json!({"type": "control_response", "response": {"subtype": "success", "request_id": "1af60ce8",
            "response": {"behavior": "allow", "updatedInput": {"command": "touch /tmp/pp/x.txt"}}}}));
        assert_eq!(v(json!({"behavior": "allow"}))["response"]["response"], allow["response"]["response"]);
        // always allow: the suggestions go along
        let always = v(json!({"behavior": "allow", "updatedInput": r.input, "updatedPermissions": r.suggestions}));
        assert_eq!(always["response"]["response"]["updatedPermissions"], json!(r.suggestions));
        assert!(allow["response"]["response"].get("updatedPermissions").is_none());
        // deny, with and without the user's words
        assert_eq!(v(json!({"behavior": "deny", "message": "no thanks"}))["response"]["response"], json!({"behavior": "deny", "message": "no thanks"}));
        assert_eq!(v(json!({"behavior": "deny"}))["response"]["response"]["message"], "Denied by the user.");
        // a question: the answers ride in updatedInput
        let q = card("c:1", &ask()).unwrap();
        let mut input = q.input.clone();
        input["answers"] = json!({"Which color?": "Red, mauve"});
        let a: Value = serde_json::from_str(&respond(&q, &json!({"behavior": "allow", "updatedInput": input})).unwrap()).unwrap();
        assert_eq!(a["response"]["response"]["updatedInput"]["answers"]["Which color?"], "Red, mauve");
        assert_eq!(a["response"]["request_id"], "e1687ec1");
        // a card from before (a file without the CLI's request id) cannot be answered here
        assert!(respond(&Request::new("tool", "Bash", json!({})), &json!({"behavior": "allow"})).is_none());
    }
    #[test]
    fn a_card_survives_the_restart_once() {
        use agent_core::pending;
        let d = std::env::temp_dir().join(format!("claude-cards-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        // the request came while the app ran: its card is on disk. After a restart the broker replays what came while
        // the app was away, and a request seen before is the same card
        pending::write(&d, &card("c:1", &bash()).unwrap()).unwrap();
        pending::write(&d, &card("c:1", &bash()).unwrap()).unwrap();
        pending::write(&d, &card("c:1", &ask()).unwrap()).unwrap();
        let open = pending::list(&d);
        assert_eq!(open.len(), 2);
        // answered after the restart, from the card as the webview reads it: the line for the CLI has the CLI's id
        let r = pending::read(&d, open.iter().find(|c| c["tool_name"] == "Bash").unwrap()["id"].as_str().unwrap()).unwrap();
        assert_eq!(r.request_id.as_deref(), Some("1af60ce8"));
        assert!(respond(&r, &json!({"behavior": "allow", "updatedInput": r.input, "updatedPermissions": r.suggestions})).unwrap().contains("\"request_id\":\"1af60ce8\""));
        pending::answer(&d, &r.id, &json!({"behavior": "allow"})).unwrap();
        pending::take(&d, &r.id);
        assert_eq!(pending::list(&d).len(), 1);
        std::fs::remove_dir_all(d).ok();
    }
}
