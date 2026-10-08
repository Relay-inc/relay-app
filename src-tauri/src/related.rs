// The full-text index of a folder of notes (SQLite FTS5, one file per folder in the app's data folder): the vault,
// and every Commonwealth brain the Brain view shows. Related notes for a conversation, search, and each note's
// title, kind, tags and links for the graph. The index follows the folder by mtime on every query, so no watcher.

use crate::vault;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

// the open index per folder; a folder's file is named after its path
static INDEX: Mutex<Option<HashMap<String, Connection>>> = Mutex::new(None);

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
         tokenize = 'unicode61 remove_diacritics 2');
         CREATE TABLE IF NOT EXISTS meta (path TEXT PRIMARY KEY, title TEXT, kind TEXT, tags TEXT, links TEXT, hub INTEGER);",
    )?;
    Ok(c)
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64)
}

/// What the graph needs of a note: its title (frontmatter `title:`, else the file name), kind (`kind:` or `type:`),
/// tags, the notes it points at (every [[wikilink]], frontmatter included, and the ids under `relates:`), and whether
/// it is a hub that links everything (a generated index note, a contributor). Tags and links joined by newlines.
// ponytail: a line parser, not YAML, like commonwealth::read_note. Ceiling: a title in a block scalar.
pub fn parse(rel: &str, text: &str) -> (String, String, String, String, bool) {
    let stem = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_string();
    let (head, body) = text.strip_prefix("---\n").and_then(|r| r.split_once("\n---")).unwrap_or(("", text));
    let get = |k: &str| head.lines().find_map(|l| l.strip_prefix(k)?.strip_prefix(':')).map(|v| crate::commonwealth::unquote(v.trim())).unwrap_or_default();
    // the `- item` lines under a key, or its inline [a, b]
    let list = |k: &str| -> Vec<String> {
        let inline = get(k);
        if let Some(i) = inline.strip_prefix('[').and_then(|i| i.strip_suffix(']')) {
            return i.split(',').map(|x| crate::commonwealth::unquote(x.trim())).filter(|x| !x.is_empty()).collect();
        }
        if !inline.is_empty() { return vec![inline]; }
        let mut lines = head.lines().skip_while(|l| l.strip_prefix(k).and_then(|r| r.strip_prefix(':')).is_none()).skip(1);
        let mut out = vec![];
        while let Some(item) = lines.next().and_then(|l| l.trim_start().strip_prefix("- ")) { out.push(crate::commonwealth::unquote(item.trim())); }
        out
    };
    let title = Some(get("title")).filter(|t| !t.is_empty()).unwrap_or(stem);
    let kind = Some(get("kind")).filter(|k| !k.is_empty()).unwrap_or_else(|| get("type")).trim_matches(|c| c == '[' || c == ']').to_string();
    let tags = list("tags");
    let mut links: Vec<String> = list("relates");
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        rest = &rest[i + 2..];
        let Some(j) = rest.find("]]") else { break };
        let target = rest[..j].split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() && !target.contains('\n') { links.push(target.to_string()); }
        rest = &rest[j + 2..];
    }
    let hub = body.contains("> Generated index for") || (kind == "person" && tags.iter().any(|t| t == "contributor"));
    (title, kind, tags.join("\n"), links.join("\n"), hub)
}

/// Bring the index in line with the folder: new and changed notes in, deleted ones out. Returns how many changed.
/// A brain's staging/ is its review queue, not its notes, so it stays out.
fn sync(c: &mut Connection, root: &str) -> rusqlite::Result<usize> {
    let (abs, mut notes) = vault::notes(root);
    notes.retain(|n| !n.starts_with("staging/"));
    let mut known: HashMap<String, i64> = c
        .prepare("SELECT path, mtime FROM docs")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let tx = c.transaction()?;
    let mut n = 0;
    for rel in notes {
        let p = Path::new(&abs).join(&rel);
        let m = mtime(&p);
        if known.remove(&rel) == Some(m) { continue; }
        let body = fs::read_to_string(&p).unwrap_or_default();
        let (title, kind, tags, links, hub) = parse(&rel, &body);
        tx.execute("DELETE FROM docs WHERE path = ?1", [&rel])?;
        tx.execute("INSERT INTO docs (path, mtime, title, body) VALUES (?1, ?2, ?3, ?4)", params![rel, m, title, body])?;
        tx.execute("INSERT OR REPLACE INTO meta (path, title, kind, tags, links, hub) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![rel, title, kind, tags, links, hub])?;
        n += 1;
    }
    for gone in known.keys() {
        tx.execute("DELETE FROM docs WHERE path = ?1", [gone])?;
        tx.execute("DELETE FROM meta WHERE path = ?1", [gone])?;
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

fn search(c: &Connection, q: &str, limit: usize) -> rusqlite::Result<Vec<Value>> {
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

/// What someone typed as an FTS5 query: every word must be there, the last one may be half typed.
pub fn typed_query(text: &str) -> String {
    text.split(|ch: char| !ch.is_alphanumeric()).filter(|w| !w.is_empty()).map(|w| format!("\"{w}\"*")).collect::<Vec<_>>().join(" ")
}

/// Run `f` on the index of `root`, brought up to date first. The index files live in `dir`, one per folder.
fn with<T>(dir: &Path, root: &str, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let mut g = INDEX.lock().unwrap();
    let map = g.get_or_insert_with(HashMap::new);
    if !map.contains_key(root) {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let name = format!("{}.db", sha1_smol::Sha1::from(root).digest());
        map.insert(root.to_string(), open(&dir.join(name)).map_err(|e| e.to_string())?);
    }
    let c = map.get_mut(root).unwrap();
    sync(c, root).map_err(|e| e.to_string())?;
    f(c).map_err(|e| e.to_string())
}

/// The notes in `vault` that match `text` best, [{path, title, snippet}].
pub fn related(dir: &Path, vault: &str, text: &str, limit: usize) -> Result<Vec<Value>, String> {
    let q = query_of(text);
    with(dir, vault, |c| search(c, &q, limit))
}

/// The notes in `root` that match what someone typed, [{path, title, snippet}].
pub fn find(dir: &Path, root: &str, text: &str, limit: usize) -> Result<Vec<Value>, String> {
    let q = typed_query(text);
    with(dir, root, |c| search(c, &q, limit))
}

/// Every note of `root` and the links between them: {nodes: [{p, t, k, g, h}], edges: [from, to, from, to, …]}
/// (indexes into nodes, each pair once, no self links). A link resolves like Obsidian: the note's path without .md,
/// else its file name, case-insensitive; one that names no note is dropped.
pub fn graph(dir: &Path, root: &str) -> Result<Value, String> {
    with(dir, root, |c| {
        let rows: Vec<(String, String, String, String, String, bool)> = c
            .prepare("SELECT path, title, kind, tags, links, hub FROM meta ORDER BY path")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<Result<_, _>>()?;
        let mut by: HashMap<String, usize> = HashMap::new();
        for (i, (p, ..)) in rows.iter().enumerate() {
            let full = p.trim_end_matches(".md").to_lowercase();
            let stem = full.rsplit('/').next().unwrap_or(&full).to_string();
            by.entry(stem).or_insert(i);
            by.insert(full, i);
        }
        let mut seen = std::collections::HashSet::new();
        let mut edges = vec![];
        for (i, (.., links, _)) in rows.iter().enumerate() {
            for l in links.lines() {
                let l = l.trim_end_matches(".md").to_lowercase();
                let Some(&j) = by.get(&l).or_else(|| by.get(l.rsplit('/').next().unwrap_or(&l))) else { continue };
                if i != j && seen.insert((i.min(j), i.max(j))) { edges.push(i); edges.push(j); }
            }
        }
        let nodes: Vec<Value> = rows.iter().map(|(p, t, k, tags, _, h)| json!({"p": p, "t": t, "k": k, "g": tags.lines().collect::<Vec<_>>(), "h": h})).collect();
        Ok(json!({"nodes": nodes, "edges": edges}))
    })
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
        let db = d.join("index");
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
        let db = std::env::temp_dir().join(format!("relay-related-real-{}", std::process::id()));
        let t = std::time::Instant::now();
        let hits = related(&db, &vault::canon(v), "tariefgesprek met Pieter, dagtarief en de o2o plaatsing", 8).unwrap();
        println!("{:?}", t.elapsed());
        for h in &hits { println!("{}", h["path"]); }
        assert!(!hits.is_empty());
        let t = std::time::Instant::now();
        related(&db, &vault::canon(v), "Spardex customer portal", 8).unwrap();
        println!("warm: {:?}", t.elapsed());
        fs::remove_dir_all(db).ok();
    }

    /// cargo test real_graphs -- --ignored --nocapture: the user's own vault and brain, index in a temp folder
    #[test]
    #[ignore]
    fn real_graphs() {
        let home = std::env::var("HOME").unwrap();
        let db = std::env::temp_dir().join(format!("relay-graph-real-{}", std::process::id()));
        for r in [format!("{home}/vault"), format!("{home}/projects/antenna-brain")] {
            let t = std::time::Instant::now();
            let g = graph(&db, &vault::canon(&r)).unwrap();
            let hubs = g["nodes"].as_array().unwrap().iter().filter(|n| n["h"] == true).count();
            println!("{r}: {} nodes, {} edges, {hubs} hubs, {:?}", g["nodes"].as_array().unwrap().len(), g["edges"].as_array().unwrap().len() / 2, t.elapsed());
            let t = std::time::Instant::now();
            graph(&db, &vault::canon(&r)).unwrap();
            println!("  warm {:?}", t.elapsed());
        }
        fs::remove_dir_all(db).ok();
    }

    #[test]
    fn a_note_parses_into_title_kind_tags_and_links() {
        let brain = "---\nid: x-1\nkind: memory\ntitle: 'It''s done'\ntags:\n  - spardex\n  - dms\nrelates:\n  - contributor-k\n---\nSee [[Other note|the other]] and [[a/b#Head]].\n";
        let (title, kind, tags, links, hub) = parse("memory/x-1.md", brain);
        assert_eq!((title.as_str(), kind.as_str(), tags.as_str(), hub), ("It's done", "memory", "spardex\ndms", false));
        assert_eq!(links, "contributor-k\nOther note\na/b");
        let vault = "---\ntype: Meeting\ncontext: \"[[Antenna]]\"\ntags: [a, b]\n---\n# Hi\n";
        assert_eq!(parse("Calendar/2026-10-08 Sync.md", vault), ("2026-10-08 Sync".into(), "Meeting".into(), "a\nb".into(), "Antenna".into(), false));
        assert!(parse("spardex/Spardex.md", "# Spardex\n\n> Generated index for `spardex`.\n").4);
    }

    #[test]
    fn typed_words_must_all_match_the_last_may_be_half() {
        assert_eq!(typed_query("spardex dm"), "\"spardex\"* \"dm\"*");
        assert_eq!(typed_query("  \"; "), "");
    }

    #[test]
    fn the_graph_links_by_path_and_by_name_and_leaves_staging_out() {
        let d = std::env::temp_dir().join(format!("relay-graph-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join("a")).unwrap();
        fs::create_dir_all(d.join("staging")).unwrap();
        fs::write(d.join("a/One.md"), "links [[Two]] and [[a/Three|3]] and [[Nowhere]] and [[two]] again").unwrap();
        fs::write(d.join("Two.md"), "back to [[One]]").unwrap();
        fs::write(d.join("a/Three.md"), "alone").unwrap();
        fs::write(d.join("staging/S.md"), "[[One]]").unwrap();
        let root = vault::canon(d.to_str().unwrap());
        let g = graph(&d.join(".idx"), &root).unwrap();
        let names: Vec<&str> = g["nodes"].as_array().unwrap().iter().map(|n| n["p"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["Two.md", "a/One.md", "a/Three.md"]);
        assert_eq!(g["edges"], json!([0, 1, 1, 2])); // One-Two once, One-Three; Nowhere dropped
        assert_eq!(find(&d.join(".idx"), &root, "alo", 5).unwrap()[0]["path"], "a/Three.md");
    }
}
