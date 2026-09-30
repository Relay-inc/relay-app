// Where the app finds things in a vault. Vaults differ, so settings.json keeps a mapping per vault
// ("vaults": {"/abs/vault": {"workState": "rel/path.md", ...}}), prefilled by `detect` when a folder
// is picked and editable in Settings. Paths are relative to the vault; an absolute one is used as is.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The mapping keys: (key, is a folder, required). Only workState is required: it makes a folder a
/// vault. The others switch a feature off when missing.
pub const KEYS: [(&str, bool, bool); 4] = [
    ("workState", false, true),      // the project tables per context
    ("reminders", false, false),     // the reminder table
    ("reminderScript", false, false), // reminder-digest.py: done / push / drop from the app
    ("notes", true, false),          // folder searched for project notes (## Open, Stand van zaken)
];
/// The brain folder of the known layouts: System/ in the new one, Resources/Meta/Claude/ in the old one.
const BRAINS: [&str; 2] = ["System", "Resources/Meta/Claude"];

/// The path with symlinks resolved, or as given (without a trailing slash) when it does not exist.
pub fn canon(p: &str) -> String {
    fs::canonicalize(p).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| p.trim_end_matches('/').to_string())
}

/// A mapped path as an absolute one.
pub fn resolve(vault: &str, rel: &str) -> PathBuf {
    if rel.starts_with('/') { PathBuf::from(rel) } else { Path::new(vault).join(rel) }
}

/// `p` relative to the (canonical) vault, symlinks resolved when the target stays inside the vault,
/// so Resources/Meta/Claude/reminders.md becomes the file it links to.
fn rel(root: &Path, p: &Path) -> String {
    let real = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let r = real.strip_prefix(root).or_else(|_| p.strip_prefix(root)).map(Path::to_path_buf).unwrap_or(real);
    r.to_string_lossy().into_owned()
}

/// Breadth-first search for a file called `name`, shallowest first. Skips hidden folders, archives and
/// node_modules, does not follow symlinks (no loops), and stops after a few thousand folders.
fn scan(root: &Path, name: &str) -> Option<PathBuf> {
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0)]);
    let mut seen = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        seen += 1;
        if seen > 5000 { return None; }
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut subs = vec![];
        for e in rd.flatten() {
            let (n, Ok(ft)) = (e.file_name().to_string_lossy().into_owned(), e.file_type()) else { continue };
            if ft.is_file() && n == name { return Some(e.path()); }
            if ft.is_dir() && depth < 6 && !n.starts_with('.') && !["node_modules", "_archive"].contains(&n.as_str()) { subs.push(e.path()); }
        }
        subs.sort();
        queue.extend(subs.into_iter().map(|p| (p, depth + 1)));
    }
    None
}

/// Guess the mapping of a vault: the known layouts first, then a search for the files by name.
/// Returns the canonical vault path and the mapping ("" where nothing was found).
pub fn detect(vault: &str) -> (String, Value) {
    let v = canon(vault);
    let root = PathBuf::from(&v);
    let brains: Vec<PathBuf> = BRAINS.iter().map(|b| root.join(b)).filter(|b| b.is_dir()).collect();
    let in_brain = |sub: &str| brains.iter().map(|b| b.join(sub)).find(|p| p.exists());
    let work = in_brain("rules/core/work-state.md").or_else(|| scan(&root, "work-state.md"));
    let next_to_work = |name: &str| work.as_ref().and_then(|w| w.parent()).map(|d| d.join(name)).filter(|p| p.is_file());
    let reminders = in_brain("reminders.md").or_else(|| next_to_work("reminders.md")).or_else(|| scan(&root, "reminders.md"));
    let script = in_brain("scripts/reminder-digest.py").or_else(|| scan(&root, "reminder-digest.py"));
    let notes = Some(root.join("Contexts")).filter(|p| p.is_dir());
    let r = |p: Option<PathBuf>| json!(p.map(|p| rel(&root, &p)).unwrap_or_default());
    (v, json!({"workState": r(work), "reminders": r(reminders), "reminderScript": r(script), "notes": r(notes)}))
}

/// The detected mapping with the stored one on top, keeping only known keys with text values.
pub fn merge(detected: &Value, stored: &Value) -> Value {
    let mut m = Map::new();
    for (k, _, _) in KEYS {
        let s = stored[k].as_str().or(detected[k].as_str()).unwrap_or("").trim();
        m.insert(k.into(), json!(s));
    }
    Value::Object(m)
}

/// Which mapped paths exist, and whether the vault is usable (its work-state is there).
pub fn status(vault: &str, map: &Value) -> Value {
    let mut found = Map::new();
    for (k, dir, _) in KEYS {
        let p = map[k].as_str().unwrap_or("");
        let f = !vault.is_empty() && !p.is_empty() && { let a = resolve(vault, p); if dir { a.is_dir() } else { a.is_file() } };
        found.insert(k.into(), json!(f));
    }
    let ok = KEYS.iter().all(|(k, _, req)| !req || found[*k] == true) && Path::new(vault).is_dir();
    json!({"vault": vault, "map": map, "found": found, "ok": ok})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vault-detect-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(d).unwrap()
    }
    fn touch(root: &Path, rel: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, "").unwrap();
    }
    fn det(root: &Path) -> Value { let (v, m) = detect(root.to_str().unwrap()); status(&v, &m) }

    #[test]
    fn new_system_layout() {
        let d = tmp("system");
        for f in ["System/rules/core/work-state.md", "System/reminders.md", "System/scripts/reminder-digest.py", "Contexts/Antenna/Portfolio/X.md"] { touch(&d, f); }
        let s = det(&d);
        assert_eq!(s["map"], json!({"workState": "System/rules/core/work-state.md", "reminders": "System/reminders.md",
            "reminderScript": "System/scripts/reminder-digest.py", "notes": "Contexts"}));
        assert_eq!(s["ok"], true);
    }

    #[test]
    fn old_resources_layout() {
        let d = tmp("old");
        for f in ["Resources/Meta/Claude/rules/core/work-state.md", "Resources/Meta/Claude/reminders.md"] { touch(&d, f); }
        let s = det(&d);
        assert_eq!(s["map"]["workState"], "Resources/Meta/Claude/rules/core/work-state.md");
        assert_eq!(s["map"]["reminders"], "Resources/Meta/Claude/reminders.md");
        assert_eq!(s["map"]["reminderScript"], ""); // no script: the feature is off, the vault still works
        assert_eq!(s["found"]["reminderScript"], false);
        assert_eq!(s["ok"], true);
    }

    #[test]
    fn scanned_layout_with_symlinks() {
        // work-state outside the brain, reminders.md in the brain a symlink to the real file
        let d = tmp("scan");
        for f in ["Contexts/Personal/State/work-state.md", "Contexts/Personal/State/reminders.md", "Resources/Meta/Claude/rules/core/hard-walls.md"] { touch(&d, f); }
        symlink(d.join("Contexts/Personal/State/reminders.md"), d.join("Resources/Meta/Claude/reminders.md")).unwrap();
        symlink("Resources/Meta/Claude", d.join(".claude")).unwrap();
        // the vault picked through a symlink resolves to the real folder
        let link = tmp("scan-link").join("v");
        symlink(&d, &link).unwrap();
        let (v, m) = detect(link.to_str().unwrap());
        assert_eq!(v, d.to_str().unwrap());
        assert_eq!(m["workState"], "Contexts/Personal/State/work-state.md");
        assert_eq!(m["reminders"], "Contexts/Personal/State/reminders.md");
        assert_eq!(status(&v, &m)["ok"], true);
    }

    #[test]
    fn not_a_vault() {
        let d = tmp("empty");
        touch(&d, "notes/a.md");
        let s = det(&d);
        assert_eq!(s["ok"], false);
        assert_eq!(status("", &json!({}))["ok"], false);
    }

    #[test]
    fn stored_overrides_win() {
        let d = tmp("merge");
        touch(&d, "System/rules/core/work-state.md");
        touch(&d, "Elsewhere/reminders.md");
        let (v, m) = detect(d.to_str().unwrap());
        let m = merge(&m, &json!({"reminders": "Elsewhere/reminders.md", "bogus": "x"}));
        assert_eq!(m["reminders"], "Elsewhere/reminders.md");
        assert!(m.get("bogus").is_none());
        assert_eq!(status(&v, &m)["found"]["reminders"], true);
    }

    // Kristof's real vault, read-only; skipped where it does not exist
    #[test]
    fn real_vault_of_kristof() {
        let v = "/Users/kristof/vault";
        if !Path::new(v).is_dir() { return; }
        let (v, m) = detect(v);
        println!("{v}: {m}");
        assert_eq!(m["workState"], "Contexts/Personal/State/work-state.md");
        assert_eq!(m["reminders"], "Contexts/Personal/State/reminders.md");
        assert_eq!(status(&v, &m)["ok"], true);
    }
}
