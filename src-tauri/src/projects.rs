// Contexts and projects made, changed and removed from the Pages tab. A context is a folder of the notes with a note
// named like it and a table in work-state; a project is a note in its context with a row in that table, or, in a vault
// whose work-state build-index.py writes (migrate::cards), a card under Contexts/<context>/Projects/ whose `status` is
// its state. A note comes from the vault's template of that type when it has one Relay can fill in.

use crate::migrate::{self, Side};
use regex::Regex;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const STATES: [&str; 4] = ["Active", "Blocked", "Quiet", "Paused"];
/// The note types a project can be, in the order New project offers them; a vault offers the ones it has a template for.
const KINDS: [&str; 5] = ["Project", "Product", "Initiative", "Platform", "Feature"];
const TABLE: &str = "| Project | State | Last Touched | Left Off |\n|---|---|---|---|";

fn err(e: impl ToString) -> String { e.to_string() }
/// The folder contexts live in: the mapped notes folder, else the vault.
fn notes_root(side: &Side) -> PathBuf {
    if !side.notes.is_empty() && Path::new(&side.notes).is_dir() { PathBuf::from(&side.notes) } else { PathBuf::from(&side.vault) }
}
fn rel(side: &Side, p: &Path) -> String {
    let vault = fs::canonicalize(&side.vault).unwrap_or_else(|_| PathBuf::from(&side.vault));
    let p = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    p.strip_prefix(&vault).unwrap_or(&p).to_string_lossy().into_owned()
}
fn named(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if migrate::plain(name) && !name.contains(['[', ']', '|', '#', '^']) { Ok(name) } else { Err(format!("not a usable name: {name}")) }
}
/// A new file with `text`, never over one that is there.
fn write_new(p: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(p)
        .map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { format!("already there: {}", p.display()) } else { e.to_string() })?;
    f.write_all(text.as_bytes()).map_err(err)
}

/// The contexts a workspace shows, also those without a project: the folders of its notes folder, or, when the notes
/// are not mapped to a folder of their own, the config's `contexts`.
pub fn listed(side: &Side) -> Vec<String> {
    if notes_root(side) != Path::new(&side.vault) { return crate::snapshot::contexts(&side.vault, &side.notes).unwrap_or_default(); }
    let mut l: Vec<String> = crate::relay_config::load(&side.vault).and_then(|c| c["contexts"].as_array().cloned()).unwrap_or_default()
        .iter().filter_map(|v| v.as_str().map(String::from)).collect();
    l.sort();
    l
}

/// `key: value` in a note's frontmatter, replacing the line that is there (and a list under it), else added at its end.
pub fn set_field(text: &str, key: &str, value: &str) -> String {
    let line = format!("{key}: {value}");
    let Some((fm, body)) = text.strip_prefix("---\n").and_then(|t| t.split_once("\n---")) else { return format!("---\n{line}\n---\n{text}") };
    let (mut out, mut found, mut in_list) = (vec![], false, false);
    for l in fm.lines() {
        if in_list && (l.starts_with(' ') || l.starts_with('\t')) { continue; }
        in_list = false;
        if l.split_once(':').is_some_and(|(k, _)| k == key) {
            if !found { out.push(line.clone()); }
            found = true;
            in_list = true;
        } else { out.push(l.to_string()); }
    }
    if !found { out.push(line); }
    format!("---\n{}\n---{body}", out.join("\n"))
}
/// The vault's template `kind` filled in for a note `name` of `ctx`, or None: no template, or one that runs a script
/// (Templater `<%* … %>`) Relay can't. Obsidian's {{date}} and {{title}} and Templater's date and title tags are filled.
fn template(vault: &str, kind: &str, name: &str, ctx: &str, today: &str) -> Option<String> {
    let text = fs::read_to_string(Path::new(vault).join("Resources/Templates").join(format!("{kind}.md"))).ok()?.replace("\r\n", "\n");
    let text = Regex::new(r"<%\s*tp\.date\.now\([^)]*\)\s*%>").unwrap().replace_all(&text, today);
    let text = Regex::new(r"<%\s*tp\.file\.title\s*%>").unwrap().replace_all(&text, name);
    let text = Regex::new(r"\{\{date(:[^}]*)?\}\}").unwrap().replace_all(&text, today).replace("{{title}}", name);
    if text.contains("<%") || !text.starts_with("---\n") { return None; }
    // lastSync: a sync plugin's stamp on the template itself, not the note's
    let text = Regex::new(r"(?m)^lastSync:.*\n").unwrap().replace(&text, "").into_owned();
    Some(if ctx.is_empty() { text } else { set_field(&text, "context", &format!("\"[[{ctx}]]\"")) })
}
/// The project types New project offers: those the vault has a template for, else Project.
pub fn kinds(vault: &str) -> Vec<String> {
    let dir = Path::new(vault).join("Resources/Templates");
    let l: Vec<String> = KINDS.iter().filter(|k| dir.join(format!("{k}.md")).is_file()).map(|k| k.to_string()).collect();
    if l.is_empty() { vec!["Project".into()] } else { l }
}

/// `text` with an empty table for `ctx` after the last context's table (at the end when there is none), at that
/// context heading's level. Unchanged when `ctx` has a heading.
pub fn add_context(text: &str, ctx: &str, known: &[String]) -> String {
    let head = Regex::new(r"^(#{2,3}) (.+?)\s*$").unwrap();
    let lines: Vec<&str> = text.lines().collect();
    let heads: Vec<(usize, usize, &str)> = lines.iter().enumerate()
        .filter_map(|(i, l)| head.captures(l).map(|c| (i, c[1].len(), c.get(2).unwrap().as_str()))).collect();
    if heads.iter().any(|h| h.2 == ctx) { return text.to_string(); }
    let Some(&(at, level, _)) = heads.iter().rev().find(|h| known.iter().any(|k| k == h.2)) else {
        return format!("{}\n\n### {ctx}\n\n{TABLE}\n", text.trim_end());
    };
    // the end of that context's section: the next heading at its level or above
    let end = lines[at + 1..].iter().position(|l| l.starts_with('#') && l.chars().take_while(|c| *c == '#').count() <= level).map_or(lines.len(), |i| at + 1 + i);
    let mut before = lines[..end].join("\n").trim_end().to_string();
    before += &format!("\n\n{} {ctx}\n\n{TABLE}\n", "#".repeat(level));
    let rest = lines[end..].join("\n");
    if rest.is_empty() { before } else { format!("{before}\n{rest}\n") }
}

/// A new context: `<notes>/<name>/<name>.md`, its table in work-state, and in the config's `contexts` when the config
/// lists them. A vault of cards gets its Projects/ folder. Returns the note, relative to the vault.
pub fn create_context(side: &Side, name: &str, today: &str) -> Result<String, String> {
    let name = named(name)?;
    let known = listed(side);
    let dir = notes_root(side).join(name);
    if known.iter().any(|c| c.eq_ignore_ascii_case(name)) || fs::symlink_metadata(&dir).is_ok() { return Err(format!("already there: {name}")); }
    let note = dir.join(format!("{name}.md"));
    let text = template(&side.vault, "Context", name, "", today)
        .unwrap_or_else(|| format!("---\ntype: Context\naliases:\n  - \"{name}\"\ncreated: {today}\n---\n"));
    write_new(&note, &text)?;
    if migrate::cards(side) { fs::create_dir_all(dir.join("Projects")).map_err(err)?; } else {
        let ws = fs::read_to_string(&side.work_state).map_err(err)?;
        fs::write(&side.work_state, add_context(&ws, name, &known)).map_err(err)?;
    }
    if let Some(mut cfg) = crate::relay_config::load(&side.vault) {
        if let Some(l) = cfg["contexts"].as_array_mut() {
            l.push(name.into());
            crate::relay_config::save(&side.vault, &cfg)?;
        }
    }
    Ok(rel(side, &note))
}

/// A new project `name` of context `ctx`: its note (from the template of `kind`) as a folder note under the context's
/// Portfolio/ or Projects/ when it has one, else in its own folder, and its row, or a card with `status`. Returns the
/// note, relative to the vault.
pub fn create_project(side: &Side, ctx: &str, name: &str, kind: &str, state: &str, today: &str) -> Result<String, String> {
    let name = named(name)?;
    if !STATES.contains(&state) { return Err(format!("not a state: {state}")); }
    if !listed(side).iter().any(|c| c == ctx) { return Err(format!("no context {ctx}")); }
    if crate::snapshot::project_note(&side.vault, &side.notes, name).is_some() || migrate::row_of(&side.work_state, name).is_some() {
        return Err(format!("already a project: {name}"));
    }
    let card = migrate::cards(side);
    let base = notes_root(side).join(ctx);
    let into = if card { base.join("Projects") } else { ["Portfolio", "Projects"].iter().map(|d| base.join(d)).find(|d| d.is_dir()).unwrap_or(base) };
    let note = into.join(name).join(format!("{name}.md"));
    let kind = if KINDS.contains(&kind) { kind } else { "Project" };
    let mut text = template(&side.vault, kind, name, ctx, today)
        .unwrap_or_else(|| format!("---\ntype: {kind}\ncontext: \"[[{ctx}]]\"\ncreated: {today}\n---\n"));
    if card {
        text = set_field(&set_field(&text, "status", state), "last", today);
        return write_new(&note, &text).map(|_| rel(side, &note));
    }
    let ws = fs::read_to_string(&side.work_state).map_err(err)?;
    write_new(&note, &text)?;
    fs::write(&side.work_state, migrate::add_row(&ws, ctx, &format!("| [[{name}]] | {state} | {today} |  |"))).map_err(|e| {
        fs::remove_file(&note).ok();
        fs::remove_dir(note.parent().unwrap()).ok();
        e.to_string()
    })?;
    Ok(rel(side, &note))
}

/// A project's state: the State cell of its row, or its card's `status`.
pub fn set_state(side: &Side, name: &str, state: &str) -> Result<(), String> {
    if !STATES.contains(&state) { return Err(format!("not a state: {state}")); }
    if migrate::cards(side) {
        let note = crate::snapshot::project_note(&side.vault, &side.notes, name).ok_or_else(|| format!("no note {name}.md found"))?;
        let text = fs::read_to_string(&note).map_err(err)?;
        return fs::write(&note, set_field(&text, "status", state)).map_err(err);
    }
    let row = migrate::row_of(&side.work_state, name).ok_or_else(|| format!("no row for {name}"))?;
    let cell = Regex::new(r"^(\|[^|]*\| )\w+( \|)").unwrap();
    let new = cell.replace(&row, format!("${{1}}{state}${{2}}")).into_owned();
    let text = fs::read_to_string(&side.work_state).map_err(err)?;
    let text = text.replacen(&format!("{row}\n"), &format!("{new}\n"), 1);
    fs::write(&side.work_state, text).map_err(err)
}

/// A deleted project's row out of work-state; returns it, for Undo (None in a vault of cards: the card is the row).
pub fn drop_row(side: &Side, name: &str) -> Result<Option<String>, String> {
    if migrate::cards(side) { return Ok(None); }
    let Some(row) = migrate::row_of(&side.work_state, name) else { return Ok(None) };
    let text = fs::read_to_string(&side.work_state).map_err(err)?;
    fs::write(&side.work_state, migrate::drop_row(&text, &row)).map_err(err)?;
    Ok(Some(row))
}
/// Undo of drop_row: the row back in its context's table.
pub fn restore_row(side: &Side, ctx: &str, row: &str) -> Result<(), String> {
    if migrate::cards(side) { return Ok(()); }
    let text = fs::read_to_string(&side.work_state).map_err(err)?;
    if text.lines().any(|l| l == row) { return Ok(()); }
    fs::write(&side.work_state, migrate::add_row(&text, ctx, row)).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-projects-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(d).unwrap()
    }
    fn w(root: &Path, rel: &str, body: &str) { let p = root.join(rel); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, body).unwrap(); }
    fn r(root: &Path, rel: &str) -> String { fs::read_to_string(root.join(rel)).unwrap() }
    fn side(v: &Path, ws: &str) -> Side {
        Side { vault: v.to_string_lossy().into(), work_state: v.join(ws).to_string_lossy().into(), notes: v.join("Contexts").to_string_lossy().into() }
    }
    const WS: &str = "# Work State\n\n## Last Session\n- x\n\n## Work\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| [[A]] | Active | 2026-10-01 | a |\n";

    #[test]
    fn a_context_gets_its_note_and_table() {
        let v = tmp("ctx");
        w(&v, "State/ws.md", WS);
        w(&v, "Contexts/Work/Work.md", "---\ntype: Context\n---\n");
        w(&v, ".relay/config.json", "{\"contexts\": [\"Work\"]}");
        let s = side(&v, "State/ws.md");
        assert_eq!(create_context(&s, "Home", "2026-10-29").unwrap(), "Contexts/Home/Home.md");
        assert!(r(&v, "Contexts/Home/Home.md").contains("type: Context"));
        assert!(r(&v, "State/ws.md").ends_with("| [[A]] | Active | 2026-10-01 | a |\n\n## Home\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n"));
        assert!(r(&v, ".relay/config.json").contains("Home"));
        assert!(create_context(&s, "home", "2026-10-29").is_err());
        assert!(create_context(&s, "../x", "2026-10-29").is_err());
    }

    #[test]
    fn a_context_goes_after_the_last_one_not_at_the_end() {
        let text = "## Work\n\n| a |\n\n## Notes\nkeep\n";
        assert_eq!(add_context(text, "Home", &["Work".into()]), "## Work\n\n| a |\n\n## Home\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n\n## Notes\nkeep\n");
        assert_eq!(add_context(text, "Work", &["Work".into()]), text);
    }

    #[test]
    fn a_project_in_the_portfolio_from_the_template_with_its_row() {
        let v = tmp("proj");
        w(&v, "State/ws.md", WS);
        fs::create_dir_all(v.join("Contexts/Work/Portfolio")).unwrap();
        w(&v, "Resources/Templates/Product.md", "---\nlastSync: x\ntype: Product\ncontext:\nproduct-status:\ncreated: <% tp.date.now(\"YYYY-MM-DD\") %>\n---\n");
        let s = side(&v, "State/ws.md");
        assert_eq!(kinds(&s.vault), vec!["Product"]);
        let p = create_project(&s, "Work", "Beta", "Product", "Blocked", "2026-10-29").unwrap();
        assert_eq!(p, "Contexts/Work/Portfolio/Beta/Beta.md");
        assert_eq!(r(&v, &p), "---\ntype: Product\ncontext: \"[[Work]]\"\nproduct-status:\ncreated: 2026-10-29\n---\n");
        assert!(r(&v, "State/ws.md").ends_with("| [[A]] | Active | 2026-10-01 | a |\n| [[Beta]] | Blocked | 2026-10-29 |  |\n"));
        assert!(create_project(&s, "Work", "Beta", "Product", "Active", "2026-10-29").is_err());
        assert!(create_project(&s, "Nope", "Gamma", "Product", "Active", "2026-10-29").is_err());

        set_state(&s, "Beta", "Paused").unwrap();
        assert!(r(&v, "State/ws.md").contains("| [[Beta]] | Paused | 2026-10-29 |  |\n"));
        let row = drop_row(&s, "Beta").unwrap().unwrap();
        assert!(!r(&v, "State/ws.md").contains("Beta"));
        restore_row(&s, "Work", &row).unwrap();
        assert!(r(&v, "State/ws.md").contains("| [[Beta]] | Paused |"));
    }

    #[test]
    fn a_templater_script_or_no_portfolio_falls_back() {
        let v = tmp("plain");
        w(&v, "State/ws.md", WS);
        fs::create_dir_all(v.join("Contexts/Work")).unwrap();
        w(&v, "Resources/Templates/Project.md", "<%* await tp.system.prompt() %>\n");
        let s = side(&v, "State/ws.md");
        let p = create_project(&s, "Work", "Beta", "Project", "Active", "2026-10-29").unwrap();
        assert_eq!(p, "Contexts/Work/Beta/Beta.md");
        assert_eq!(r(&v, &p), "---\ntype: Project\ncontext: \"[[Work]]\"\ncreated: 2026-10-29\n---\n");
    }

    #[test]
    fn a_vault_of_cards_gets_a_card_with_its_status() {
        let v = tmp("cards");
        w(&v, "System/rules/core/work-state.md", "*Generated by `System/scripts/build-index.py`*\n");
        w(&v, "Contexts/Work/Work.md", "---\ntype: Context\n---\n");
        w(&v, "Resources/Templates/Project.md", "---\ntype: Project\ncontext: \"[[Work]]\"\nstatus: Active\nlast: {{date:YYYY-MM-DD}}\nrepos: []\n---\n\n## Status\n*{{date:YYYY-MM-DD}}*\n");
        let s = side(&v, "System/rules/core/work-state.md");
        assert_eq!(create_context(&s, "Home", "2026-10-29").unwrap(), "Contexts/Home/Home.md");
        assert!(v.join("Contexts/Home/Projects").is_dir());
        let p = create_project(&s, "Home", "Garden", "Project", "Quiet", "2026-10-29").unwrap();
        assert_eq!(p, "Contexts/Home/Projects/Garden/Garden.md");
        assert_eq!(r(&v, &p), "---\ntype: Project\ncontext: \"[[Home]]\"\nstatus: Quiet\nlast: 2026-10-29\nrepos: []\n---\n\n## Status\n*2026-10-29*\n");
        set_state(&s, "Garden", "Paused").unwrap();
        assert!(r(&v, &p).contains("status: Paused\n"));
        assert_eq!(drop_row(&s, "Garden").unwrap(), None);
    }

    #[test]
    fn set_field_replaces_a_list_too() {
        assert_eq!(set_field("---\na: 1\ncontext:\n  - x\nb: 2\n---\nbody", "context", "y"), "---\na: 1\ncontext: y\nb: 2\n---\nbody");
        assert_eq!(set_field("---\na: 1\n---\n", "s", "x"), "---\na: 1\ns: x\n---\n");
    }
}
