// The workspace check: what a vault needs so every member's Claude works in it, and the repair of what is missing.
// A vault Relay made (its config folder is System/) has the starter's files: CLAUDE.md, AGENTS.md (the same rules for Codex and OpenCode), the core and vault rules,
// reminders, templates; a team workspace the team starter's (vault::create_team), a personal one the personal one.
// Every vault, made by Relay or not, is checked for its contexts: each has its note and its rule, a table in a
// hand-kept work-state, and its notes name it in `context:`. A card has its fields, a row its note. A repair writes
// a missing file, never over one that is there, and sets fields; what needs a person's call is only reported.

use crate::migrate::{self, Side};
use crate::projects;
use crate::vault::rel_to as rel;
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
const REQUIRED: [&str; 6] = ["CLAUDE.md", "AGENTS.md", "System/rules/core/", "System/rules/vault/", "System/reminders.md", "Resources/Templates/"];

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
/// A vault Relay made: its config folder is System/ (`.claude` links there, or is not there yet).
fn from_starter(vault: &Path) -> bool {
    match fs::canonicalize(vault.join(".claude")) { Ok(c) => c == vault.join("System"), Err(_) => vault.join("System/rules/core").is_dir() }
}
/// The frontmatter of a note, without its fences, or None.
pub(crate) fn frontmatter(text: &str) -> Option<&str> { crate::vault::split(text).map(|(fm, _)| fm) }
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
        if !crate::platform::dir_link_ok(&vault.join(".claude")) { out.push(f("claude_link", "", ".claude".into(), vec![], true)); }
        for r in starter.required() {
            if fs::symlink_metadata(vault.join(&r)).is_err() { out.push(f("missing_file", "", r, vec![], true)); }
        }
    }
    // macOS has what the starter's scripts and hooks run, Windows does not
    #[cfg(windows)]
    out.extend(missing_tools(&vault, &windows_has));
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

// ---- the garden: where the vault is decaying. Findings in the shape of the check's, one per kind, `paths` the notes
// they are about; none has a Repair (`fix` false): each has its own action in the UI, run by the person asking.

/// What the garden leaves alone: the notes the vault runs on.
const NOT_THEIRS: [&str; 2] = ["System/", "Resources/Templates/"];
/// Orphans are noisy there: a daily note links out and nothing links back.
const NOT_ORPHANS: [&str; 3] = ["System/", "Resources/Templates/", "Calendar/Daily/"];

/// Whether a frontmatter key has a value, a list's first item too.
fn fm_has(fm: &str, key: &str) -> bool {
    let mut lines = fm.lines();
    let Some(v) = lines.find_map(|l| l.strip_prefix(key)?.strip_prefix(':')) else { return false };
    if !v.trim().trim_matches(['"', '\'', '[', ']']).is_empty() { return true; }
    lines.next().is_some_and(|l| l.trim_start().strip_prefix("- ").is_some_and(|i| !i.trim().is_empty()))
}
/// (line, target) of every [[link]], ![[embed]] and local ](link) of a note, outside code fences.
// ponytail: a line scanner (no markdown parser): inline code spans and %-escapes other than %20 are not understood.
fn links(text: &str) -> Vec<(usize, String)> {
    let (mut out, mut fenced) = (vec![], false);
    for (i, l) in text.lines().enumerate() {
        if l.trim_start().starts_with("```") || l.trim_start().starts_with("~~~") { fenced = !fenced; continue; }
        if fenced { continue; }
        for c in crate::pagefiles::WIKI.captures_iter(l) { out.push((i + 1, c[1].trim().to_string())); }
        for c in crate::pagefiles::MDLINK.captures_iter(l) {
            let d = c[1].trim_matches(['<', '>']);
            if d.contains("://") || d.starts_with("mailto:") || d.starts_with('#') { continue; }
            out.push((i + 1, d.split('#').next().unwrap_or(d).replace("%20", " ")));
        }
    }
    out
}
/// A link's target as the files are keyed: lowercase, no leading `/`, `./` or `../`, no `.md`.
fn key_of(t: &str) -> String {
    let mut t = t.trim().trim_start_matches('/');
    while let Some(r) = t.strip_prefix("./").or_else(|| t.strip_prefix("../")) { t = r; }
    let t = t.to_lowercase();
    t.strip_suffix(".md").map(String::from).unwrap_or(t)
}
/// A file's path as keys: "a/B.md" is "a/b" and "b", "a/p.png" is "a/p.png" and "p.png".
fn keys_of(p: &str) -> Vec<String> {
    let k = if p.ends_with(".md") { key_of(p) } else { p.to_lowercase() };
    let mut out = vec![k.clone()];
    out.extend(k.match_indices('/').map(|(i, _)| k[i + 1..].to_string()));
    out
}

/// What the garden finds: `outside_home` (`path` the type, as Tidy structure), `no_project` (meetings without `about:`,
/// newest first), `broken_link` (paths "note<TAB>line<TAB>target"), `orphan`, `unused_attachment` (`context` their total
/// bytes) and `no_type`. A kind with nothing found is not listed.
pub fn garden(side: &Side) -> Vec<Finding> {
    let Ok(vault) = fs::canonicalize(&side.vault) else { return vec![] };
    let all = crate::pagefiles::all_files(&vault);
    let mut by: std::collections::HashMap<String, Vec<usize>> = Default::default();
    for (i, p) in all.iter().enumerate() { for k in keys_of(p) { by.entry(k).or_default().push(i); } }
    let under = |p: &str, skip: &[&str]| skip.iter().any(|s| p.starts_with(s));
    let mut used = std::collections::HashSet::new();
    let (mut inc, mut outg, mut about) = (vec![false; all.len()], vec![false; all.len()], vec![false; all.len()]);
    let (mut no_project, mut broken, mut no_type) = (vec![], vec![], vec![]);
    for (i, p) in all.iter().enumerate().filter(|(_, p)| p.ends_with(".md")) {
        if fs::metadata(vault.join(p)).map_or(true, |m| m.len() > 1 << 20) { continue; }
        let Ok(text) = fs::read_to_string(vault.join(p)) else { continue };
        let fm = frontmatter(&text).unwrap_or("");
        about[i] = fm_has(fm, "about");
        let ours = !under(p, &NOT_THEIRS);
        if ours {
            let kind = fm.lines().find_map(|l| l.strip_prefix("type:")).map(|v| v.trim().trim_matches(['"', '\'']).to_lowercase()).unwrap_or_default();
            if kind.is_empty() { no_type.push(p.clone()); }
            if kind == "meeting" && !about[i] { no_project.push(p.clone()); }
        }
        for (line, target) in links(&text) {
            match by.get(&key_of(&target)) {
                Some(hits) => for &j in hits.iter().filter(|j| **j != i) {
                    if all[j].ends_with(".md") { outg[i] = true; inc[j] = true } else { used.insert(j); }
                },
                None if ours => broken.push(format!("{p}\t{line}\t{target}")),
                None => {}
            }
        }
    }
    let f = |kind, context: String, path: &str, mut paths: Vec<String>| (!paths.is_empty()).then(|| { paths.sort(); Finding { kind, context, path: path.into(), paths, fix: false } });
    let mut out = vec![];
    // notes whose type has a home and that sit elsewhere, by type: Tidy structure moves them
    let mut outside: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for m in crate::tidy::plan(side).moves { outside.entry(m.kind).or_default().push(m.from); }
    out.extend(outside.into_iter().filter_map(|(kind, paths)| f("outside_home", String::new(), &kind, paths)));
    out.extend(f("no_project", String::new(), "", no_project).map(|mut x| { x.paths.reverse(); x }));
    out.extend(f("broken_link", String::new(), "", broken));
    let orphans = (0..all.len()).filter(|i| all[*i].ends_with(".md") && !inc[*i] && !outg[*i] && !about[*i] && !under(&all[*i], &NOT_ORPHANS)).map(|i| all[i].clone()).collect();
    out.extend(f("orphan", String::new(), "", orphans));
    // an attachment: a file other than a note, in a folder named Attachments or where this vault puts them
    let home = crate::homes::home(&vault, "attachments", "0000");
    let home = rel(&vault, home.parent().unwrap_or(&vault));
    let unused: Vec<usize> = (0..all.len()).filter(|i| !all[*i].ends_with(".md") && !used.contains(i) && !under(&all[*i], &NOT_THEIRS)
        && (all[*i].split('/').rev().skip(1).any(|d| d.eq_ignore_ascii_case("attachments")) || all[*i].starts_with(&format!("{home}/")))).collect();
    let bytes: u64 = unused.iter().map(|i| fs::metadata(vault.join(&all[*i])).map_or(0, |m| m.len())).sum();
    out.extend(f("unused_attachment", bytes.to_string(), "", unused.iter().map(|i| all[*i].clone()).collect()));
    out.extend(f("no_type", String::new(), "", no_type));
    out
}

/// Repairs the findings named by `ids` that the check still finds and can fix. Returns how many it repaired.
pub fn repair(side: &Side, starter: &Starter, ids: &[String], today: &str) -> Result<usize, String> {
    let vault = fs::canonicalize(&side.vault).map_err(|e| e.to_string())?;
    let mut done = 0;
    for f in check(side, starter).into_iter().filter(|f| f.fix && ids.contains(&f.id())) {
        let at = vault.join(&f.path);
        match f.kind {
            "claude_link" => crate::platform::dir_link("System", &at).map_err(|e| e.to_string())?,
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

/// What runs the vault's own files and is not on this computer, each a finding Repair cannot fix: `python` (Python 3)
/// for System/scripts/build-index.py, which Relay runs for the project index, and `bash` (Git Bash) and `jq` for the
/// `.sh` hooks Claude Code runs (in PowerShell without Git Bash, where they fail). `context` names what needs it.
#[cfg_attr(not(windows), allow(dead_code))]
fn missing_tools(vault: &Path, has: &dyn Fn(&str) -> bool) -> Vec<Finding> {
    let hooks = fs::read_dir(vault.join(".claude/hooks")).into_iter().flatten().flatten().any(|e| e.path().extension().is_some_and(|x| x == "sh"));
    let needs = [("python", "System/scripts/build-index.py", vault.join("System/scripts/build-index.py").is_file()), ("bash", "System/hooks", hooks), ("jq", "System/hooks", hooks)];
    needs.into_iter().filter(|&(tool, _, needed)| needed && !has(tool))
        .map(|(tool, by, _)| Finding { kind: "missing_tool", context: by.into(), path: tool.into(), paths: vec![], fix: false }).collect()
}
/// Whether a tool `missing_tools` asks for is on this Windows computer: Python 3 as Relay runs it, Git Bash where
/// Git for Windows puts it (or `CLAUDE_CODE_GIT_BASH_PATH`, Claude Code's setting for it), `jq.exe` on the PATH.
#[cfg(windows)]
fn windows_has(tool: &str) -> bool {
    let on_path = |exe: &str| std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(exe).is_file()));
    match tool {
        "python" => crate::platform::python("").is_some(),
        "jq" => on_path("jq.exe"),
        _ => {
            let git = std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).find(|d| d.join("git.exe").is_file()));
            std::env::var_os("CLAUDE_CODE_GIT_BASH_PATH").map(PathBuf::from).into_iter()
                .chain(git.and_then(|d| d.parent().map(|g| g.join("bin/bash.exe"))))
                .chain(std::env::var_os("ProgramFiles").map(|p| Path::new(&p).join("Git/bin/bash.exe")))
                .any(|b| b.is_file())
        }
    }
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
        w(&t, "AGENTS.md", "agents\n");
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
            "missing_file  AGENTS.md",
            "missing_file  CLAUDE.md",
            "missing_file  Resources/Templates/Context.md",
            "missing_file  System/rules/core/team.md",
            "context_note Sales Contexts/Sales/Sales.md",
            "context_rule Sales System/rules/sales/context.md",
            "context_mismatch Work Contexts/Work",
            "card_fields Work Contexts/Work/Projects/B/B.md",
            "orphan_rule  System/rules/gone/context.md",
        ]);
        assert_eq!(found[7].paths, vec!["Contexts/Work/Projects/B/Documents/Spec.md"]);
        assert_eq!(found[8].paths, vec!["type", "status", "last"]);

        let ids: Vec<String> = found.iter().map(|f| f.id()).collect();
        assert_eq!(repair(&side, &s, &ids, "2026-10-29").unwrap(), 9);
        assert_eq!(kinds(&check(&side, &s)), vec!["orphan_rule  System/rules/gone/context.md"]);
        assert_eq!(r(&v, "CLAUDE.md"), "team\n");
        assert_eq!(r(&v, "AGENTS.md"), "agents\n");
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
    fn notes_outside_their_home_are_found_by_type_and_not_repaired() {
        let root = tmp("home");
        let v = root.join("vault");
        w(&v, "State/ws.md", "## Work\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n");
        w(&v, "Contexts/Work/Work.md", "---\ntype: Context\n---\n");
        w(&v, "Calendar/2026-11-04 Sync.md", "---\ntype: Meeting\n---\n");
        w(&v, "Calendar/2026-11-03 Sync.md", "---\ntype: Meeting\n---\n");
        w(&v, "Calendar/2026-11-04.md", "---\ntype: Daily\n---\n");
        w(&v, "Calendar/Meetings/2026/2026-10-01 Home.md", "---\ntype: Meeting\n---\n");
        let side = Side { vault: v.to_string_lossy().into(), work_state: v.join("State/ws.md").to_string_lossy().into(), notes: v.join("Contexts").to_string_lossy().into() };
        let found: Vec<Finding> = garden(&side).into_iter().filter(|f| f.kind == "outside_home").collect();
        assert_eq!(kinds(&found), vec!["outside_home  Daily", "outside_home  Meeting"]);
        assert_eq!(found[1].paths, vec!["Calendar/2026-11-03 Sync.md", "Calendar/2026-11-04 Sync.md"]);
        assert!(found.iter().all(|f| !f.fix));
    }

    #[test]
    fn the_garden_finds_one_of_each_problem() {
        let root = tmp("garden");
        let v = root.join("vault");
        w(&v, "System/ws.md", "## Work\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n");
        w(&v, "Calendar/2026-11-04 Sync.md", "---\ntype: Meeting\n---\n[[Linked]]\n");
        w(&v, "Calendar/Meetings/2026/2026-10-01 Ok.md", "---\ntype: Meeting\nabout: \"[[Linked]]\"\n---\n![[chart.png]]\n");
        w(&v, "Notes/Linked.md", "---\ntype: Note\n---\nsee [[Gone]] and [[Linked]]\n```\n[[In Code]]\n```\n[doc](../Files/a%20b.pdf)\n");
        w(&v, "Notes/Alone.md", "---\ntype: Note\n---\nnothing\n");
        w(&v, "Notes/Typeless.md", "no frontmatter, links [[Linked]]\n");
        w(&v, "Calendar/Daily/2026/2026-11-04.md", "---\ntype: Daily\n---\n");
        w(&v, "Resources/Templates/T.md", "---\ntype: Meeting\n---\n[[{{x}}]]\n");
        w(&v, "Attachments/2026/chart.png", "12345");
        w(&v, "Attachments/2026/unused.png", "123456789");
        w(&v, "Files/a b.pdf", "pdf");
        let side = Side { vault: v.to_string_lossy().into(), work_state: v.join("System/ws.md").to_string_lossy().into(), notes: v.join("Contexts").to_string_lossy().into() };
        let found = garden(&side);
        let at = |k: &str| found.iter().find(|f| f.kind == k).map(|f| f.paths.clone()).unwrap_or_default();
        assert_eq!(at("outside_home"), vec!["Calendar/2026-11-04 Sync.md"]);
        assert_eq!(at("no_project"), vec!["Calendar/2026-11-04 Sync.md"]);
        assert_eq!(at("broken_link"), vec!["Notes/Linked.md\t4\tGone"]);
        assert_eq!(at("orphan"), vec!["Notes/Alone.md"]);
        assert_eq!(at("unused_attachment"), vec!["Attachments/2026/unused.png"]);
        assert_eq!(found.iter().find(|f| f.kind == "unused_attachment").unwrap().context, "9");
        assert_eq!(at("no_type"), vec!["Notes/Typeless.md"]);
        assert!(found.iter().all(|f| !f.fix));
    }

    #[test]
    fn named_contexts_reads_a_value_or_a_list() {
        assert_eq!(named_contexts("a: 1\ncontext: \"[[Work|w]]\"\nb: 2"), Some(vec!["Work".into()]));
        assert_eq!(named_contexts("context:\n  - \"[[A]]\"\n  - B\nb: 2"), Some(vec!["A".into(), "B".into()]));
        assert_eq!(named_contexts("context:\nb: 2"), None);
        assert_eq!(named_contexts("b: 2"), None);
    }

    #[test]
    fn missing_tools_only_for_what_the_vault_runs() {
        let v = tmp("tools");
        assert!(missing_tools(&v, &|_| false).is_empty());
        w(&v, "System/scripts/build-index.py", "");
        w(&v, ".claude/hooks/check.sh", "");
        assert_eq!(kinds(&missing_tools(&v, &|_| false)), ["missing_tool System/scripts/build-index.py python", "missing_tool System/hooks bash", "missing_tool System/hooks jq"]);
        assert_eq!(kinds(&missing_tools(&v, &|t| t != "jq")), ["missing_tool System/hooks jq"]);
        assert!(missing_tools(&v, &|_| true).iter().all(|f| !f.fix));
    }
}
