// Where a note of a kind goes: one folder per kind, so Relay, the prompts and the vault check agree on it instead of
// each agent picking a place. A vault sets its own in `.relay/config.json` under `homes` ({"meeting": "Meetings/{yyyy}"});
// `{yyyy}` is the note's year. Attachments follow Obsidian's attachment folder when the vault sets one there.

use std::path::{Path, PathBuf};

const DEFAULTS: [(&str, &str); 4] = [
    ("meeting", "Calendar/Meetings/{yyyy}"),
    ("daily", "Calendar/Daily/{yyyy}"),
    ("thread", "Calendar/Threads/{yyyy}"),
    ("attachments", "Attachments/{yyyy}"),
];

/// A folder relative to the vault, or None: no absolute path, no `..`, nothing hidden.
fn clean(p: &str) -> Option<String> {
    let p = p.trim().trim_matches('/');
    let ok = !p.is_empty() && p.split('/').all(|s| !s.is_empty() && !s.starts_with('.'));
    ok.then(|| p.to_string())
}

/// Obsidian's attachmentFolderPath, when it names a folder in the vault (not "./" relative to the note).
fn obsidian_attachments(vault: &Path) -> Option<String> {
    let app = std::fs::read_to_string(vault.join(".obsidian/app.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&app).ok()?;
    clean(v["attachmentFolderPath"].as_str()?)
}

/// The folder notes of `kind` go into, for a note of `year` (YYYY). Not created here.
pub fn home(vault: &Path, kind: &str, year: &str) -> PathBuf {
    let set = crate::relay_config::load(&vault.to_string_lossy()).and_then(|c| c["homes"][kind].as_str().and_then(clean));
    let set = set.or_else(|| if kind == "attachments" { obsidian_attachments(vault) } else { None });
    let folder = set.or_else(|| DEFAULTS.iter().find(|(k, _)| *k == kind).map(|(_, v)| v.to_string())).unwrap_or_default();
    vault.join(folder.replace("{yyyy}", year))
}

/// The year of a day (YYYY-MM-DD), None for anything else.
pub fn year_of(day: &str) -> Option<&str> { day.get(..4).filter(|y| y.chars().all(|c| c.is_ascii_digit())) }

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp { fn path(&self) -> &Path { &self.0 } }
    impl Drop for Tmp { fn drop(&mut self) { std::fs::remove_dir_all(&self.0).ok(); } }
    fn vault() -> Tmp {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("relay-homes-{}-{n}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        Tmp(d)
    }

    #[test]
    fn defaults_per_kind_with_the_year() {
        let d = vault();
        assert_eq!(home(d.path(), "meeting", "2026"), d.path().join("Calendar/Meetings/2026"));
        assert_eq!(home(d.path(), "attachments", "2026"), d.path().join("Attachments/2026"));
        assert_eq!(home(d.path(), "daily", "2026"), d.path().join("Calendar/Daily/2026"));
        assert_eq!(home(d.path(), "thread", "2025"), d.path().join("Calendar/Threads/2025"));
    }

    #[test]
    fn the_vaults_config_wins_and_obsidian_sets_attachments() {
        let d = vault();
        std::fs::create_dir_all(d.path().join(".obsidian")).unwrap();
        std::fs::write(d.path().join(".obsidian/app.json"), r#"{"attachmentFolderPath":"Resources/Attachments"}"#).unwrap();
        assert_eq!(home(d.path(), "attachments", "2026"), d.path().join("Resources/Attachments"));
        std::fs::create_dir_all(d.path().join(".relay")).unwrap();
        std::fs::write(d.path().join(".relay/config.json"), r#"{"homes":{"meeting":"Meetings/{yyyy}","attachments":"../out"}}"#).unwrap();
        assert_eq!(home(d.path(), "meeting", "2027"), d.path().join("Meetings/2027"));
        // a folder outside the vault is ignored: Obsidian's, then
        assert_eq!(home(d.path(), "attachments", "2026"), d.path().join("Resources/Attachments"));
    }

    #[test]
    fn a_year_is_four_digits() {
        assert_eq!(year_of("2026-11-04"), Some("2026"));
        assert_eq!(year_of("../x"), None);
        assert_eq!(year_of("20"), None);
    }
}
