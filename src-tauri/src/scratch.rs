// The notes drawer's old home, kept only so moving a project still carries its files: before the drawer's notes moved
// into the Inbox (inbox.rs) they were plain files in <vault>/.relay/notes/<project>/<id>.md. The drawer is gone;
// nothing reads or writes them any more.

use std::path::PathBuf;

/// The project name as a folder name: no path separators, no leading dot; empty or over 120 chars is refused.
fn folder(project: &str) -> Result<String, String> {
    if project.is_empty() || project.len() > 120 { return Err("bad project".into()); }
    let f: String = project.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    let f = f.trim_start_matches('.').to_string();
    if f.is_empty() { Err("bad project".into()) } else { Ok(f) }
}
/// The folder the notes of a project had before they moved into the Inbox.
pub fn dir(vault: &str, project: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(vault).join(".relay/notes").join(folder(project)?))
}
