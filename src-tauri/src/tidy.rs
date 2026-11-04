// Tidy structure: the notes whose type has a home (homes.rs) but that sit somewhere else, and where each would go. The
// plan is only ever read: the move itself, with its link rewrites, is pagefiles::plan_batch/apply_batch. Not moved:
// notes under System/ or Resources/Templates/, in a project's folder, hidden ones, and notes without a `type:` or a
// date (nothing says where they go). A name taken in the target folder gets " 2", " 3"…

use crate::migrate::Side;
use crate::{homes, pagefiles};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;

/// One note on its way: `kind` is its `type:` as written, `renamed` that its name was taken in the target folder.
pub struct Move { pub kind: String, pub from: String, pub to: String, pub renamed: bool }
/// What the plan found: the notes to move, and how many of the notes that have a home already sit in it.
pub struct Tidy { pub moves: Vec<Move>, pub stay: usize }

/// The home a type goes to (a key of homes.rs), None for a type without one. A transcript sits with its meeting; a
/// journal is a daily note when it is named for a day.
fn home_of(kind: &str, stem: &str) -> Option<&'static str> {
    match kind.to_lowercase().as_str() {
        "meeting" | "transcript" => Some("meeting"),
        "thread" => Some("thread"),
        "daily" => Some("daily"),
        "journal" if dated(stem) => Some("daily"),
        _ => None,
    }
}
/// A name or value that starts with a day, YYYY-MM-DD.
fn dated(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10 && b[..10].iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}
fn field<'a>(fm: &'a str, key: &str) -> Option<&'a str> {
    fm.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix(':')).map(|v| v.trim().trim_matches(['"', '\''])).filter(|v| !v.is_empty())
}
/// The year a note belongs to: its name's day, else its `date:`, else `created:`.
fn year_of(stem: &str, fm: &str) -> Option<String> {
    if dated(stem) { return Some(stem[..4].to_string()); }
    ["date", "created"].iter().find_map(|k| field(fm, k).filter(|v| dated(v)).map(|v| v[..4].to_string()))
}
/// The top of a note: its frontmatter is in the first few KB.
fn head(p: &Path) -> String {
    let mut buf = vec![0; 4096];
    let n = fs::File::open(p).and_then(|mut f| f.read(&mut buf)).unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).into_owned()
}
/// A free path for `name` in `dir` among `taken` (lowercase): "A 2.md", and for a transcript "A 2.transcript.md".
fn free(dir: &str, name: &str, taken: &HashSet<String>) -> (String, bool) {
    let at = |n: &str| if dir.is_empty() { n.to_string() } else { format!("{dir}/{n}") };
    if !taken.contains(&at(name).to_lowercase()) { return (at(name), false); }
    let (stem, ext) = name.strip_suffix(".transcript.md").map_or_else(|| (name.strip_suffix(".md").unwrap_or(name), ".md"), |s| (s, ".transcript.md"));
    (2..).map(|i| at(&format!("{stem} {i}{ext}"))).find(|p| !taken.contains(&p.to_lowercase())).map(|p| (p, true)).unwrap()
}
/// The folders of the projects: their notes are not Tidy structure's to move.
fn project_dirs(side: &Side, vault: &Path) -> Vec<String> {
    let Ok((rows, _)) = crate::snapshot::vault_projects(&side.vault, &side.work_state, &side.notes) else { return vec![] };
    rows.iter().filter_map(|p| crate::snapshot::project_note(&side.vault, &side.notes, p["name"].as_str()?))
        .filter_map(|n| fs::canonicalize(n.parent()?).ok()?.strip_prefix(vault).ok().map(|r| r.to_string_lossy().into_owned()))
        .filter(|d| !d.is_empty()).collect()
}

/// Every note of the workspace that has a home and is not in it, with where it goes.
pub fn plan(side: &Side) -> Tidy {
    let Ok(vault) = fs::canonicalize(&side.vault) else { return Tidy { moves: vec![], stay: 0 } };
    let all = pagefiles::all_files(&vault);
    let mut taken: HashSet<String> = all.iter().map(|p| p.to_lowercase()).collect();
    let projects = project_dirs(side, &vault);
    let skip = |p: &str| p.starts_with("System/") || p.starts_with("Resources/Templates/") || projects.iter().any(|d| p.strip_prefix(d.as_str()).is_some_and(|r| r.starts_with('/')));
    let (mut moves, mut stay) = (vec![], 0);
    for p in all.iter().filter(|p| p.to_lowercase().ends_with(".md") && !skip(p)) {
        let text = head(&vault.join(p));
        let Some(fm) = crate::vaultcheck::frontmatter(&text) else { continue };
        let name = p.rsplit('/').next().unwrap_or(p);
        let stem = name.strip_suffix(".md").unwrap_or(name);
        let Some(kind) = field(fm, "type") else { continue };
        let Some(home) = home_of(kind, stem) else { continue };
        let Some(year) = year_of(stem, fm) else { continue };
        let Ok(dir) = homes::home(&vault, home, &year).strip_prefix(&vault).map(|d| d.to_string_lossy().into_owned()) else { continue };
        if p.rsplit_once('/').map_or("", |(d, _)| d) == dir { stay += 1; continue; }
        let (to, renamed) = free(&dir, name, &taken);
        taken.insert(to.to_lowercase());
        moves.push(Move { kind: kind.to_string(), from: p.clone(), to, renamed });
    }
    Tidy { moves, stay }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-tidy-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(d).unwrap()
    }
    fn w(root: &Path, rel: &str, body: &str) { let p = root.join(rel); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, body).unwrap(); }
    fn r(root: &Path, rel: &str) -> String { fs::read_to_string(root.join(rel)).unwrap() }
    /// A note of type `ty`; its last line names it, so a link's target can be told by what it holds.
    fn note(ty: &str, extra: &str, body: &str, id: &str) -> String { format!("---\ntype: {ty}\n{extra}---\n{body}\n{id}\n") }
    fn side(v: &Path, ws: &str) -> Side { Side { vault: v.to_string_lossy().into(), work_state: v.join(ws).to_string_lossy().into(), notes: v.join("Contexts").to_string_lossy().into() } }
    fn pairs(t: &Tidy) -> Vec<(&str, &str)> { t.moves.iter().map(|m| (m.from.as_str(), m.to.as_str())).collect() }
    /// Every file with its text.
    fn all(v: &Path) -> BTreeMap<String, String> { pagefiles::all_files(v).into_iter().map(|p| (p.clone(), r(v, &p))).collect() }
    /// Every [[link]] of every note as (the note's id, the id of the note it resolves to or None), read as Obsidian does
    /// (a path, else the one note ending in it).
    fn links(v: &Path) -> Vec<(String, Option<String>)> {
        let notes: Vec<String> = pagefiles::all_files(v).into_iter().filter(|p| p.ends_with(".md")).collect();
        let id = |p: &str| r(v, p).lines().last().unwrap_or("").to_string();
        let link = regex::Regex::new(r"\[\[([^\]|#]+)").unwrap();
        let mut out = vec![];
        for n in &notes {
            for c in link.captures_iter(&r(v, n)) {
                let t = c[1].trim().trim_end_matches(".md").to_lowercase();
                let hits: Vec<&String> = notes.iter().filter(|p| { let l = p.trim_end_matches(".md").to_lowercase(); l == t || l.ends_with(&format!("/{t}")) }).collect();
                out.push((id(n), (hits.len() == 1).then(|| id(hits[0]))));
            }
        }
        out.sort();
        out
    }

    // a flat Calendar/ with the three kinds mixed and linked, two notes already home, notes that must stay where they
    // are, and a project of `shape` ("table": a hand-kept work-state, "cards": one built from the cards)
    fn fixture(v: &Path, shape: &str) -> &'static str {
        w(v, "Calendar/2026-11-04.md", &note("Daily", "", "Met [[2026-11-04 Beacon sync]], [[Calendar/2026-11-04 Beacon sync]], read [[Beacon thread]] [t](Beacon%20thread.md) [[Nowhere]]", "id-daily"));
        w(v, "Calendar/2026-11-04 Beacon sync.md", &note("Meeting", "", "![[2026-11-04 Beacon sync.transcript]] [[2026-11-04]] [[Calendar/Beacon thread|thread]]", "id-meeting"));
        w(v, "Calendar/2026-11-04 Beacon sync.transcript.md", &note("Transcript", "", "words", "id-transcript"));
        w(v, "Calendar/Beacon thread.md", &note("Thread", "created: 2025-12-30\n", "see [[2026-11-04 Beacon sync]]", "id-thread"));
        w(v, "Calendar/Meetings/2026/2026-10-01 Old.md", &note("Meeting", "", "already home, see [[2026-11-04]]", "id-old"));
        w(v, "Calendar/Daily/2026/2026-10-31.md", &note("Daily", "", "already home", "id-old-daily"));
        w(v, "Calendar/No type.md", "no frontmatter\nid-none\n");
        w(v, "Calendar/Undated.md", &note("Thread", "", "no day to file it under", "id-undated"));
        w(v, "System/rules/2026-01-01 Rule.md", &note("Meeting", "", "never", "id-rule"));
        w(v, "Resources/Templates/Meeting.md", &note("Meeting", "", "never {{date}}", "id-template"));
        w(v, "Contexts/Work/Work.md", "---\ntype: Context\n---\nid-work\n");
        w(v, "Contexts/Work/Projects/Beacon/Beacon.md", "---\ntype: Project\nstatus: Active\nlast: 2026-11-01\n---\n[[2026-11-04 Beacon sync]] [daily](../../../../Calendar/2026-11-04.md)\nid-project\n");
        w(v, "Contexts/Work/Projects/Beacon/2026-11-02 Kickoff.md", &note("Meeting", "", "in the project folder", "id-kickoff"));
        let table = "## Work\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| [[Beacon]] | Active | 2026-11-01 | x |\n";
        if shape == "cards" {
            w(v, "System/scripts/build-index.py", "# index\n");
            w(v, "System/rules/core/work-state.md", &format!("*Generated by `System/scripts/build-index.py`*\n\n{table}"));
            "System/rules/core/work-state.md"
        } else {
            w(v, "State/work-state.md", table);
            "State/work-state.md"
        }
    }
    fn batch(v: &Path, s: &Side) -> pagefiles::Batch {
        let moves: Vec<(String, String)> = plan(s).moves.into_iter().map(|m| (m.from, m.to)).collect();
        pagefiles::plan_batch(&v.to_string_lossy(), &moves).unwrap()
    }

    #[test]
    fn each_type_goes_to_its_home_and_the_rest_stays_in_table_and_card_vaults() {
        for shape in ["table", "cards"] {
            let v = tmp(&format!("plan-{shape}"));
            let ws = fixture(&v, shape);
            let t = plan(&side(&v, ws));
            assert_eq!(pairs(&t), vec![
                ("Calendar/2026-11-04 Beacon sync.md", "Calendar/Meetings/2026/2026-11-04 Beacon sync.md"),
                ("Calendar/2026-11-04 Beacon sync.transcript.md", "Calendar/Meetings/2026/2026-11-04 Beacon sync.transcript.md"),
                ("Calendar/2026-11-04.md", "Calendar/Daily/2026/2026-11-04.md"),
                ("Calendar/Beacon thread.md", "Calendar/Threads/2025/Beacon thread.md"),
            ], "{shape}");
            assert_eq!(t.stay, 2, "{shape}");
        }
    }

    #[test]
    fn a_taken_name_gets_a_number_and_a_vaults_own_homes_win() {
        let v = tmp("names");
        w(&v, "Calendar/2026-11-05 Sync.md", &note("Meeting", "", "a", "id-a"));
        w(&v, "Old/2026-11-05 Sync.md", &note("Meeting", "", "b", "id-b"));
        w(&v, "Old/2026-11-05 Sync.transcript.md", &note("Transcript", "", "c", "id-c"));
        w(&v, "Calendar/Meetings/2026/2026-11-05 Sync.transcript.md", &note("Transcript", "", "d", "id-d"));
        let s = side(&v, "none.md");
        let t = plan(&s);
        assert_eq!(pairs(&t), vec![
            ("Calendar/2026-11-05 Sync.md", "Calendar/Meetings/2026/2026-11-05 Sync.md"),
            ("Old/2026-11-05 Sync.md", "Calendar/Meetings/2026/2026-11-05 Sync 2.md"),
            ("Old/2026-11-05 Sync.transcript.md", "Calendar/Meetings/2026/2026-11-05 Sync 2.transcript.md"),
        ]);
        assert_eq!(t.moves.iter().map(|m| m.renamed).collect::<Vec<_>>(), [false, true, true]);
        w(&v, ".relay/config.json", r#"{"homes":{"meeting":"Meetings/{yyyy}"}}"#);
        assert_eq!(plan(&s).moves[0].to, "Meetings/2026/2026-11-05 Sync.md");
    }

    #[test]
    fn the_preview_is_what_apply_does_every_link_still_resolves_and_one_undo_restores_all() {
        for shape in ["table", "cards"] {
            let v = tmp(&format!("apply-{shape}"));
            let ws = fixture(&v, shape);
            let s = side(&v, ws);
            let (before, linked) = (all(&v), links(&v));
            assert!(linked.iter().any(|(_, t)| t.is_none()), "the fixture has a link nothing resolves");
            let b = batch(&v, &s);
            // the preview: 4 notes, 4 links in 3 notes (3 of the notes are in the list: two of them move; bare names need no rewrite)
            assert_eq!((b.moves.len(), b.links, b.edits.len()), (4, 4, 3), "{shape}");
            pagefiles::apply_batch(&b).unwrap();
            let after = all(&v);
            // what apply did is what was counted: the moved notes, and the notes with a rewritten link
            let gone: Vec<&String> = before.keys().filter(|p| !after.contains_key(*p)).collect();
            let made: Vec<&String> = after.keys().filter(|p| !before.contains_key(*p)).collect();
            assert_eq!((gone.len(), made.len()), (4, 4), "{shape}");
            let rewritten = after.iter().filter(|(p, t)| before.get(*p).is_some_and(|o| o != *t)).count();
            assert_eq!(rewritten, 1, "the other two rewritten notes moved: {shape}");
            assert!(r(&v, "Calendar/Daily/2026/2026-11-04.md").contains("[[Calendar/Meetings/2026/2026-11-04 Beacon sync]]"));
            assert!(r(&v, "Calendar/Meetings/2026/2026-11-04 Beacon sync.md").contains("[[Calendar/Threads/2025/Beacon thread|thread]]"));
            assert!(r(&v, "Contexts/Work/Projects/Beacon/Beacon.md").contains("](../../../../Calendar/Daily/2026/2026-11-04.md)"));
            // the walk over every link: each one that resolved still resolves, to the same note
            assert_eq!(links(&v), linked, "{shape}");
            // nothing that must stay moved
            assert!(v.join("Contexts/Work/Projects/Beacon/2026-11-02 Kickoff.md").is_file() && v.join("System/rules/2026-01-01 Rule.md").is_file());
            assert!(v.join("Calendar/Undated.md").is_file() && v.join("Calendar/No type.md").is_file());
            // the next check finds nothing left to tidy
            assert!(plan(&s).moves.is_empty(), "{shape}");
            // one Undo: every path and every text as before, the folders it made gone
            pagefiles::undo_batch(&b).unwrap();
            assert_eq!(all(&v), before, "{shape}");
            assert!(!v.join("Calendar/Threads").exists() && !v.join("Calendar/Daily/2026/2026-11-04.md").exists());
            assert!(v.join("Calendar/Daily/2026/2026-10-31.md").is_file(), "a folder that was there stays");
        }
    }

    #[test]
    fn a_note_changed_since_the_preview_stops_apply_and_nothing_stays_half_done() {
        let v = tmp("stale");
        let ws = fixture(&v, "table");
        let s = side(&v, ws);
        let (before, b) = (all(&v), batch(&v, &s));
        w(&v, "Contexts/Work/Projects/Beacon/Beacon.md", "an editor saved this meanwhile\n");
        let e = pagefiles::apply_batch(&b).unwrap_err();
        assert!(e.contains("changed since"), "{e}");
        let mut now = all(&v);
        now.insert("Contexts/Work/Projects/Beacon/Beacon.md".into(), before["Contexts/Work/Projects/Beacon/Beacon.md"].clone());
        assert_eq!(now, before);
    }
}
