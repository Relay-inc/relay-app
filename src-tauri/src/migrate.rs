// A project moved or copied to another vault (workspace): its note, or its folder when the note is a folder note, its
// work-state row (a hand-kept table) or card (a vault whose work-state.md build-index.py generates from the project
// notes' frontmatter), its entries in .relay/config.json (icon, Design link, repos) and its scratch notes. `plan` reads
// both sides and writes nothing; `apply` writes the plan. Nothing is written while a path in the target exists, and a
// move removes only what was copied, after every write succeeded. Conversations are not touched here: they stay in the
// vault they ran in (policy::fence), the webview makes them general conversations there.

use regex::Regex;
use relay_remote::sync::Filter;
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// One vault as the move reads it: the folder, its work-state file and the folder of its notes.
pub struct Side { pub vault: String, pub work_state: String, pub notes: String }

pub struct Plan {
    name: String,
    context: String,
    note: PathBuf,
    /// what is written, as (from, to), the note among them; scratch notes and the icon file too
    files: Vec<(PathBuf, PathBuf)>,
    /// paths left behind: links (never followed) and what the target's filter keeps out
    skipped: Vec<String>,
    /// target paths that exist, and a project of that name there: nothing is written then
    conflicts: Vec<String>,
    /// the folders that are the project's own (its folder, its scratch notes): emptied by a move, they go
    owned: Vec<PathBuf>,
    /// the project's row in the source work-state, as written there
    row: Option<String>,
    from_card: bool,
    to_card: bool,
    entries: Value,
}

/// A vault whose work-state.md build-index.py writes from the cards.
pub fn cards(side: &Side) -> bool {
    Path::new(&side.vault).join("System/scripts/build-index.py").is_file()
        || fs::read_to_string(&side.work_state).is_ok_and(|t| t.contains("build-index.py"))
}
/// One folder or file name: no separator, no `..`, not hidden.
fn plain(s: &str) -> bool { !s.is_empty() && !s.starts_with('.') && !s.contains(['/', '\\']) && s != ".." }
fn rel(p: &Path, root: &Path) -> String { p.strip_prefix(root).unwrap_or(p).to_string_lossy().into_owned() }

/// Every file under `p` (or `p` itself), links listed apart and never followed.
fn walk(p: &Path, files: &mut Vec<PathBuf>, links: &mut Vec<PathBuf>) {
    let Ok(m) = fs::symlink_metadata(p) else { return };
    if m.file_type().is_symlink() { links.push(p.into()); }
    else if m.is_dir() {
        let mut subs: Vec<PathBuf> = fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).collect();
        subs.sort();
        for s in subs { walk(&s, files, links); }
    } else { files.push(p.into()); }
}
/// Whether a path in the target would be written through a link: every part of it that exists, below the vault, is
/// a plain folder.
fn through_link(vault: &Path, p: &Path) -> bool {
    let mut at = vault.to_path_buf();
    for c in p.strip_prefix(vault).unwrap_or(p).components() {
        let Component::Normal(c) = c else { return true };
        at.push(c);
        match fs::symlink_metadata(&at) { Ok(m) if m.file_type().is_symlink() => return true, Ok(_) => {}, Err(_) => return false }
    }
    false
}

/// The project's row in a work-state table: the line whose first cell is `[[name]]` or `name`.
fn row_of(work_state: &str, name: &str) -> Option<String> {
    let row = Regex::new(&format!(r"^\| (?:\[\[{0}(?:\|[^\]]*)?\]\][^|]*|{0}) \| ", regex::escape(name))).unwrap();
    fs::read_to_string(work_state).ok()?.lines().find(|l| row.is_match(l)).map(String::from)
}
/// `text` with `line` added to the table under the `## ctx` or `### ctx` heading, or under a new heading at the end.
pub fn add_row(text: &str, ctx: &str, line: &str) -> String {
    let head = Regex::new(&format!(r"^#{{2,3}} {}\s*$", regex::escape(ctx))).unwrap();
    let mut lines: Vec<&str> = text.lines().collect();
    if let Some(h) = lines.iter().position(|l| head.is_match(l)) {
        let end = lines[h + 1..].iter().position(|l| l.starts_with('#')).map_or(lines.len(), |i| h + 1 + i);
        if let Some(last) = (h + 1..end).rev().find(|&i| lines[i].starts_with('|')) {
            lines.insert(last + 1, line);
            return lines.join("\n") + "\n";
        }
        let mut out = lines[..=h].join("\n");
        out += &format!("\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n{line}\n");
        let rest = lines[h + 1..].join("\n");
        return if rest.trim().is_empty() { out } else { format!("{out}{}\n", rest.trim_start_matches('\n')) };
    }
    format!("{}\n\n### {ctx}\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n{line}\n", text.trim_end())
}
/// `text` without `line` (once).
fn drop_row(text: &str, line: &str) -> String {
    let mut gone = false;
    let kept: Vec<&str> = text.lines().filter(|l| { let x = !gone && *l == line; gone |= x; !x }).collect();
    kept.join("\n") + "\n"
}
/// A project note as a card in another context: `context` set to it, and the fields build-index.py needs that the
/// note lacks (status, last, index) from the work-state row.
pub fn as_card(text: &str, ctx: &str, row: Option<&str>, today: &str) -> String {
    let cells: Vec<String> = row.map(|r| r.trim_matches('|').split(" | ").map(|c| c.trim().to_string()).collect()).unwrap_or_default();
    let cell = |i: usize| cells.get(i).cloned().unwrap_or_default();
    let date = Regex::new(r"^\d{4}-\d\d-\d\d$").unwrap();
    let last = Some(cell(2)).filter(|d| date.is_match(d)).unwrap_or_else(|| today.to_string());
    let index: String = cell(3).replace(['|', '"'], "'").chars().take(160).collect();
    let status = Some(cell(1)).filter(|s| !s.is_empty()).unwrap_or_else(|| "Active".into());
    let (fm, body) = match text.strip_prefix("---\n").and_then(|t| t.split_once("\n---")) {
        Some((fm, body)) => (fm.to_string(), body.to_string()),
        None => (String::new(), format!("\n{text}")),
    };
    let mut lines: Vec<String> = vec![];
    let mut skip_list = false;
    for l in fm.lines() {
        if skip_list && (l.starts_with(' ') || l.starts_with('\t')) { continue; }
        skip_list = false;
        if l.starts_with("context:") { skip_list = true; continue; }
        lines.push(l.to_string());
    }
    let has = |k: &str, lines: &[String]| lines.iter().any(|l| l.starts_with(&format!("{k}:")));
    let mut add = vec![format!("context: \"[[{ctx}]]\"")];
    if !has("status", &lines) { add.push(format!("status: {status}")); }
    if !has("last", &lines) { add.push(format!("last: {last}")); }
    if !has("index", &lines) { add.push(format!("index: \"{index}\"")); }
    lines.splice(0..0, add);
    format!("---\n{}\n---{body}", lines.join("\n"))
}

/// What moving project `name` from `from` to context `ctx` of `to` would write. `filter`: what may go into the target
/// (a shared vault's sync filter). `taken`: the target has a project of that name.
pub fn plan(from: &Side, to: &Side, name: &str, ctx: &str, filter: &Filter, taken: bool) -> Result<Plan, String> {
    if !plain(name) || !plain(ctx) { return Err(format!("not a plain name: {name} / {ctx}")); }
    let (src_vault, dst_vault) = (fs::canonicalize(&from.vault).map_err(|e| e.to_string())?, fs::canonicalize(&to.vault).map_err(|e| e.to_string())?);
    if src_vault == dst_vault { return Err("the project is in that workspace already".into()); }
    let note = crate::snapshot::project_note(&from.vault, &from.notes, name).ok_or_else(|| format!("no note {name}.md found"))?;
    let real = fs::canonicalize(&note).map_err(|e| e.to_string())?;
    if !real.starts_with(&src_vault) { return Err(format!("{} lies outside the workspace", note.display())); }
    let src_notes = PathBuf::from(&from.notes);
    // a folder note (<P>/<P>.md) takes its folder along, a flat note only itself
    let parent = note.parent().unwrap_or(&src_notes);
    let root = if parent.file_name().is_some_and(|f| f.to_string_lossy() == note.file_stem().unwrap_or_default().to_string_lossy()) && parent != src_notes { parent.to_path_buf() } else { note.clone() };
    let to_card = cards(to);
    // where it lands: the same folders below the context, or Projects/ in a vault of cards
    let segs: Vec<String> = root.strip_prefix(&src_notes).unwrap_or(&root).components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let from_ctxs = crate::snapshot::contexts(&from.vault, &from.notes)?;
    let middle: Vec<String> = match segs.split_last() {
        Some((_, rest)) if rest.first().is_some_and(|c| from_ctxs.contains(c)) => rest[1..].to_vec(),
        Some((_, rest)) => rest.to_vec(),
        None => vec![],
    };
    let base = segs.last().cloned().unwrap_or_else(|| format!("{name}.md"));
    let dst_root = if to_card { dst_vault.join("Contexts").join(ctx).join("Projects").join(&base) }
        else { middle.iter().fold(PathBuf::from(&to.notes).join(ctx), |p, s| p.join(s)).join(&base) };
    let known = if to_card { dst_vault.join("Contexts").join(ctx).is_dir() } else { crate::snapshot::contexts(&to.vault, &to.notes)?.iter().any(|c| c == ctx) };
    if !known { return Err(format!("no context {ctx} in the target workspace")); }
    let (mut found, mut links) = (vec![], vec![]);
    walk(&root, &mut found, &mut links);
    let mut skipped: Vec<String> = links.iter().map(|l| rel(l, &src_vault)).collect();
    let mut files = vec![];
    for f in found {
        let dst = dst_root.join(f.strip_prefix(&root).unwrap_or(Path::new("")));
        let dst = if f == root { dst_root.clone() } else { dst };
        let size = fs::metadata(&f).map_or(0, |m| m.len());
        if filter.skips(&rel(&dst, &dst_vault), false) || (filter.max_size > 0 && size > filter.max_size) {
            if f == note { return Err(format!("{name}.md may not go into that workspace")); }
            skipped.push(rel(&f, &src_vault));
        } else { files.push((f, dst)); }
    }
    // the scratch notes and the icon file, under .relay/: Relay's own, never synced
    let (sd, dd) = (crate::scratch::dir(&from.vault, name)?, crate::scratch::dir(&to.vault, name)?);
    for e in fs::read_dir(&sd).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_file())) { files.push((e.path(), dd.join(e.file_name()))); }
    let (entries, icon) = crate::relay_config::project_entries(&from.vault, name);
    if let Some(f) = icon { files.push((crate::relay_config::path(&from.vault).with_file_name(&f), crate::relay_config::path(&to.vault).with_file_name(&f))); }
    let mut conflicts: Vec<String> = files.iter().filter(|(_, d)| fs::symlink_metadata(d).is_ok()).map(|(_, d)| rel(d, &dst_vault)).collect();
    if taken { conflicts.insert(0, name.to_string()); }
    if let Some((_, d)) = files.iter().find(|(_, d)| through_link(&dst_vault, d)) { return Err(format!("{} lies behind a link", rel(d, &dst_vault))); }
    let owned = [root.clone(), sd].into_iter().filter(|d| d.is_dir()).collect();
    Ok(Plan { name: name.into(), context: ctx.into(), note, files, owned, skipped, conflicts, row: row_of(&from.work_state, name), from_card: cards(from), to_card, entries })
}

impl Plan {
    /// What the dialog shows: the files that go (paths in the target), what stays, what is in the way.
    pub fn json(&self, to: &Side) -> Value {
        let dst = fs::canonicalize(&to.vault).unwrap_or_else(|_| PathBuf::from(&to.vault));
        let notes: Vec<String> = self.files.iter().filter(|(_, d)| !d.starts_with(dst.join(".relay"))).map(|(_, d)| rel(d, &dst)).collect();
        let e = &self.entries;
        json!({
            "files": notes,
            "scratch": self.files.iter().filter(|(_, d)| d.starts_with(dst.join(".relay/notes"))).count(),
            "skipped": self.skipped,
            "conflicts": self.conflicts,
            "row": self.row.is_some() || self.from_card,
            "card": self.to_card,
            "icon": e["icons"].as_object().is_some_and(|m| !m.is_empty()),
            "design": e["designs"].as_object().is_some_and(|m| !m.is_empty()),
            "repos": e["repos"].as_object().map_or(0, |m| m.len()),
        })
    }

    /// Writes the plan; `mv` then removes from the source what was copied. A failed write takes back what it wrote.
    pub fn apply(&self, from: &Side, to: &Side, mv: bool, today: &str) -> Result<(), String> {
        if !self.conflicts.is_empty() { return Err(format!("already in that workspace: {}", self.conflicts.join(", "))); }
        let mut written: Vec<&Path> = vec![];
        let res = (|| -> Result<(), String> {
            for (s, d) in &self.files {
                fs::create_dir_all(d.parent().unwrap()).map_err(|e| e.to_string())?;
                if fs::symlink_metadata(d).is_ok() { return Err(format!("{} appeared meanwhile", d.display())); }
                if *s == self.note && self.to_card {
                    let text = fs::read_to_string(s).map_err(|e| e.to_string())?;
                    fs::write(d, as_card(&text, &self.context, self.row.as_deref(), today)).map_err(|e| e.to_string())?;
                } else { fs::copy(s, d).map_err(|e| e.to_string())?; }
                written.push(d);
            }
            if !self.to_card {
                let line = self.row.clone().unwrap_or_else(|| format!("| [[{}]] | Active | {today} |  |", self.name));
                let text = fs::read_to_string(&to.work_state).map_err(|e| e.to_string())?;
                fs::write(&to.work_state, add_row(&text, &self.context, &line)).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        if let Err(e) = res {
            for d in written.iter().rev() { fs::remove_file(d).ok(); }
            return Err(e);
        }
        crate::relay_config::add_project_entries(&to.vault, &self.entries)?;
        if !mv { return Ok(()); }
        for (s, _) in &self.files { fs::remove_file(s).map_err(|e| format!("{}: {e}", s.display()))?; }
        // the project's folders the files left, deepest first: one with a file that stayed (a link, a filtered file) stays
        let mut dirs: Vec<&Path> = self.files.iter().flat_map(|(s, _)| s.ancestors().skip(1)).filter(|d| self.owned.iter().any(|o| d.starts_with(o))).collect();
        dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
        dirs.dedup();
        for d in dirs { fs::remove_dir(d).ok(); }
        if !self.from_card {
            if let Some(line) = &self.row {
                let text = fs::read_to_string(&from.work_state).map_err(|e| e.to_string())?;
                fs::write(&from.work_state, drop_row(&text, line)).map_err(|e| e.to_string())?;
            }
        }
        crate::relay_config::drop_project_entries(&from.vault, &self.name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-migrate-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(d).unwrap()
    }
    fn w(root: &Path, rel: &str, body: &str) { let p = root.join(rel); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, body).unwrap(); }
    fn side(v: &Path, ws: &str, notes: &str) -> Side {
        Side { vault: v.to_string_lossy().into(), work_state: v.join(ws).to_string_lossy().into(), notes: v.join(notes).to_string_lossy().into() }
    }
    const WS: &str = "# Work State\n\n## Work\n\n| Project | State | Last Touched | Left Off |\n|---------|-------|-------------|----------|\n| Kestrel | Active | 2026-10-20 | Shop page built. |\n| Other | Quiet | 2026-09-01 | x |\n";
    /// A hand-kept vault with Kestrel as a folder note, a document, scratch notes and config entries.
    fn own(name: &str) -> PathBuf {
        let v = tmp(name);
        w(&v, "State/work-state.md", WS);
        w(&v, "Contexts/Work/Portfolio/Kestrel/Kestrel.md", "---\ntype: Product\n---\n# Kestrel\n");
        w(&v, "Contexts/Work/Portfolio/Kestrel/Documents/Spec.md", "spec");
        w(&v, ".relay/notes/Kestrel/a1.md", "scratch");
        w(&v, ".relay/config.json", r#"{"icons": {"Kestrel": "🦅"}, "designs": {"Kestrel": "https://claude.ai/x"}, "repos": {"me/kestrel": "Kestrel", "me/other": "Other"}}"#);
        v
    }

    #[test]
    fn copy_into_a_hand_kept_work_state() {
        let (a, b) = (own("hand-a"), tmp("hand-b"));
        w(&b, "State/work-state.md", "# Work State\n\n## Clients\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| Habo | Active | 2026-10-01 | y |\n\n## Personal\n");
        fs::create_dir_all(b.join("Contexts/Clients")).unwrap();
        let (from, to) = (side(&a, "State/work-state.md", "Contexts"), side(&b, "State/work-state.md", "Contexts"));
        let p = plan(&from, &to, "Kestrel", "Clients", &Filter::vault_default(), false).unwrap();
        assert_eq!(p.json(&to)["files"], json!(["Contexts/Clients/Portfolio/Kestrel/Documents/Spec.md", "Contexts/Clients/Portfolio/Kestrel/Kestrel.md"]));
        p.apply(&from, &to, false, "2026-10-28").unwrap();
        let ws = fs::read_to_string(b.join("State/work-state.md")).unwrap();
        assert!(ws.contains("| Habo | Active | 2026-10-01 | y |\n| Kestrel | Active | 2026-10-20 | Shop page built. |\n\n## Personal"), "{ws}");
        assert_eq!(fs::read_to_string(b.join(".relay/notes/Kestrel/a1.md")).unwrap(), "scratch");
        let cfg: Value = serde_json::from_str(&fs::read_to_string(b.join(".relay/config.json")).unwrap()).unwrap();
        assert_eq!(cfg["repos"], json!({"me/kestrel": "Kestrel"}));
        assert_eq!(cfg["icons"]["Kestrel"], "🦅");
        // a copy leaves the source as it was
        assert!(a.join("Contexts/Work/Portfolio/Kestrel/Kestrel.md").is_file());
        assert_eq!(fs::read_to_string(a.join("State/work-state.md")).unwrap(), WS);
    }

    #[test]
    fn copy_into_a_vault_of_cards() {
        let (a, b) = (own("card-a"), tmp("card-b"));
        w(&b, "System/scripts/build-index.py", "# build-index");
        w(&b, "System/rules/core/work-state.md", "*Generated by `System/scripts/build-index.py`*\n");
        fs::create_dir_all(b.join("Contexts/Work")).unwrap();
        let (from, to) = (side(&a, "State/work-state.md", "Contexts"), side(&b, "System/rules/core/work-state.md", "Contexts"));
        plan(&from, &to, "Kestrel", "Work", &Filter::vault_default(), false).unwrap().apply(&from, &to, false, "2026-10-28").unwrap();
        let card = fs::read_to_string(b.join("Contexts/Work/Projects/Kestrel/Kestrel.md")).unwrap();
        assert_eq!(card, "---\ncontext: \"[[Work]]\"\nstatus: Active\nlast: 2026-10-20\nindex: \"Shop page built.\"\ntype: Product\n---\n# Kestrel\n");
        assert!(b.join("Contexts/Work/Projects/Kestrel/Documents/Spec.md").is_file());
        // the generated index is rebuilt by the caller, not edited here
        assert!(!fs::read_to_string(b.join("System/rules/core/work-state.md")).unwrap().contains("Kestrel"));
    }

    #[test]
    fn a_conflict_stops_before_any_write() {
        let (a, b) = (own("conf-a"), tmp("conf-b"));
        w(&b, "State/work-state.md", "# Work State\n");
        w(&b, "Contexts/Work/Portfolio/Kestrel/Documents/Spec.md", "theirs");
        let (from, to) = (side(&a, "State/work-state.md", "Contexts"), side(&b, "State/work-state.md", "Contexts"));
        let p = plan(&from, &to, "Kestrel", "Work", &Filter::vault_default(), false).unwrap();
        assert_eq!(p.json(&to)["conflicts"], json!(["Contexts/Work/Portfolio/Kestrel/Documents/Spec.md"]));
        assert!(p.apply(&from, &to, true, "2026-10-28").is_err());
        assert!(!b.join("Contexts/Work/Portfolio/Kestrel/Kestrel.md").exists());
        assert!(!b.join(".relay").exists());
        assert_eq!(fs::read_to_string(b.join("State/work-state.md")).unwrap(), "# Work State\n");
        assert!(a.join("Contexts/Work/Portfolio/Kestrel/Kestrel.md").is_file());
        // a project of that name there is a conflict too
        let p = plan(&from, &to, "Kestrel", "Work", &Filter::vault_default(), true).unwrap();
        assert_eq!(p.json(&to)["conflicts"][0], "Kestrel");
    }

    #[test]
    fn a_move_removes_the_source_only_after_the_writes() {
        let (a, b) = (own("move-a"), tmp("move-b"));
        w(&b, "State/work-state.md", "# Work State\n");
        fs::create_dir_all(b.join("Contexts/Work")).unwrap();
        // a file the target cannot take: the write fails halfway, and nothing of the source goes
        let (from, to) = (side(&a, "State/work-state.md", "Contexts"), side(&b, "State/work-state.md", "Contexts"));
        let p = plan(&from, &to, "Kestrel", "Work", &Filter::vault_default(), false).unwrap();
        w(&b, "Contexts/Work/Portfolio/Kestrel/Kestrel.md", "came meanwhile");
        assert!(p.apply(&from, &to, true, "2026-10-28").is_err());
        assert!(!b.join("Contexts/Work/Portfolio/Kestrel/Documents/Spec.md").exists(), "taken back");
        assert!(a.join("Contexts/Work/Portfolio/Kestrel/Documents/Spec.md").is_file());
        assert_eq!(fs::read_to_string(a.join("State/work-state.md")).unwrap(), WS);
        fs::remove_dir_all(b.join("Contexts/Work/Portfolio")).unwrap();
        // now it goes, and the source loses the folder, the row and the config entries
        plan(&from, &to, "Kestrel", "Work", &Filter::vault_default(), false).unwrap().apply(&from, &to, true, "2026-10-28").unwrap();
        assert!(b.join("Contexts/Work/Portfolio/Kestrel/Documents/Spec.md").is_file());
        assert!(!a.join("Contexts/Work/Portfolio/Kestrel").exists());
        assert!(a.join("Contexts/Work/Portfolio").is_dir(), "the context's folders stay");
        assert!(!a.join(".relay/notes/Kestrel").exists());
        assert!(!fs::read_to_string(a.join("State/work-state.md")).unwrap().contains("Kestrel"));
        let cfg: Value = serde_json::from_str(&fs::read_to_string(a.join(".relay/config.json")).unwrap()).unwrap();
        assert_eq!(cfg["repos"], json!({"me/other": "Other"}));
        assert!(cfg["icons"].get("Kestrel").is_none());
    }

    #[test]
    fn a_shared_target_gets_what_its_sync_takes() {
        let (a, b) = (own("shared-a"), tmp("shared-b"));
        w(&a, "Contexts/Work/Portfolio/Kestrel/.claude/settings.json", "{}");
        w(&a, "Contexts/Work/Portfolio/Kestrel/.git/HEAD", "ref");
        w(&b, "State/work-state.md", "# Work State\n");
        fs::create_dir_all(b.join("Contexts/Work")).unwrap();
        let filter = crate::shared_vaults::filter(&b).unwrap();
        let (from, to) = (side(&a, "State/work-state.md", "Contexts"), side(&b, "State/work-state.md", "Contexts"));
        let p = plan(&from, &to, "Kestrel", "Work", &filter, false).unwrap();
        assert_eq!(p.json(&to)["skipped"], json!(["Contexts/Work/Portfolio/Kestrel/.claude/settings.json", "Contexts/Work/Portfolio/Kestrel/.git/HEAD"]));
        p.apply(&from, &to, true, "2026-10-28").unwrap();
        assert!(!b.join("Contexts/Work/Portfolio/Kestrel/.claude").exists());
        // what did not go stays in the source, with its folders
        assert!(a.join("Contexts/Work/Portfolio/Kestrel/.claude/settings.json").is_file());
        assert!(!a.join("Contexts/Work/Portfolio/Kestrel/Kestrel.md").exists());
    }

    #[test]
    fn rows_go_under_their_context() {
        assert_eq!(add_row("# W\n\n## A\n\nnone yet\n", "A", "| X |"), "# W\n\n## A\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| X |\nnone yet\n");
        assert_eq!(add_row("# W\n", "B", "| X |"), "# W\n\n### B\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| X |\n");
        assert_eq!(drop_row("a\n| X |\nb\n", "| X |"), "a\nb\n");
    }
}
