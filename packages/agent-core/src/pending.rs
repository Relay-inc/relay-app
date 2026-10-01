//! The pending folder, for every provider: a permission request or question is `<id>.json`, the app's answer
//! `<id>.answer.json`. Files, not a socket: nothing listens on a port and a waiting question survives an app
//! restart. A provider either writes and polls the files itself (Claude's perm_server.py, relay false), or
//! raises [`crate::Event::Permission`]; the app then writes the request (relay true) and hands the answer to
//! [`crate::AgentProvider::respond`].
//!
//! The decision the app writes: `{"behavior":"allow","updatedInput":{…}}` or `{"behavior":"deny","message":"…"}`.
//! A question (kind "question") has `input.questions: [{question, options: [{label, description}], multiSelect}]`
//! and is answered with `updatedInput.answers: {<question>: "label, label"}`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn claude() -> String { "claude".into() }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub id: String,
    /// The app's conversation key.
    #[serde(default)]
    pub project: String,
    /// Requests from before the providers are Claude's.
    #[serde(default = "claude")]
    pub provider: String,
    /// "tool" or "question"; "" in old files, where tool_name AskUserQuestion is a question.
    #[serde(default)]
    pub kind: String,
    pub tool_name: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// The app passes the answer to the provider (true), or the provider reads the answer file (false).
    #[serde(default)]
    pub relay: bool,
    /// Seconds since the epoch, for the order of the cards.
    #[serde(default)]
    pub at: f64,
}

impl Request {
    /// A request raised in a provider's own protocol. The app fills in `project` and `provider`.
    pub fn new(kind: &str, tool_name: &str, input: Value) -> Self {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
        Request { id: new_id(), project: String::new(), provider: String::new(), kind: kind.into(), tool_name: tool_name.into(),
            input, tool_use_id: None, relay: true, at }
    }
}

/// 12 hex digits, unique enough for a folder of open requests.
pub fn new_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:012x}", h.finish() & 0xffff_ffff_ffff)
}
pub fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit()) }

fn req_path(dir: &Path, id: &str) -> PathBuf { dir.join(format!("{id}.json")) }
fn ans_path(dir: &Path, id: &str) -> PathBuf { dir.join(format!("{id}.answer.json")) }

/// Write a request atomically (a temp file, then a rename).
pub fn write(dir: &Path, r: &Request) -> std::io::Result<()> {
    if !valid_id(&r.id) { return Err(std::io::Error::other("bad id")); }
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{}.json.tmp", r.id));
    fs::write(&tmp, serde_json::to_string(r).unwrap_or_default())?;
    fs::rename(tmp, req_path(dir, &r.id))
}

/// The open requests, unanswered, oldest first, as stored (the webview draws the cards from them).
pub fn list(dir: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json") && !p.to_string_lossy().ends_with(".answer.json"))
        .filter(|p| !PathBuf::from(p.to_string_lossy().replace(".json", ".answer.json")).exists())
        .filter_map(|p| fs::read_to_string(p).ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
    out.sort_by(|a: &Value, b: &Value| a["at"].as_f64().unwrap_or(0.0).partial_cmp(&b["at"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
    out
}

pub fn read(dir: &Path, id: &str) -> Option<Request> {
    if !valid_id(id) { return None; }
    fs::read_to_string(req_path(dir, id)).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// Store the user's decision for a request.
pub fn answer(dir: &Path, id: &str, decision: &Value) -> Result<(), String> {
    if !valid_id(id) { return Err("bad id".into()); }
    fs::write(ans_path(dir, id), decision.to_string()).map_err(|e| e.to_string())
}

/// The decision for a request once there is one, removing both files.
pub fn take(dir: &Path, id: &str) -> Option<Value> {
    if !valid_id(id) { return None; }
    let d = fs::read_to_string(ans_path(dir, id)).ok().and_then(|s| serde_json::from_str(&s).ok())?;
    fs::remove_file(req_path(dir, id)).ok();
    fs::remove_file(ans_path(dir, id)).ok();
    Some(d)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_and_old_files() {
        let d = std::env::temp_dir().join(format!("vault-pending-{}", std::process::id()));
        let mut r = Request::new("tool", "Bash", serde_json::json!({"command": "ls"}));
        r.project = "c:1".into(); r.provider = "codex".into();
        write(&d, &r).unwrap();
        // a file perm_server.py wrote before the providers: no provider, kind or relay
        fs::write(d.join("abc123.json"), r#"{"id":"abc123","project":"p","at":1.0,"tool_name":"AskUserQuestion","input":{}}"#).unwrap();
        let open = list(&d);
        assert_eq!(open.len(), 2);
        assert_eq!(open[0]["id"], "abc123");
        let old = read(&d, "abc123").unwrap();
        assert_eq!((old.provider.as_str(), old.kind.as_str(), old.relay), ("claude", "", false));
        assert_eq!(read(&d, &r.id).unwrap(), r);
        assert!(take(&d, &r.id).is_none());
        answer(&d, &r.id, &serde_json::json!({"behavior": "allow"})).unwrap();
        assert_eq!(list(&d).len(), 1);
        assert_eq!(take(&d, &r.id).unwrap()["behavior"], "allow");
        assert!(read(&d, &r.id).is_none());
        assert!(answer(&d, "../x", &Value::Null).is_err());
        fs::remove_dir_all(d).ok();
    }
}
