// Which notes of the workspaces Relay's conversations read and wrote, from the tool calls in their Claude Code
// transcripts: Recent in the Pages tab, and the glow in the Pages graph.

use serde_json::{json, Value};

/// A note a transcript touched: (root, path relative to it, when in ms, "read" or "write").
pub type Touch = (String, String, i64, &'static str);

/// The notes a transcript's tool calls read (Read) and wrote (Edit, MultiEdit, Write), at or after `since` (ms).
/// `roots` are canonical; a file outside every root is left out.
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
            let kind = match name { "Read" => "read", "Edit" | "MultiEdit" | "Write" => "write", _ => "" };
            if kind.is_empty() { continue; }
            let Some(file) = b["input"]["file_path"].as_str().filter(|f| f.ends_with(".md")) else { continue };
            let real = std::fs::canonicalize(file).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| file.to_string());
            // the deepest root that holds it: a workspace inside the vault's folder is that workspace's
            if let Some((root, rel)) = roots.iter().filter_map(|r| Some((r, real.strip_prefix(r.as_str())?.strip_prefix('/')?))).max_by_key(|(r, _)| r.len()) {
                out.push((root.clone(), rel.to_string(), at, kind));
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
        std::fs::create_dir_all(d.join("v/team/memory")).unwrap();
        std::fs::write(d.join("v/team/memory/m.md"), "x").unwrap();
        let v = crate::vault::canon(d.join("v").to_str().unwrap());
        let w = format!("{v}/team");
        let line = |ts: &str, name: &str, input: Value| json!({"timestamp": ts, "message": {"content": [{"type": "tool_use", "name": name, "input": input}]}}).to_string();
        let text = [
            line("2026-10-08T10:00:00Z", "Read", json!({"file_path": format!("{v}/Notes/A.md")})),
            line("2026-10-08T10:01:00Z", "Edit", json!({"file_path": format!("{w}/memory/m.md")})),
            line("2026-10-08T10:02:00Z", "Read", json!({"file_path": "/etc/hosts.md"})),
            line("2026-10-08T10:03:00Z", "Bash", json!({"command": "ls"})),
            line("2026-10-01T10:00:00Z", "Read", json!({"file_path": format!("{v}/Old.md")})),
        ].join("\n");
        let since = chrono::DateTime::parse_from_rfc3339("2026-10-05T00:00:00Z").unwrap().timestamp_millis();
        let got: Vec<(String, String, &str)> = touches(&text, &[v.clone(), w.clone()], since).into_iter().map(|t| (t.0, t.1, t.3)).collect();
        assert_eq!(got, vec![(v, "Notes/A.md".into(), "read"), (w, "memory/m.md".into(), "write")]);
    }
}
