// The vault's own Relay settings, in <vault>/.relay/config.json. In the vault so they travel with it (synced to
// every Mac, each vault its own) and so nothing about one person's vault is hard-coded in the app:
//
//   paths     the mapping (workState, reminders, notes), relative to the vault
//   headings  the `## ` headings this vault uses for open items and status, in its own language
//   contexts  the work-state headings that hold project tables
//   skip      folder names project-note lookups pass over
//   repos     GitHub "owner/repo" -> project, for the PRs per project
//   sites     project -> its website, for its favicon ("" when none was found)
//
// Written once from what the app detects, the first time a vault is used; after that the file is the truth,
// edited by hand or in Settings. snapshot.py and favicon.py read the same file.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// The heading candidates per role, in the app's languages; a new vault gets the ones its notes use.
const OPEN: [&str; 10] = ["Open", "Openstaand", "Open items", "Open loops", "To do", "Todo", "Ouvert", "À faire", "Offen", "Offene Punkte"];
const STATUS: [&str; 8] = ["Stand van zaken", "Status", "Current state", "Current status", "État", "Statut", "Stand", "Aktueller Stand"];
const SKIP: [&str; 3] = ["Documents", "Gesprekken", "_archive"];
/// Where checkouts usually live, for matching repos to projects.
const CODE: [&str; 7] = ["projects", "code", "dev", "src", "Developer", "Sites", "repos"];

pub fn path(vault: &str) -> PathBuf { Path::new(vault).join(".relay/config.json") }
pub fn load(vault: &str) -> Option<Value> {
    if vault.is_empty() { return None; }
    serde_json::from_str(&fs::read_to_string(path(vault)).ok()?).ok().filter(Value::is_object)
}
pub fn save(vault: &str, cfg: &Value) -> Result<(), String> {
    let p = path(vault);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(cfg).unwrap() + "\n").and_then(|_| fs::rename(&tmp, &p)).map_err(|e| e.to_string())
}
/// The vault's config, created from what is detected when it has none yet.
pub fn ensure(vault: &str, map: &Value) -> Value {
    if let Some(c) = load(vault) { return c; }
    let c = seed(vault, map);
    save(vault, &c).ok();
    c
}
/// New paths for the mapping: into the config (created first when missing), only written when they changed.
pub fn set_paths(vault: &str, map: &Value) -> Result<(), String> {
    let mut c = ensure(vault, map);
    if c["paths"] == *map { return Ok(()); }
    c["paths"] = map.clone();
    save(vault, &c)
}

fn seed(vault: &str, map: &Value) -> Value {
    let abs = |k: &str| map[k].as_str().filter(|s| !s.is_empty()).map(|s| crate::vault::resolve(vault, s));
    let notes = abs("notes").unwrap_or_else(|| PathBuf::from(vault));
    let skip: Vec<String> = SKIP.iter().map(|s| s.to_string()).collect();
    let (projects, contexts) = abs("workState").map(|w| work_state(&w)).unwrap_or_default();
    let counts = headings(&notes, &skip);
    let sites = guess_sites(vault, &notes, &projects);
    json!({
        "version": 1,
        "paths": map,
        "headings": { "open": pick(&OPEN, &counts), "status": pick(&STATUS, &counts) },
        "contexts": contexts,
        "skip": skip,
        "repos": repos(vault, &projects),
        "sites": sites,
    })
}

/// Each project's website, guessed from its notes by favicon.py (no AI, nothing fetched); "" when none was found.
fn guess_sites(vault: &str, notes: &Path, projects: &[String]) -> Value {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let job = json!({"projects": projects.iter().map(|p| json!({"name": p})).collect::<Vec<_>>()});
    let run = || -> Option<Value> {
        let mut c = Command::new("/usr/bin/python3").arg(format!("{}/favicon.py", crate::REPO)).arg("--guess")
            .env("VAULT", vault).env("VAULT_NOTES", notes).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
        c.stdin.take()?.write_all(job.to_string().as_bytes()).ok()?;
        serde_json::from_slice(&c.wait_with_output().ok()?.stdout).ok()
    };
    run().filter(Value::is_object).unwrap_or_else(|| json!({}))
}
/// New guesses for projects the config has no site for yet (added to work-state later); what is there stays.
pub fn add_sites(vault: &str, found: &Map<String, Value>) {
    let Some(mut c) = load(vault) else { return };
    if !c["sites"].is_object() { c["sites"] = json!({}); }
    let sites = c["sites"].as_object_mut().unwrap();
    let mut changed = false;
    for (name, site) in found { if !sites.contains_key(name) { sites.insert(name.clone(), site.clone()); changed = true; } }
    if changed { save(vault, &c).ok(); }
}

/// The candidates the notes use, most used first; all of them when the notes use none (nothing to go on).
fn pick(cands: &[&str], counts: &HashMap<String, usize>) -> Vec<String> {
    let mut used: Vec<(&str, usize)> = cands.iter().filter_map(|c| counts.get(&c.to_lowercase()).map(|n| (*c, *n))).collect();
    if used.is_empty() { return cands.iter().map(|c| c.to_string()).collect(); }
    used.sort_by(|a, b| b.1.cmp(&a.1));
    used.into_iter().map(|(c, _)| c.to_string()).collect()
}
/// How often each `## ` heading occurs in the notes (lowercased), skipping hidden and skipped folders.
// ponytail: stops after 3000 notes, plenty to see which headings a vault uses
fn headings(root: &Path, skip: &[String]) -> HashMap<String, usize> {
    let (mut counts, mut stack, mut seen) = (HashMap::new(), vec![root.to_path_buf()], 0);
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).into_iter().flatten().flatten() {
            let (n, p) = (e.file_name().to_string_lossy().into_owned(), e.path());
            if n.starts_with('.') || skip.contains(&n) { continue; }
            if p.is_dir() { stack.push(p); continue; }
            if !n.ends_with(".md") { continue; }
            seen += 1;
            if seen > 3000 { return counts; }
            for l in fs::read_to_string(&p).unwrap_or_default().lines() {
                if let Some(h) = l.strip_prefix("## ") { *counts.entry(h.trim().to_lowercase()).or_insert(0) += 1; }
            }
        }
    }
    counts
}
/// The project names in work-state and the headings their tables sit under (the contexts). A project row is
/// `| Name | State | YYYY-MM-DD | … |`, the name plain or as a [[link]].
fn work_state(file: &Path) -> (Vec<String>, Vec<String>) {
    let (mut projects, mut contexts, mut cur) = (vec![], vec![], String::new());
    for l in fs::read_to_string(file).unwrap_or_default().lines() {
        if let Some(h) = l.strip_prefix("### ").or_else(|| l.strip_prefix("## ")) { cur = h.trim().to_string(); continue; }
        let cells: Vec<&str> = l.trim().trim_matches('|').split('|').map(str::trim).collect();
        if !l.starts_with('|') || cells.len() < 4 || !is_date(cells[2]) || cur.is_empty() { continue; }
        let name = cells[0].trim_start_matches("[[").split([']', '|']).next().unwrap_or("").trim().to_string();
        if !name.is_empty() && !projects.contains(&name) { projects.push(name); }
        if !contexts.contains(&cur) { contexts.push(cur.clone()); }
    }
    (projects, contexts)
}
fn is_date(s: &str) -> bool { s.len() == 10 && s.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }) }

/// A name to compare: lowercase letters and digits, without a "(…)" suffix, so "BE Plastics (TradeHub)",
/// "be-plastics" and "be_plastics" all become "beplastics".
fn key(s: &str) -> String { s.split('(').next().unwrap_or(s).chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect() }
/// The project a checkout belongs to: a project whose name is the folder or repo name, or its first words
/// ("be-plastics-backend" -> "BE Plastics", "o2o-platform" -> "o2o"). Whole words only, never part of one.
fn project_of<'a>(names: &[&str], by_key: &HashMap<String, &'a String>) -> Option<&'a String> {
    names.iter().find_map(|n| {
        let words: Vec<&str> = n.split(['-', '_', '.', ' ']).filter(|w| !w.is_empty()).collect();
        // the longest leading run of words that is a project, so "be-plastics" wins over a project called "be"
        (1..=words.len()).rev().find_map(|i| by_key.get(&key(&words[..i].concat())).copied())
    })
}
/// GitHub repo -> project: the vault's own index/repos.json in its brain folder when there is one, then the
/// checkouts in the usual code folders, and one level into a folder that is not a checkout itself
/// (~/projects/antenna/spardex).
fn repos(vault: &str, projects: &[String]) -> Map<String, Value> {
    let mut out = Map::new();
    for (repo, note) in crate::repo_index(vault) {
        if let Some(p) = projects.iter().find(|p| key(p) == key(&note)) { out.insert(repo, json!(p)); }
    }
    let by_key: HashMap<String, &String> = projects.iter().map(|p| (key(p), p)).filter(|(k, _)| k.len() >= 3).collect();
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = |d: &str| fs::read_dir(d).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path().to_string_lossy().into_owned()).collect::<Vec<_>>();
    let mut add = |dir: &str, repo: String| {
        let folder = dir.rsplit('/').next().unwrap_or("").to_string();
        if let Some(p) = project_of(&[&folder, repo.rsplit('/').next().unwrap_or("")], &by_key) { out.entry(repo).or_insert(json!(p)); }
    };
    for root in CODE.iter().map(|c| format!("{home}/{c}")) {
        for d in dirs(&root) {
            match crate::gh_repo(&d) {
                Some(r) => add(&d, r),
                None => for d2 in dirs(&d) { if let Some(r) = crate::gh_repo(&d2) { add(&d2, r); } },
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picks_the_headings_a_vault_uses() {
        let c: HashMap<String, usize> = [("status".to_string(), 8), ("current state".to_string(), 7), ("log".to_string(), 5)].into();
        assert_eq!(pick(&STATUS, &c), ["Status", "Current state"]);
        assert_eq!(pick(&OPEN, &c).len(), OPEN.len(), "none used: all candidates");
        let nl: HashMap<String, usize> = [("stand van zaken".to_string(), 3), ("open".to_string(), 4)].into();
        assert_eq!(pick(&STATUS, &nl), ["Stand van zaken"]);
        assert_eq!(pick(&OPEN, &nl), ["Open"]);
    }
    #[test]
    fn reads_projects_and_contexts_from_work_state() {
        let d = std::env::temp_dir().join(format!("relay-cfg-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let f = d.join("work-state.md");
        fs::write(&f, "# Work State\n## State Vocabulary\n| State | Meaning |\n|---|---|\n| Active | x |\n## Antenna\n| Project | State | Last | Left |\n|---|---|---|---|\n| Spardex | Active | 2026-10-01 | x |\n| [[BE Plastics (TradeHub)]] | Active | 2026-09-29 | y |\n### Meersman\n| Klant | Actief | 2026-01-02 | z |\n").unwrap();
        let (p, c) = work_state(&f);
        assert_eq!(p, ["Spardex", "BE Plastics (TradeHub)", "Klant"]);
        assert_eq!(c, ["Antenna", "Meersman"]);
        assert_eq!(key("BE Plastics (TradeHub)"), key("be-plastics"));
        let ps = ["BE Plastics (TradeHub)".to_string(), "o2o".to_string(), "Spardex".to_string()];
        let by: HashMap<String, &String> = ps.iter().map(|p| (key(p), p)).collect();
        assert_eq!(project_of(&["be-plastics-backend"], &by), Some(&ps[0]));
        assert_eq!(project_of(&["o2o-platform"], &by), Some(&ps[1]));
        assert_eq!(project_of(&["spardex"], &by), Some(&ps[2]));
        assert_eq!(project_of(&["spardexer", "blog"], &by), None, "never part of a word");
        fs::remove_dir_all(&d).ok();
    }
}
#[cfg(test)]
mod dry_run {
    // VAULT=/path RELAY_MAP='{"workState":…}' cargo test show_seed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn show_seed() {
        let v = std::env::var("VAULT").unwrap();
        let map = std::env::var("RELAY_MAP").ok().and_then(|m| serde_json::from_str(&m).ok()).unwrap_or_else(|| crate::vault::detect(&v).1);
        println!("{}", serde_json::to_string_pretty(&super::seed(&v, &map)).unwrap());
    }
}
