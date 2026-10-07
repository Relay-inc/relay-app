// Claude's stdin/stdout pipe beyond the conversation itself: the app answers the in-process MCP servers
// (relay-mail, relay-orch) and sets the model of a running process.
use super::Proc;
use crate::{home, mail, orch, App};
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// The request that opens the pipe: which in-process MCP servers the app answers for.
pub(crate) fn pipe_init(mail_on: bool, orch_on: bool) -> Value {
    let servers: Vec<&str> = [(mail_on, "relay-mail"), (orch_on, "relay-orch")].into_iter().filter(|s| s.0).map(|s| s.1).collect();
    json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": servers}})
}
/// Claude's control_request that changes the model for the turns after it ("default": the CLI's own).
pub(crate) fn set_model_request(model: &str) -> Value {
    json!({"type": "control_request", "request_id": "model", "request": {"subtype": "set_model", "model": if model.is_empty() { "default" } else { model }}})
}

/// A request from the CLI over the pipe. Only relay-mail's MCP messages are answered, a tool call runs off this
/// reader thread so the conversation keeps streaming while IMAP works.
pub(crate) fn control(app: &AppHandle, key: &str, pid: u32, ev: &Value) {
    let (rid, req) = (ev["request_id"].clone(), &ev["request"]);
    if req["subtype"] == "mcp_message" && req["server_name"] == "relay-orch" && orch::is_orch(key) { return orch::control(app, key, pid, rid, &req["message"]); }
    if req["subtype"] != "mcp_message" || req["server_name"] != "relay-mail" {
        return pipe_reply(app, key, pid, json!({"subtype": "error", "request_id": rid, "error": "unsupported"}));
    }
    match mail::rpc(&req["message"]) {
        mail::Rpc::Reply(r) => pipe_reply(app, key, pid, pipe_ok(rid, r)),
        mail::Rpc::Call { id, name, args } => {
            // mail text is about to enter this session: marked before the tool runs
            if ["search", "read", "thread", "attachment"].contains(&name.as_str()) {
                let st = app.state::<App>();
                let mut procs = st.procs.lock().unwrap();
                if let Some(p) = procs.get_mut(key).filter(|p| p.child.id() == pid && !p.tainted) { Proc::mark_tainted(p); }
            }
            let (app, key) = (app.clone(), key.to_string());
            tauri::async_runtime::spawn(async move {
                let st = app.state::<App>();
                let (on, accts, default) = { let s = st.settings.lock().unwrap(); (s["mail"]["on"] == true, mail::accounts(&s["mail"]), s["mail"]["account"].as_str().unwrap_or("").to_string()) };
                let dl = PathBuf::from(home()).join("Downloads/Relay-mail");
                let res = if on { st.mail.tool(&accts, &default, &name, &args, &dl).await }
                    else { json!({"content": [{"type": "text", "text": "Mail is switched off in the app."}], "isError": true}) };
                if name == "save_draft" && res["isError"] != true {
                    // the chat shows who the draft is really for, whatever Claude writes about it
                    let d: Value = serde_json::from_str(res["content"][0]["text"].as_str().unwrap_or("")).unwrap_or_default();
                    app.emit("agent", json!({"project": key, "provider": "claude", "event": {"type": "draft_saved", "folder": d["folder"], "to": d["to"], "cc": d["cc"], "bcc": d["bcc"]}})).ok();
                }
                pipe_reply(&app, &key, pid, pipe_ok(rid, mail::rpc_result(id, res)));
            });
        }
    }
}
pub(crate) fn pipe_ok(rid: Value, r: Value) -> Value { json!({"subtype": "success", "request_id": rid, "response": {"mcp_response": r}}) }
/// Write a control_response to the process that asked, if it is still the one in that slot.
pub(crate) fn pipe_reply(app: &AppHandle, key: &str, pid: u32, response: Value) {
    let st = app.state::<App>();
    let mut procs = st.procs.lock().unwrap();
    if let Some(p) = procs.get_mut(key).filter(|p| p.child.id() == pid) {
        writeln!(p.stdin, "{}", json!({"type": "control_response", "response": response})).and_then(|_| p.stdin.flush()).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pipe_init_names_the_apps_servers() {
        assert_eq!(pipe_init(true, false)["request"]["sdkMcpServers"], json!(["relay-mail"]));
        assert_eq!(pipe_init(false, false)["request"]["sdkMcpServers"], json!([]));
        assert_eq!(pipe_init(true, true)["request"]["sdkMcpServers"], json!(["relay-mail", "relay-orch"]));
    }
    #[test]
    fn set_model_json() {
        let v = set_model_request("sonnet");
        assert_eq!(v["type"], "control_request");
        assert_eq!(v["request"]["subtype"], "set_model");
        assert_eq!(v["request"]["model"], "sonnet");
        assert_eq!(set_model_request("")["request"]["model"], "default");
    }
}
