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
// when each folder's index last matched the folder; `touched` (the watcher saw a change) forgets them
static SYNCED: Mutex<Option<HashMap<String, std::time::Instant>>> = Mutex::new(None);
// a change the watcher misses (a folder it does not watch) is picked up after this long
const RESYNC: std::time::Duration = std::time::Duration::from_secs(10);

/// `file` changed (or was added, moved or removed): the next query of the folder it is in walks the folder again.
pub fn touched(file: &Path) {
    if let Some(m) = SYNCED.lock().unwrap().as_mut() { m.retain(|root, _| !file.starts_with(root)); }
}

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
    // an index made before `props` existed: the same
    if c.prepare("SELECT props FROM meta LIMIT 0").is_err() {
        c.execute_batch("ALTER TABLE meta ADD COLUMN props TEXT; DELETE FROM docs;")?;
    }
    Ok(c)
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64)
}

/// The `- item` lines under a key, or its inline [a, b].
fn fm_list(head: &str, k: &str) -> Vec<String> {
    let inline = vault::field(head, k).unwrap_or_default();
    if let Some(i) = inline.strip_prefix('[').and_then(|i| i.strip_suffix(']')) {
        return i.split(',').map(|x| vault::unquote(x.trim())).filter(|x| !x.is_empty()).collect();
    }
    if !inline.is_empty() { return vec![inline]; }
    let mut lines = head.lines().skip_while(|l| l.strip_prefix(k).and_then(|r| r.strip_prefix(':')).is_none()).skip(1);
    let mut out = vec![];
    while let Some(item) = lines.next().and_then(|l| l.trim_start().strip_prefix("- ")) { out.push(vault::unquote(item.trim())); }
    out
}

/// What the graph needs of a note: its title (frontmatter `title:`, else the file name), kind (`kind:` or `type:`),
/// tags, the notes it points at (every [[wikilink]], frontmatter included, and the ids under `relates:`), and whether
/// it is a hub that links everything (a generated index note, a contributor). Tags and links joined by newlines.
// ponytail: a line parser, not YAML. Ceiling: a title in a block scalar.
pub fn parse(rel: &str, text: &str) -> (String, String, String, String, bool) {
    let stem = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_string();
    let (head, body) = vault::split(text).unwrap_or(("", text));
    let get = |k: &str| vault::field(head, k).unwrap_or_default();
    let list = |k: &str| fm_list(head, k);
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
    let (head, body) = vault::split(text).unwrap_or(("", text));
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

/// Every frontmatter key of a note with its values, for the collections' columns and filters: JSON `{key: [value]}`.
/// A scalar is one value, a list its items, a `[[Beacon|alias]]` link the name it links by; an empty key is left out.
// ponytail: a line scanner like `refs`, not YAML. Ceiling: a nested mapping (its lines are skipped), a plain scalar
// with `[[` in the middle of a sentence (read as links).
pub fn props(text: &str) -> String {
    let head = vault::split(text).map_or("", |(h, _)| h);
    let mut out = serde_json::Map::new();
    let mut lines = head.lines().peekable();
    while let Some(line) = lines.next() {
        if line.starts_with([' ', '\t', '-', '#']) { continue; }
        let Some((key, first)) = line.split_once(':') else { continue };
        let key = key.trim();
        if key.is_empty() { continue; }
        let mut block = vec![];
        while let Some(next) = lines.peek() {
            if !(next.starts_with([' ', '\t']) || next.starts_with("- ")) { break; }
            block.push(next.trim_start().trim_start_matches("- ").trim().to_string());
            lines.next();
        }
        let first = first.trim();
        let mut values: Vec<String> = vec![];
        let mut add = |raw: &str| {
            if raw.contains("[[") {
                let mut rest = raw;
                while let Some(i) = rest.find("[[") {
                    rest = &rest[i + 2..];
                    let Some(j) = rest.find("]]") else { break };
                    let target = rest[..j].split(['|', '#']).next().unwrap_or("").trim();
                    if !target.is_empty() { values.push(target.to_string()); }
                    rest = &rest[j + 2..];
                }
            } else {
                let v = vault::unquote(raw.trim());
                if !v.is_empty() { values.push(v); }
            }
        };
        if let Some(inner) = first.strip_prefix('[').filter(|f| !f.starts_with('[')).and_then(|f| f.strip_suffix(']')) {
            for item in inner.split(',') { add(item); }
        } else if !first.is_empty() { add(first); }
        for item in &block { add(item); }
        if !values.is_empty() { out.insert(key.to_string(), json!(values)); }
    }
    Value::Object(out).to_string()
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
        let props = props(&body);
        tx.execute("DELETE FROM docs WHERE path = ?1", [&rel])?;
        tx.execute("INSERT INTO docs (path, mtime, title, body) VALUES (?1, ?2, ?3, ?4)", params![rel, m, title, body])?;
        tx.execute("INSERT OR REPLACE INTO meta (path, title, kind, tags, links, hub, refs, props) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![rel, title, kind, tags, links, hub, refs, props])?;
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
    let fresh = SYNCED.lock().unwrap().as_ref().and_then(|m| m.get(root)).is_some_and(|t| t.elapsed() < RESYNC);
    if !fresh {
        // marked before the walk: a change during it makes the next query walk again
        SYNCED.lock().unwrap().get_or_insert_with(HashMap::new).insert(root.to_string(), std::time::Instant::now());
        sync(c, root).map_err(|e| e.to_string())?;
    }
    f(c).map_err(|e| e.to_string())
}

/// The notes in `vault` that match `text` best, [{path, title, snippet}].
pub fn related(dir: &Path, vault: &str, text: &str, limit: usize) -> Result<Vec<Value>, String> {
    let q = query_of(text);
    with(dir, vault, |c| search(c, &q, limit))
}

/// Every note by the names a link may use: its path without .md and its file name, lowercase, as indexes into `paths`.
fn name_map<'a>(paths: impl Iterator<Item = &'a str>) -> HashMap<String, usize> {
    let mut by: HashMap<String, usize> = HashMap::new();
    for (i, p) in paths.enumerate() {
        let full = p.trim_end_matches(".md").to_lowercase();
        let stem = full.rsplit('/').next().unwrap_or(&full).to_string();
        by.entry(stem).or_insert(i);
        by.insert(full, i);
    }
    by
}
/// The note a link names, like Obsidian: by its path, else by its file name.
fn lookup(by: &HashMap<String, usize>, link: &str) -> Option<usize> {
    let l = link.trim_end_matches(".md").to_lowercase();
    by.get(&l).or_else(|| by.get(l.rsplit('/').next().unwrap_or(&l))).copied()
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
        let by = name_map(rows.iter().map(|r| r.0.as_str()));
        let mut seen = std::collections::HashSet::new();
        let mut edges = vec![];
        for (i, (.., links, _)) in rows.iter().enumerate() {
            for l in links.lines() {
                let Some(j) = lookup(&by, l) else { continue };
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

/// Every note of `root` with what the collections show: [{p, t, k, at, date, stage, props}], `props` as `props()` gives
/// them. A note without a `type:` has `k` "", so the views can say so. The query itself runs on the frontend
/// (domain/collections/rules.ts) over these rows, so a filter chip answers without a round trip.
pub fn collection(dir: &Path, root: &str) -> Result<Value, String> {
    with(dir, root, |c| {
        let mut st = c.prepare(
            "SELECT m.path, m.title, m.kind, d.mtime, m.refs, m.props FROM meta m JOIN docs d ON d.path = m.path ORDER BY m.path",
        )?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?)))?;
        let mut out = vec![];
        for row in rows {
            let (p, t, k, at, refs, props) = row?;
            let refs: Value = refs.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or(Value::Null);
            let props: Value = props.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_else(|| json!({}));
            out.push(json!({"p": p, "t": t, "k": k, "at": at, "date": refs["date"], "stage": refs["stage"], "props": props}));
        }
        Ok(Value::from(out))
    })
}

/// A line cut to a window around [from, to) (chars): the text before, the hit, the text after, with … where it was cut.
fn window(chars: &[char], from: usize, to: usize) -> (String, String, String) {
    let lead = chars.iter().take_while(|c| c.is_whitespace()).count().min(from);
    let start = from.saturating_sub(40).max(lead);
    let end = chars.len().min(to + 100);
    let cut = |a: usize, b: usize| chars[a..b].iter().collect::<String>();
    (format!("{}{}", if start > lead { "…" } else { "" }, cut(start, from)), cut(from, to), format!("{}{}", cut(to, end), if end < chars.len() { "…" } else { "" }))
}

/// The lines of `text` after the frontmatter, with their numbers in the file (from 1), outside code fences.
fn body_lines(text: &str) -> Vec<(usize, &str)> {
    let skip = if text.starts_with("---\n") { text.find("\n---").map_or(0, |i| text[..i].lines().count() + 1) } else { 0 };
    let mut fence = false;
    let mut out = vec![];
    for (i, l) in text.lines().enumerate().skip(skip) {
        if l.trim_start().starts_with("```") || l.trim_start().starts_with("~~~") { fence = !fence; continue; }
        if !fence { out.push((i + 1, l)); }
    }
    out
}

/// The [[…]] of a line as char ranges [from, to) and what they name (the part before `|` and `#`).
fn wikilinks(chars: &[char]) -> Vec<(usize, usize, String)> {
    let mut out = vec![];
    let mut i = 0;
    while i + 1 < chars.len() {
        if chars[i] == '[' && chars[i + 1] == '[' {
            if let Some(j) = (i + 2..chars.len().saturating_sub(1)).find(|&j| chars[j] == ']' && chars[j + 1] == ']') {
                let inner: String = chars[i + 2..j].iter().collect();
                out.push((i, j + 2, inner.split(['|', '#']).next().unwrap_or("").trim().to_string()));
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// The first line of `text` with a [[link]] that `names` the note: (line, before, the link as written, after). The body
/// first, the frontmatter (`about:`, `context:`) when the body has none.
fn link_line(text: &str, names: impl Fn(&str) -> bool) -> Option<(usize, String, String, String)> {
    let body = body_lines(text);
    let first = body.first().map_or(usize::MAX, |b| b.0);
    let head = text.lines().enumerate().take_while(|(i, _)| i + 1 < first).map(|(i, l)| (i + 1, l));
    body.into_iter().chain(head).find_map(|(n, l)| {
        let chars: Vec<char> = l.chars().collect();
        let (from, to, _) = wikilinks(&chars).into_iter().find(|w| names(&w.2))?;
        let (before, hit, after) = window(&chars, from, to);
        Some((n, before, hit, after))
    })
}

/// The first line of `text` that has `name` (lowercase) as plain text: not inside a [[link]], on word boundaries,
/// any case. (line, before, the text as written, after).
fn mention_line(text: &str, names: &[Vec<char>]) -> Option<(usize, String, String, String)> {
    body_lines(text).into_iter().find_map(|(n, l)| {
        let chars: Vec<char> = l.chars().collect();
        let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
        let links = wikilinks(&chars);
        for name in names {
            for from in 0..lower.len().saturating_sub(name.len() - 1) {
                let to = from + name.len();
                if lower[from..to] != name[..] { continue; }
                if (from > 0 && chars[from - 1].is_alphanumeric()) || (to < chars.len() && chars[to].is_alphanumeric()) { continue; }
                if links.iter().any(|w| from < w.1 && to > w.0) { continue; }
                let (before, hit, after) = window(&chars, from, to);
                return Some((n, before, hit, after));
            }
        }
        None
    })
}

/// A note's right rail (K2): who links to it, where its name is written without a link, and what is near it, from
/// the index of `root` brought up to date. `path` is the note in the workspace.
/// {backlinks, mentions: [{p, t, k, line, before, hit, after}], related: [{p, t, k}]}, a line counting from 1 in the file.
/// Names shorter than 4 characters are not looked for (a note called "AI" or "Q3" would match everywhere).
pub fn rail(dir: &Path, root: &str, path: &str) -> Result<Value, String> {
    with(dir, root, |c| {
        let rows: Vec<(String, String, String, String)> = c
            .prepare("SELECT path, title, kind, links FROM meta ORDER BY path")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<_, _>>()?;
        let by = name_map(rows.iter().map(|r| r.0.as_str()));
        let Some(me) = rows.iter().position(|r| r.0 == path) else { return Ok(json!({"backlinks": [], "mentions": [], "related": []})) };
        let read = |p: &str| fs::read_to_string(Path::new(root).join(p)).unwrap_or_default();
        let hit = |(p, t, k, _): &(String, String, String, String), at: (usize, String, String, String)| {
            json!({"p": p, "t": t, "k": k, "line": at.0, "before": at.1, "hit": at.2, "after": at.3})
        };
        let mut backlinks = vec![];
        let mut linking = std::collections::HashSet::new();
        for (i, row) in rows.iter().enumerate() {
            if i == me || !row.3.lines().any(|l| lookup(&by, l) == Some(me)) { continue; }
            linking.insert(i);
            if let Some(at) = link_line(&read(&row.0), |name| lookup(&by, name) == Some(me)) { backlinks.push(hit(row, at)); }
        }
        // the names the note goes by: its file name, its title, its aliases
        let text = read(path);
        let head = vault::split(&text).map_or("", |h| h.0);
        let stem = path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md").to_string();
        let mut names: Vec<Vec<char>> = vec![];
        for n in [stem, rows[me].1.clone()].into_iter().chain(fm_list(head, "aliases")) {
            let n: Vec<char> = n.trim().chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect();
            if n.len() >= 4 && !names.contains(&n) { names.push(n); }
        }
        let mut mentions = vec![];
        let mut seen = std::collections::HashSet::new();
        for name in &names {
            let phrase = format!("\"{}\"", name.iter().collect::<String>().replace('"', "\"\""));
            let mut st = c.prepare("SELECT path FROM docs WHERE docs MATCH ?1 ORDER BY path LIMIT 200")?;
            let candidates: Vec<String> = st.query_map([&phrase], |r| r.get(0))?.collect::<Result<_, _>>()?;
            for p in candidates {
                let Some(i) = rows.iter().position(|r| r.0 == p) else { continue };
                if i == me || linking.contains(&i) || !seen.insert(i) || mentions.len() >= 20 { continue; }
                match mention_line(&read(&p), &names) { Some(at) => mentions.push(hit(&rows[i], at)), None => { seen.remove(&i); } }
            }
        }
        let related: Vec<Value> = search(c, &query_of(&text), 7)?
            .into_iter()
            .filter(|v| v["path"] != path)
            .take(5)
            .map(|v| {
                let k = rows.iter().find(|r| v["path"] == r.0.as_str()).map_or("", |r| r.2.as_str());
                json!({"p": v["path"], "t": v["title"], "k": k})
            })
            .collect();
        Ok(json!({"backlinks": backlinks, "mentions": mentions, "related": related}))
    })
}

/// A typed ⌘K query: `type:Document`, `in:Studio` (`in:"Client Work"`) and `#tag` narrow the notes, the rest is the text.
/// A filter without a value yet (`type:`) is dropped, so typing it does not change the results.
#[derive(Debug, Default, PartialEq)]
pub struct Query { pub text: String, pub kind: Option<String>, pub within: Option<String>, pub tags: Vec<String> }
pub fn parse_query(q: &str) -> Query {
    let (mut out, mut words, mut tok, mut quoted) = (Query::default(), vec![], String::new(), false);
    let mut chars = q.chars().peekable();
    loop {
        let c = chars.next();
        match c {
            Some('"') => quoted = !quoted,
            Some(c) if quoted || !c.is_whitespace() => tok.push(c),
            _ => {
                let t = std::mem::take(&mut tok);
                let lower = t.to_lowercase();
                if let Some(v) = lower.strip_prefix("type:") { if !v.is_empty() { out.kind = Some(v.to_string()); } }
                else if let Some(v) = lower.strip_prefix("in:") { if !v.is_empty() { out.within = Some(v.to_string()); } }
                else if let Some(v) = lower.strip_prefix('#').filter(|v| !v.is_empty()) { out.tags.push(v.to_string()); }
                else if !t.is_empty() { words.push(t); }
                if c.is_none() { break; }
            }
        }
    }
    out.text = words.join(" ");
    out
}

/// The words of a text as FTS5 prefix terms ("pricewise rate" finds "Pricewise rates").
fn terms(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}
fn fts(column: &str, terms: &[String]) -> String {
    format!("{column} : ({})", terms.iter().map(|t| format!("\"{t}\"*")).collect::<Vec<_>>().join(" "))
}

/// The first line of `body` with the most terms, as (its number in the file, before, hit, after): the hit is the
/// first run of matching words, the line cut to a window around it. A match the line scan can't find (the index folds
/// accents) gives the first body line with no hit.
fn hit_line(body: &str, terms: &[String]) -> Option<(usize, String, String, String)> {
    // the words of a line as (start, end, lowercase), in chars
    let words = |line: &str| -> Vec<(usize, usize, String)> {
        let chars: Vec<char> = line.chars().collect();
        let (mut out, mut i) = (vec![], 0);
        while i < chars.len() {
            if !chars[i].is_alphanumeric() { i += 1; continue; }
            let start = i;
            while i < chars.len() && chars[i].is_alphanumeric() { i += 1; }
            out.push((start, i, chars[start..i].iter().flat_map(|c| c.to_lowercase()).collect()));
        }
        out
    };
    // a word matches when a term is its prefix, as FTS5 reads "rate"*
    let hit = |w: &(usize, usize, String)| terms.iter().any(|t| w.2.starts_with(t.as_str()));
    let skip = if body.starts_with("---\n") { body.find("\n---").map_or(0, |i| body[..i].lines().count() + 1) } else { 0 };
    let lines: Vec<&str> = body.lines().collect();
    let mut best: Option<(usize, usize)> = None;
    for (i, l) in lines.iter().enumerate().skip(skip) {
        let w = words(l);
        let n = terms.iter().filter(|t| w.iter().any(|x| x.2.starts_with(t.as_str()))).count();
        if n > best.map_or(0, |b| b.1) { best = Some((i, n)); }
    }
    let at = best.map(|b| b.0).or_else(|| lines.iter().enumerate().skip(skip).find(|(_, l)| !l.trim().is_empty()).map(|(i, _)| i))?;
    let line = lines[at].trim_end();
    let chars: Vec<char> = line.chars().collect();
    let w = words(line);
    let (from, to) = match w.iter().position(&hit) {
        Some(i) => {
            let mut j = i;
            while j + 1 < w.len() && hit(&w[j + 1]) && w[j + 1].0 <= w[j].1 + 1 { j += 1; }
            (w[i].0, w[j].1)
        }
        None => (0, 0),
    };
    let lead = chars.iter().take_while(|c| c.is_whitespace()).count().min(from);
    let start = from.saturating_sub(40).max(lead);
    let end = chars.len().min(to + 100);
    let cut = |a: usize, b: usize| chars[a..b].iter().collect::<String>();
    let before = format!("{}{}", if start > lead { "…" } else { "" }, cut(start, from));
    let after = format!("{}{}", cut(to, end), if end < chars.len() { "…" } else { "" });
    Some((at + 1, before, cut(from, to), after))
}

/// A note's kind, tags, refs and path against the query's filters.
fn keeps(q: &Query, path: &str, kind: &str, tags: &str, refs: &str) -> bool {
    if q.kind.as_ref().is_some_and(|k| !kind.eq_ignore_ascii_case(k)) { return false; }
    if q.tags.iter().any(|t| !tags.lines().any(|x| x.trim_start_matches('#').eq_ignore_ascii_case(t))) { return false; }
    let Some(w) = &q.within else { return true };
    let dirs = path.rsplit_once('/').map_or("", |(d, _)| d);
    dirs.split('/').any(|d| d.eq_ignore_ascii_case(w))
        || serde_json::from_str::<Value>(refs).ok().is_some_and(|v| v["context"].as_array().is_some_and(|a| a.iter().any(|c| c.as_str().is_some_and(|c| c.eq_ignore_ascii_case(w)))))
}

/// The filters as SQL over `meta m` (an AND per filter) and their parameters, numbered from ?2 (?1 is the match). The
/// folder/context test is a superset here (`keeps` makes it exact): it only has to keep the candidates few.
fn filters_sql(q: &Query) -> (String, Vec<String>) {
    let (mut sql, mut args) = (String::new(), vec![]);
    let mut add = |clause: &str, v: String| { args.push(v); sql += &clause.replace('?', &format!("?{}", args.len() + 1)); };
    if let Some(k) = &q.kind { add(" AND lower(m.kind) = ?", k.clone()); }
    for t in &q.tags { add(" AND (char(10) || lower(m.tags) || char(10)) LIKE '%' || char(10) || ? || char(10) || '%'", t.clone()); }
    if let Some(w) = &q.within {
        // every ? of a clause is the same parameter
        add(" AND (lower(m.path) LIKE '%' || ? || '/%' OR lower(m.refs) LIKE '%\"' || ? || '\"%')", w.clone());
    }
    (sql, args)
}

const NAMES: usize = 8;
const CONTENT: usize = 12;
const CANDIDATES: usize = 100;
/// ⌘K over a workspace: {names: [{path, title, type}], content: [{path, title, line, before, hit, after}]}. The text is
/// matched as word prefixes against the title (names) and the body (content); `type:`, `in:` and `#tag` narrow both.
/// With filters and no text, the names are the notes that pass them.
pub fn find(dir: &Path, root: &str, query: &str) -> Result<Value, String> {
    let q = parse_query(query);
    let terms = terms(&q.text);
    let (filter, args) = filters_sql(&q);
    with(dir, root, |c| {
        let run = |sql: &str, m: Option<String>| -> rusqlite::Result<Vec<Vec<String>>> {
            let mut st = c.prepare(sql)?;
            let params: Vec<String> = m.into_iter().chain(args.iter().cloned()).collect();
            let n = st.column_count();
            let rows = st.query_map(rusqlite::params_from_iter(params), |r| (0..n).map(|i| Ok(r.get::<_, Option<String>>(i)?.unwrap_or_default())).collect())?;
            rows.collect()
        };
        let names = if !terms.is_empty() {
            run(&format!("SELECT docs.path, docs.title, m.kind, m.tags, m.refs FROM docs JOIN meta m ON m.path = docs.path
                WHERE docs MATCH ?1{filter} ORDER BY bm25(docs, 0, 0, 5.0, 1.0) LIMIT {CANDIDATES}"), Some(fts("title", &terms)))?
        } else if q.kind.is_some() || q.within.is_some() || !q.tags.is_empty() {
            // no ?1 here: the filters' numbering starts at ?2, so a match is bound as an unused first value
            run(&format!("SELECT m.path, m.title, m.kind, m.tags, m.refs FROM meta m WHERE ?1 = ?1{filter} ORDER BY m.path LIMIT {CANDIDATES}"), Some(String::new()))?
        } else { vec![] };
        let names: Vec<Value> = names.into_iter().filter(|n| keeps(&q, &n[0], &n[2], &n[3], &n[4])).take(NAMES)
            .map(|n| json!({"path": n[0], "title": n[1], "type": n[2]})).collect();
        let mut content = vec![];
        if !terms.is_empty() {
            let rows = run(&format!("SELECT docs.path, docs.title, m.kind, m.tags, m.refs, docs.body FROM docs JOIN meta m ON m.path = docs.path
                WHERE docs MATCH ?1{filter} ORDER BY bm25(docs, 0, 0, 5.0, 1.0) LIMIT {CANDIDATES}"), Some(fts("body", &terms)))?;
            for r in rows {
                if !keeps(&q, &r[0], &r[2], &r[3], &r[4]) { continue; }
                let Some((line, before, hit, after)) = hit_line(&r[5], &terms) else { continue };
                content.push(json!({"path": r[0], "title": r[1], "line": line, "before": before, "hit": hit, "after": after}));
                if content.len() == CONTENT { break; }
            }
        }
        Ok(json!({"names": names, "content": content}))
    })
}

/// When each note of `root` last changed, {path: seconds}, for a folder sorted by modified.
pub fn times(dir: &Path, root: &str) -> Result<Value, String> {
    with(dir, root, |c| {
        let rows = c.prepare("SELECT path, mtime FROM docs")?.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows.into_iter().map(|(p, t)| (p, json!(t))).collect::<serde_json::Map<_, _>>().into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn props_reads_every_key_scalars_lists_and_links() {
        let note = "---\ntype: Meeting\nabout: \"[[Northwind Portal|the portal]]\"\nwith:\n  - \"[[Sofie Claes]]\"\n  - \"[[Tom Willems]]\"\ntags: [a, \"b c\"]\ntitle: Hello, world\nempty:\nlang: en\n---\n# Body\nabout: not this\n";
        let v: Value = serde_json::from_str(&props(note)).unwrap();
        assert_eq!(v["type"], json!(["Meeting"]));
        assert_eq!(v["about"], json!(["Northwind Portal"]));
        assert_eq!(v["with"], json!(["Sofie Claes", "Tom Willems"]));
        assert_eq!(v["tags"], json!(["a", "b c"]));
        assert_eq!(v["title"], json!(["Hello, world"])); // a plain scalar is not split on commas
        assert!(v.get("empty").is_none());
        assert_eq!(v["lang"], json!(["en"]));
        assert_eq!(props("no frontmatter"), "{}");
    }

    #[test]
    fn collection_lists_every_note_with_its_props_and_empty_kind_for_an_untyped_one() {
        let d = std::env::temp_dir().join(format!("relay-collection-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join("Calendar/Meetings/2026")).unwrap();
        let v = vault::canon(d.to_str().unwrap());
        let db = d.join("index");
        fs::write(d.join("Calendar/Meetings/2026/2026-10-08 Sync.md"), "---\ntype: Meeting\ncontext: \"[[Agency]]\"\nabout: \"[[Northwind Portal]]\"\n---\n## Summary\nx\n").unwrap();
        fs::write(d.join("Loose.md"), "just text").unwrap();
        let rows = collection(&db, &v).unwrap();
        let rows = rows.as_array().unwrap();
        let sync = rows.iter().find(|r| r["p"] == "Calendar/Meetings/2026/2026-10-08 Sync.md").unwrap();
        assert_eq!((sync["k"].as_str(), sync["date"].as_str(), sync["stage"].as_str()), (Some("Meeting"), Some("2026-10-08"), Some("wrapped")));
        assert_eq!(sync["props"]["about"], json!(["Northwind Portal"]));
        assert_eq!(sync["props"]["context"], json!(["Agency"]));
        assert_eq!(rows.iter().find(|r| r["p"] == "Loose.md").unwrap()["k"], "");
        fs::remove_dir_all(&d).ok();
    }

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
        touched(&vault::canon_path(&d));
        assert_eq!(paths("prijscascade"), vec!["Contexts/A/Prijzen.md"]);
    }

    #[test]
    fn mention_finder() {
        let names = |n: &[&str]| n.iter().map(|s| s.chars().collect::<Vec<_>>()).collect::<Vec<_>>();
        let text = "---\ntitle: Daily\n---\nSee [[Hosting plan]] first.\n09:30 hosting PLAN with Sam, then NW-212.\n";
        // the linked one is no mention, the plain one is, in the case it was written, with its line in the file
        let (n, before, hit, after) = mention_line(text, &names(&["hosting plan"])).unwrap();
        assert_eq!((n, before.as_str(), hit.as_str(), after.as_str()), (5, "09:30 ", "hosting PLAN", " with Sam, then NW-212."));
        // a word boundary on both sides, frontmatter and code fences are not read
        assert!(mention_line("The hosting planner.\nunhosting plan\n", &names(&["hosting plan"])).is_none());
        assert!(mention_line("---\naliases: hosting plan\n---\n```\nhosting plan\n```\n", &names(&["hosting plan"])).is_none());
        // an alias finds it, a link with a label or heading counts as a link to the note
        assert!(mention_line("Het Plan voor de host.\n", &names(&["hosting plan", "plan voor de host"])).is_some());
        let (n, _, hit, _) = link_line("a\nb [[Other]] and [[Hosting Plan#Scope|the plan]] c", |x| x.eq_ignore_ascii_case("hosting plan")).unwrap();
        assert_eq!((n, hit.as_str()), (2, "[[Hosting Plan#Scope|the plan]]"));
    }

    #[test]
    fn rail_of_a_note() {
        let d = std::env::temp_dir().join(format!("relay-rail-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(d.join("Docs")).unwrap();
        let v = vault::canon(d.to_str().unwrap());
        let db = d.join("index");
        let w = |p: &str, t: &str| fs::write(d.join(p), t).unwrap();
        w("Docs/Hosting plan.md", "---\naliases:\n  - Migration plan\n  - AI\n---\n# Hosting plan\n\nCaching per plate, rate limits of the sandbox.\n");
        w("Docs/A.md", "Intro\nLast sync: [[Hosting plan]], migration on 15 Nov.\n");
        w("Docs/B.md", "---\nabout: \"[[Hosting plan]]\"\n---\nNothing in the body.\n");
        w("Docs/C.md", "See [[docs/hosting plan|the plan]].\n");
        w("Docs/D.md", "Weekly hosting plan on Wednesdays, and the migration plan too. AI everywhere.\n");
        w("Docs/E.md", "Links [[Hosting plan]] and also names the hosting plan in plain text.\n");
        w("Docs/F.md", "Caching per plate and rate limits, unrelated to the name.\n");
        let r = rail(&db, &v, "Docs/Hosting plan.md").unwrap();
        let p = |k: &str| r[k].as_array().unwrap().iter().map(|x| x["p"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        // three notes link to it (E too: it is a backlink, not a mention), each with its line
        assert_eq!(p("backlinks"), vec!["Docs/A.md", "Docs/B.md", "Docs/C.md", "Docs/E.md"]);
        let a = &r["backlinks"][0];
        assert_eq!((a["line"].as_u64(), a["before"].as_str(), a["hit"].as_str()), (Some(2), Some("Last sync: "), Some("[[Hosting plan]]")));
        assert_eq!(r["backlinks"][1]["line"], 2); // the frontmatter line, the body has no link
        // D names it twice (name and alias) and shows once; "AI" is under 4 characters and is not looked for
        assert_eq!(p("mentions"), vec!["Docs/D.md"]);
        assert_eq!(r["mentions"][0]["hit"], "hosting plan");
        assert!(p("related").contains(&"Docs/F.md".to_string()));
        assert!(!p("related").contains(&"Docs/Hosting plan.md".to_string()));
        // linking the mention moves it to the backlinks
        std::thread::sleep(std::time::Duration::from_millis(1100)); // the index follows the mtime, in seconds
        w("Docs/D.md", "Weekly [[Hosting plan|hosting plan]] on Wednesdays.\n");
        // nothing told the index: no new walk, the old answer
        assert_eq!(rail(&db, &v, "Docs/Hosting plan.md").unwrap()["backlinks"].as_array().unwrap().len(), 4);
        touched(&vault::canon_path(&d));
        let r = rail(&db, &v, "Docs/Hosting plan.md").unwrap();
        assert!(r["mentions"].as_array().unwrap().is_empty());
        assert_eq!(r["backlinks"].as_array().unwrap().len(), 5);
        fs::remove_dir_all(&d).ok();
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
        touched(&vault::canon_path(&d));
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

    #[test]
    fn a_query_splits_into_filters_and_text() {
        let q = parse_query("type:Document in:Studio pricewise rate");
        assert_eq!((q.text.as_str(), q.kind.as_deref(), q.within.as_deref()), ("pricewise rate", Some("document"), Some("studio")));
        let q = parse_query("#beacon  in:\"Client Work\" #Plan notes");
        assert_eq!((q.text.as_str(), q.within.as_deref(), q.tags.clone()), ("notes", Some("client work"), vec!["beacon".to_string(), "plan".to_string()]));
        // a filter still being typed filters nothing; a lone # is text-free
        assert_eq!(parse_query("type: in: rate"), Query { text: "rate".into(), ..Query::default() });
        assert_eq!(parse_query("  "), Query::default());
    }

    fn write_vault(d: &Path) {
        fs::create_dir_all(d.join("Contexts/Studio/Beacon/Documents")).unwrap();
        fs::create_dir_all(d.join("Contexts/Clients/Northwind")).unwrap();
        fs::write(d.join("Contexts/Studio/Beacon/Documents/Pricewise API findings.md"),
            "---\ntype: Document\ncontext: \"[[Studio]]\"\ntags: [plan]\n---\n# Findings\n\nSome intro.\nPricewise rate limit: 60 requests per minute\n").unwrap();
        fs::write(d.join("Contexts/Studio/Beacon/Documents/Pricewise rate limits test plan.md"), "---\ntype: Document\n---\nCases for the limits.\n").unwrap();
        fs::write(d.join("Contexts/Studio/Beacon/Documents/Sprint scope.md"), "---\ntype: Meeting\ncontext: \"[[Studio]]\"\n---\nThe simulator respects the Pricewise rates with a cache\n").unwrap();
        fs::write(d.join("Contexts/Clients/Northwind/Notes.md"), "---\ntype: Document\n---\nPricewise rate card for the client\n").unwrap();
    }
    fn found(d: &Path, q: &str) -> Value { find(&d.join("index"), &vault::canon(d.to_str().unwrap()), q).unwrap() }
    fn paths(v: &Value, key: &str) -> Vec<String> { v[key].as_array().unwrap().iter().map(|r| r["path"].as_str().unwrap().rsplit('/').next().unwrap().to_string()).collect() }

    #[test]
    fn find_ranks_names_first_and_highlights_the_matched_line() {
        let d = std::env::temp_dir().join(format!("relay-find-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        write_vault(&d);
        let r = found(&d, "pricewise rate");
        // names: only the title that has both words
        assert_eq!(paths(&r, "names"), vec!["Pricewise rate limits test plan.md"]);
        assert_eq!(paths(&found(&d, "pricewise"), "names").len(), 2);
        // content: the line with both words, its number counted from the top of the file, the run of words as the hit
        let hit = r["content"].as_array().unwrap().iter().find(|c| c["path"].as_str().unwrap().ends_with("Pricewise API findings.md")).unwrap();
        assert_eq!((hit["line"].as_u64(), hit["hit"].as_str()), (Some(9), Some("Pricewise rate")));
        assert_eq!(hit["after"], " limit: 60 requests per minute");
        // a prefix of the last word is enough
        assert_eq!(paths(&found(&d, "pricewise ra"), "content").len(), 3);
        assert_eq!(paths(&found(&d, "nothing here"), "content").len(), 0);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn find_narrows_by_type_context_and_tag() {
        let d = std::env::temp_dir().join(format!("relay-find-filters-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        write_vault(&d);
        // type:Document in:Studio: not the meeting, not the client's note (a folder and a `context:` both count as in)
        let r = found(&d, "type:Document in:Studio pricewise rate");
        assert_eq!(paths(&r, "content"), vec!["Pricewise API findings.md"]);
        assert_eq!(found(&d, "in:Clients pricewise")["content"].as_array().unwrap().len(), 1);
        assert_eq!(paths(&found(&d, "#plan pricewise"), "content"), vec!["Pricewise API findings.md"]);
        // filters alone list the notes that pass
        let mut l = paths(&found(&d, "type:Meeting"), "names");
        l.sort();
        assert_eq!(l, vec!["Sprint scope.md"]);
        // a note changed on disk is found at once
        fs::write(d.join("Contexts/Clients/Northwind/Notes.md"), "---\ntype: Document\n---\nzebra\n").unwrap();
        touched(&vault::canon_path(&d));
        filetime_bump(&d.join("Contexts/Clients/Northwind/Notes.md"));
        assert_eq!(paths(&found(&d, "zebra"), "content"), vec!["Notes.md"]);
        fs::remove_dir_all(&d).ok();
    }
    // the index follows mtime in whole seconds: a rewrite within the same second would not be seen
    fn filetime_bump(p: &Path) {
        let f = fs::OpenOptions::new().write(true).open(p).unwrap();
        f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(5)).unwrap();
    }

    /// Acceptance: results within 150 ms on a 3,000-note vault (the index is warm; the first sync is not the typing path).
    #[test]
    fn find_answers_within_150_ms_on_3000_notes() {
        let d = std::env::temp_dir().join(format!("relay-find-3k-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        for i in 0..3000 {
            let dir = d.join(format!("Contexts/C{}/P{}/Documents", i % 10, i % 60));
            fs::create_dir_all(&dir).unwrap();
            let body: String = (0..40).map(|l| format!("Line {l} of note {i}: the simulator handles quotes, plates and tariff tables for client {}.\n", i % 97)).collect();
            fs::write(dir.join(format!("Note {i} about topic{}.md", i % 50)), format!("---\ntype: Document\ntags: [t{}]\n---\n{body}Pricewise rate limit {i}\n", i % 7)).unwrap();
        }
        let root = vault::canon(d.to_str().unwrap());
        let idx = d.join("index");
        let t = std::time::Instant::now();
        find(&idx, &root, "pricewise").unwrap();
        println!("cold (index built): {:?}", t.elapsed());
        for q in ["pricewise rate", "type:Document in:C3 pricewise ra", "topic7", "simulator handles quo"] {
            let t = std::time::Instant::now();
            let r = find(&idx, &root, q).unwrap();
            let took = t.elapsed();
            println!("{q:?}: {took:?}, {} names, {} content", r["names"].as_array().unwrap().len(), r["content"].as_array().unwrap().len());
            assert!(took < std::time::Duration::from_millis(150), "{q}: {took:?}");
        }
        fs::remove_dir_all(&d).ok();
    }
}
