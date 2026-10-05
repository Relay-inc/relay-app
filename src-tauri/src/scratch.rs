// Plain-text scratch notes per project: <vault>/.relay/notes/<project>/<id>.md, one small file each.
// Ids are made here and checked on every call, so a note can only ever be a file in its project's folder.

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

/// The project name as a folder name: no path separators, no leading dot; empty or over 120 chars is refused.
fn folder(project: &str) -> Result<String, String> {
    if project.is_empty() || project.len() > 120 { return Err("bad project".into()); }
    let f: String = project.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    let f = f.trim_start_matches('.').to_string();
    if f.is_empty() { Err("bad project".into()) } else { Ok(f) }
}
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) }
fn dir(vault: &str, project: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(vault).join(".relay/notes").join(folder(project)?))
}
fn new_id() -> String {
    let mut n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let mut s = Vec::new();
    while n > 0 { s.push(char::from_digit((n % 36) as u32, 36).unwrap()); n /= 36; }
    s.into_iter().rev().collect()
}

/// [{id, text, modified (unix seconds)}], newest first.
pub fn list(vault: &str, project: &str) -> Result<Value, String> {
    let mut notes = Vec::new();
    if let Ok(rd) = fs::read_dir(dir(vault, project)?) {
        for e in rd.flatten() {
            let p = e.path();
            let id = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if p.extension().and_then(|s| s.to_str()) != Some("md") || !valid_id(id) { continue; }
            let Ok(text) = fs::read_to_string(&p) else { continue };
            let modified = e.metadata().and_then(|m| m.modified()).ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            notes.push((modified, json!({"id": id, "text": text, "modified": modified})));
        }
    }
    notes.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(Value::Array(notes.into_iter().map(|n| n.1).collect()))
}

/// Create (no id) or overwrite a note through a tmp file; returns its id.
pub fn save(vault: &str, project: &str, id: Option<String>, text: &str) -> Result<String, String> {
    let id = id.unwrap_or_else(new_id);
    if !valid_id(&id) { return Err("bad id".into()); }
    let d = dir(vault, project)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let tmp = d.join(format!("{id}.tmp"));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, d.join(format!("{id}.md"))).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn delete(vault: &str, project: &str, id: &str) -> Result<(), String> {
    if !valid_id(id) { return Err("bad id".into()); }
    match fs::remove_file(dir(vault, project)?.join(format!("{id}.md"))) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_ids_stay_inside_the_project_folder() {
        assert_eq!(folder("A/B\\C:D").unwrap(), "A-B-C-D");
        assert_eq!(folder("..hidden").unwrap(), "hidden");
        assert!(folder("").is_err() && folder("...").is_err() && folder(&"x".repeat(121)).is_err());
        assert!(valid_id(&new_id()) && valid_id("a1b2"));
        assert!(!valid_id("") && !valid_id("../x") && !valid_id("A") && !valid_id("a.b"));
    }
    #[test]
    fn save_list_delete_round_trip() {
        let v = std::env::temp_dir().join(format!("relay-scratch-{}", new_id()));
        let v = v.to_str().unwrap();
        let id = save(v, "P", None, "hello").unwrap();
        save(v, "P", Some(id.clone()), "hello 2").unwrap();
        let l = list(v, "P").unwrap();
        assert_eq!(l[0]["text"], "hello 2");
        assert_eq!(l.as_array().unwrap().len(), 1);
        delete(v, "P", &id).unwrap();
        assert!(list(v, "P").unwrap().as_array().unwrap().is_empty());
        fs::remove_dir_all(v).ok();
    }
}
