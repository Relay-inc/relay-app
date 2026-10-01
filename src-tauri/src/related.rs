// Related notes: a full-text index of the vault (SQLite FTS5, in the app's data folder) and the notes that best
// match what a conversation is about. The index follows the vault by mtime on every query, so no watcher.

use crate::vault;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

// ponytail: one index for the vault last asked about; a second vault rebuilds it from scratch
static INDEX: Mutex<Option<(String, Connection)>> = Mutex::new(None);

// words that say nothing about a topic, in the languages the vault is written in
const STOP: &[&str] = &[
    "about", "after", "also", "been", "before", "being", "could", "does", "from", "have", "here", "into", "just", "like",
    "made", "make", "more", "most", "much", "need", "only", "other", "over", "same", "should", "some", "still", "such",
    "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "through", "very", "want",
    "what", "when", "where", "which", "while", "will", "with", "would", "your", "aan", "alle", "als", "ben", "bij",
    "dan", "dat", "deze", "die", "dit", "doen", "door", "een", "eens", "even", "geen", "had", "heb", "hebben", "heeft",
    "het", "hier", "hij", "hoe", "iets", "ook", "kan", "kunnen", "maar", "meer", "met", "moet", "naar", "niet", "niets",
    "nog", "omdat", "over", "tegen", "toch", "toen", "tot", "uit", "van", "veel", "voor", "waar", "wat", "wel", "werd",
    "wie", "wij", "wil", "wordt", "zal", "zich", "zijn", "zo", "zou", "zoals",
];

fn open(db: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(db)?;
    c.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(path UNINDEXED, mtime UNINDEXED, title, body,
         tokenize = 'unicode61 remove_diacritics 2');",
    )?;
    Ok(c)
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64)
}

/// Bring the index in line with the vault: new and changed notes in, deleted ones out. Returns how many changed.
fn sync(c: &mut Connection, vault: &str) -> rusqlite::Result<usize> {
    let (root, notes) = vault::notes(vault);
    let mut known: HashMap<String, i64> = c
        .prepare("SELECT path, mtime FROM docs")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let tx = c.transaction()?;
    let mut n = 0;
    for rel in notes {
        let p = Path::new(&root).join(&rel);
        let m = mtime(&p);
        if known.remove(&rel) == Some(m) { continue; }
        let body = fs::read_to_string(&p).unwrap_or_default();
        let title = rel.rsplit('/').next().unwrap_or(&rel).trim_end_matches(".md").to_string();
        tx.execute("DELETE FROM docs WHERE path = ?1", [&rel])?;
        tx.execute("INSERT INTO docs (path, mtime, title, body) VALUES (?1, ?2, ?3, ?4)", params![rel, m, title, body])?;
        n += 1;
    }
    for gone in known.keys() {
        tx.execute("DELETE FROM docs WHERE path = ?1", [gone])?;
        n += 1;
    }
    tx.commit()?;
    Ok(n)
}

/// The text's most frequent meaningful words as an FTS5 OR-query, "" when there are none.
/// ponytail: term frequency of the conversation only, no IDF on the query side; bm25 weighs the vault side
pub fn query_of(text: &str) -> String {
    let mut count: HashMap<String, usize> = HashMap::new();
    for w in text.split(|ch: char| !ch.is_alphanumeric()).map(str::to_lowercase) {
        if w.chars().count() >= 4 && !w.chars().all(|ch| ch.is_ascii_digit()) && !STOP.contains(&w.as_str()) {
            *count.entry(w).or_default() += 1;
        }
    }
    let mut words: Vec<_> = count.into_iter().collect();
    words.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    words.into_iter().take(24).map(|(w, _)| format!("\"{w}\"")).collect::<Vec<_>>().join(" OR ")
}

fn search(c: &Connection, text: &str, limit: usize) -> rusqlite::Result<Vec<Value>> {
    let q = query_of(text);
    if q.is_empty() { return Ok(vec![]); }
    // the title counts five times the body
    let mut st = c.prepare(
        "SELECT path, title, snippet(docs, 3, '', '', '…', 16) FROM docs WHERE docs MATCH ?1
         ORDER BY bm25(docs, 0, 0, 5.0, 1.0) LIMIT ?2",
    )?;
    let rows = st.query_map(params![q, limit as i64], |r| {
        Ok(json!({"path": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "snippet": r.get::<_, String>(2)?}))
    })?;
    rows.collect()
}

/// The notes in `vault` that match `text` best, [{path, title, snippet}], the index in `db` brought up to date first.
pub fn related(db: &Path, vault: &str, text: &str, limit: usize) -> Result<Vec<Value>, String> {
    let mut g = INDEX.lock().unwrap();
    if g.as_ref().map(|(v, _)| v.as_str()) != Some(vault) {
        fs::remove_file(db).ok(); // the index of another vault
        *g = Some((vault.to_string(), open(db).map_err(|e| e.to_string())?));
    }
    let c = &mut g.as_mut().unwrap().1;
    sync(c, vault).map_err(|e| e.to_string())?;
    search(c, text, limit).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_keeps_topic_words() {
        let q = query_of("Wat is de status van Spardex? Spardex portal, de customer portal en de testklanten.");
        assert!(q.starts_with("\"portal\" OR \"spardex\""), "{q}");
        assert!(!q.contains("\"status\" OR \"wat\""));
        assert!(!q.contains("\"van\""));
        assert_eq!(query_of("de en het 2026 ok"), "");
    }

    #[test]
    fn index_follows_the_vault() {
        let d = std::env::temp_dir().join(format!("relay-related-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join("Contexts/A")).unwrap();
        let v = vault::canon(d.to_str().unwrap());
        let db = d.join("index.db");
        fs::write(d.join("Contexts/A/Spardex.md"), "Customer portal voor testklanten").unwrap();
        fs::write(d.join("Contexts/A/Brutsaert.md"), "Access ERP migratie, prijscascade").unwrap();
        fs::write(d.join("Contexts/A/Other.md"), "Over de customer portal van Spardex, kort").unwrap();
        let paths = |text: &str| related(&db, &v, text, 5).unwrap().iter().map(|r| r["path"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let hits = paths("hoe zit het met de Spardex customer portal");
        assert_eq!(hits[0], "Contexts/A/Spardex.md"); // the title match wins
        assert!(hits.contains(&"Contexts/A/Other.md".to_string()));
        assert!(!hits.contains(&"Contexts/A/Brutsaert.md".to_string()));
        assert_eq!(paths("prijscascade"), vec!["Contexts/A/Brutsaert.md"]);
        // a deleted note leaves the index, a new one comes in
        fs::remove_file(d.join("Contexts/A/Brutsaert.md")).unwrap();
        fs::write(d.join("Contexts/A/Prijzen.md"), "de prijscascade per klant").unwrap();
        assert_eq!(paths("prijscascade"), vec!["Contexts/A/Prijzen.md"]);
    }

    // Kristof's real vault, read-only (index in a temp file); skipped where it does not exist
    #[test]
    fn real_vault_of_kristof() {
        let v = "/Users/kristof/vault";
        if !Path::new(v).is_dir() { return; }
        let db = std::env::temp_dir().join(format!("relay-related-real-{}.db", std::process::id()));
        let t = std::time::Instant::now();
        let hits = related(&db, &vault::canon(v), "tariefgesprek met Pieter, dagtarief en de o2o plaatsing", 8).unwrap();
        println!("{:?}", t.elapsed());
        for h in &hits { println!("{}", h["path"]); }
        assert!(!hits.is_empty());
        let t = std::time::Instant::now();
        related(&db, &vault::canon(v), "Spardex customer portal", 8).unwrap();
        println!("warm: {:?}", t.elapsed());
        fs::remove_file(db).ok();
    }
}
