// The control pipe of a provider with `caps.control`, beyond the conversation itself: the app answers the in-process MCP
// servers it offers (relay-mail, relay-orch, relay-design). The provider words the requests and the replies.
use super::Proc;
use crate::{design, home, mail, orch, App};
use agent_core::AgentProvider;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// A request from the CLI over the pipe (`server`: the MCP server it is for). Only relay-mail's and the orchestrator's
/// messages are answered, a tool call runs off this reader thread so the conversation keeps streaming while IMAP works.
pub(crate) fn control(app: &AppHandle, p: &'static dyn AgentProvider, key: &str, pid: u32, rid: &Value, server: Option<&str>, message: &Value) {
    if server == Some("relay-orch") && orch::is_orch(key) { return orch::control(app, key, pid, rid.clone(), message); }
    if server == Some("relay-design") { return design::control(app, key, pid, rid.clone(), message); }
    if server != Some("relay-mail") { return pipe_reply(app, key, pid, rid, Err("unsupported".into())); }
    match mail::rpc(message) {
        mail::Rpc::Reply(r) => pipe_reply(app, key, pid, rid, Ok(r)),
        mail::Rpc::Call { id, name, args } => {
            // mail text is about to enter this session: marked before the tool runs
            if ["search", "read", "thread", "attachment"].contains(&name.as_str()) {
                let st = app.state::<App>();
                let mut procs = st.procs.lock().unwrap();
                if let Some(p) = procs.get_mut(key).filter(|p| p.child.id() == pid && !p.tainted) { Proc::mark_tainted(p); }
            }
            let (app, key, rid) = (app.clone(), key.to_string(), rid.clone());
            tauri::async_runtime::spawn(async move {
                let st = app.state::<App>();
                let (on, accts, default) = { let s = st.settings.lock().unwrap(); (s["mail"]["on"] == true, mail::accounts(&s["mail"]), s["mail"]["account"].as_str().unwrap_or("").to_string()) };
                let dl = PathBuf::from(home()).join("Downloads/Relay-mail");
                let res = if on { st.mail.tool(&accts, &default, &name, &args, &dl).await }
                    else { json!({"content": [{"type": "text", "text": "Mail is switched off in the app."}], "isError": true}) };
                if name == "save_draft" && res["isError"] != true {
                    // the chat shows who the draft is really for, whatever Claude writes about it
                    let d: Value = serde_json::from_str(res["content"][0]["text"].as_str().unwrap_or("")).unwrap_or_default();
                    app.emit("agent", json!({"project": key, "provider": p.id(), "event": {"type": "draft_saved", "folder": d["folder"], "to": d["to"], "cc": d["cc"], "bcc": d["bcc"]}})).ok();
                }
                pipe_reply(&app, &key, pid, &rid, Ok(mail::rpc_result(id, res)));
            });
        }
    }
}
/// Write the provider's control reply to the process that asked, if it is still the one in that slot.
pub(crate) fn pipe_reply(app: &AppHandle, key: &str, pid: u32, rid: &Value, reply: Result<Value, String>) {
    let st = app.state::<App>();
    let mut procs = st.procs.lock().unwrap();
    if let Some(p) = procs.get_mut(key).filter(|p| p.child.id() == pid) {
        let Some(line) = crate::agents::get(p.provider).ok().and_then(|a| a.control_reply(rid, reply)) else { return };
        writeln!(p.stdin, "{line}").and_then(|_| p.stdin.flush()).ok();
    }
}
