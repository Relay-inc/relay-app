//! The permission tool of a Claude session (`relay --perm-server`), a stdio MCP server. Claude's side of the
//! pending folder (agent-core's pending.rs): it writes the requests and reads the answers itself, so its
//! requests have relay false.
//!
//! Claude calls `approve` for every tool call that needs the user, and for AskUserQuestion. The request is
//! written to $PENDING/<id>.json, the app shows it and writes $PENDING/<id>.answer.json. We wait for that
//! file, pass the decision back to Claude and remove both. Stdout carries only protocol lines.

use agent_core::pending::{self, Request};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::Path;
use std::time::Duration;

/// Entry point of `relay --perm-server`; PENDING and PROJECT come from the MCP config's env.
pub fn perm_server_main() {
    let pending = std::env::var("PENDING").expect("PENDING");
    let project = std::env::var("PROJECT").unwrap_or_default();
    let _ = run(std::io::stdin().lock(), std::io::stdout().lock(), Path::new(&pending), &project, Duration::from_millis(250));
}

fn tool() -> Value {
    json!({"name": "approve", "description": "Ask the user to approve a tool call or answer a question",
        "inputSchema": {"type": "object", "required": ["tool_name", "input"], "properties": {
            "tool_name": {"type": "string"}, "input": {"type": "object"}, "tool_use_id": {"type": "string"}}}})
}

fn ask(dir: &Path, project: &str, poll: Duration, args: &Value) -> std::io::Result<Value> {
    let name = args["tool_name"].as_str().unwrap_or("");
    let mut r = Request::new(if name == "AskUserQuestion" { "question" } else { "tool" }, name, args["input"].clone());
    r.project = project.into(); r.provider = "claude".into(); r.relay = false;
    r.tool_use_id = args["tool_use_id"].as_str().map(Into::into);
    pending::write(dir, &r)?;
    loop {
        if let Some(d) = pending::take(dir, &r.id) { return Ok(d); }
        std::thread::sleep(poll);
    }
}

/// Serve MCP requests, one JSON line each, until the reader ends.
pub fn run(reader: impl BufRead, mut out: impl Write, dir: &Path, project: &str, poll: Duration) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for line in reader.lines() {
        let Ok(req) = serde_json::from_str::<Value>(&line?) else { continue };
        let id = req["id"].clone();
        let result = match req["method"].as_str() {
            Some("initialize") => json!({"protocolVersion": req["params"]["protocolVersion"], "capabilities": {"tools": {}},
                "serverInfo": {"name": "vaultperm", "version": "0.1"}}),
            Some("tools/list") => json!({"tools": [tool()]}),
            Some("tools/call") => json!({"content": [{"type": "text", "text": ask(dir, project, poll, &req["params"]["arguments"])?.to_string()}]}),
            _ if id.is_null() => continue,
            _ => json!({}),
        };
        writeln!(out, "{}", json!({"jsonrpc": "2.0", "id": id, "result": result}))?;
        out.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handshake_list_and_call() {
        let d = std::env::temp_dir().join(format!("perm-server-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        // answerer: the app, writing the answer for the first request that shows up
        let dd = d.clone();
        let app = std::thread::spawn(move || loop {
            if let Some(r) = pending::list(&dd).first() {
                assert_eq!((r["project"].as_str(), r["provider"].as_str(), r["kind"].as_str(), r["relay"].as_bool()), (Some("c:1"), Some("claude"), Some("tool"), Some(false)));
                assert_eq!((r["tool_name"].as_str(), r["input"]["command"].as_str(), r["tool_use_id"].as_str()), (Some("Bash"), Some("ls"), Some("tu1")));
                pending::answer(&dd, r["id"].as_str().unwrap(), &json!({"behavior": "allow"})).unwrap();
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        });
        let input = [
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}),
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "approve", "arguments":
                {"tool_name": "Bash", "input": {"command": "ls"}, "tool_use_id": "tu1"}}}),
            json!({"jsonrpc": "2.0", "id": 4, "method": "ping"}),
        ].map(|v| v.to_string()).join("\n");
        let mut out = Vec::new();
        run(input.as_bytes(), &mut out, &d, "c:1", Duration::from_millis(5)).unwrap();
        app.join().unwrap();
        let rs: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(rs.len(), 4);
        assert_eq!((rs[0]["id"].clone(), rs[0]["result"]["protocolVersion"].clone(), rs[0]["result"]["serverInfo"]["name"].clone()), (json!(1), json!("2025-06-18"), json!("vaultperm")));
        assert_eq!(rs[1]["result"]["tools"][0]["name"], "approve");
        assert_eq!(serde_json::from_str::<Value>(rs[2]["result"]["content"][0]["text"].as_str().unwrap()).unwrap(), json!({"behavior": "allow"}));
        assert_eq!(rs[3]["result"], json!({}));
        assert!(pending::list(&d).is_empty());
        std::fs::remove_dir_all(d).ok();
    }
}
