// The reminder table, read and written by the app itself, so reminders work in any vault without a
// script. Same format and ids as the vault's reminder-digest.py, which may write the same file:
// | date | reminder | source | repeat |, id = first 8 hex of sha1("date|text"). Every write rereads
// the file first and replaces it through a tmp file. Errors are TEXT keys, lib.rs translates them.

use chrono::{Datelike, Duration, Months, NaiveDate};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::Path;

const HEADER: &str = "# Reminders\n\n| Date | Reminder | Source | Repeat |\n|------|----------|--------|--------|\n";
const WEEKDAYS: [[&str; 2]; 7] = [["maandag", "monday"], ["dinsdag", "tuesday"], ["woensdag", "wednesday"],
    ["donderdag", "thursday"], ["vrijdag", "friday"], ["zaterdag", "saturday"], ["zondag", "sunday"]];

#[derive(Debug, Clone, PartialEq)]
pub struct Row { line: usize, pub date: NaiveDate, pub text: String, source: String, repeat: String }

impl Row {
    pub fn id(&self) -> String { id_of(self.date, &self.text) }
    /// The first wikilink target in the text, the project the reminder belongs to.
    pub fn project(&self) -> Option<String> { self.text.find("[[").map(|i| link_at(&self.text[i..]).0) }
    /// Bold part, else the first sentence, project prefix dropped, links unwrapped.
    pub fn title(&self) -> String {
        let t = self.text.trim_start();
        let body = if t.starts_with("[[") { &t[link_at(t).1..] } else { t }.trim_start();
        let head = match body.strip_prefix("**").and_then(|b| b.find("**").map(|e| &b[..e])) {
            Some(bold) => bold.to_string(),
            None => first_sentence(body),
        };
        let head = unlink(&head).replace("**", "");
        let head = head.trim().trim_end_matches('.');
        if head.chars().count() > 140 { format!("{}...", head.chars().take(137).collect::<String>().trim_end()) } else { head.to_string() }
    }
    fn format(&self) -> String {
        format!("| {} | {} | {} | {} |", self.date, esc(&self.text), esc(&self.source), self.repeat)
    }
}

fn id_of(date: NaiveDate, text: &str) -> String { sha1_smol::Sha1::from(format!("{date}|{text}")).digest().to_string()[..8].to_string() }
fn esc(s: &str) -> String { s.replace('|', "\\|") }

/// `[[target|alias]]...` at the start of `s`: the target and the byte length of the link.
fn link_at(s: &str) -> (String, usize) {
    let Some(end) = s.find("]]") else { return (String::new(), 0) };
    let inner = &s[2..end];
    (inner.split('|').next().unwrap_or("").to_string(), end + 2)
}
fn unlink(s: &str) -> String {
    let (mut out, mut rest) = (String::new(), s);
    while let Some(i) = rest.find("[[") {
        let (target, len) = link_at(&rest[i..]);
        if len == 0 { break; }
        out.push_str(&rest[..i]);
        out.push_str(&target);
        rest = &rest[i + len..];
    }
    out + rest
}
fn first_sentence(s: &str) -> String {
    let b = s.as_bytes();
    let end = (0..b.len().saturating_sub(1)).find(|&i| b".?!".contains(&b[i]) && b[i + 1].is_ascii_whitespace()).map_or(s.len(), |i| i + 1);
    s[..end].to_string()
}

/// Cells of a table line, split on unescaped pipes, outer empties dropped, `\|` unescaped.
fn split_row(line: &str) -> Vec<String> {
    let (mut cells, mut cur, mut prev) = (vec![], String::new(), '\0');
    for c in line.trim().chars() {
        if c == '|' && prev != '\\' { cells.push(std::mem::take(&mut cur)); } else { cur.push(c); }
        prev = c;
    }
    cells.push(cur);
    let mut cells: Vec<String> = cells.into_iter().map(|c| c.trim().replace("\\|", "|")).collect();
    if cells.first().is_some_and(String::is_empty) { cells.remove(0); }
    if cells.last().is_some_and(String::is_empty) { cells.pop(); }
    cells
}

fn is_iso(s: &str) -> bool { s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() }

/// The file's lines and its reminder rows. A missing file is empty, not an error.
fn load(path: &Path) -> (Vec<String>, Vec<Row>) {
    let raw = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    let rows = lines.iter().enumerate().filter(|(_, l)| l.starts_with('|')).filter_map(|(i, l)| {
        let c = split_row(l);
        if c.len() < 3 || !is_iso(&c[0]) { return None; }
        Some(Row { line: i, date: NaiveDate::parse_from_str(&c[0], "%Y-%m-%d").ok()?, text: c[1].clone(),
            source: c[2].clone(), repeat: c.get(3).cloned().unwrap_or_default() })
    }).collect();
    (lines, rows)
}

fn save(path: &Path, mut lines: Vec<Option<String>>, added: Option<&Row>, last_row: Option<usize>) -> Result<(), String> {
    if let Some(r) = added {
        match last_row {
            Some(i) => lines.insert(i + 1, Some(r.format())),
            None => {
                // no table yet: the header after what the file already has, the title too when it is new
                while lines.last().is_some_and(|l| l.as_deref().is_none_or(str::is_empty)) { lines.pop(); }
                let head = if lines.is_empty() { HEADER } else { lines.push(Some(String::new())); &HEADER["# Reminders\n\n".len()..] };
                lines.extend(head.trim_end().split('\n').map(|l| Some(l.to_string())));
                lines.push(Some(r.format()));
                lines.push(Some(String::new()));
            }
        }
    }
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let text = lines.into_iter().flatten().collect::<Vec<_>>().join("\n");
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, text).and_then(|_| fs::rename(&tmp, path)).map_err(|e| e.to_string())
}

fn log(log: &Path, kind: &str, extra: &str, r: &Row) {
    if let Some(dir) = log.parent() { fs::create_dir_all(dir).ok(); }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log) {
        writeln!(f, "{} {kind} {extra} {}", chrono::Local::now().format("%Y-%m-%dT%H:%M:%S"), r.format()).ok();
    }
}

/// The rows as the webview and the tray use them, soonest first.
pub fn list(path: &Path, today: NaiveDate) -> Vec<Value> {
    let (_, mut rows) = load(path);
    rows.sort_by_key(|r| r.date);
    rows.iter().map(|r| json!({"id": r.id(), "date": r.date.to_string(), "days": (r.date - today).num_days(),
        "project": r.project(), "title": r.title(), "text": r.text, "repeat": Some(&r.repeat).filter(|s| !s.is_empty())})).collect()
}

/// A date as typed or sent by a button: ISO, today/tomorrow (nl and en), +3d / 2w / +1m, a weekday
/// (always the next one, so "friday" on a Friday is a week out).
pub fn parse_when(s: &str, today: NaiveDate) -> Result<NaiveDate, String> {
    let s = s.trim().to_lowercase();
    if is_iso(&s) { return NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|e| e.to_string()); }
    match s.as_str() {
        "vandaag" | "today" => return Ok(today),
        "morgen" | "tomorrow" => return Ok(today + Duration::days(1)),
        "overmorgen" => return Ok(today + Duration::days(2)),
        "volgende week" | "next week" => return Ok(today + Duration::days(7)),
        _ => {}
    }
    if let Some(wd) = WEEKDAYS.iter().position(|names| names.contains(&s.as_str())) {
        let delta = (wd as i64 - today.weekday().num_days_from_monday() as i64).rem_euclid(7);
        return Ok(today + Duration::days(if delta == 0 { 7 } else { delta }));
    }
    let t = s.trim_start_matches('+');
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    let (n, unit) = (t[..digits].parse::<u32>().map_err(|_| "err.rem_date".to_string())?, t[digits..].trim());
    match unit {
        "d" | "dag" | "dagen" => Ok(today + Duration::days(n.into())),
        "w" | "week" | "weken" => Ok(today + Duration::weeks(n.into())),
        "m" | "maand" | "maanden" => today.checked_add_months(Months::new(n)).ok_or("err.rem_date".into()),
        _ => Err("err.rem_date".into()),
    }
}

/// `14d`, `2w`, `1m`, `1y` (or `1j`), from the later of the reminder's date and today, so an overdue
/// repeat restarts from today.
fn next_repeat(date: NaiveDate, repeat: &str, today: NaiveDate) -> Result<NaiveDate, String> {
    let r = repeat.trim().to_lowercase();
    let digits = r.chars().take_while(char::is_ascii_digit).count();
    let n: u32 = r[..digits].parse().map_err(|_| "err.rem_repeat".to_string())?;
    let base = date.max(today);
    match r[digits..].trim() {
        "d" => Ok(base + Duration::days(n.into())),
        "w" => Ok(base + Duration::weeks(n.into())),
        "m" => base.checked_add_months(Months::new(n)).ok_or("err.rem_repeat".into()),
        "y" | "j" => base.checked_add_months(Months::new(12 * n)).ok_or("err.rem_repeat".into()),
        _ => Err("err.rem_repeat".into()),
    }
}

/// done (gone, or moved on by its repeat), push to `when`, or drop. Returns the row's new date or "".
pub fn act(path: &Path, logf: &Path, action: &str, id: &str, when: Option<&str>, today: NaiveDate) -> Result<String, String> {
    let (lines, rows) = load(path);
    let mut r = rows.into_iter().find(|r| r.id() == id).ok_or("err.rem_gone")?;
    let mut lines: Vec<Option<String>> = lines.into_iter().map(Some).collect();
    match action {
        "done" if !r.repeat.is_empty() => { let d = next_repeat(r.date, &r.repeat, today)?; log(logf, "done", "app", &r); r.date = d; }
        "done" | "drop" => { log(logf, action, if action == "done" { "app" } else { "" }, &r); lines[r.line] = None; }
        "push" => { let d = parse_when(when.unwrap_or(""), today)?; log(logf, "push", &format!("-> {d}"), &r); r.date = d; }
        _ => return Err("unknown action".into()),
    }
    if lines[r.line].is_some() { lines[r.line] = Some(r.format()); }
    let out = if lines[r.line].is_some() { r.date.to_string() } else { String::new() };
    save(path, lines, None, None)?;
    Ok(out)
}

/// A new row after the last one, the file (with its table header) created when missing. Returns its id.
pub fn add(path: &Path, logf: &Path, text: &str, when: &str, project: Option<&str>, repeat: Option<&str>, today: NaiveDate) -> Result<String, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" "); // one table line, no newlines
    if text.is_empty() || text.chars().count() > 2000 { return Err("err.rem_text".into()); }
    let project = project.map(str::trim).filter(|p| !p.is_empty());
    if project.is_some_and(|p| p.len() > 120 || p.contains(['[', ']', '|', '\n'])) { return Err("err.rem_text".into()); }
    let repeat = repeat.map(str::trim).filter(|r| !r.is_empty()).unwrap_or("").to_string();
    if !repeat.is_empty() { next_repeat(today, &repeat, today)?; }
    let date = parse_when(when, today)?;
    let text = project.map_or(text.clone(), |p| format!("[[{p}]] {text}"));
    let (lines, rows) = load(path);
    let r = Row { line: 0, date, text, source: "Relay".into(), repeat };
    log(logf, "add", "", &r);
    save(path, lines.into_iter().map(Some).collect(), Some(&r), rows.iter().map(|r| r.line).max())?;
    Ok(r.id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }
    fn tmp(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vault-rem-{name}-{}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(&dir).unwrap();
        (dir.join("reminders.md"), dir.join("actions.log"))
    }
    const TABLE: &str = "# Reminders\n\n*intro*\n\n| Date | Reminder | Source | Repeat |\n|------|----------|--------|--------|\n\
| 2026-10-02 | [[Smappee Laadpassen]] **Prijsvork naar Mina.** Kern 12,5-19k. | [[x]] |  |\n\
| 2026-10-11 | [[Antenna]] **Budgetronde** (a \\| b). | Laurent | 1m |\n\
| 2026-09-30 | Overdracht Moduus. Mail verstuurd. | Mail |\n";

    #[test]
    fn parse_and_ids_match_the_python_script() {
        let (p, _) = tmp("parse");
        fs::write(&p, TABLE).unwrap();
        let l = list(&p, d("2026-09-30"));
        assert_eq!(l.len(), 3);
        assert_eq!(l[0]["days"], 0);
        assert_eq!(l[0]["title"], "Overdracht Moduus");
        assert_eq!(l[0]["project"], Value::Null);
        assert_eq!(l[1]["project"], "Smappee Laadpassen");
        assert_eq!(l[1]["title"], "Prijsvork naar Mina");
        assert_eq!(l[2]["text"], "[[Antenna]] **Budgetronde** (a | b).");
        assert_eq!(l[2]["repeat"], "1m");
        // ids are sha1("date|unescaped text")[:8], as in reminder-digest.py row_id
        // expected values from hashlib.sha1("date|text".encode()).hexdigest()[:8], as in reminder-digest.py
        assert_eq!(id_of(d("2026-10-02"), "abc"), "13af1684");
        assert_eq!(id_of(d("2026-10-01"), "[[PHÉNX]] **Terugkoppeling** (a | b)"), "4a80e48b");
    }

    #[test]
    fn done_push_drop_keep_the_rest_of_the_file() {
        let (p, lg) = tmp("act");
        fs::write(&p, TABLE).unwrap();
        let today = d("2026-09-30");
        let ids: Vec<String> = list(&p, today).iter().map(|r| r["id"].as_str().unwrap().to_string()).collect();
        // done on a repeat moves it on, from the later of its date and today
        assert_eq!(act(&p, &lg, "done", &ids[2], None, today).unwrap(), "2026-11-11");
        assert!(fs::read_to_string(&p).unwrap().contains("| 2026-11-11 | [[Antenna]] **Budgetronde** (a \\| b). | Laurent | 1m |"));
        // push to a weekday: 2026-09-30 is a Wednesday
        assert_eq!(act(&p, &lg, "push", &ids[0], Some("maandag"), today).unwrap(), "2026-10-05");
        assert_eq!(act(&p, &lg, "drop", &ids[1], None, today).unwrap(), "");
        let s = fs::read_to_string(&p).unwrap();
        assert!(s.starts_with("# Reminders\n\n*intro*\n") && s.ends_with("|\n"));
        assert!(!s.contains("Smappee"));
        assert_eq!(list(&p, today).len(), 2);
        assert_eq!(act(&p, &lg, "done", &ids[1], None, today), Err("err.rem_gone".into()));
        assert_eq!(fs::read_to_string(&lg).unwrap().lines().count(), 3);
    }

    #[test]
    fn add_creates_the_file_and_appends_after_the_last_row() {
        let (p, lg) = tmp("add");
        let today = d("2026-09-30");
        let id = add(&p, &lg, "Eerste  reminder\nmet | pipe", "morgen", Some("Weemaes"), None, today).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), format!("{HEADER}| 2026-10-01 | [[Weemaes]] Eerste reminder met \\| pipe | Relay |  |\n"));
        assert_eq!(list(&p, today)[0]["id"], id.as_str());
        add(&p, &lg, "Tweede", "+2w", None, Some("14d"), today).unwrap();
        let l = list(&p, today);
        assert_eq!((l[1]["date"].as_str(), l[1]["repeat"].as_str()), (Some("2026-10-14"), Some("14d")));
        assert!(fs::read_to_string(&p).unwrap().ends_with("| 2026-10-14 | Tweede | Relay | 14d |\n"));
        assert_eq!(add(&p, &lg, "  ", "morgen", None, None, today), Err("err.rem_text".into()));
        assert_eq!(add(&p, &lg, "x", "ooit", None, None, today), Err("err.rem_date".into()));
        assert_eq!(add(&p, &lg, "x", "morgen", None, Some("vaak"), today), Err("err.rem_repeat".into()));
        assert_eq!(add(&p, &lg, "x", "morgen", Some("a]]b"), None, today), Err("err.rem_text".into()));
    }

    #[test]
    fn add_to_a_file_without_a_table_keeps_its_text() {
        let (p, lg) = tmp("notable");
        fs::write(&p, "# Mijn reminders\n\nNotities.\n").unwrap();
        add(&p, &lg, "x", "2026-10-01", None, None, d("2026-09-30")).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(),
            "# Mijn reminders\n\nNotities.\n\n| Date | Reminder | Source | Repeat |\n|------|----------|--------|--------|\n| 2026-10-01 | x | Relay |  |\n");
    }

    #[test]
    fn dates() {
        let t = d("2026-01-31");
        assert_eq!(parse_when("+1m", t).unwrap(), d("2026-02-28"));
        assert_eq!(parse_when("3d", t).unwrap(), d("2026-02-03"));
        assert_eq!(parse_when("2 weken", t).unwrap(), d("2026-02-14"));
        assert_eq!(parse_when("saturday", t).unwrap(), d("2026-02-07")); // 2026-01-31 is a Saturday
        assert_eq!(parse_when("2026-03-01", t).unwrap(), d("2026-03-01"));
        assert!(parse_when("", t).is_err());
        assert_eq!(next_repeat(d("2026-01-01"), "1y", t).unwrap(), d("2027-01-31"));
    }

    // the real reminders file of the vault in $VAULT, read-only: every row parses to a title
    #[test]
    fn real_vault_file() {
        let Ok(v) = std::env::var("VAULT") else { return };
        let p = Path::new(&v).join("System/reminders.md");
        if !p.is_file() { return; }
        let l = list(&p, chrono::Local::now().date_naive());
        for r in &l { println!("{} {} {:>4} {}", r["id"].as_str().unwrap(), r["date"].as_str().unwrap(), r["days"], r["title"].as_str().unwrap()); }
        assert!(l.iter().all(|r| !r["title"].as_str().unwrap().is_empty()));
    }
}
