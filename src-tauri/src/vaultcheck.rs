// The workspace check: what a vault needs so every member's Claude works in it, and the repair of what is missing.
// A vault Relay made (its config folder is System/) has the starter's files: CLAUDE.md, the core and vault rules,
// reminders, templates; a team workspace the team starter's (vault::create_team), a personal one the personal one.
// Every vault, made by Relay or not, is checked for its contexts: each has its note and its rule, a table in a
// hand-kept work-state, and its notes name it in `context:`. A card has its fields, a row its note. A repair writes
// a missing file, never over one that is there, and sets fields; what needs a person's call is only reported.

use crate::migrate::{self, Side};
use crate::projects;
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// One finding: `kind` says what (the UI words it), `context` and `path` where, `paths` the notes it is about.
/// `fix`: Repair can put it right. `id` names it for a repair: the check runs again and repairs what matches.
pub struct Finding { pub kind: &'static str, pub context: String, pub path: String, pub paths: Vec<String>, pub fix: bool }
impl Finding {
    pub fn id(&self) -> String { format!("{}:{}:{}", self.kind, self.context, self.path) }
    pub fn json(&self) -> Value {
        json!({ "id": self.id(), "kind": self.kind, "context": self.context, "path": self.path, "paths": self.paths, "fix": self.fix })
    }
}
/// The starter a vault is checked against: the personal one, or with `overlay` the team one.
pub struct Starter { pub template: PathBuf, pub overlay: Option<PathBuf> }
impl Starter {
    /// The starter's copy of `rel`: the overlay's, else the template's unless the team starter drops it.
    fn file(&self, rel: &str) -> Option<PathBuf> {
        if let Some(o) = &self.overlay {
            if o.join(rel).is_file() { return Some(o.join(rel)); }
            if crate::vault::TEAM_DROP.iter().any(|d| rel == *d || rel.starts_with(&format!("{d}/"))) { return None; }
        }
        Some(self.template.join(rel)).filter(|p| p.is_file())
    }
    /// The files every vault of this starter needs, relative to it.
    fn required(&self) -> Vec<String> {
        let mut all = vec![];
        for root in std::iter::once(&self.template).chain(self.overlay.as_ref()) { files(root, root, &mut all); }
        all.sort();
        all.dedup();
        all.into_iter().filter(|r| REQUIRED.iter().any(|q| r == q || (q.ends_with('/') && r.starts_with(q))))
            .filter(|r| r != "System/rules/core/work-state.md" && self.file(r).is_some()).collect()
    }
}
/// What of the starter a vault can't do without; the rest (skills, hooks, scripts) Relay places itself or ships.
const REQUIRED: [&str; 5] = ["CLAUDE.md", "System/rules/core/", "System/rules/vault/", "System/reminders.md", "Resources/Templates/"];

fn files(root: &Path, dir: &Path, out: &mut Vec<String>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let (p, name) = (e.path(), e.file_name().to_string_lossy().into_owned());
        if name.starts_with('.') { continue; }
        if p.is_dir() { files(root, &p, out) } else { out.push(p.strip_prefix(root).unwrap().to_string_lossy().into_owned()) }
    }
}
fn notes_in(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if e.file_name().to_string_lossy().starts_with('.') || fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) { continue; }
        if p.is_dir() { notes_in(&p, out) } else if p.extension().is_some_and(|x| x == "md") { out.push(p) }
    }
}
fn rel(vault: &Path, p: &Path) -> String { p.strip_prefix(vault).unwrap_or(p).to_string_lossy().into_owned() }
/// A vault Relay made: its config folder is System/ (`.claude` links there, or is not there yet).
fn from_starter(vault: &Path) -> bool {
    match fs::canonicalize(vault.join(".claude")) { Ok(c) => c == vault.join("System"), Err(_) => vault.join("System/rules/core").is_dir() }
}
/// The frontmatter of a note, without its fences, or None.
fn frontmatter(text: &str) -> Option<&str> { text.strip_prefix("---\n").and_then(|t| t.split_once("\n---")).map(|(fm, _)| fm) }
/// The contexts a note's `context:` names (a value or a list), by their link target.
fn named_contexts(fm: &str) -> Option<Vec<String>> {
    let link = Regex::new(r"\[\[([^\]|#]+)").unwrap();
    let mut lines = fm.lines().skip_while(|l| !l.starts_with("context:"));
    let first = lines.next()?;
    let mut values: Vec<String> = vec![first["context:".len()..].trim().to_string()];
    values.extend(lines.take_while(|l| l.starts_with(' ') || l.starts_with('\t')).map(|l| l.trim().trim_start_matches('-').trim().to_string()));
    let named: Vec<String> = values.iter().filter_map(|v| link.captures(v).map(|c| c[1].trim().to_string()).or_else(|| Some(v.trim_matches('"').trim().to_string()).filter(|s| !s.is_empty()))).collect();
    Some(named).filter(|n| !n.is_empty())
}
/// The folders a rule loads for: its `paths:` entries without the `/**`.
fn rule_paths(text: &str) -> Vec<String> {
    let Some(fm) = frontmatter(text) else { return vec![] };
    fm.lines().skip_while(|l| !l.starts_with("paths:")).skip(1).take_while(|l| l.starts_with(' ') || l.starts_with('\t'))
        .map(|l| l.trim().trim_start_matches('-').trim().trim_matches('"').trim_matches('\'').trim_end_matches("/**").to_string()).collect()
}

/// Everything the check finds in a vault.
pub fn check(side: &Side, starter: &Starter) -> Vec<Finding> {
    let Ok(vault) = fs::canonicalize(&side.vault) else { return vec![] };
    let mut out = vec![];
    let f = |kind, context: &str, path: String, paths, fix| Finding { kind, context: context.into(), path, paths, fix };
    if from_starter(&vault) {
        if fs::symlink_metadata(vault.join(".claude")).is_err() { out.push(f("claude_link", "", ".claude".into(), vec![], true)); }
        for r in starter.required() {
            if fs::symlink_metadata(vault.join(&r)).is_err() { out.push(f("missing_file", "", r, vec![], true)); }
        }
    }
    let root = fs::canonicalize(projects::notes_root(side)).unwrap_or_else(|_| vault.clone());
    let contexts = projects::listed(side);
    let rules = projects::rules_dir(side);
    let rule_files: Vec<(PathBuf, Vec<String>)> = rules.iter().flat_map(|r| fs::read_dir(r).into_iter().flatten().flatten())
        .filter(|e| e.path().is_dir()).flat_map(|e| fs::read_dir(e.path()).into_iter().flatten().flatten())
        .map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md"))
        .map(|p| { let paths = fs::read_to_string(&p).map(|t| rule_paths(&t)).unwrap_or_default(); (p, paths) }).collect();
    let cards = migrate::cards(side);
    let ws = fs::read_to_string(&side.work_state).unwrap_or_default();
    let head = Regex::new(r"(?m)^#{2,3} (.+?)\s*$").unwrap();
    let heads: Vec<String> = head.captures_iter(&ws).map(|c| c[1].to_string()).collect();
    for ctx in &contexts {
        let dir = root.join(ctx);
        let dir_rel = rel(&vault, &dir);
        let note = dir.join(format!("{ctx}.md"));
        if !note.is_file() { out.push(f("context_note", ctx, rel(&vault, &note), vec![], true)); }
        if let Some(r) = &rules {
            if !rule_files.iter().any(|(_, paths)| paths.iter().any(|p| *p == dir_rel)) {
                out.push(f("context_rule", ctx, rel(&vault, &r.join(projects::slug(ctx)).join("context.md")), vec![], true));
            }
        }
        if !cards && !heads.iter().any(|h| h == ctx) { out.push(f("context_heading", ctx, rel(&vault, Path::new(&side.work_state)), vec![], true)); }
        // its notes name it, or nothing: one that names another context sits in the wrong place or says the wrong thing
        let mut notes = vec![];
        notes_in(&dir, &mut notes);
        let mut wrong = vec![];
        for n in &notes {
            let Ok(text) = fs::read_to_string(n) else { continue };
            let Some(named) = frontmatter(&text).and_then(named_contexts) else { continue };
            if !named.iter().any(|c| c == ctx) { wrong.push(rel(&vault, n)); }
        }
        if !wrong.is_empty() { out.push(f("context_mismatch", ctx, dir_rel.clone(), wrong, true)); }
        // a card has what build-index.py reads: without `status` it shows as nothing
        if cards {
            for n in notes.iter().filter(|n| n.strip_prefix(dir.join("Projects")).is_ok_and(|r| {
                let parts: Vec<_> = r.components().collect();
                parts.len() == 1 || (parts.len() == 2 && n.file_stem() == n.parent().and_then(|p| p.file_name()))
            })) {
                let text = fs::read_to_string(n).unwrap_or_default();
                let fm = frontmatter(&text).unwrap_or("");
                let lacks: Vec<String> = ["type", "status", "last"].iter().filter(|k| !fm.lines().any(|l| l.starts_with(&format!("{k}:")) && l.len() > k.len() + 1)).map(|k| k.to_string()).collect();
                if !lacks.is_empty() { out.push(f("card_fields", ctx, rel(&vault, n), lacks, true)); }
            }
        }
    }
    // a rule for a folder of the notes that is not there: its context was renamed or removed
    for (p, paths) in &rule_files {
        let notes_rel = rel(&vault, &root);
        for at in paths.iter().filter(|at| at.starts_with(&format!("{notes_rel}/")) && at[notes_rel.len() + 1..].split('/').count() == 1) {
            if !vault.join(at).is_dir() { out.push(f("orphan_rule", "", rel(&vault, p), vec![at.clone()], false)); }
        }
    }
    // a row whose project has no note: nothing to open, no status to read
    if !cards {
        if let Ok((projects, _)) = crate::snapshot::vault_projects(&side.vault, &side.work_state, &side.notes) {
            for p in projects {
                let name = p["name"].as_str().unwrap_or("");
                if crate::snapshot::project_note(&side.vault, &side.notes, name).is_none() {
                    out.push(f("row_without_note", p["context"].as_str().unwrap_or(""), name.into(), vec![], false));
                }
            }
        }
    }
    out
}

/// Repairs the findings named by `ids` that the check still finds and can fix. Returns how many it repaired.
pub fn repair(side: &Side, starter: &Starter, ids: &[String], today: &str) -> Result<usize, String> {
    let vault = fs::canonicalize(&side.vault).map_err(|e| e.to_string())?;
    let mut done = 0;
    for f in check(side, starter).into_iter().filter(|f| f.fix && ids.contains(&f.id())) {
        let at = vault.join(&f.path);
        match f.kind {
            "claude_link" => std::os::unix::fs::symlink("System", &at).map_err(|e| e.to_string())?,
            "missing_file" => {
                let src = starter.file(&f.path).ok_or_else(|| format!("no starter copy of {}", f.path))?;
                projects::write_new(&at, &fs::read_to_string(src).map_err(|e| e.to_string())?)?;
            }
            "context_note" => projects::write_new(&at, &projects::context_text(&side.vault, &f.context, today))?,
            "context_rule" => {
                let dir = rel(&vault, &fs::canonicalize(projects::notes_root(side)).unwrap_or_else(|_| vault.clone()).join(&f.context));
                projects::write_new(&at, &projects::rule_text(&dir, &f.context))?;
            }
            "context_heading" => {
                let text = fs::read_to_string(&side.work_state).map_err(|e| e.to_string())?;
                fs::write(&side.work_state, projects::add_context(&text, &f.context, &projects::listed(side))).map_err(|e| e.to_string())?;
            }
            "context_mismatch" => for p in &f.paths {
                let text = fs::read_to_string(vault.join(p)).map_err(|e| e.to_string())?;
                fs::write(vault.join(p), projects::set_field(&text, "context", &format!("\"[[{}]]\"", f.context))).map_err(|e| e.to_string())?;
            },
            "card_fields" => {
                let mut text = fs::read_to_string(&at).map_err(|e| e.to_string())?;
                for k in &f.paths {
                    text = projects::set_field(&text, k, match k.as_str() { "type" => "Project", "status" => "Active", _ => today });
                }
                fs::write(&at, text).map_err(|e| e.to_string())?;
            }
            _ => continue,
        }
        done += 1;
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-vaultcheck-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(d).unwrap()
    }
    fn w(root: &Path, rel: &str, body: &str) { let p = root.join(rel); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, body).unwrap(); }
    fn r(root: &Path, rel: &str) -> String { fs::read_to_string(root.join(rel)).unwrap() }
    fn kinds(l: &[Finding]) -> Vec<String> { l.iter().map(|f| format!("{} {} {}", f.kind, f.context, f.path)).collect() }
    // a team starter: the template with a personal file the team drops, and the overlay's team.md
    fn starter(root: &Path) -> Starter {
        let (t, o) = (root.join("starter"), root.join("overlay"));
        w(&t, "CLAUDE.md", "personal\n");
        w(&t, "System/rules/core/memory.md", "m\n");
        w(&t, "System/rules/core/user-profile.md", "me\n");
        w(&t, "System/rules/core/work-state.md", "generated\n");
        w(&t, "System/skills/x/SKILL.md", "s\n");
        w(&t, "Resources/Templates/Context.md", "---\ntype: Context\naliases:\n  - \"{{title}}\"\n---\n");
        w(&o, "CLAUDE.md", "team\n");
        w(&o, "System/rules/core/team.md", "t\n");
        Starter { template: t, overlay: Some(o) }
    }

    #[test]
    fn a_team_workspace_missing_its_pieces_is_found_and_repaired() {
        let root = tmp("team");
        let s = starter(&root);
        let v = root.join("ws");
        w(&v, "System/rules/core/memory.md", "kept\n");
        w(&v, "System/rules/core/work-state.md", "*Generated by `System/scripts/build-index.py`*\n");
        w(&v, "System/rules/work/context.md", "---\npaths:\n  - \"Contexts/Work/**\"\n---\n");
        w(&v, "System/rules/gone/context.md", "---\npaths:\n  - \"Contexts/Gone/**\"\n---\n");
        w(&v, "Contexts/Work/Work.md", "---\ntype: Context\n---\n");
        w(&v, "Contexts/Work/Projects/A/A.md", "---\ntype: Project\ncontext: \"[[Work]]\"\nstatus: Active\nlast: 2026-10-01\n---\n");
        w(&v, "Contexts/Work/Projects/B/B.md", "---\ncontext: \"[[Work]]\"\nstatus:\n---\n");
        w(&v, "Contexts/Work/Projects/B/Documents/Spec.md", "---\ncontext: \"[[Sales]]\"\n---\n");
        w(&v, "Contexts/Sales/Deal.md", "---\ncontext:\n  - \"[[Sales]]\"\n---\n");
        let side = Side { vault: v.to_string_lossy().into(), work_state: v.join("System/rules/core/work-state.md").to_string_lossy().into(), notes: v.join("Contexts").to_string_lossy().into() };
        let found = check(&side, &s);
        assert_eq!(kinds(&found), vec![
            "claude_link  .claude",
            "missing_file  CLAUDE.md",
            "missing_file  Resources/Templates/Context.md",
            "missing_file  System/rules/core/team.md",
            "context_note Sales Contexts/Sales/Sales.md",
            "context_rule Sales System/rules/sales/context.md",
            "context_mismatch Work Contexts/Work",
            "card_fields Work Contexts/Work/Projects/B/B.md",
            "orphan_rule  System/rules/gone/context.md",
        ]);
        assert_eq!(found[6].paths, vec!["Contexts/Work/Projects/B/Documents/Spec.md"]);
        assert_eq!(found[7].paths, vec!["type", "status", "last"]);

        let ids: Vec<String> = found.iter().map(|f| f.id()).collect();
        assert_eq!(repair(&side, &s, &ids, "2026-10-29").unwrap(), 8);
        assert_eq!(kinds(&check(&side, &s)), vec!["orphan_rule  System/rules/gone/context.md"]);
        assert_eq!(r(&v, "CLAUDE.md"), "team\n");
        assert_eq!(r(&v, "System/rules/core/memory.md"), "kept\n");
        assert_eq!(fs::read_link(v.join(".claude")).unwrap(), PathBuf::from("System"));
        assert!(r(&v, "System/rules/sales/context.md").starts_with("---\npaths:\n  - \"Contexts/Sales/**\"\n---\n\n# Sales Context"));
        assert_eq!(r(&v, "Contexts/Sales/Sales.md"), "---\ntype: Context\naliases:\n  - \"Sales\"\n---\n");
        assert_eq!(r(&v, "Contexts/Work/Projects/B/Documents/Spec.md"), "---\ncontext: \"[[Work]]\"\n---\n");
        assert_eq!(r(&v, "Contexts/Work/Projects/B/B.md"), "---\ncontext: \"[[Work]]\"\nstatus: Active\ntype: Project\nlast: 2026-10-29\n---\n");
        // the dropped personal profile is not asked for
        assert!(!v.join("System/rules/core/user-profile.md").exists());
    }

    #[test]
    fn a_vault_relay_did_not_make_is_checked_for_its_contexts_only() {
        let root = tmp("own");
        let s = starter(&root);
        let v = root.join("vault");
        w(&v, "Meta/Claude/rules/work/context.md", "---\npaths:\n  - \"Contexts/Work/**\"\n---\n");
        std::os::unix::fs::symlink("Meta/Claude", v.join(".claude")).unwrap();
        w(&v, "State/ws.md", "## Work\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| [[A]] | Active | 2026-10-01 | a |\n| [[Ghost]] | Active | 2026-10-01 | g |\n");
        w(&v, "Contexts/Work/Work.md", "---\ntype: Context\n---\n");
        w(&v, "Contexts/Work/Portfolio/A/A.md", "---\ncontext: \"[[Work]]\"\n---\n");
        w(&v, "Contexts/Home/Home.md", "---\ntype: Context\n---\n");
        let side = Side { vault: v.to_string_lossy().into(), work_state: v.join("State/ws.md").to_string_lossy().into(), notes: v.join("Contexts").to_string_lossy().into() };
        let found = check(&side, &s);
        assert_eq!(kinds(&found), vec![
            "context_rule Home Meta/Claude/rules/home/context.md",
            "context_heading Home State/ws.md",
            "row_without_note Work Ghost",
        ]);
        let ids: Vec<String> = found.iter().map(|f| f.id()).collect();
        assert_eq!(repair(&side, &s, &ids, "2026-10-29").unwrap(), 2);
        assert!(r(&v, "State/ws.md").contains("## Home\n\n| Project |"));
        assert_eq!(kinds(&check(&side, &s)), vec!["row_without_note Work Ghost"]);
    }

    #[test]
    fn named_contexts_reads_a_value_or_a_list() {
        assert_eq!(named_contexts("a: 1\ncontext: \"[[Work|w]]\"\nb: 2"), Some(vec!["Work".into()]));
        assert_eq!(named_contexts("context:\n  - \"[[A]]\"\n  - B\nb: 2"), Some(vec!["A".into(), "B".into()]));
        assert_eq!(named_contexts("context:\nb: 2"), None);
        assert_eq!(named_contexts("b: 2"), None);
    }
}
