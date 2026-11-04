// Scratch notes per project, the notes drawer's: Inbox notes of the vault (inbox.rs) with `about: "[[<Project>]]"`, so
// Claude, Obsidian and search see them and filing moves them out like any capture. A note's id is its file name in
// the Inbox, checked on every call. Before, they were plain files in <vault>/.relay/notes/<project>/<id>.md: those are
// moved into the Inbox by `migrate`, which shows what it would do first (`plan`) and keeps a journal for its Undo.

use crate::inbox;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
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
fn legacy_id(id: &str) -> bool { !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) }
fn about(project: &str) -> String { format!("[[{}]]", project.trim()) }
fn is_about(text: &str, project: &str) -> bool {
    inbox::split(text).0.and_then(|fm| inbox::field(fm, "about")).is_some_and(|a| a.eq_ignore_ascii_case(&about(project)))
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
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, format!("{fm}{text}")).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
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

// ---------- the notes of before: .relay/notes/<project>/<id>.md

/// One note still in `.relay/notes`, and where it goes: the project, its old id, its text, its name in the Inbox.
#[derive(Debug, Clone, PartialEq)]
pub struct Move { pub project: String, pub id: String, pub text: String, pub to: String }

fn journal(vault: &str) -> PathBuf { Path::new(vault).join(".relay/scratch-migration.json") }

/// What `migrate` would do now, read and not written: every old note, named for the minute it was last changed
/// (a name taken gets a number), the newest first.
pub fn plan(vault: &str) -> Vec<Move> {
    let mut old: Vec<(u64, Move)> = vec![];
    for d in fs::read_dir(Path::new(vault).join(".relay/notes")).into_iter().flatten().flatten() {
        let project = d.file_name().to_string_lossy().into_owned();
        if !d.path().is_dir() || folder(&project).is_err() { continue; }
        for e in fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let p = e.path();
            let id = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if p.extension().and_then(|s| s.to_str()) != Some("md") || !legacy_id(&id) { continue; }
            let Ok(text) = fs::read_to_string(&p) else { continue };
            old.push((modified(&p), Move { project: project.clone(), id, text, to: String::new() }));
        }
    }
    old.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let mut taken: std::collections::HashSet<String> = fs::read_dir(inbox::dir(Path::new(vault))).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect();
    old.into_iter().map(|(m, mut mv)| {
        let secs = i64::try_from(m).unwrap_or(0);
        let when = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default().with_timezone(&chrono::Local);
        let stem = when.format("%Y-%m-%d %H%M").to_string();
        let name = (0..).map(|i| if i == 0 { stem.clone() } else { format!("{stem} {i}") }).find(|n| !taken.contains(&format!("{n}.md").to_lowercase())).unwrap();
        taken.insert(format!("{name}.md").to_lowercase());
        mv.to = name;
        mv
    }).collect()
}

/// Move every old note into the Inbox with `about:` set, and write the journal Undo needs. Each note is written to its
/// new place before the old file goes, so a stop halfway loses nothing. Returns the moves made.
pub fn migrate(vault: &str) -> Result<Vec<Move>, String> {
    let moves = plan(vault);
    if moves.is_empty() { return Ok(moves); }
    let dir = inbox::dir(Path::new(vault));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut done: Vec<Move> = vec![];
    for m in &moves {
        let text = with_about(&m.project, &m.text);
        let mut f = crate::pagefiles::new_file(&dir.join(format!("{}.md", m.to))).map_err(|e| e.to_string())?;
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        fs::remove_file(dir_of(vault, m)?).map_err(|e| e.to_string())?;
        done.push(m.clone());
    }
    let entries: Vec<Value> = done.iter().map(|m| json!({"project": m.project, "id": m.id, "text": m.text, "to": m.to})).collect();
    fs::write(journal(vault), json!({"moves": entries}).to_string()).map_err(|e| e.to_string())?;
    // the folders that are empty now go; one that holds anything else stays
    for d in fs::read_dir(Path::new(vault).join(".relay/notes")).into_iter().flatten().flatten() { fs::remove_dir(d.path()).ok(); }
    Ok(done)
}
fn dir_of(vault: &str, m: &Move) -> Result<PathBuf, String> { Ok(dir(vault, &m.project)?.join(format!("{}.md", m.id))) }

/// Put the last migration back: each note into `.relay/notes` as it was, unless it was edited since (it stays in the
/// Inbox, and counts in the second number). Returns (put back, left).
pub fn undo(vault: &str) -> Result<(usize, usize), String> {
    let j: Value = serde_json::from_str(&fs::read_to_string(journal(vault)).map_err(|_| "nothing to undo".to_string())?).map_err(|e| e.to_string())?;
    let (mut back, mut left) = (0, 0);
    for m in j["moves"].as_array().into_iter().flatten() {
        let (project, id, text, to) = (m["project"].as_str().unwrap_or(""), m["id"].as_str().unwrap_or(""), m["text"].as_str().unwrap_or(""), m["to"].as_str().unwrap_or(""));
        if !legacy_id(id) || !valid_id(to) { left += 1; continue; }
        let at = file(vault, to)?;
        let (target, same) = (dir(vault, project)?, fs::read_to_string(&at).is_ok_and(|now| now == with_about(project, text)));
        if !same { left += 1; continue; }
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        fs::write(target.join(format!("{id}.md")), text).map_err(|e| e.to_string())?;
        fs::remove_file(&at).map_err(|e| e.to_string())?;
        back += 1;
    }
    fs::remove_file(journal(vault)).ok();
    Ok((back, left))
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
    fn old(v: &str, project: &str, id: &str, text: &str) {
        let d = dir(v, project).unwrap();
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join(format!("{id}.md")), text).unwrap();
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

    #[test]
    fn the_migration_shows_its_plan_moves_the_notes_and_one_undo_puts_them_back() {
        let v = tmp("migrate");
        old(&v, "Beacon", "lxyz1", "Ask Eva about the tax rule");
        old(&v, "Atlas Logistics", "lxyz2", "Rates for Q1");
        fs::create_dir_all(Path::new(&v).join("Inbox")).unwrap();
        let p = plan(&v);
        assert_eq!(p.len(), 2);
        assert!(p.iter().all(|m| m.to.len() >= 15 && m.to.as_bytes()[10] == b' '), "named for the minute: {p:?}");
        assert_ne!(p[0].to, p[1].to, "two notes of one minute get two names");
        // the plan is only read
        assert!(dir(&v, "Beacon").unwrap().join("lxyz1.md").exists() && list(&v, "Beacon").unwrap().as_array().unwrap().is_empty());
        let done = migrate(&v).unwrap();
        assert_eq!(done.len(), 2);
        assert_eq!(list(&v, "Beacon").unwrap()[0]["text"], "Ask Eva about the tax rule");
        assert_eq!(list(&v, "Atlas Logistics").unwrap()[0]["text"], "Rates for Q1");
        assert!(plan(&v).is_empty() && !Path::new(&v).join(".relay/notes/Beacon").exists());
        // one note edited since stays; the other goes back
        let edited = list(&v, "Beacon").unwrap()[0]["id"].as_str().unwrap().to_string();
        save(&v, "Beacon", Some(edited), "Ask Eva, then Sam").unwrap();
        assert_eq!(undo(&v).unwrap(), (1, 1));
        assert_eq!(fs::read_to_string(dir(&v, "Atlas Logistics").unwrap().join("lxyz2.md")).unwrap(), "Rates for Q1");
        assert_eq!(list(&v, "Beacon").unwrap()[0]["text"], "Ask Eva, then Sam");
        assert!(undo(&v).is_err(), "one Undo per migration");
        fs::remove_dir_all(&v).ok();
    }
}
