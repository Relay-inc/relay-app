// New notes from the vault's templates (`Resources/Templates/`): a note of a type that has a home (types.rs: meeting,
// thread, daily by default) is saved there, any other where it was asked for. `context:` and `about:` come from where it was asked,
// the date and the title from today and the note's name; Templater tags Relay does not know stay as text. The daily
// note is the one note a day: opened when it is there, made once when not.

use crate::vault::rel_to as rel;
use crate::{homes, projects, vault};
use std::fs;
use std::path::{Path, PathBuf};

const DIR: &str = "Resources/Templates";

/// The templates New offers, by name: every note of the templates folder except the ones New project and New context
/// make notes from.
pub fn list(vault: &str) -> Vec<String> {
    let mut l: Vec<String> = fs::read_dir(Path::new(vault).join(DIR)).into_iter().flatten().flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".md").map(String::from))
        .filter(|n| !n.starts_with('.') && n != "Context" && n != "Daily" && !projects::KINDS.contains(&n.as_str())).collect();
    l.sort_by_key(|n| n.to_lowercase());
    l
}

/// A name with nothing a file name or a link can't take.
fn safe(name: &str) -> String {
    name.chars().filter(|c| !"/\\:[]|#^".contains(*c) && !c.is_control()).collect::<String>().trim().to_string()
}
/// A template filled in for `name`: its date and title tags, `lastSync:` (a sync plugin's stamp on the template itself)
/// out, `about:` and `context:` set when known.
fn note_text(raw: &str, name: &str, today: &str, about: &str, context: &str) -> String {
    let text = projects::fill(raw, name, today);
    let text = regex::Regex::new(r"(?m)^lastSync:.*\n").unwrap().replace(&text, "").into_owned();
    let text = if context.is_empty() { text } else { projects::set_field(&text, "context", &format!("\"[[{context}]]\"")) };
    if about.is_empty() { text } else { projects::set_field(&text, "about", &format!("\"[[{about}]]\"")) }
}
/// `dir/name.md`, `dir/name 2.md`… the first that is free.
fn free(dir: &Path, name: &str) -> (String, PathBuf) {
    (1..).map(|i| if i == 1 { name.to_string() } else { format!("{name} {i}") }).map(|n| (dir.join(format!("{n}.md")), n)).find(|(p, _)| !p.exists()).map(|(p, n)| (n, p)).unwrap()
}

/// A new note from `template`, for `folder` (relative to the vault, "" the top) when its type has no home. `title` names
/// it when given (a note in a home keeps its day and project in front of it), else the template does; a name that is
/// taken gets a number, nothing is overwritten. Returns the note's path relative to the vault.
pub fn create(vault: &Path, template: &str, folder: &str, about: &str, context: &str, title: &str, today: &str) -> Result<String, String> {
    let v = vault.to_string_lossy();
    if !list(&v).iter().any(|n| n == template) { return Err(format!("no template {template}")); }
    let raw = fs::read_to_string(vault.join(DIR).join(format!("{template}.md"))).map_err(|e| e.to_string())?;
    let kind = vault::split(&raw).and_then(|(fm, _)| vault::field(fm, "type")).unwrap_or_else(|| template.to_string());
    let types = crate::types::load(vault);
    let home = types.home_of(&kind, today);
    let (about, context, title) = (safe(about), safe(context), safe(title));
    let title = if title.is_empty() { template } else { &title };
    let dir = match home {
        Some(h) => homes::home(vault, h, homes::year_of(today).ok_or("not a day")?),
        None => {
            if folder.split('/').any(|s| s == ".." || s.starts_with('.')) || folder.starts_with('/') { return Err(format!("not a folder of the vault: {folder}")); }
            vault.join(folder)
        }
    };
    let base = match (home.is_some(), about.is_empty()) {
        (true, true) => format!("{today} {title}"),
        (true, false) => format!("{today} {about} {title}"),
        (false, _) => title.to_string(),
    };
    let (name, path) = free(&dir, &base);
    let mut text = note_text(&raw, &name, today, &about, &context);
    // a dated note says its day
    if home.is_some() { text = projects::set_field(&text, "date", today); }
    projects::write_new(&path, &text)?;
    Ok(rel(vault, &path))
}

/// Today's note, `<daily home>/<day>.md`: the path of the one that is there, else the note made from the vault's Daily
/// template (a plain one with its type and day when there is none).
pub fn daily(vault: &Path, today: &str) -> Result<String, String> {
    let path = homes::home(vault, "daily", homes::year_of(today).ok_or("not a day")?).join(format!("{today}.md"));
    if !path.exists() {
        let text = fs::read_to_string(vault.join(DIR).join("Daily.md")).map(|raw| note_text(&raw, today, today, "", ""))
            .unwrap_or_else(|_| format!("---\ntype: Daily\ncreated: {today}\n---\n"));
        // two clicks at once: the second finds the first's note
        match projects::write_new(&path, &text) { Ok(()) => {} Err(_) if path.exists() => {} Err(e) => return Err(e) }
    }
    Ok(rel(vault, &path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-templates-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join(DIR)).unwrap();
        fs::canonicalize(d).unwrap()
    }
    fn w(root: &Path, rel: &str, body: &str) { let p = root.join(rel); fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, body).unwrap(); }
    fn r(root: &Path, rel: &str) -> String { fs::read_to_string(root.join(rel)).unwrap() }

    #[test]
    fn a_meeting_goes_to_its_home_with_about_context_and_date() {
        let v = vault("meeting");
        w(&v, "Resources/Templates/Meeting.md", "---\nlastSync: x\ntype: Meeting\ncontext:\nabout:\ndate: <% tp.date.now(\"YYYY-MM-DD\") %>\nwith:\n---\n# <% tp.file.title %>\n\n<%* await tp.system.prompt() %>\n");
        w(&v, "Resources/Templates/Document.md", "---\ntype: Document\n---\n");
        w(&v, "Resources/Templates/Project.md", "---\ntype: Project\n---\n");
        assert_eq!(list(&v.to_string_lossy()), ["Document", "Meeting"]);
        let p = create(&v, "Meeting", "Contexts/Studio/Beacon", "Beacon", "Studio", "", "2026-11-04").unwrap();
        assert_eq!(p, "Calendar/Meetings/2026/2026-11-04 Beacon Meeting.md");
        let t = r(&v, &p);
        assert!(t.contains("about: \"[[Beacon]]\"") && t.contains("context: \"[[Studio]]\"") && t.contains("date: 2026-11-04"), "{t}");
        assert!(!t.contains("lastSync") && t.contains("# 2026-11-04 Beacon Meeting"), "{t}");
        assert!(t.contains("<%* await tp.system.prompt() %>"), "a tag Relay does not know stays text");
        // a second one the same day does not take the first's place
        assert_eq!(create(&v, "Meeting", "", "Beacon", "Studio", "", "2026-11-04").unwrap(), "Calendar/Meetings/2026/2026-11-04 Beacon Meeting 2.md");
        // a type without a home goes where it was asked for
        assert_eq!(create(&v, "Document", "Contexts/Studio/Beacon/Documents", "Beacon", "Studio", "", "2026-11-04").unwrap(), "Contexts/Studio/Beacon/Documents/Document.md");
        assert!(r(&v, "Contexts/Studio/Beacon/Documents/Document.md").contains("about: \"[[Beacon]]\""));
        // a title names the note, in a home and out of it; one that is taken gets a number, never replaces
        assert_eq!(create(&v, "Meeting", "", "Beacon", "Studio", "Kickoff", "2026-11-04").unwrap(), "Calendar/Meetings/2026/2026-11-04 Beacon Kickoff.md");
        assert_eq!(create(&v, "Meeting", "", "Beacon", "Studio", "Kickoff", "2026-11-04").unwrap(), "Calendar/Meetings/2026/2026-11-04 Beacon Kickoff 2.md");
        assert!(r(&v, "Calendar/Meetings/2026/2026-11-04 Beacon Kickoff.md").contains("# 2026-11-04 Beacon Kickoff\n"), "the first is untouched");
        assert_eq!(create(&v, "Document", "Contexts/Studio/Beacon/Documents", "Beacon", "Studio", "Sofie/Claes: brief", "2026-11-04").unwrap(), "Contexts/Studio/Beacon/Documents/SofieClaes brief.md");
        // not a template, not a folder outside the vault
        assert!(create(&v, "../Secrets", "", "", "", "", "2026-11-04").is_err());
        assert!(create(&v, "Document", "../out", "", "", "", "2026-11-04").is_err());
    }

    #[test]
    fn the_vaults_home_decides_and_the_daily_note_is_made_once() {
        let v = vault("daily");
        w(&v, ".relay/config.json", r#"{"homes":{"meeting":"Meetings/{yyyy}"}}"#);
        w(&v, "Resources/Templates/Meeting.md", "---\ntype: Meeting\n---\n");
        assert_eq!(create(&v, "Meeting", "", "", "", "", "2027-01-05").unwrap(), "Meetings/2027/2027-01-05 Meeting.md");
        // no Daily template: a plain note
        assert_eq!(daily(&v, "2026-11-04").unwrap(), "Calendar/Daily/2026/2026-11-04.md");
        assert_eq!(r(&v, "Calendar/Daily/2026/2026-11-04.md"), "---\ntype: Daily\ncreated: 2026-11-04\n---\n");
        // edited by the user, opened again: the same note, untouched
        w(&v, "Calendar/Daily/2026/2026-11-04.md", "mine");
        assert_eq!(daily(&v, "2026-11-04").unwrap(), "Calendar/Daily/2026/2026-11-04.md");
        assert_eq!(r(&v, "Calendar/Daily/2026/2026-11-04.md"), "mine");
        // with a Daily template
        w(&v, "Resources/Templates/Daily.md", "---\ntype: Daily\ndate: {{date:YYYY-MM-DD}}\n---\n# {{title}}\n");
        assert_eq!(daily(&v, "2026-11-05").unwrap(), "Calendar/Daily/2026/2026-11-05.md");
        assert_eq!(r(&v, "Calendar/Daily/2026/2026-11-05.md"), "---\ntype: Daily\ndate: 2026-11-05\n---\n# 2026-11-05\n");
        assert!(daily(&v, "nope").is_err());
    }
}
