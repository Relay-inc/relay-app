// Scratch notes per project, the notes drawer's: Inbox notes of the vault (inbox.rs) with `about: "[[<Project>]]"`, so
// Claude, Obsidian and search see them and filing moves them out like any capture. A note's id is its file name in
// the Inbox, checked on every call. Before, they were plain files in <vault>/.relay/notes/<project>/<id>.md.

use crate::inbox;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The project name as a folder name: no path separators, no leading dot; empty or over 120 chars is refused.
fn folder(project: &str) -> Result<String, String> {
    if project.is_empty() || project.len() > 120 { return Err("bad project".into()); }
    let f: String = project.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    let f = f.trim_start_matches('.').to_string();
    if f.is_empty() { Err("bad project".into()) } else { Ok(f) }
}
/// An Inbox note's file name without `.md`: nothing that could leave the folder or hide.
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 100 && !id.starts_with('.') && !id.chars().any(|c| matches!(c, '/' | '\\') || c.is_control()) }
/// The folder the notes of a project had before they moved into the Inbox.
pub fn dir(vault: &str, project: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(vault).join(".relay/notes").join(folder(project)?))
}
fn about(project: &str) -> String { format!("[[{}]]", project.trim()) }
fn is_about(text: &str, project: &str) -> bool {
    inbox::split(text).0.and_then(|fm| crate::vault::field(fm, "about")).is_some_and(|a| a.eq_ignore_ascii_case(&about(project)))
}
fn with_about(project: &str, text: &str) -> String { format!("---\nabout: \"{}\"\n---\n\n{}", about(project), text) }
fn body(text: &str) -> &str { inbox::split(text).1.trim_start_matches('\n') }
fn file(vault: &str, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) { return Err("bad id".into()); }
    Ok(inbox::dir(Path::new(vault)).join(format!("{id}.md")))
}
fn modified(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// [{id, text, modified (unix seconds)}], newest first: the Inbox notes about the project.
pub fn list(vault: &str, project: &str) -> Result<Value, String> {
    folder(project)?;
    let mut notes = Vec::new();
    for e in fs::read_dir(inbox::dir(Path::new(vault))).into_iter().flatten().flatten() {
        let p = e.path();
        let id = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if p.extension().and_then(|s| s.to_str()) != Some("md") || !valid_id(id) { continue; }
        let Ok(text) = fs::read_to_string(&p) else { continue };
        if !is_about(&text, project) { continue; }
        let m = modified(&p);
        notes.push((m, json!({"id": id, "text": body(&text), "modified": m})));
    }
    notes.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1["id"].as_str().cmp(&a.1["id"].as_str())));
    Ok(Value::Array(notes.into_iter().map(|n| n.1).collect()))
}

/// Create (no id) or overwrite the text of a project's note; returns its id. Another project's note, or one that is
/// not about a project, is never written through this.
pub fn save(vault: &str, project: &str, id: Option<String>, text: &str) -> Result<String, String> {
    folder(project)?;
    let root = Path::new(vault);
    let Some(id) = id else {
        let made = inbox::create(root, &with_about(project, text), chrono::Local::now())?;
        return Ok(made.trim_start_matches("Inbox/").trim_end_matches(".md").to_string());
    };
    let p = file(vault, &id)?;
    let now = fs::read_to_string(&p).map_err(|_| "this note is gone".to_string())?;
    if !is_about(&now, project) { return Err("not this project's note".into()); }
    // the frontmatter as it is (filing may have added to it), the body is what was typed
    let fm = inbox::split(&now).0.map(|f| format!("---\n{f}\n---\n\n")).unwrap_or_default();
    crate::util::write_file(&p, format!("{fm}{text}"))?;
    Ok(id)
}

pub fn delete(vault: &str, project: &str, id: &str) -> Result<(), String> {
    let p = file(vault, id)?;
    match fs::read_to_string(&p) {
        Ok(t) if is_about(&t, project) => fs::remove_file(&p).map_err(|e| e.to_string()),
        Ok(_) => Err("not this project's note".into()),
        Err(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("relay-scratch-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        d.to_string_lossy().into_owned()
    }

    #[test]
    fn names_and_ids_stay_inside_their_folder() {
        assert_eq!(folder("A/B\\C:D").unwrap(), "A-B-C-D");
        assert_eq!(folder("..hidden").unwrap(), "hidden");
        assert!(folder("").is_err() && folder("...").is_err() && folder(&"x".repeat(121)).is_err());
        assert!(valid_id("2026-11-04 1432") && valid_id("a1b2"));
        assert!(!valid_id("") && !valid_id("../x") && !valid_id(".hidden") && !valid_id("a/b") && !valid_id("a\nb"));
    }

    #[test]
    fn save_list_delete_round_trip_in_the_inbox_and_only_for_the_projects_own_notes() {
        let v = tmp("round");
        let id = save(&v, "Beacon", None, "hello").unwrap();
        assert!(fs::read_to_string(Path::new(&v).join(format!("Inbox/{id}.md"))).unwrap().starts_with("---\nabout: \"[[Beacon]]\"\n---\n\nhello"));
        save(&v, "Beacon", Some(id.clone()), "hello 2").unwrap();
        let l = list(&v, "Beacon").unwrap();
        assert_eq!((l[0]["text"].as_str(), l.as_array().unwrap().len()), (Some("hello 2"), 1));
        assert!(list(&v, "Atlas").unwrap().as_array().unwrap().is_empty());
        // a capture without `about:` and another project's note are not this one's
        crate::inbox::create(Path::new(&v), "plain capture\n", chrono::Local::now() + chrono::Duration::minutes(5)).unwrap();
        assert!(list(&v, "Beacon").unwrap().as_array().unwrap().len() == 1);
        assert!(save(&v, "Atlas", Some(id.clone()), "mine now").is_err() && delete(&v, "Atlas", &id).is_err());
        // filing added a type: a later save keeps it
        let p = Path::new(&v).join(format!("Inbox/{id}.md"));
        fs::write(&p, format!("---\ntype: Document\nabout: \"[[Beacon]]\"\n---\n\nhello 2")).unwrap();
        save(&v, "Beacon", Some(id.clone()), "hello 3").unwrap();
        assert!(fs::read_to_string(&p).unwrap().contains("type: Document") && list(&v, "Beacon").unwrap()[0]["text"] == "hello 3");
        delete(&v, "Beacon", &id).unwrap();
        assert!(list(&v, "Beacon").unwrap().as_array().unwrap().is_empty());
    }
}
