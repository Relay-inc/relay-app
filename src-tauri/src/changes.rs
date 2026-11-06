// The Changes feed: everything a Relay-run Claude job (a conversation's capture, a page action) wrote to a vault, kept
// for review after the fact. Before a job the vault's markdown is read into memory; after it, the files that differ
// become one entry in `<vault>/.relay/changes/<id>.json` with {before, after} per file, kept 30 days. Keep marks a file
// as read. Undo writes `before` back only while the file still is `after`; a note edited since is never overwritten:
// Undo answers with the three texts and the page merges them (domain/workspace/merge.ts), then `resolve` writes the
// result. The folder is hidden, so no Pages walk, index, ⌘K search or shared sync reads it (vaultsync.rs adds it to git
// with an exclusion, the shared rounds skip `.relay`); `exclusion` below holds each of them to that.
//
// An entry: {id, at (ms), source ("capture" | "action:<name>"), subject (the conversation's title or the note's name),
// reason (one line), files: [{path, before, after (text, null when the file did not exist / was removed), state
// ("open" | "kept" | "undone")}]}.

use agent_core::usage::now_ms;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex};

const KEEP_MS: i64 = 30 * 86_400_000;
/// ponytail: a bigger note is neither read before a job nor recorded; a diff view of it would not be readable anyway
const MAX_BYTES: u64 = 1 << 20;

/// The vault's notes before a job: path (relative) -> text.
pub type Snap = HashMap<String, String>;

// read-modify-write of an entry's file: one at a time
static LOCK: Mutex<()> = Mutex::new(());
// notes the app's own editor saved: path -> hash of the text it wrote. A job that ran meanwhile did not write those
// (the editor merges outside changes), so they are not its changes: Undo would take typed text away.
static TYPED: LazyLock<Mutex<HashMap<PathBuf, String>>> = LazyLock::new(Default::default);

/// A page's save (`write_note`) wrote this note: the job running now is not its author.
pub fn typed(file: &Path, hash: &str) {
    let file = crate::vault::canon_path(file);
    TYPED.lock().unwrap().insert(file, hash.to_string());
}

/// `path` is a note of the workspace `root`: relative, nothing hidden, a .md file that exists.
pub fn note_in(root: &Path, path: &str) -> Result<(), String> {
    let plain = Path::new(path).components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')));
    if plain && path.ends_with(".md") && root.join(path).is_file() { Ok(()) } else { Err(format!("not a note of this workspace: {path}")) }
}

fn dir(root: &Path) -> PathBuf { root.join(".relay").join("changes") }

/// The vault's markdown as it is now (what `pagefiles::all_files` lists: nothing hidden, so not `.relay` either).
pub fn snap(root: &Path) -> Snap {
    crate::pagefiles::all_files(root).into_iter().filter(|p| p.ends_with(".md"))
        .filter(|p| fs::metadata(root.join(p)).is_ok_and(|m| m.len() <= MAX_BYTES))
        .filter_map(|p| Some((p.clone(), fs::read_to_string(root.join(&p)).ok()?))).collect()
}

/// The entry a job left, written; None when it changed no note. `before` is `snap` from before the job.
pub fn record(root: &Path, before: &Snap, source: &str, subject: &str, reason: &str) -> Result<Option<String>, String> {
    let after = snap(root);
    let typed = TYPED.lock().unwrap().clone();
    let mut files: Vec<Value> = vec![];
    let mut paths: Vec<&String> = before.keys().chain(after.keys().filter(|p| !before.contains_key(*p))).collect();
    paths.sort();
    for p in paths {
        let (b, a) = (before.get(p), after.get(p));
        if b == a { continue; }
        if a.is_some_and(|a| typed.get(&root.join(p)).is_some_and(|h| *h == crate::vault::text_hash(a))) { continue; }
        files.push(json!({"path": p, "before": b, "after": a, "state": "open"}));
    }
    write_entry(root, source, subject, reason, files)
}

/// An entry for writes the app made itself (a meeting's briefing, summary, decision or follow-up mark, written from the
/// webview): `(path, before, after)` per note, the path relative to `root`. Notes whose text did not change are left out;
/// None when nothing is left or a path is no note of the workspace.
pub fn record_files(root: &Path, source: &str, subject: &str, reason: &str, notes: &[(String, Option<String>, Option<String>)]) -> Result<Option<String>, String> {
    let mut files = vec![];
    for (path, before, after) in notes {
        let plain = Path::new(path).components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')));
        if !plain || !path.ends_with(".md") { return Err(format!("not a note of this workspace: {path}")); }
        if before != after { files.push(json!({"path": path, "before": before, "after": after, "state": "open"})); }
    }
    write_entry(root, source, subject, reason, files)
}

fn write_entry(root: &Path, source: &str, subject: &str, reason: &str, files: Vec<Value>) -> Result<Option<String>, String> {
    if files.is_empty() { return Ok(None); }
    let _lock = LOCK.lock().unwrap();
    let at = now_ms();
    let id = format!("{at}-{}", &relay_remote::tls::random_secret()[..6]);
    let entry = json!({"id": id, "at": at, "source": source, "subject": subject, "reason": reason.trim(), "files": files});
    save(root, &entry)?;
    prune(root, at);
    Ok(Some(id))
}

fn save(root: &Path, entry: &Value) -> Result<(), String> {
    let d = dir(root);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let path = d.join(format!("{}.json", entry["id"].as_str().unwrap_or("x")));
    crate::util::write_file(&path, entry.to_string())
}
fn load(root: &Path, id: &str) -> Result<Value, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return Err("not a change".into()); }
    let text = fs::read_to_string(dir(root).join(format!("{id}.json"))).map_err(|_| "this change is gone".to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
/// Entries older than 30 days go.
fn prune(root: &Path, now: i64) {
    for e in fs::read_dir(dir(root)).into_iter().flatten().flatten() {
        let at = e.file_name().to_string_lossy().split('-').next().and_then(|n| n.parse::<i64>().ok());
        if at.is_some_and(|at| now.saturating_sub(at) > KEEP_MS) { fs::remove_file(e.path()).ok(); }
    }
}

/// Every entry, newest first.
pub fn list(root: &Path) -> Vec<Value> {
    let _lock = LOCK.lock().unwrap();
    prune(root, now_ms());
    let mut out: Vec<Value> = fs::read_dir(dir(root)).into_iter().flatten().flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str(&fs::read_to_string(e.path()).ok()?).ok()).collect();
    out.sort_by_key(|e| std::cmp::Reverse(e["at"].as_u64().unwrap_or(0)));
    out
}

fn file_mut<'a>(entry: &'a mut Value, path: &str) -> Result<&'a mut Value, String> {
    entry["files"].as_array_mut().and_then(|f| f.iter_mut().find(|f| f["path"] == path)).ok_or_else(|| format!("not in this change: {path}"))
}
/// Mark a note of an entry (all of them when `path` is None) as read; one that is open only.
pub fn keep(root: &Path, id: &str, path: Option<&str>) -> Result<(), String> {
    let _lock = LOCK.lock().unwrap();
    let mut entry = load(root, id)?;
    for f in entry["files"].as_array_mut().into_iter().flatten().filter(|f| path.is_none_or(|p| f["path"] == p) && f["state"] == "open") { f["state"] = json!("kept"); }
    save(root, &entry)
}

fn put(root: &Path, rel: &str, text: Option<&str>) -> Result<(), String> {
    // the path came out of our own snapshot, but a hand-edited entry must not write outside the vault
    if !Path::new(rel).components().all(|c| matches!(c, Component::Normal(_))) { return Err(format!("not a note: {rel}")); }
    let file = root.join(rel);
    let Some(text) = text else { return match fs::remove_file(&file) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) } };
    if let Some(p) = file.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    crate::util::write_file(&file, text)
}
fn now_text(root: &Path, rel: &str) -> Option<String> { fs::read_to_string(root.join(rel)).ok() }
fn str_of(v: &Value) -> Option<String> { v.as_str().map(String::from) }

/// What Undo did: `Done`, or `Merge` when the note is not what the job left: the three texts for the page to merge
/// (`current` empty when the note is gone), and nothing written.
pub enum Undone { Done, Merge { current: Option<String>, before: Option<String>, after: Option<String> } }

/// Put a note back as it was before the job, while it still is what the job left.
pub fn undo(root: &Path, id: &str, path: &str) -> Result<Undone, String> {
    let _lock = LOCK.lock().unwrap();
    let mut entry = load(root, id)?;
    let f = file_mut(&mut entry, path)?;
    if f["state"] != "open" { return Err("already reviewed".into()); }
    let (before, after) = (str_of(&f["before"]), str_of(&f["after"]));
    let current = now_text(root, path);
    if current != after { return Ok(Undone::Merge { current, before, after }); }
    put(root, path, before.as_deref())?;
    f["state"] = json!("undone");
    save(root, &entry)?;
    Ok(Undone::Done)
}

/// Write what the user decided after a Merge: only while the note still is `expect` (what the merge was made from),
/// so a later edit is not lost either.
pub fn resolve(root: &Path, id: &str, path: &str, expect: Option<&str>, text: &str) -> Result<(), String> {
    let _lock = LOCK.lock().unwrap();
    let mut entry = load(root, id)?;
    let f = file_mut(&mut entry, path)?;
    if f["state"] != "open" { return Err("already reviewed".into()); }
    if now_text(root, path).as_deref() != expect { return Err("changed".into()); }
    put(root, path, Some(text))?;
    f["state"] = json!("undone");
    save(root, &entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-changes-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join("Projects")).unwrap();
        fs::write(d.join("Projects/Beacon.md"), "## Decisions\n- old decision\n").unwrap();
        fs::write(d.join("Projects/Findings.md"), "## Status\nGo live in sprint 24.\n").unwrap();
        fs::write(d.join("Projects/Untouched.md"), "same\n").unwrap();
        fs::canonicalize(d).unwrap() // as the commands get it (vault::canon)
    }
    /// A capture run that edits two notes and adds a third.
    fn capture(d: &Path) -> String {
        let before = snap(d);
        fs::write(d.join("Projects/Beacon.md"), "## Decisions\n- old decision\n- new decision\n").unwrap();
        fs::write(d.join("Projects/Findings.md"), "## Status\nDry run in sprint 24.\n").unwrap();
        record(d, &before, "capture", "Pricewise check", "Decision: dry run first").unwrap().unwrap()
    }
    fn read(d: &Path, p: &str) -> String { fs::read_to_string(d.join(p)).unwrap() }

    #[test]
    fn a_run_that_edits_two_notes_is_one_entry_with_its_reason() {
        let d = vault("record");
        let id = capture(&d);
        let all = list(&d);
        assert_eq!(all.len(), 1);
        let e = &all[0];
        assert_eq!((e["id"].as_str().unwrap(), e["source"].as_str().unwrap(), e["subject"].as_str().unwrap(), e["reason"].as_str().unwrap()), (id.as_str(), "capture", "Pricewise check", "Decision: dry run first"));
        let paths: Vec<&str> = e["files"].as_array().unwrap().iter().map(|f| f["path"].as_str().unwrap()).collect();
        assert_eq!(paths, ["Projects/Beacon.md", "Projects/Findings.md"]); // the untouched note is not in it
        assert_eq!(e["files"][1]["before"], "## Status\nGo live in sprint 24.\n");
        assert_eq!(e["files"][1]["after"], "## Status\nDry run in sprint 24.\n");
        // a run that wrote nothing leaves no entry
        let before = snap(&d);
        assert_eq!(record(&d, &before, "capture", "x", "").unwrap(), None);
    }

    #[test]
    fn undo_restores_one_note_and_the_other_stays() {
        let d = vault("undo");
        let id = capture(&d);
        assert!(matches!(undo(&d, &id, "Projects/Findings.md").unwrap(), Undone::Done));
        assert_eq!(read(&d, "Projects/Findings.md"), "## Status\nGo live in sprint 24.\n");
        assert!(read(&d, "Projects/Beacon.md").contains("new decision"));
        let e = &list(&d)[0];
        assert_eq!((e["files"][0]["state"].as_str(), e["files"][1]["state"].as_str()), (Some("open"), Some("undone")));
        // an undone note cannot be undone twice
        assert!(undo(&d, &id, "Projects/Findings.md").is_err());
    }

    #[test]
    fn undo_after_an_edit_since_never_overwrites() {
        let d = vault("edited");
        let id = capture(&d);
        // the user typed in the same note after the job
        let mine = "## Status\nDry run in sprint 24.\nMy own line.\n";
        fs::write(d.join("Projects/Findings.md"), mine).unwrap();
        let Undone::Merge { current, before, after } = undo(&d, &id, "Projects/Findings.md").unwrap() else { panic!("must not undo over an edit") };
        assert_eq!(read(&d, "Projects/Findings.md"), mine, "nothing written by Undo");
        assert_eq!((current.as_deref(), before.as_deref(), after.as_deref()), (Some(mine), Some("## Status\nGo live in sprint 24.\n"), Some("## Status\nDry run in sprint 24.\n")));
        assert_eq!(list(&d)[0]["files"][1]["state"], "open");
        // the merge the page made is written only while the note is still what it was made from
        assert_eq!(resolve(&d, &id, "Projects/Findings.md", Some("something else"), "x"), Err("changed".into()));
        assert_eq!(read(&d, "Projects/Findings.md"), mine);
        let merged = "## Status\nGo live in sprint 24.\nMy own line.\n";
        resolve(&d, &id, "Projects/Findings.md", Some(mine), merged).unwrap();
        assert_eq!(read(&d, "Projects/Findings.md"), merged);
        assert_eq!(list(&d)[0]["files"][1]["state"], "undone");
    }

    #[test]
    fn a_created_and_a_removed_note_undo_too() {
        let d = vault("created");
        let before = snap(&d);
        fs::write(d.join("Projects/New.md"), "made by the job\n").unwrap();
        fs::remove_file(d.join("Projects/Untouched.md")).unwrap();
        let id = record(&d, &before, "action:split", "Beacon", "").unwrap().unwrap();
        assert!(matches!(undo(&d, &id, "Projects/New.md").unwrap(), Undone::Done));
        assert!(matches!(undo(&d, &id, "Projects/Untouched.md").unwrap(), Undone::Done));
        assert!(!d.join("Projects/New.md").exists());
        assert_eq!(read(&d, "Projects/Untouched.md"), "same\n");
        // a note the user recreated since the job removed it is not replaced either
        let before = snap(&d);
        fs::remove_file(d.join("Projects/Untouched.md")).unwrap();
        let id = record(&d, &before, "capture", "x", "").unwrap().unwrap();
        fs::write(d.join("Projects/Untouched.md"), "mine\n").unwrap();
        assert!(matches!(undo(&d, &id, "Projects/Untouched.md").unwrap(), Undone::Merge { .. }));
        assert_eq!(read(&d, "Projects/Untouched.md"), "mine\n");
    }

    #[test]
    fn keep_marks_notes_and_a_page_the_user_saved_is_not_the_jobs() {
        let d = vault("keep");
        let before = snap(&d);
        fs::write(d.join("Projects/Beacon.md"), "typed in the editor\n").unwrap();
        typed(&d.join("Projects/Beacon.md"), &crate::vault::text_hash("typed in the editor\n"));
        fs::write(d.join("Projects/Findings.md"), "by the job\n").unwrap();
        let id = record(&d, &before, "capture", "x", "").unwrap().unwrap();
        let e = &list(&d)[0];
        assert_eq!(e["files"].as_array().unwrap().len(), 1, "only the job's own change");
        keep(&d, &id, None).unwrap();
        assert_eq!(list(&d)[0]["files"][0]["state"], "kept");
        assert!(undo(&d, &id, "Projects/Findings.md").is_err());
    }

    #[test]
    fn writes_the_app_made_are_one_entry_that_undo_restores_exactly() {
        // a wrap-up's Accept: the meeting note changed, and a decision added to a project note by its own entry
        let d = vault("app");
        let (before, after) = ("## Notes\n- x\n".to_string(), "## Notes\n- x\n\n## Summary\nDone.\n".to_string());
        fs::write(d.join("Projects/Beacon.md"), &after).unwrap();
        let notes = [("Projects/Beacon.md".to_string(), Some(before.clone()), Some(after.clone())), ("Projects/Findings.md".to_string(), Some("same".into()), Some("same".into()))];
        let id = record_files(&d, "wrap-up", "Beacon sync", "Summary for Beacon sync", &notes).unwrap().unwrap();
        let e = &list(&d)[0];
        assert_eq!((e["source"].as_str(), e["reason"].as_str(), e["files"].as_array().map(Vec::len)), (Some("wrap-up"), Some("Summary for Beacon sync"), Some(1)));
        assert_eq!((e["files"][0]["before"].as_str(), e["files"][0]["after"].as_str()), (Some(before.as_str()), Some(after.as_str())));
        // a new meeting note (a prep on a day without one) is undone by removing it
        let id2 = record_files(&d, "prep", "Beacon sync", "Briefing for Beacon sync", &[("Projects/Meeting.md".into(), None, Some("briefing".into()))]).unwrap().unwrap();
        fs::write(d.join("Projects/Meeting.md"), "briefing").unwrap();
        assert!(matches!(undo(&d, &id2, "Projects/Meeting.md").unwrap(), Undone::Done));
        assert!(!d.join("Projects/Meeting.md").exists());
        assert!(matches!(undo(&d, &id, "Projects/Beacon.md").unwrap(), Undone::Done));
        assert_eq!(read(&d, "Projects/Beacon.md"), before);
        // nothing changed: no entry; a path outside the notes: refused
        assert_eq!(record_files(&d, "prep", "x", "", &[("Projects/Beacon.md".into(), Some("a".into()), Some("a".into()))]).unwrap(), None);
        assert!(record_files(&d, "prep", "x", "", &[("../x.md".into(), None, Some("a".into()))]).is_err());
    }

    #[test]
    fn entries_go_after_30_days() {
        let d = vault("prune");
        let id = capture(&d);
        let old = format!("{}-abcdef", now_ms() - KEEP_MS - 1000);
        fs::copy(dir(&d).join(format!("{id}.json")), dir(&d).join(format!("{old}.json"))).unwrap();
        assert_eq!(list(&d).len(), 1);
        assert!(!dir(&d).join(format!("{old}.json")).exists());
    }

    #[test]
    fn exclusion() {
        // what the job removed lives only in the entry: no walk, index or search of the vault may surface it
        let d = vault("exclusion");
        fs::write(d.join("Projects/Findings.md"), "## Status\nzebraquartz in the old text.\n").unwrap();
        let before = snap(&d);
        fs::write(d.join("Projects/Findings.md"), "## Status\nplain now.\n").unwrap();
        let id = record(&d, &before, "capture", "x", "").unwrap().unwrap();
        let entry = format!(".relay/changes/{id}.json");
        assert!(d.join(&entry).is_file() && read(&d, &entry).contains("zebraquartz"));
        // the Pages tree, a move's link rewrite and the next job's snapshot
        assert!(crate::pagefiles::all_files(&d).iter().all(|p| !p.starts_with(".relay")));
        assert!(snap(&d).keys().all(|p| !p.starts_with(".relay")));
        // ⌘K's names and content, the related notes, the index
        let root = crate::vault::canon(d.to_str().unwrap());
        let db = d.join("index");
        let found = crate::related::find(&db, &root, "zebraquartz").unwrap();
        assert_eq!(found["content"].as_array().map(Vec::len), Some(0), "{found}");
        assert_eq!(found["names"].as_array().map(Vec::len), Some(0), "{found}");
        assert!(crate::related::related(&db, &root, "zebraquartz", 5).unwrap().is_empty());
        let graph = crate::related::graph(&db, &root).unwrap();
        assert!(!graph.to_string().contains(".relay") && !graph.to_string().contains("zebraquartz"));
        // a shared workspace's rounds
        assert!(relay_remote::sync::Filter::vault_default().skips(&entry, false));
        // the vault's git backup
        if std::process::Command::new("git").arg("--version").output().is_ok() {
            let git = |args: &[&str]| std::process::Command::new("git").current_dir(&d).args(["-c", "user.name=t", "-c", "user.email=t@example.com"]).args(args).output().unwrap();
            git(&["init", "-q", "-b", "main"]);
            crate::vaultsync::stage_all(d.to_str().unwrap(), &std::env::var("PATH").unwrap_or_default()).unwrap();
            let staged = String::from_utf8_lossy(&git(&["diff", "--cached", "--name-only"]).stdout).into_owned();
            assert!(staged.contains("Projects/Findings.md") && !staged.contains(".relay/changes"), "{staged}");
        }
    }
}
