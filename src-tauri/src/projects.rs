// Projects made from the app: a row in the vault's work-state (`| Name | Active | date |  |` under the context's
// heading) and a note `<context>/<Name>.md` under the project notes, and the row's Last Touched date moved to today
// when a conversation in the project closes. The rest of the row stays the agents' (the vault's CLAUDE.md).

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const HEADER: &str = "| Project | State | Last Touched | Left Off |\n|---------|-------|--------------|----------|";

/// A name the table and a file name both take: no pipes, slashes or line breaks, at most 60 characters.
pub fn valid(name: &str) -> Option<String> {
    let n = name.trim();
    (!n.is_empty() && n.chars().count() <= 60 && !n.contains(['|', '/', '\\', '\n', '[', ']']) && !n.starts_with('.')).then(|| n.to_string())
}

/// The row's project name, a [[link]] taken by its target. None for a line that is no project row.
fn row_name(line: &str) -> Option<String> {
    let cells: Vec<&str> = line.trim().trim_matches('|').split('|').map(str::trim).collect();
    if !line.trim_start().starts_with('|') || cells.len() < 4 || !is_date(cells[2]) { return None; }
    Some(cells[0].trim_start_matches("[[").split([']', '|']).next().unwrap_or("").trim().to_string())
}
fn is_date(s: &str) -> bool { s.len() == 10 && s.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }) }

/// The headings with project rows under them, in file order: the contexts a new project can go to.
pub fn contexts(text: &str) -> Vec<String> {
    let (mut out, mut cur) = (Vec::<String>::new(), None::<String>);
    for l in text.lines() {
        if let Some(h) = l.strip_prefix("### ").or_else(|| l.strip_prefix("## ")) { cur = Some(h.trim().to_string()); }
        else if let (Some(c), Some(_)) = (&cur, row_name(l)) { if !out.contains(c) { out.push(c.clone()); } }
    }
    out
}

/// `text` with a row for `name` at the end of the table under `## <context>`; the heading and table are added when
/// missing. Err when a project of that name (case-insensitive) is already there.
pub fn add_row(text: &str, name: &str, context: &str, today: &str) -> Result<String, String> {
    if text.lines().filter_map(row_name).any(|n| n.eq_ignore_ascii_case(name)) { return Err("err.project_exists".into()); }
    let row = format!("| {name} | Active | {today} |  |");
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let head = lines.iter().position(|l| l.strip_prefix("### ").or_else(|| l.strip_prefix("## ")).is_some_and(|h| h.trim() == context));
    match head {
        Some(h) => {
            let first = (h + 1..lines.len()).find(|&i| !lines[i].trim().is_empty());
            match first.filter(|&i| lines[i].trim_start().starts_with('|')) {
                Some(i) => {
                    let end = (i..lines.len()).find(|&j| !lines[j].trim_start().starts_with('|')).unwrap_or(lines.len());
                    lines.insert(end, row);
                }
                None => { lines.splice(h + 1..h + 1, ["".to_string(), HEADER.to_string(), row]); }
            }
        }
        None => {
            if lines.last().is_some_and(|l| !l.trim().is_empty()) { lines.push(String::new()); }
            lines.extend([format!("## {context}"), String::new(), HEADER.to_string(), row]);
        }
    }
    Ok(lines.join("\n") + "\n")
}

/// `text` with the Last Touched of `name`'s row set to `today`; None when there is no such row or it already says today.
pub fn touch(text: &str, name: &str, today: &str) -> Option<String> {
    let mut hit = false;
    let lines: Vec<String> = text.lines().map(|l| {
        if hit || row_name(l).is_none_or(|n| n != name) { return l.to_string(); }
        let mut cells: Vec<String> = l.split('|').map(String::from).collect(); // "", name, state, date, …, ""
        if cells[3].trim() == today { return l.to_string(); }
        hit = true;
        cells[3] = format!(" {today} ");
        cells.join("|")
    }).collect();
    hit.then(|| lines.join("\n") + if text.ends_with('\n') { "\n" } else { "" })
}

/// A new project in the vault `st` (vault_status): its row in work-state under `context` (the first context with
/// projects, else "Projects") and its note in `<project notes>/<context>/`. A vault without work-state gets
/// `work-state.md` in its root, mapped in .relay/config.json. Returns the name; errors are err.* keys or I/O text.
pub fn add(st: &Value, name: &str, context: Option<&str>, today: &str) -> Result<String, String> {
    let v = st["vault"].as_str().unwrap_or("");
    let name = valid(name).ok_or("err.project_name")?;
    let mapped = st["map"]["workState"].as_str().unwrap_or("");
    let rel = if mapped.is_empty() { "work-state.md" } else { mapped };
    let ws = crate::vault::resolve(v, rel);
    let text = fs::read_to_string(&ws).unwrap_or_default();
    let ctx = context.and_then(valid).or_else(|| contexts(&text).into_iter().next()).unwrap_or_else(|| "Projects".into());
    fs::write(&ws, add_row(&text, &name, &ctx, today)?).map_err(|e| e.to_string())?;
    if mapped.is_empty() {
        let mut m = st["map"].clone();
        m["workState"] = json!(rel);
        crate::relay_config::set_paths(v, &m)?;
    }
    // the context's folder makes it a context for the snapshot, also when the note already lives elsewhere
    let notes = if st["found"]["notes"] == true { crate::vault::resolve(v, st["map"]["notes"].as_str().unwrap()) } else { PathBuf::from(v) };
    let dir = notes.join(&ctx);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if crate::vault::note(v, &name).is_none() { write_note(&dir.join(format!("{name}.md")), &name, today)?; }
    Ok(name)
}

/// A new project note, never over an existing file.
pub fn write_note(path: &Path, name: &str, today: &str) -> Result<(), String> {
    if path.exists() { return Ok(()); }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, format!("---\ntype: Project\ncreated: {today}\n---\n\n# {name}\n\n## Open\n\n## Status\n")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WS: &str = "# W\n\n## Antenna\n\n| Project | State | Last Touched | Left Off |\n|---|---|---|---|\n| Spardex | Active | 2026-10-07 | x |\n| [[Habo]] | Quiet | 2026-09-01 | y |\n\n## Personal\n\n| P | S | L | N |\n|---|---|---|---|\n| Relay | Active | 2026-10-01 | z |\n";

    #[test]
    fn adds_rows_where_they_belong() {
        let t = add_row(WS, "Acme", "Antenna", "2026-10-08").unwrap();
        assert!(t.contains("| [[Habo]] | Quiet | 2026-09-01 | y |\n| Acme | Active | 2026-10-08 |  |\n\n## Personal"));
        let t = add_row(WS, "Side", "Freelance", "2026-10-08").unwrap();
        assert!(t.ends_with("| Relay | Active | 2026-10-01 | z |\n\n## Freelance\n\n| Project | State | Last Touched | Left Off |\n|---------|-------|--------------|----------|\n| Side | Active | 2026-10-08 |  |\n"));
        let seeded = "# Work State\n\n## Projects\n\n| Project | State | Last Touched | Left Off |\n|---------|-------|--------------|----------|\n";
        assert!(add_row(seeded, "First", "Projects", "2026-10-08").unwrap().ends_with("|----------|\n| First | Active | 2026-10-08 |  |\n"));
        assert!(add_row("## Projects\n", "A", "Projects", "2026-10-08").unwrap().contains("## Projects\n\n| Project"));
        assert_eq!(add_row(WS, "habo", "Personal", "2026-10-08").unwrap_err(), "err.project_exists");
        assert_eq!(contexts(WS), ["Antenna", "Personal"]);
        assert_eq!(contexts(&add_row(WS, "Side", "Freelance", "d").unwrap()), ["Antenna", "Personal"], "d is no date");
    }

    #[test]
    fn a_project_shows_up_in_the_snapshot() {
        let d = std::env::temp_dir().join(format!("relay-projects-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        // a folder without work-state: the first project makes work-state.md and maps it
        fs::create_dir_all(&d).unwrap();
        let v = crate::vault::canon(d.to_str().unwrap());
        let st = crate::vault::status(&v, &crate::vault::merge(&crate::vault::detect(&v).1, &json!({})));
        assert_eq!(add(&st, " Acme ", None, "2026-10-08").unwrap(), "Acme");
        assert!(Path::new(&v).join("Projects/Acme.md").is_file());
        assert_eq!(crate::relay_config::load(&v).unwrap()["paths"]["workState"], "work-state.md");
        let st = crate::vault::status(&v, &crate::relay_config::load(&v).unwrap()["paths"]);
        assert_eq!(add(&st, "Beta", None, "2026-10-08").unwrap(), "Beta");
        assert_eq!(add(&st, "acme", None, "2026-10-08").unwrap_err(), "err.project_exists");
        let ws = format!("{v}/work-state.md");
        let snap = crate::snapshot::snapshot(&v, &ws, "", chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap(), "", &d.join("c.json"), "").unwrap();
        let got: Vec<_> = snap["projects"].as_array().unwrap().iter().map(|p| (p["name"].as_str().unwrap(), p["context"].as_str().unwrap())).collect();
        assert_eq!(got, [("Acme", "Projects"), ("Beta", "Projects")]);
        assert_eq!(snap["projects"][0]["open"], 0, "its note is found, with an empty ## Open");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn touches_only_the_named_row() {
        let t = touch(WS, "Spardex", "2026-10-08").unwrap();
        assert!(t.contains("| Spardex | Active | 2026-10-08 | x |") && t.contains("| Relay | Active | 2026-10-01 | z |"));
        assert!(touch(&t, "Spardex", "2026-10-08").is_none(), "already today");
        assert!(touch(WS, "Habo", "2026-10-08").unwrap().contains("| [[Habo]] | Quiet | 2026-10-08 | y |"));
        assert!(touch(WS, "Ghost", "2026-10-08").is_none());
        assert_eq!(valid("  Acme  ").as_deref(), Some("Acme"));
        assert!(valid("a|b").is_none() && valid("../x").is_none() && valid("").is_none());
    }
}
