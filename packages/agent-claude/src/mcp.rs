//! The MCP servers Claude has in the vault (Settings › Agents › Claude Code), asked and changed over the control
//! pipe of a short-lived `claude -p` (`mcp_status`, `mcp_authenticate`, `mcp_reconnect`, `mcp_toggle`: not in
//! `claude --help`, Claude Code 2.1.332). Sign-in and the switch are kept by claude itself (its credential store and
//! its settings), so a conversation started afterwards has them; a running one keeps the servers it has.

use crate::{control_cmd, on_account, account};
use agent_core::{discover_within, Env, Probe};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

type R<T> = Result<T, String>;

/// How long a sign-in waits for the person in the browser (claude listens on a localhost port for the redirect).
const SIGNIN: Duration = Duration::from_secs(180);
/// How long a list waits for servers that are still starting (`pending`).
const SETTLE: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_secs(1);

/// `op`: `{op: "status"}`, or `{op: "signin" | "reconnect" | "toggle", server, on?}`; the answer is the servers after it.
pub fn run(env: &Env, op: &Value, open: &dyn Fn(&str)) -> R<Value> {
    if env.vault.is_empty() || !Path::new(env.bin).is_file() { return Err("claude is not installed".into()); }
    let kind = op["op"].as_str().unwrap_or_default();
    let limit = if kind == "signin" { SIGNIN + SETTLE + Duration::from_secs(10) } else { Duration::from_secs(40) };
    let mut answer = Err("claude did not answer".to_string());
    discover_within(env, limit, |p| { answer = session(p, env, op, open); Ok(Value::Null) });
    answer
}

fn session(p: &mut Probe, env: &Env, op: &Value, open: &dyn Fn(&str)) -> R<Value> {
    let mut cmd = control_cmd(env);
    on_account(&mut cmd, account(env));
    let c = p.start(cmd)?;
    ask(p, c, "init", json!({"subtype": "initialize"}))?;
    let server = op["server"].as_str().unwrap_or_default();
    match op["op"].as_str().unwrap_or_default() {
        "status" => {}
        "reconnect" => { ask(p, c, "act", json!({"subtype": "mcp_reconnect", "serverName": server}))?; }
        "toggle" => { ask(p, c, "act", json!({"subtype": "mcp_toggle", "serverName": server, "enabled": op["on"] == true}))?; }
        "signin" => signin(p, c, server, open)?,
        other => return Err(format!("unknown MCP action {other}")),
    }
    status(p, c, SETTLE).map(Value::Array)
}

/// One control request and its answer: the `response` of a success, the message of an error.
fn ask(p: &mut Probe, c: usize, id: &str, request: Value) -> R<Value> {
    p.send(c, json!({"type": "control_request", "request_id": id, "request": request}))?;
    let v = p.receive(c, |v| v["type"] == "control_response" && v["response"]["request_id"] == id)?;
    let r = &v["response"];
    if r["subtype"] == "error" { return Err(r["error"].as_str().unwrap_or("failed").trim().to_string()); }
    Ok(r["response"].clone())
}

/// The servers now, as the settings page shows them; waits up to `patience` for the ones still starting.
fn status(p: &mut Probe, c: usize, patience: Duration) -> R<Vec<Value>> {
    let t = Instant::now();
    for n in 1.. {
        let list = servers(&ask(p, c, &format!("s{n}"), json!({"subtype": "mcp_status"}))?);
        if t.elapsed() >= patience || !list.iter().any(|s| s["status"] == "pending") { return Ok(list); }
        std::thread::sleep(POLL);
    }
    unreachable!()
}

/// `mcp_status` rows cut down to what the page shows. `connector`: a claude.ai connector, signed in on claude.ai
/// (its sign-in is held there, not by this process).
fn servers(response: &Value) -> Vec<Value> {
    response["mcpServers"].as_array().into_iter().flatten().filter_map(|s| {
        let name = s["name"].as_str()?;
        let connector = s["sessionProxied"] == true || s["config"]["type"] == "claudeai-proxy";
        let error = s["error"].as_str().map(str::trim).filter(|e| !e.is_empty());
        Some(json!({"name": name, "status": s["status"].as_str().unwrap_or("pending"), "error": error, "connector": connector}))
    }).collect()
}

/// `mcp_authenticate` answers with the page to sign in on. A connector's page is on claude.ai and nothing is waited for
/// here; for any other server claude listens on localhost for the redirect, so the process is kept until the server
/// is no longer `needs-auth` or the time is up.
fn signin(p: &mut Probe, c: usize, server: &str, open: &dyn Fn(&str)) -> R<()> {
    let r = ask(p, c, "act", json!({"subtype": "mcp_authenticate", "serverName": server}))?;
    if let Some(url) = r["authUrl"].as_str() { open(url); }
    if r["callbackExpected"] != true { return Ok(()); }
    let t = Instant::now();
    while t.elapsed() < SIGNIN {
        std::thread::sleep(POLL * 2);
        let waiting = status(p, c, Duration::ZERO)?.iter().any(|s| s["name"] == server && s["status"] == "needs-auth");
        if !waiting { break; }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::NO_GRANTS;
    use std::path::PathBuf;

    #[test]
    fn rows_keep_what_the_page_shows() {
        let v = json!({"mcpServers": [
            {"name": "acme-docs", "status": "failed", "error": "connect ECONNREFUSED\n", "config": {"type": "http", "url": "https://docs.example.com/mcp", "headers": {"X-Key": "secret"}}, "tools": [{"name": "t"}]},
            {"name": "claude.ai Linear", "status": "needs-auth", "config": {"type": "claudeai-proxy"}, "sessionProxied": true},
            {"name": "notion", "status": "connected", "config": {"type": "stdio"}},
            {"status": "connected"}]});
        assert_eq!(servers(&v), vec![
            json!({"name": "acme-docs", "status": "failed", "error": "connect ECONNREFUSED", "connector": false}),
            json!({"name": "claude.ai Linear", "status": "needs-auth", "error": null, "connector": true}),
            json!({"name": "notion", "status": "connected", "error": null, "connector": false})]);
        assert!(servers(&json!({})).is_empty());
    }

    /// A claude that answers each control request by its id: `mcp_status` from a file holding the rows (swapped by
    /// `mcp_authenticate`, which also logs that it was asked), `mcp_toggle` and `mcp_reconnect` with an error when
    /// `fail` exists.
    fn fake(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("relay-mcp-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = |s: &str| json!({"mcpServers": [{"name": "acme-docs", "status": s, "config": {"type": "http"}}]}).to_string();
        std::fs::write(dir.join("before"), rows("needs-auth")).unwrap();
        std::fs::write(dir.join("after"), rows("connected")).unwrap();
        std::fs::write(dir.join("cur"), rows("needs-auth")).unwrap();
        let bin = dir.join("claude");
        std::fs::write(&bin, r#"#!/bin/sh
d=$(dirname "$0")
while read l; do
  id=$(echo "$l" | sed 's/.*"request_id":"\([^"]*\)".*/\1/')
  case "$l" in
    *mcp_status*) body=$(cat "$d/cur"); echo "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\",\"response\":$body}}";;
    *mcp_authenticate*) echo asked > "$d/asked"; cp "$d/after" "$d/cur"
      echo "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\",\"response\":{\"authUrl\":\"https://docs.example.com/authorize\",\"requiresUserAction\":true,\"callbackExpected\":$(cat "$d/callback" 2>/dev/null || echo true)}}}";;
    *mcp_reconnect*|*mcp_toggle*) if [ -f "$d/fail" ]; then echo "{\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",\"request_id\":\"$id\",\"error\":\"Connection failed\"}}"; else echo "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\"}}"; fi;;
    *) echo "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\",\"response\":{}}}";;
  esac
done
"#).unwrap();
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        (dir, bin)
    }
    fn go(bin: &Path, op: Value) -> (R<Value>, Vec<String>) {
        let pending = PathBuf::new();
        let env = Env { home: "/h", vault: "/tmp", path: "/usr/bin:/bin", bin: bin.to_str().unwrap(), pending: &pending, grants: &NO_GRANTS, opts: &Value::Null };
        let opened = std::sync::Mutex::new(vec![]);
        let r = run(&env, &op, &|u| opened.lock().unwrap().push(u.to_string()));
        (r, opened.into_inner().unwrap())
    }

    #[test]
    fn status_lists_the_servers() {
        let (dir, bin) = fake("status");
        let (r, opened) = go(&bin, json!({"op": "status"}));
        assert_eq!(r.unwrap(), json!([{"name": "acme-docs", "status": "needs-auth", "error": null, "connector": false}]));
        assert!(opened.is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn signin_opens_the_page_and_waits_until_the_server_is_in() {
        let (dir, bin) = fake("signin");
        let (r, opened) = go(&bin, json!({"op": "signin", "server": "acme-docs"}));
        assert_eq!(opened, vec!["https://docs.example.com/authorize"]);
        assert_eq!(r.unwrap()[0]["status"], "connected");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_connector_signin_opens_its_page_and_does_not_wait() {
        let (dir, bin) = fake("connector");
        std::fs::write(dir.join("callback"), "false").unwrap();
        std::fs::write(dir.join("after"), std::fs::read(dir.join("before")).unwrap()).unwrap();
        let t = Instant::now();
        let (r, opened) = go(&bin, json!({"op": "signin", "server": "acme-docs"}));
        assert!(t.elapsed() < Duration::from_secs(3) && opened.len() == 1);
        assert_eq!(r.unwrap()[0]["status"], "needs-auth");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_refused_reconnect_gives_claudes_message() {
        let (dir, bin) = fake("reconnect");
        std::fs::write(dir.join("fail"), "").unwrap();
        assert_eq!(go(&bin, json!({"op": "reconnect", "server": "acme-docs"})).0, Err("Connection failed".into()));
        std::fs::remove_file(dir.join("fail")).unwrap();
        assert!(go(&bin, json!({"op": "toggle", "server": "acme-docs", "on": false})).0.is_ok());
        assert!(go(&bin, json!({"op": "nope"})).0.is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
