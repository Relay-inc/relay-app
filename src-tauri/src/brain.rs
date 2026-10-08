// The Brain view's conversation glow: which notes of the vault and the brains Relay's conversations read and wrote,
// from the tool calls in their Claude Code transcripts.

use serde_json::{json, Value};
use std::path::Path;

/// A note a transcript touched: (root, path relative to it, when in ms, "read" or "write").
pub type Touch = (String, String, i64, &'static str);

/// The notes a transcript's tool calls read (Read, Commonwealth's MCP read) and wrote (Edit, MultiEdit, Write), at
/// or after `since` (ms). `roots` are canonical; a file outside every root is left out, and so is a staged note.
// ponytail: Grep/Glob hits and a `cat` through Bash do not count. Upgrade: parse Bash commands for note paths.
pub fn touches(text: &str, roots: &[String], since: i64) -> Vec<Touch> {
    let mut out = vec![];
    for line in text.lines() {
        if !line.contains("\"tool_use\"") { continue; }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let Some(at) = v["timestamp"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis()) else { continue };
        if at < since { continue; }
        for b in v["message"]["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "tool_use") {
            let name = b["name"].as_str().unwrap_or("");
            let input = &b["input"];
            let kind = match name { "Read" => "read", "Edit" | "MultiEdit" | "Write" => "write", _ => "" };
            if !kind.is_empty() {
                let Some(file) = input["file_path"].as_str().filter(|f| f.ends_with(".md")) else { continue };
                let real = std::fs::canonicalize(file).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| file.to_string());
                // the deepest root that holds it: a brain inside the vault's folder is the brain's
                if let Some((root, rel)) = roots.iter().filter_map(|r| Some((r, real.strip_prefix(r.as_str())?.strip_prefix('/')?))).max_by_key(|(r, _)| r.len()) {
                    if !rel.starts_with("staging/") { out.push((root.clone(), rel.to_string(), at, kind)); }
                }
            } else if name.starts_with("mcp__") && name.contains("commonwealth") && name.ends_with("__read") {
                // a brain-relative path, without the brain: the first root that has it
                let Some(rel) = input["path"].as_str().filter(|p| p.ends_with(".md") && !p.contains("..")) else { continue };
                if let Some(root) = roots.iter().find(|r| Path::new(r).join(rel).is_file()) { out.push((root.clone(), rel.to_string(), at, "read")); }
            }
        }
    }
    out
}

pub fn touch_json(key: &str, t: &Touch) -> Value { json!({"key": key, "root": t.0, "path": t.1, "at": t.2, "kind": t.3}) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_and_writes_inside_the_roots_count() {
        let d = std::env::temp_dir().join(format!("relay-touch-{}", std::process::id()));
        std::fs::create_dir_all(d.join("v/brain/memory")).unwrap();
        std::fs::write(d.join("v/brain/memory/m.md"), "x").unwrap();
        let v = crate::vault::canon(d.join("v").to_str().unwrap());
        let b = format!("{v}/brain");
        let line = |ts: &str, name: &str, input: Value| json!({"timestamp": ts, "message": {"content": [{"type": "tool_use", "name": name, "input": input}]}}).to_string();
        let text = [
            line("2026-10-08T10:00:00Z", "Read", json!({"file_path": format!("{v}/Notes/A.md")})),
            line("2026-10-08T10:01:00Z", "Edit", json!({"file_path": format!("{b}/memory/m.md")})),
            line("2026-10-08T10:02:00Z", "Read", json!({"file_path": "/etc/hosts.md"})),
            line("2026-10-08T10:03:00Z", "Bash", json!({"command": "ls"})),
            line("2026-10-08T10:04:00Z", "mcp__plugin_commonwealth_commonwealth__read", json!({"path": "memory/m.md"})),
            line("2026-10-08T10:05:00Z", "Write", json!({"file_path": format!("{b}/staging/s.md")})),
            line("2026-10-01T10:00:00Z", "Read", json!({"file_path": format!("{v}/Old.md")})),
        ].join("\n");
        let since = chrono::DateTime::parse_from_rfc3339("2026-10-05T00:00:00Z").unwrap().timestamp_millis();
        let got: Vec<(String, String, &str)> = touches(&text, &[v.clone(), b.clone()], since).into_iter().map(|t| (t.0, t.1, t.3)).collect();
        assert_eq!(got, vec![(v.clone(), "Notes/A.md".into(), "read"), (b.clone(), "memory/m.md".into(), "write"), (b, "memory/m.md".into(), "read")]);
    }

    /// cargo test real_touches -- --ignored --nocapture: the last 7 days of this Mac's vault transcripts
    #[test]
    #[ignore]
    fn real_touches() {
        let home = std::env::var("HOME").unwrap();
        let roots = vec![crate::vault::canon(&format!("{home}/vault")), crate::vault::canon(&format!("{home}/projects/antenna-brain"))];
        let since = chrono::Utc::now().timestamp_millis() - 7 * 86_400_000;
        let dir = format!("{home}/.claude/projects/-Users-kristof-vault");
        let (mut n, mut files) = (std::collections::HashMap::new(), 0);
        for f in std::fs::read_dir(dir).unwrap().flatten().filter(|f| f.path().extension().is_some_and(|x| x == "jsonl")) {
            files += 1;
            for t in touches(&std::fs::read_to_string(f.path()).unwrap_or_default(), &roots, since) { *n.entry((crate::commonwealth::brain_name(&t.0).to_string(), t.3)).or_insert(0) += 1; }
        }
        println!("{files} transcripts: {n:?}");
    }
}
