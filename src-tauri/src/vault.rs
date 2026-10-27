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

/// Where the starter vault goes on a first start: in the home folder, not in ~/Documents, which macOS guards with
/// a permission prompt.
pub const DEFAULT_DIR: &str = "Relay";

/// Copies the starter vault (the app's resources/default-vault) to `dest` and makes it work: hooks and scripts
/// executable, `.claude` a link to `System`, where Claude Code reads the settings, hooks and skills. A `dest`
/// that already holds a vault stays as it is (a second first start), any other folder with visible files in it is
/// refused with the key err.vault_dest_used.
pub fn create_default(template: &Path, dest: &Path) -> Result<(), String> { create(template, None, dest) }
/// What the team starter leaves out of the starter vault: the parts about one person. A shared vault is the team's.
pub const TEAM_DROP: [&str; 3] = ["System/rules/core/user-profile.md", "System/rules/personal", "Contexts/Personal"];
/// The team starter, what a shared vault made in an empty folder starts as (docs/shared-vaults.md): the starter vault
/// without TEAM_DROP, with the team overlay (the app's resources/team-vault: CLAUDE.md, team.md, the team setup skill)
/// copied over it. Otherwise as `create_default`.
pub fn create_team(template: &Path, overlay: &Path, dest: &Path) -> Result<(), String> { create(template, Some(overlay), dest) }
fn create(template: &Path, overlay: Option<&Path>, dest: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if dest.join("System/rules/core/work-state.md").is_file() { return Ok(()); }
    // hidden files (.DS_Store) do not count, someone else's notes do
    if fs::read_dir(dest).is_ok_and(|d| d.flatten().any(|e| !e.file_name().to_string_lossy().starts_with('.'))) { return Err("err.vault_dest_used".into()); }
    copy_dir(template, dest).map_err(|e| e.to_string())?;
    if let Some(o) = overlay {
        for d in TEAM_DROP {
            let p = dest.join(d);
            if p.is_dir() { fs::remove_dir_all(&p) } else if p.exists() { fs::remove_file(&p) } else { Ok(()) }.map_err(|e| e.to_string())?;
        }
        copy_dir(o, dest).map_err(|e| e.to_string())?;
    }
    for sub in ["System/hooks", "System/scripts"] {
        for e in fs::read_dir(dest.join(sub)).map_err(|e| e.to_string())?.flatten() {
            fs::set_permissions(e.path(), fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
    }
    let link = dest.join(".claude");
    if fs::symlink_metadata(&link).is_err() { std::os::unix::fs::symlink("System", &link).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Marks a skill folder in a shared vault as Relay's copy (`place_skills`), with a line for whoever opens it.
const SKILL_MARK: (&str, &str) = (".relay-skill", "Relay's copy of this skill, rewritten when Relay's changes. To change it, copy the folder under another name.\n");
/// Relay's own skills in a shared vault's System/skills. Skills never sync (a member's code may not run on another
/// Mac), so each Mac gets the team starter's skills from the app (the starter vault's, with the overlay's on top),
/// written only where a file differs. A folder of the same name is Relay's when it has SKILL_MARK, or is empty, or is a
/// bundled copy as it was made (the team starter's, or the personal starter's in a vault an older Relay started as one).
/// Any other folder is the user's own and stays as it is, as does a link (it leads out of the vault).
/// Writes files only, nothing here runs anything from the vault.
pub fn place_skills(template: &Path, overlay: &Path, vault: &Path) -> std::io::Result<()> {
    let (personal, team, skills) = (template.join("System/skills"), overlay.join("System/skills"), vault.join("System/skills"));
    if fs::symlink_metadata(&skills).is_ok_and(|m| m.file_type().is_symlink()) { return Ok(()); }
    let dirs = |d: &Path| fs::read_dir(d).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.file_name());
    let names: std::collections::BTreeSet<_> = dirs(&personal).chain(dirs(&team)).collect();
    for name in names {
        let base = files(&personal.join(&name));
        let mut want = base.clone();
        want.extend(files(&team.join(&name)));
        let dir = skills.join(&name);
        if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) { continue; }
        let have = files(&dir);
        if !dir.join(SKILL_MARK.0).is_file() && !have.is_empty() && have != want && have != base { continue; }
        for (rel, data) in &want {
            if have.get(rel) == Some(data) { continue; }
            let p = dir.join(rel);
            if let Some(up) = p.parent() { fs::create_dir_all(up)?; }
            fs::write(p, data)?;
        }
        if !dir.join(SKILL_MARK.0).is_file() { fs::write(dir.join(SKILL_MARK.0), SKILL_MARK.1)?; }
    }
    Ok(())
}
/// The files under `dir` by their path in it, hidden ones (the mark, .DS_Store) and links left out.
fn files(dir: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    let mut todo = vec![dir.to_path_buf()];
    while let Some(d) = todo.pop() {
        for e in fs::read_dir(&d).into_iter().flatten().flatten() {
            let (Ok(t), n) = (e.file_type(), e.file_name()) else { continue };
            if n.to_string_lossy().starts_with('.') { continue; }
            if t.is_dir() { todo.push(e.path()); } else if t.is_file() {
                if let (Ok(r), Ok(data)) = (e.path().strip_prefix(dir), fs::read(e.path())) { out.insert(r.to_string_lossy().into_owned(), data); }
            }
        }
    }
    out
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() { copy_dir(&e.path(), &target)?; } else { fs::copy(e.path(), target)?; }
    }
    Ok(())
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

    #[test]
    fn default_vault_is_copied_once_and_works() {
        use std::os::unix::fs::PermissionsExt;
        let tpl = tmp("tpl");
        for f in ["System/rules/core/work-state.md", "System/hooks/check.sh", "System/scripts/index.py", ".relay/config.json"] { touch(&tpl, f); }
        let dest = tmp("dest").join("Relay");
        create_default(&tpl, &dest).unwrap();
        assert_eq!(fs::metadata(dest.join("System/hooks/check.sh")).unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(fs::read_link(dest.join(".claude")).unwrap(), PathBuf::from("System"));
        assert!(dest.join(".relay/config.json").is_file());
        assert_eq!(det(&dest)["ok"], true);
        // a second first start keeps the vault and what was written in it
        fs::write(dest.join("System/rules/core/work-state.md"), "mine").unwrap();
        create_default(&tpl, &dest).unwrap();
        assert_eq!(fs::read_to_string(dest.join("System/rules/core/work-state.md")).unwrap(), "mine");
        // a folder with other files in it is never overwritten
        let used = tmp("used");
        touch(&used, "notes.txt");
        assert_eq!(create_default(&tpl, &used), Err("err.vault_dest_used".into()));
        // a folder with only hidden files counts as empty
        let hidden = tmp("hidden");
        touch(&hidden, ".DS_Store");
        create_default(&tpl, &hidden).unwrap();
        assert!(hidden.join("System/rules/core/work-state.md").is_file());
    }

    #[test]
    fn shipped_template_is_a_vault() {
        let tpl = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/default-vault");
        let dest = tmp("shipped").join("Relay");
        create_default(&tpl, &dest).unwrap();
        let s = det(&dest);
        assert_eq!(s["ok"], true, "{s}");
        assert_eq!(s["map"], json!({"workState": "System/rules/core/work-state.md", "reminders": "System/reminders.md", "notes": "Contexts"}));
    }

    fn shipped(name: &str) -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join(name) }

    #[test]
    fn a_shared_vault_starts_as_the_team_starter() {
        let dest = tmp("team").join("Team");
        create_team(&shipped("default-vault"), &shipped("team-vault"), &dest).unwrap();
        assert_eq!(det(&dest)["ok"], true);
        assert!(dest.join("System/rules/core/team.md").is_file() && dest.join("System/rules/core/hard-walls.md").is_file());
        for d in TEAM_DROP { assert!(!dest.join(d).exists(), "{d}"); }
        assert!(fs::read_to_string(dest.join("System/skills/setup/SKILL.md")).unwrap().contains("team.md"));
        assert!(!fs::read_to_string(dest.join(".relay/config.json")).unwrap().contains("Personal"));
        assert_eq!(fs::read_link(dest.join(".claude")).unwrap(), PathBuf::from("System"));
        // the personal first start is as it was
        let own = tmp("own").join("Relay");
        create_default(&shipped("default-vault"), &own).unwrap();
        assert!(own.join("System/rules/core/user-profile.md").is_file() && !own.join("System/rules/core/team.md").exists());
    }

    #[test]
    fn relays_skills_go_into_a_shared_vault_and_the_users_stay() {
        let (tpl, team) = (shipped("default-vault"), shipped("team-vault"));
        let want = fs::read_to_string(team.join("System/skills/setup/SKILL.md")).unwrap();
        let v = tmp("skills");
        // a joined vault has no skills: Relay's come in, marked
        place_skills(&tpl, &team, &v).unwrap();
        assert_eq!(fs::read_to_string(v.join("System/skills/setup/SKILL.md")).unwrap(), want);
        assert!(v.join("System/skills/meeting-notes/SKILL.md").is_file() && v.join("System/skills/setup/.relay-skill").is_file());
        // a Relay copy that changed (an older Relay's) is brought up to date
        fs::write(v.join("System/skills/setup/SKILL.md"), "older").unwrap();
        place_skills(&tpl, &team, &v).unwrap();
        assert_eq!(fs::read_to_string(v.join("System/skills/setup/SKILL.md")).unwrap(), want);
        // a vault started as a personal one: its unmarked personal setup is Relay's too and becomes the team's
        let p = tmp("skills-personal");
        create_default(&tpl, &p).unwrap();
        place_skills(&tpl, &team, &p).unwrap();
        assert_eq!(fs::read_to_string(p.join("System/skills/setup/SKILL.md")).unwrap(), want);
        // the user's own skill of the same name, unmarked: left alone, and nothing marks it
        let u = tmp("skills-user");
        touch(&u, "System/skills/setup/SKILL.md");
        fs::write(u.join("System/skills/setup/SKILL.md"), "mine").unwrap();
        place_skills(&tpl, &team, &u).unwrap();
        assert_eq!(fs::read_to_string(u.join("System/skills/setup/SKILL.md")).unwrap(), "mine");
        assert!(!u.join("System/skills/setup/.relay-skill").exists() && u.join("System/skills/stress-test/SKILL.md").is_file());
    }
}
