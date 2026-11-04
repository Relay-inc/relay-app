// The full-text index of a folder of notes (SQLite FTS5, one file per folder in the app's data folder): the vault
// and the other workspaces. Related notes for a conversation, and each note's
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

// words that say nothing about a topic, in the languages the vault is written in (English, then Dutch; the meeting
// recorder also tells the two apart by them, see meeting.rs)
pub(crate) const STOP_EN: &[&str] = &[
    "about", "after", "also", "been", "before", "being", "could", "does", "from", "have", "here", "into", "just", "like",
    "made", "make", "more", "most", "much", "need", "only", "other", "over", "same", "should", "some", "still", "such",
    "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "through", "very", "want",
    "what", "when", "where", "which", "while", "will", "with", "would", "your",
];
pub(crate) const STOP_NL: &[&str] = &[
    "aan", "alle", "als", "ben", "bij",
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
    // an index made before `refs` existed: add the column and let the next sync read every note again
    if c.prepare("SELECT refs FROM meta LIMIT 0").is_err() {
        c.execute_batch("ALTER TABLE meta ADD COLUMN refs TEXT; DELETE FROM docs;")?;
    }
    Ok(c)
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64)
}

/// What the graph needs of a note: its title (frontmatter `title:`, else the file name), kind (`kind:` or `type:`),
/// tags, the notes it points at (every [[wikilink]], frontmatter included, and the ids under `relates:`), and whether
/// it is a hub that links everything (a generated index note, a contributor). Tags and links joined by newlines.
// ponytail: a line parser, not YAML. Ceiling: a title in a block scalar.
pub fn parse(rel: &str, text: &str) -> (String, String, String, String, bool) {
    let stem = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_string();
    let (head, body) = text.strip_prefix("---\n").and_then(|r| r.split_once("\n---")).unwrap_or(("", text));
    let get = |k: &str| head.lines().find_map(|l| l.strip_prefix(k)?.strip_prefix(':')).map(|v| vault::unquote(v.trim())).unwrap_or_default();
    // the `- item` lines under a key, or its inline [a, b]
    let list = |k: &str| -> Vec<String> {
        let inline = get(k);
        if let Some(i) = inline.strip_prefix('[').and_then(|i| i.strip_suffix(']')) {
            return i.split(',').map(|x| vault::unquote(x.trim())).filter(|x| !x.is_empty()).collect();
        }
        if !inline.is_empty() { return vec![inline]; }
        let mut lines = head.lines().skip_while(|l| l.strip_prefix(k).and_then(|r| r.strip_prefix(':')).is_none()).skip(1);
        let mut out = vec![];
        while let Some(item) = lines.next().and_then(|l| l.trim_start().strip_prefix("- ")) { out.push(vault::unquote(item.trim())); }
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

/// The notes a note points at through the frontmatter keys `about:`, `context:` and `with:`, as the names they link by
/// (`[[Beacon|alias]]` gives Beacon): a plain string, an inline or block list, a wikilink, quoted or not (YAML reads
/// an unquoted `[[Beacon]]` as a list in a list, which is why this scans the value instead). Plus what a meeting row
/// shows: the date, the stage, and a person's role. As JSON: {about, context, with, date, stage, role}.
// ponytail: a value scanner, not a YAML parser (the workspace has none). Ceiling: a value that is a mapping, or a
// list item with a comma in a plain (unlinked) name.
pub fn refs(rel: &str, text: &str) -> String {
    let (head, body) = text.strip_prefix("---\n").and_then(|r| r.split_once("\n---")).unwrap_or(("", text));
    let key = |k: &str| -> Vec<String> {
        let mut lines = head.lines();
        let Some(first) = lines.find_map(|l| l.strip_prefix(k)?.strip_prefix(':')) else { return vec![] };
        let mut value = first.to_string();
        for l in lines.take_while(|l| l.starts_with([' ', '\t']) || l.starts_with("- ")) { value.push('\n'); value.push_str(l); }
        let mut out = vec![];
        if value.contains("[[") {
            let mut rest = value.as_str();
            while let Some(i) = rest.find("[[") {
                rest = &rest[i + 2..];
                let Some(j) = rest.find("]]") else { break };
                let target = rest[..j].split(['|', '#']).next().unwrap_or("").trim();
                if !target.is_empty() { out.push(target.to_string()); }
                rest = &rest[j + 2..];
            }
        } else {
            for part in value.split([',', '\n']) {
                let part = part.trim().trim_start_matches("- ").trim().trim_matches(['[', ']']).trim();
                let part = vault::unquote(part);
                if !part.is_empty() { out.push(part); }
            }
        }
        out
    };
    let get = |k: &str| key(k).into_iter().next().unwrap_or_default();
    let stem = rel.rsplit('/').next().unwrap_or(rel);
    let date = Some(get("date")).filter(|d| !d.is_empty()).unwrap_or_else(|| {
        let d = stem.get(..10).unwrap_or("");
        if d.len() == 10 && d.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() }) { d.to_string() } else { String::new() }
    });
    let kind = get("type").to_lowercase();
    // the stages a note can show (a live one is the recording, which the index does not know): as meetingStage in rules.ts
    let stage = if kind != "meeting" { "" }
        else if body.lines().any(|l| l.trim_end_matches([' ', '\t']) == "## Summary") { "wrapped" }
        else if body.split_once("\n## Briefing").is_some_and(|(_, r)| r.lines().skip(1).take_while(|l| !l.starts_with("# ") && !l.starts_with("## ")).any(|l| !l.trim().is_empty())) { "briefed" }
        else { "planned" };
    json!({"about": key("about"), "context": key("context"), "with": key("with"), "date": date, "stage": stage, "role": get("role")}).to_string()
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
        let refs = refs(&rel, &body);
        tx.execute("DELETE FROM docs WHERE path = ?1", [&rel])?;
        tx.execute("INSERT INTO docs (path, mtime, title, body) VALUES (?1, ?2, ?3, ?4)", params![rel, m, title, body])?;
        tx.execute("INSERT OR REPLACE INTO meta (path, title, kind, tags, links, hub, refs) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![rel, title, kind, tags, links, hub, refs])?;
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
        if w.chars().count() >= 4 && !w.chars().all(|ch| ch.is_ascii_digit()) && !STOP_EN.contains(&w.as_str()) && !STOP_NL.contains(&w.as_str()) {
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

/// The notes of `root` that point at another through `about:`, `context:` or `with:`:
/// [{p, t, k, at, about, context, with, date, stage, role}], `at` the file's mtime in seconds. The Pages tree's virtual
/// groups and a project page's auto sections are built from it on the frontend.
pub fn linked(dir: &Path, root: &str) -> Result<Value, String> {
    with(dir, root, |c| {
        let mut st = c.prepare(
            "SELECT m.path, m.title, m.kind, d.mtime, m.refs FROM meta m JOIN docs d ON d.path = m.path WHERE m.refs IS NOT NULL ORDER BY m.path",
        )?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?)))?;
        let mut out = vec![];
        for row in rows {
            let (p, t, k, at, refs) = row?;
            let Ok(mut v) = serde_json::from_str::<Value>(&refs) else { continue };
            if ["about", "context", "with"].iter().all(|key| v[key].as_array().is_none_or(|a| a.is_empty())) { continue; }
            v["p"] = json!(p); v["t"] = json!(t); v["k"] = json!(k); v["at"] = json!(at);
            out.push(v);
        }
        Ok(Value::from(out))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_keeps_topic_words() {
        let q = query_of("Wat is de status van Vantage? Vantage portal, de customer portal en de testklanten.");
        assert!(q.starts_with("\"portal\" OR \"vantage\""), "{q}");
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
        fs::write(d.join("Contexts/A/Northwind.md"), "Customer portal voor testklanten").unwrap();
        fs::write(d.join("Contexts/A/Bramwell.md"), "Access ERP migratie, prijscascade").unwrap();
        fs::write(d.join("Contexts/A/Other.md"), "Over de customer portal van Northwind, kort").unwrap();
        let paths = |text: &str| related(&db, &v, text, 5).unwrap().iter().map(|r| r["path"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let hits = paths("hoe zit het met de Northwind customer portal");
        assert_eq!(hits[0], "Contexts/A/Northwind.md"); // the title match wins
        assert!(hits.contains(&"Contexts/A/Other.md".to_string()));
        assert!(!hits.contains(&"Contexts/A/Bramwell.md".to_string()));
        assert_eq!(paths("prijscascade"), vec!["Contexts/A/Bramwell.md"]);
        // a deleted note leaves the index, a new one comes in
        fs::remove_file(d.join("Contexts/A/Bramwell.md")).unwrap();
        fs::write(d.join("Contexts/A/Prijzen.md"), "de prijscascade per klant").unwrap();
        assert_eq!(paths("prijscascade"), vec!["Contexts/A/Prijzen.md"]);
    }

    // Alex's real vault, read-only (index in a temp file); skipped where it does not exist
    #[test]
    fn real_vault_of_maintainer() {
        let v = "/Users/alex/vault";
        if !Path::new(v).is_dir() { return; }
        let db = std::env::temp_dir().join(format!("relay-related-real-{}", std::process::id()));
        let t = std::time::Instant::now();
        let hits = related(&db, &vault::canon(v), "tariefgesprek met Sofie, dagtarief en de a2a plaatsing", 8).unwrap();
        println!("{:?}", t.elapsed());
        for h in &hits { println!("{}", h["path"]); }
        assert!(!hits.is_empty());
        let t = std::time::Instant::now();
        related(&db, &vault::canon(v), "Northwind customer portal", 8).unwrap();
        println!("warm: {:?}", t.elapsed());
        fs::remove_dir_all(db).ok();
    }

    /// cargo test real_graphs -- --ignored --nocapture: the user's own vault and brain, index in a temp folder
    #[test]
    #[ignore]
    fn real_graphs() {
        let home = std::env::var("HOME").unwrap();
        let db = std::env::temp_dir().join(format!("relay-graph-real-{}", std::process::id()));
        for r in [format!("{home}/vault"), format!("{home}/projects/bluebird-brain")] {
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
        let brain = "---\nid: x-1\nkind: memory\ntitle: 'It''s done'\ntags:\n  - northwind\n  - dms\nrelates:\n  - contributor-k\n---\nSee [[Other note|the other]] and [[a/b#Head]].\n";
        let (title, kind, tags, links, hub) = parse("memory/x-1.md", brain);
        assert_eq!((title.as_str(), kind.as_str(), tags.as_str(), hub), ("It's done", "memory", "northwind\ndms", false));
        assert_eq!(links, "contributor-k\nOther note\na/b");
        let vault = "---\ntype: Meeting\ncontext: \"[[Bluebird]]\"\ntags: [a, b]\n---\n# Hi\n";
        assert_eq!(parse("Calendar/2026-10-08 Sync.md", vault), ("2026-10-08 Sync".into(), "Meeting".into(), "a\nb".into(), "Bluebird".into(), false));
        assert!(parse("northwind/Northwind.md", "# Northwind\n\n> Generated index for `northwind`.\n").4);
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
    }

    #[test]
    fn refs_read_a_string_a_list_and_a_wikilink() {
        let r = |head: &str| -> Value { serde_json::from_str(&refs("Calendar/Meetings/2026/2026-11-04 Sync.md", &format!("---\n{head}\n---\n"))).unwrap() };
        assert_eq!(r("about: [[Beacon]]")["about"], json!(["Beacon"])); // YAML would read a list in a list
        assert_eq!(r("about: \"[[Beacon|the app]]\"")["about"], json!(["Beacon"]));
        assert_eq!(r("about: Beacon")["about"], json!(["Beacon"]));
        assert_eq!(r("about: [Beacon, 'Harbor']")["about"], json!(["Beacon", "Harbor"]));
        assert_eq!(r("about:\n  - \"[[Beacon]]\"\n  - \"[[Harbor#Plan]]\"\ncontext: x")["about"], json!(["Beacon", "Harbor"]));
        assert_eq!(r("with: [[Sam Peeters]], [[Noor]]")["with"], json!(["Sam Peeters", "Noor"]));
        assert_eq!(r("with:\n  - Sam Peeters\n  - Noor\nabout: [[Beacon]]")["with"], json!(["Sam Peeters", "Noor"]));
        assert_eq!(r("context: \"[[Studio]]\"")["context"], json!(["Studio"]));
        assert_eq!(r("type: Meeting")["about"], json!([]));
        assert_eq!(r("type: Meeting")["date"], "2026-11-04"); // from the file name
        assert_eq!(r("type: Person\nrole: Developer")["role"], "Developer");
    }

    #[test]
    fn a_meetings_stage_follows_its_note() {
        let stage = |body: &str| -> String { serde_json::from_str::<Value>(&refs("2026-11-04 Sync.md", &format!("---\ntype: Meeting\n---\n{body}"))).unwrap()["stage"].as_str().unwrap().to_string() };
        assert_eq!(stage("# Sync\n\n## Notes\n- \n"), "planned");
        assert_eq!(stage("# Sync\n\n## Briefing\n\n## Notes\n"), "planned"); // an empty briefing
        assert_eq!(stage("# Sync\n\n## Briefing\nGoal: x\n\n## Notes\n"), "briefed");
        assert_eq!(stage("# Sync\n\n## Briefing\nGoal: x\n\n## Summary\n- done\n"), "wrapped");
    }

    #[test]
    fn linked_lists_the_notes_that_point_somewhere_and_follows_edits() {
        let d = std::env::temp_dir().join(format!("relay-linked-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join("Calendar/Meetings/2026")).unwrap();
        fs::create_dir_all(d.join("Beacon")).unwrap();
        fs::write(d.join("Calendar/Meetings/2026/2026-11-04 Beacon sync.md"), "---\ntype: Meeting\nabout: [[Beacon]]\nwith: [[Sam Peeters]]\n---\n## Summary\n").unwrap();
        fs::write(d.join("Beacon/Beacon.md"), "---\ntype: Project\n---\nHome").unwrap();
        let root = vault::canon(d.to_str().unwrap());
        let idx = d.join(".idx");
        let l = linked(&idx, &root).unwrap();
        assert_eq!(l.as_array().unwrap().len(), 1);
        assert_eq!(l[0]["p"], "Calendar/Meetings/2026/2026-11-04 Beacon sync.md");
        assert_eq!(l[0]["about"], json!(["Beacon"]));
        assert_eq!(l[0]["stage"], "wrapped");
        // a new note joins, an old index without refs is rebuilt
        fs::write(d.join("Calendar/Other.md"), "---\ntype: Thread\nabout: Beacon\n---\n").unwrap();
        assert_eq!(linked(&idx, &root).unwrap().as_array().unwrap().len(), 2);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_index_without_refs_is_rebuilt() {
        let f = std::env::temp_dir().join(format!("relay-old-index-{}.db", std::process::id()));
        fs::remove_file(&f).ok();
        let old = Connection::open(&f).unwrap();
        old.execute_batch("CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, mtime UNINDEXED, title, body);
            CREATE TABLE meta (path TEXT PRIMARY KEY, title TEXT, kind TEXT, tags TEXT, links TEXT, hub INTEGER);
            INSERT INTO docs VALUES ('a.md', 1, 'a', 'b');").unwrap();
        drop(old);
        let c = open(&f).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM docs", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        c.prepare("SELECT refs FROM meta").unwrap();
        drop(c);
        fs::remove_file(&f).ok();
    }
}
