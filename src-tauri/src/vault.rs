// Where the app finds things in a vault. Vaults differ, so settings.json keeps a mapping per vault
// ("vaults": {"/abs/vault": {"workState": "rel/path.md", ...}}), prefilled by `detect` when a folder
// is picked and editable in Settings. Paths are relative to the vault; an absolute one is used as is.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The mapping keys: (key, is a folder, required). Only workState is required: it makes a folder a
/// vault. The others switch a feature off when missing, except reminders: the first one creates the file.
pub const KEYS: [(&str, bool, bool); 3] = [
    ("workState", false, true),  // the project tables per context
    ("reminders", false, false), // the reminder table, REMINDERS in the vault root when none is found
    ("notes", true, false),      // folder searched for project notes (## Open, Stand van zaken)
];
pub const REMINDERS: &str = "reminders.md";
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

/// Breadth-first walk over the files, shallowest first, until `f` returns true. Skips hidden folders,
/// archives and node_modules, does not follow symlinks (no loops), and stops after a few thousand folders.
fn walk(root: &Path, mut f: impl FnMut(&Path, &str) -> bool) -> Option<PathBuf> {
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0)]);
    let mut seen = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        seen += 1;
        if seen > 5000 { return None; }
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut subs = vec![];
        for e in rd.flatten() {
            let (n, Ok(ft)) = (e.file_name().to_string_lossy().into_owned(), e.file_type()) else { continue };
            if ft.is_file() && f(&e.path(), &n) { return Some(e.path()); }
            if ft.is_dir() && depth < 6 && !n.starts_with('.') && !["node_modules", "_archive"].contains(&n.as_str()) { subs.push(e.path()); }
        }
        subs.sort();
        queue.extend(subs.into_iter().map(|p| (p, depth + 1)));
    }
    None
}
fn scan(root: &Path, name: &str) -> Option<PathBuf> { walk(root, |_, n| n == name) }

/// Every note in the vault, relative to it, so a conversation only links what is there.
pub fn notes(vault: &str) -> (String, Vec<String>) {
    let root = PathBuf::from(canon(vault));
    let mut out = vec![];
    walk(&root, |p, n| { if n.ends_with(".md") { out.push(rel(&root, p)); } false });
    (root.to_string_lossy().into_owned(), out)
}

/// A note a conversation points at, as (path relative to the vault, its text). `target` is a path,
/// relative to the vault or absolute, with or without `.md`, or a bare wikilink name found by `scan`.
/// Only markdown files inside the vault (symlinks resolved) are read, so a link cannot reach ~/.ssh.
pub fn note(vault: &str, target: &str) -> Option<(String, String)> {
    let root = PathBuf::from(canon(vault));
    let t = target.trim();
    if t.is_empty() { return None; }
    let md = if t.ends_with(".md") { t.to_string() } else { format!("{t}.md") };
    let p = [t, md.as_str()].iter().map(|c| root.join(c)).find(|p| p.is_file())
        .or_else(|| if t.contains('/') { None } else { scan(&root, &md) })?;
    let real = fs::canonicalize(p).ok()?;
    if !real.starts_with(&root) || real.extension()? != "md" || fs::metadata(&real).ok()?.len() > 2_000_000 { return None; }
    Some((rel(&root, &real), fs::read_to_string(&real).ok()?))
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
    let notes = Some(root.join("Contexts")).filter(|p| p.is_dir());
    let r = |p: Option<PathBuf>| json!(p.map(|p| rel(&root, &p)).unwrap_or_default());
    let reminders = json!(reminders.map_or(REMINDERS.into(), |p| rel(&root, &p)));
    (v, json!({"workState": r(work), "reminders": reminders, "notes": r(notes)}))
}

/// The detected mapping with the stored one on top, keeping only known keys with text values.
pub fn merge(detected: &Value, stored: &Value) -> Value {
    let mut m = Map::new();
    for (k, _, _) in KEYS {
        let s = stored[k].as_str().or(detected[k].as_str()).unwrap_or("").trim();
        m.insert(k.into(), json!(if s.is_empty() && k == "reminders" { REMINDERS } else { s }));
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
        assert_eq!(s["map"], json!({"workState": "System/rules/core/work-state.md", "reminders": "System/reminders.md", "notes": "Contexts"}));
        assert_eq!(s["ok"], true);
    }

    #[test]
    fn old_resources_layout() {
        let d = tmp("old");
        for f in ["Resources/Meta/Claude/rules/core/work-state.md", "Resources/Meta/Claude/reminders.md"] { touch(&d, f); }
        let s = det(&d);
        assert_eq!(s["map"]["workState"], "Resources/Meta/Claude/rules/core/work-state.md");
        assert_eq!(s["map"]["reminders"], "Resources/Meta/Claude/reminders.md");
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
    fn reminders_default_to_the_vault_root() {
        let d = tmp("norem");
        touch(&d, "System/rules/core/work-state.md");
        let s = det(&d);
        assert_eq!(s["map"]["reminders"], REMINDERS); // created by the first reminder
        assert_eq!(s["found"]["reminders"], false);
        assert_eq!(merge(&json!({}), &json!({"reminders": ""}))["reminders"], REMINDERS); // older settings stored ""
        assert_eq!(s["ok"], true);
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
    #[test]
    fn note_stays_in_the_vault() {
        let d = tmp("note");
        let v = d.to_str().unwrap();
        fs::create_dir_all(d.join("Contexts/A")).unwrap();
        fs::write(d.join("Contexts/A/Plan.md"), "# Plan").unwrap();
        fs::write(d.join("secret.txt"), "x").unwrap();
        let out = tmp("note-out");
        fs::write(out.join("Out.md"), "x").unwrap();
        symlink(out.join("Out.md"), d.join("Link.md")).unwrap();
        let ok = Some(("Contexts/A/Plan.md".to_string(), "# Plan".to_string()));
        assert_eq!(note(v, "Contexts/A/Plan.md"), ok);
        assert_eq!(note(v, "Contexts/A/Plan"), ok);
        assert_eq!(note(v, &format!("{v}/Contexts/A/Plan.md")), ok);
        assert_eq!(note(v, "Plan"), ok); // a wikilink name
        assert_eq!(notes(v).1, vec!["Contexts/A/Plan.md"]); // not the symlink, not secret.txt
        for bad in ["secret.txt", "../note-out/Out.md", "Link.md", out.join("Out.md").to_str().unwrap(), "Nope", "A/Nope", ""] {
            assert_eq!(note(v, bad), None, "{bad}");
        }
    }
}
