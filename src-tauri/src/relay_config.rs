// The vault's own Relay settings, in <vault>/.relay/config.json. In the vault so they travel with it (synced to
// every Mac, each vault its own) and so nothing about one person's vault is hard-coded in the app:
//
//   paths     the mapping (workState, reminders, notes), relative to the vault
//   headings  the `## ` headings this vault uses for open items and status, in its own language
//   contexts  the work-state headings that hold project tables
//   skip      folder names project-note lookups pass over
//   repos     GitHub "owner/repo" -> project, for the PRs per project
//   icons     project -> its icon: "icons/<file>.png" (a file next to the config), an emoji, a website whose
//             favicon the app fetches and stores as a file, or "" (none, do not guess). No entry: the app guesses
//             the project's website from its notes and stores the favicon.
//   designs   project -> its Claude Design link (a claude.ai artifact), shown in the Design drawer (design.rs)
//   actions   extension -> agent access and the policy per action for the `relay` command (actions.rs):
//             {"access": false} switches an extension off for agents, {"*": "ask", "add_time": "auto"} sets
//             policies (auto, ask, deny), a plain "auto" sets them all. No entry: on, reads run, writes ask.
//   sync      the git remote the vault is committed and pushed to, as a backup (vaultsync.rs):
//             {"remote", "on", "minutes"}
//
// Written once from what the app detects, the first time a vault is used; after that the file is the truth,
// edited by hand or in Settings. snapshot.rs and favicon.rs read the same file.

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
    json!({
        "version": 1,
        "paths": map,
        "headings": { "open": pick(&OPEN, &counts), "status": pick(&STATUS, &counts) },
        "contexts": contexts,
        "skip": skip,
        "repos": repos(vault, &projects),
    })
}

// ---------- repos

/// A project's GitHub repos ("owner/repo", lowercased) replace the ones it had. One that came from the brain's
/// index/repos.json and is taken off stays in `repos` as "" (unlinked), or it would come back from the index.
pub fn set_repos(vault: &str, project: &str, repos: &[String]) -> Result<(), String> {
    let mut c = load(vault).ok_or("no .relay/config.json")?;
    if !c["repos"].is_object() { c["repos"] = json!({}); }
    let indexed: Vec<String> = crate::repo_index(vault).into_iter().filter(|(_, n)| n == project).map(|(r, _)| r).collect();
    let m = c["repos"].as_object_mut().unwrap();
    m.retain(|_, p| p != project);
    for r in indexed { m.insert(r, json!("")); }
    for r in repos {
        let r = r.trim().trim_start_matches("https://github.com/").trim_end_matches(".git").trim_end_matches('/').to_lowercase();
        let ok = r.split('/').count() == 2 && r.split('/').all(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)));
        if !ok { return Err(format!("not owner/repo: {r}")); }
        m.insert(r, json!(project));
    }
    save(vault, &c)
}

/// A repo unlinked on purpose: `""` in `repos`, so nothing links it and nothing asks again.
pub fn ignore_repo(vault: &str, repo: &str) -> Result<(), String> {
    let repo = repo.trim().to_lowercase();
    if repo.split('/').count() != 2 || repo.split('/').any(str::is_empty) { return Err(format!("not owner/repo: {repo}")); }
    let mut c = load(vault).ok_or("no .relay/config.json")?;
    if !c["repos"].is_object() { c["repos"] = json!({}); }
    c["repos"].as_object_mut().unwrap().entry(repo).or_insert(json!(""));
    save(vault, &c)
}

// ---------- actions

/// The agent access and policies per extension, `{}` when there are none.
pub fn actions(vault: &str) -> Value { load(vault).map(|c| c["actions"].clone()).filter(Value::is_object).unwrap_or_else(|| json!({})) }
/// One extension's entry replaces the one it had: `access` a boolean, every other key an action (or `*`) with a policy.
pub fn set_actions(vault: &str, ext: &str, entry: &Value) -> Result<(), String> {
    let name_ok = |k: &str| !k.is_empty() && k.len() <= 64 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '*');
    let o = entry.as_object().ok_or("not an object")?;
    if !name_ok(ext) { return Err(format!("bad extension: {ext}")); }
    for (k, v) in o {
        let ok = if k == "access" { v.is_boolean() } else { name_ok(k) && v.as_str().is_some_and(|p| ["auto", "ask", "deny"].contains(&p)) };
        if !ok { return Err(format!("bad {ext}.{k}: {v}")); }
    }
    let mut c = load(vault).ok_or("no .relay/config.json")?;
    if !c["actions"].is_object() { c["actions"] = json!({}); }
    let m = c["actions"].as_object_mut().unwrap();
    if o.is_empty() { m.remove(ext); } else { m.insert(ext.into(), entry.clone()); }
    save(vault, &c)
}

// ---------- designs

/// A project's Claude Design link, "" for none.
pub fn design(vault: &str, project: &str) -> String {
    load(vault).and_then(|c| c["designs"][project].as_str().map(String::from)).unwrap_or_default()
}
/// Set a project's Design link, "" removes it.
pub fn set_design(vault: &str, project: &str, url: &str) -> Result<(), String> {
    let mut c = load(vault).ok_or("no .relay/config.json")?;
    if !c["designs"].is_object() { c["designs"] = json!({}); }
    let m = c["designs"].as_object_mut().unwrap();
    if url.is_empty() { m.remove(project); } else { m.insert(project.into(), json!(url)); }
    save(vault, &c)
}

// ---------- icons

/// What an `icons` value is.
pub enum Icon<'a> { File(&'a str), Emoji(&'a str), Site(&'a str), None }
pub fn icon_kind(v: &str) -> Icon<'_> {
    if v.is_empty() { Icon::None }
    else if v.starts_with("icons/") { Icon::File(v) }
    else if v.contains('.') && !v.contains(char::is_whitespace) { Icon::Site(v) }
    else { Icon::Emoji(v) }
}
/// A website as typed (https://www.spardex.be/nl) to the domain the favicon is fetched from.
pub fn site_of(s: &str) -> Option<String> {
    let d = s.trim().trim_start_matches("https://").trim_start_matches("http://").split(['/', '?', '#']).next()?.trim_start_matches("www.").to_lowercase();
    (d.contains('.') && d.chars().all(|c| c.is_ascii_alphanumeric() || ".-".contains(c))).then_some(d)
}
/// A file for a project's icon: readable name plus a short hash, so two names never share a file.
fn icon_file(project: &str) -> String {
    let slug: String = project.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let slug: String = slug.split('-').filter(|w| !w.is_empty()).collect::<Vec<_>>().join("-");
    format!("icons/{}-{}.png", &slug[..slug.len().min(40)], &sha1_smol::Sha1::from(project).digest().to_string()[..6])
}
/// An icon file as a data url for the webview; only files inside .relay/icons/.
fn icon_data(vault: &str, rel: &str) -> Option<String> {
    use base64::Engine;
    if rel.contains("..") { return None; }
    let p = path(vault).with_file_name(rel);
    let mime = match p.extension()?.to_str()?.to_lowercase().as_str() { "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "svg" => "image/svg+xml", "ico" => "image/x-icon", _ => return None };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(fs::read(p).ok()?)))
}
/// Project to the image file of its icon, for the tray menu: a site's once its favicon is stored. Emoji entries have none.
pub fn icon_files(vault: &str) -> std::collections::BTreeMap<String, PathBuf> {
    let Some(c) = load(vault) else { return Default::default() };
    c["icons"].as_object().into_iter().flatten().filter_map(|(n, v)| match icon_kind(v.as_str()?) {
        Icon::File(f) if !f.contains("..") => Some((n.clone(), path(vault).with_file_name(f))),
        Icon::Site(_) => Some((n.clone(), path(vault).with_file_name(icon_file(n)))).filter(|(_, p)| p.exists()),
        _ => None,
    }).collect()
}
/// Every project with an entry: its raw value, and what to show (`img` a data url, or `icon` an emoji).
pub fn icons(vault: &str) -> Map<String, Value> {
    let Some(c) = load(vault) else { return Map::new() };
    c["icons"].as_object().into_iter().flatten().filter_map(|(n, v)| {
        let v = v.as_str()?;
        Some((n.clone(), match icon_kind(v) {
            Icon::File(f) => json!({"value": v, "img": icon_data(vault, f)}),
            Icon::Emoji(e) => json!({"value": v, "icon": e}),
            Icon::Site(_) => json!({"value": v, "img": icon_data(vault, &icon_file(n))}),
            Icon::None => json!({"value": v}),
        }))
    }).collect()
}
/// Set a project's icon. `kind`: "img" (a png data url, stored as a file), "favicon" (the same, but a website set as
/// the icon stays the entry: the file is that site's icon, beside it), "emoji", "site" (fetched by the favicon run),
/// "none" (no icon, not guessed) or "reset" (no entry: guessed again). A file no project shows any more goes.
pub fn set_icon(vault: &str, project: &str, kind: &str, value: &str) -> Result<(), String> {
    use base64::Engine;
    let mut c = load(vault).ok_or("no .relay/config.json")?;
    if !c["icons"].is_object() { c["icons"] = json!({}); }
    let f = icon_file(project);
    let old = c["icons"][project].as_str().map(String::from);
    let old_site = old.as_deref().is_some_and(|o| matches!(icon_kind(o), Icon::Site(_)));
    let new = match kind {
        "img" | "favicon" => {
            let b64 = value.strip_prefix("data:image/png;base64,").ok_or("not a png")?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
            if bytes.len() > 512 * 1024 { return Err("image too large".into()); }
            let p = path(vault).with_file_name(&f);
            fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
            fs::write(&p, bytes).map_err(|e| e.to_string())?;
            if kind == "favicon" && old_site { old.clone() } else { Some(f.clone()) }
        }
        "emoji" if !value.trim().is_empty() && value.trim().chars().count() <= 8 && !value.contains('.') => Some(value.trim().to_string()),
        "site" => Some(site_of(value).ok_or("not a website")?),
        "none" => Some(String::new()),
        "reset" => None,
        _ => return Err("bad icon".into()),
    };
    let icons = c["icons"].as_object_mut().unwrap();
    match &new { Some(v) => { icons.insert(project.into(), json!(v)); } None => { icons.remove(project); } }
    // what the old entry showed: its file, or the stored favicon of its site when the site is not kept
    let stale = if old_site { (new != old).then_some(f) } else { old.filter(|o| o.starts_with("icons/")) };
    if let Some(o) = stale.filter(|o| new.as_ref() != Some(o) && !icons.values().any(|v| v == o.as_str())) {
        fs::remove_file(path(vault).with_file_name(o)).ok();
    }
    save(vault, &c)
}
/// The icons set before they lived in the vault (settings.json's projects: `img`, `icon`) and the `sites` of a
/// config from before `icons`, moved into `icons` once. Returns the projects whose icon moved, for settings.json.
pub fn migrate_icons(vault: &str, projects: &Map<String, Value>) -> Option<Vec<String>> {
    let mut c = load(vault)?;
    if c["icons"].is_object() { return None; }
    c["icons"] = json!({});
    if let Some(sites) = c.as_object_mut().unwrap().remove("sites").and_then(|s| s.as_object().cloned()) {
        for (n, s) in sites { c["icons"][n] = s; }
    }
    save(vault, &c).ok()?;
    let mut moved = vec![];
    for (n, p) in projects {
        let r = match (p["img"].as_str(), p["icon"].as_str()) {
            (Some(img), _) => set_icon(vault, n, "img", img),
            (_, Some(e)) if !e.is_empty() => set_icon(vault, n, "emoji", e),
            _ => continue,
        };
        if r.is_ok() { moved.push(n.clone()); }
    }
    Some(moved)
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
    fn icons_live_in_the_vault() {
        let v = std::env::temp_dir().join(format!("relay-icons-{}", std::process::id()));
        let vs = v.to_string_lossy().into_owned();
        fs::create_dir_all(&v).unwrap();
        save(&vs, &json!({"version": 1, "sites": {"o2o": "o2o.be", "Spardex": ""}})).unwrap();
        // a 1x1 png
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        let projects = json!({"Lemahieu": {"icon": "🛒", "label": "L"}, "BE Plastics (TradeHub)": {"img": png}}).as_object().unwrap().clone();
        let mut moved = migrate_icons(&vs, &projects).unwrap(); moved.sort();
        assert_eq!(moved, ["BE Plastics (TradeHub)", "Lemahieu"]);
        let i = icons(&vs);
        assert_eq!(i["o2o"]["value"], "o2o.be");
        assert_eq!(i["Spardex"]["value"], "");
        assert_eq!(i["Lemahieu"]["icon"], "🛒");
        let f = i["BE Plastics (TradeHub)"]["value"].as_str().unwrap().to_string();
        assert!(f.starts_with("icons/be-plastics-tradehub-") && i["BE Plastics (TradeHub)"]["img"].as_str().unwrap().starts_with("data:image/png;base64,"));
        // the tray only gets image files, never an emoji or a site
        let files = icon_files(&vs);
        assert_eq!(files.keys().collect::<Vec<_>>(), ["BE Plastics (TradeHub)"]);
        assert!(files["BE Plastics (TradeHub)"].exists());
        assert!(load(&vs).unwrap().get("sites").is_none(), "sites became icons");
        assert!(migrate_icons(&vs, &projects).is_none(), "only once");
        set_icon(&vs, "BE Plastics (TradeHub)", "site", "https://www.be-plastics.com/nl").unwrap();
        assert_eq!(icons(&vs)["BE Plastics (TradeHub)"]["value"], "be-plastics.com");
        assert!(!path(&vs).with_file_name(&f).exists(), "the old file goes");
        // the site's favicon is stored beside it: the site stays the entry, the tray gets the file
        set_icon(&vs, "BE Plastics (TradeHub)", "favicon", png).unwrap();
        let i = icons(&vs);
        assert_eq!(i["BE Plastics (TradeHub)"]["value"], "be-plastics.com", "a website set by hand stays");
        assert!(i["BE Plastics (TradeHub)"]["img"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert!(icon_files(&vs)["BE Plastics (TradeHub)"].exists());
        // another site drops the old site's icon, a guess (no entry) becomes the file itself
        set_icon(&vs, "BE Plastics (TradeHub)", "site", "plastics.be").unwrap();
        assert!(icons(&vs)["BE Plastics (TradeHub)"]["img"].is_null(), "no icon of the old site");
        set_icon(&vs, "Guessed", "favicon", png).unwrap();
        assert!(icons(&vs)["Guessed"]["value"].as_str().unwrap().starts_with("icons/guessed-"));
        set_icon(&vs, "Lemahieu", "reset", "").unwrap();
        assert!(!icons(&vs).contains_key("Lemahieu"));
        assert!(set_icon(&vs, "x", "emoji", "a.b").is_err());
        fs::remove_dir_all(&v).ok();
    }
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
    #[test]
    fn actions_keep_only_access_and_policies() {
        let d = std::env::temp_dir().join(format!("relay-acts-{}", std::process::id()));
        let v = d.to_string_lossy().to_string();
        save(&v, &json!({ "icons": {} })).unwrap();
        assert_eq!(actions(&v), json!({}));
        set_actions(&v, "trello", &json!({ "access": false })).unwrap();
        set_actions(&v, "productive", &json!({ "*": "ask", "add_time": "auto" })).unwrap();
        assert_eq!(actions(&v), json!({ "trello": { "access": false }, "productive": { "*": "ask", "add_time": "auto" } }));
        assert!(set_actions(&v, "productive", &json!({ "add_time": "yes" })).is_err());
        assert!(set_actions(&v, "productive", &json!({ "access": "no" })).is_err());
        assert!(set_actions(&v, "../x", &json!({})).is_err());
        set_actions(&v, "trello", &json!({})).unwrap();
        assert_eq!(actions(&v), json!({ "productive": { "*": "ask", "add_time": "auto" } }));
        assert_eq!(load(&v).unwrap()["icons"], json!({}), "the rest of the file stays");
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

// ---------- a project moving to another vault (migrate.rs)

/// A project's entries in a vault's config: `{icons, designs, repos}` with only its own keys, and the icon file its
/// entry points at (a picked image, or a site's stored favicon), relative to `.relay/`.
pub fn project_entries(vault: &str, project: &str) -> (Value, Option<String>) {
    let c = load(vault).unwrap_or_else(|| json!({}));
    let mut out = json!({"icons": {}, "designs": {}, "repos": {}});
    let mut file = None;
    if let Some(v) = c["icons"][project].as_str() {
        out["icons"][project] = json!(v);
        file = match icon_kind(v) { Icon::File(f) if !f.contains("..") => Some(f.to_string()), Icon::Site(_) => Some(icon_file(project)), _ => None }
            .filter(|f| path(vault).with_file_name(f).is_file());
    }
    if let Some(v) = c["designs"][project].as_str() { out["designs"][project] = json!(v); }
    for (r, p) in c["repos"].as_object().into_iter().flatten().filter(|(_, p)| p.as_str() == Some(project)) { out["repos"][r] = p.clone(); }
    (out, file)
}
/// `project_entries` of another vault written into this one's config, over what it has under those keys.
pub fn add_project_entries(vault: &str, entries: &Value) -> Result<(), String> {
    let mut c = load(vault).unwrap_or_else(|| json!({}));
    for k in ["icons", "designs", "repos"] {
        if !c[k].is_object() { c[k] = json!({}); }
        for (n, v) in entries[k].as_object().into_iter().flatten() { c[k][n] = v.clone(); }
    }
    save(vault, &c)
}
/// A project's entries out of a vault's config. Its icon file is left to the caller.
pub fn drop_project_entries(vault: &str, project: &str) -> Result<(), String> {
    let Some(mut c) = load(vault) else { return Ok(()) };
    for k in ["icons", "designs"] { if let Some(m) = c[k].as_object_mut() { m.remove(project); } }
    if let Some(m) = c["repos"].as_object_mut() { m.retain(|_, p| p.as_str() != Some(project)); }
    save(vault, &c)
}
