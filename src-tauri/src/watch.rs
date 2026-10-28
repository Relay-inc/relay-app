// Notes changed outside Relay (Claude, Obsidian, git, a shared round): file system events on every workspace folder,
// gathered for a moment, become one `note-changed` event per markdown file, {path, hash}: the path the way a page opens
// it (relative to the main vault, another workspace's by its folder as set + the relative path) and the text's hash, ""
// when the file is gone. What Relay itself wrote (`wrote`) and a file whose text did not change send nothing.
use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::{vault, App};

// a file's text hash as last known: written by Relay or already announced
static KNOWN: LazyLock<Mutex<HashMap<PathBuf, String>>> = LazyLock::new(Default::default);
const SKIP: [&str; 5] = [".trash", ".git", ".relay", ".obsidian", "node_modules"];

/// Relay wrote this text over the note (`write_note`): the event it causes is not an outside change.
pub fn wrote(main: &str, target: &str, hash: &str) {
    let p = vault::resolve(&vault::canon(main), target);
    let p = std::fs::canonicalize(&p).unwrap_or(p);
    KNOWN.lock().unwrap().insert(p, hash.to_string());
}

/// What to announce for a file an event named: (its page path, its hash) or None when it is no note of the roots, sits
/// in a skipped folder, or its text is what is known. `roots`: (folder as set, canonical folder), the main vault first.
fn change(roots: &[(String, String)], file: &Path) -> Option<(String, String)> {
    // hidden files are no notes: Relay's own temporary ones (`.relay-sync-…`) among them
    if file.extension().is_none_or(|e| e != "md") || file.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) { return None; }
    let (i, rel) = roots.iter().enumerate().find_map(|(i, (_, c))| file.strip_prefix(c).ok().map(|r| (i, r.to_path_buf())))?;
    if rel.components().any(|c| SKIP.contains(&c.as_os_str().to_string_lossy().as_ref())) { return None; }
    let hash = std::fs::read_to_string(file).map(|t| vault::text_hash(&t)).unwrap_or_default();
    let mut known = KNOWN.lock().unwrap();
    if known.get(file).map_or(hash.is_empty(), |h| *h == hash) { return None; }
    known.insert(file.to_path_buf(), hash.clone());
    let rel = rel.to_string_lossy();
    Some((if i == 0 { rel.into_owned() } else { format!("{}/{rel}", roots[i].0.trim_end_matches('/')) }, hash))
}

fn roots(app: &AppHandle) -> Vec<(String, String)> {
    let s = app.state::<App>().settings.lock().unwrap().clone();
    let main = s["vault"].as_str().unwrap_or("").to_string();
    std::iter::once(main).chain(crate::policy::extra_vaults(&s)).filter(|r| !r.is_empty()).map(|r| { let c = vault::canon(&r); (r, c) }).collect()
}

/// Watches the workspace folders on a thread of its own, again whenever the folders in the settings change.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |e: notify::Result<notify::Event>| { if let Ok(e) = e { tx.send(e.paths).ok(); } }) {
            Ok(w) => w,
            Err(e) => return eprintln!("watch: {e}"),
        };
        let mut watched: Vec<(String, String)> = vec![];
        loop {
            let now = roots(&app);
            if now != watched {
                for (_, c) in &watched { watcher.unwatch(Path::new(c)).ok(); }
                for (_, c) in &now { watcher.watch(Path::new(c), RecursiveMode::Recursive).ok(); }
                watched = now;
            }
            // what arrives within 300 ms after the first path is one batch: an editor's save is often several events
            let Ok(first) = rx.recv_timeout(Duration::from_secs(2)) else { continue };
            let mut files = first;
            while let Ok(more) = rx.recv_timeout(Duration::from_millis(300)) { files.extend(more); }
            files.sort();
            files.dedup();
            for f in files {
                if let Some((path, hash)) = change(&watched, &f) { app.emit("note-changed", serde_json::json!({"path": path, "hash": hash})).ok(); }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_writes_and_unchanged_text_send_nothing() {
        let dir = std::env::temp_dir().join(format!("relay-watch-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".trash")).unwrap();
        let root = vault::canon(dir.to_str().unwrap());
        let roots = vec![(dir.to_string_lossy().into_owned(), root.clone())];
        let note = PathBuf::from(&root).join("A.md");
        std::fs::write(&note, "one").unwrap();
        // Relay wrote it: quiet
        wrote(&root, "A.md", &vault::text_hash("one"));
        assert_eq!(change(&roots, &note), None);
        // someone else changed it: announced once, by its page path
        std::fs::write(&note, "two").unwrap();
        assert_eq!(change(&roots, &note), Some(("A.md".into(), vault::text_hash("two"))));
        assert_eq!(change(&roots, &note), None);
        // gone: announced with an empty hash
        std::fs::remove_file(&note).unwrap();
        assert_eq!(change(&roots, &note), Some(("A.md".into(), String::new())));
        // the trash and other files are not notes
        std::fs::write(PathBuf::from(&root).join(".trash/B.md"), "x").unwrap();
        assert_eq!(change(&roots, &PathBuf::from(&root).join(".trash/B.md")), None);
        assert_eq!(change(&roots, &PathBuf::from(&root).join("c.txt")), None);
        std::fs::write(PathBuf::from(&root).join(".relay-sync-x.md"), "x").unwrap();
        assert_eq!(change(&roots, &PathBuf::from(&root).join(".relay-sync-x.md")), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
