// One JSON snapshot of everything the control room shows: the vault's work-state table with each project's
// open items and status, and `claude agents --json` with the project each session is about. Read-only.
// What a vault calls things (headings, contexts, folders to skip) comes from its .relay/config.json
// (relay_config.rs). Reminders are read by reminders.rs.

use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

/// User-role messages the harness injects, not typed by the user.
const INJECTED: [&str; 8] = ["<", "Another Claude session", "Base directory for this skill", "[Image", "Stop hook feedback",
    "[Request interrupted", "The user sent a new message", "This session is being continued"];

fn rx(p: &str) -> Regex { Regex::new(p).unwrap() }
fn list(cfg: &Value, key: &[&str], dflt: &[&str]) -> Vec<String> {
    let v = key.iter().fold(cfg, |v, k| &v[*k]);
    let l: Vec<String> = v.as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
    if l.is_empty() { dflt.iter().map(|s| s.to_string()).collect() } else { l }
}
/// A heading in the vault's own language: any of the names for that role, case-insensitive.
fn alt(names: &[String]) -> String { format!("(?:{})", names.iter().map(|n| regex::escape(n)).collect::<Vec<_>>().join("|")) }
fn read(p: &Path) -> Option<String> { fs::read_to_string(p).ok().map(|s| s.replace("\r\n", "\n").replace('\r', "\n")) }

struct Notes { root: PathBuf, skip: Vec<String>, open: Regex, status: Regex, status_line: Regex }

pub fn snapshot(vault: &str, work_state: &str, notes: &str, today: chrono::NaiveDate, path: &str, cache: &Path, home: &str) -> Result<Value, String> {
    let (projs, root) = vault_projects(vault, work_state, notes)?;
    let mut ses = sessions(path);
    if let Some(items) = ses["items"].as_array_mut() {
        topics(items, &projs, &root, vault, cache, home);
    }
    Ok(json!({ "today": today.format("%Y-%m-%d").to_string(), "projects": projs, "sessions": ses }))
}

/// A vault's projects (its work-state rows with their notes' open items and status), and the folder of its notes.
pub fn vault_projects(vault: &str, work_state: &str, notes: &str) -> Result<(Vec<Value>, PathBuf), String> {
    let cfg = crate::relay_config::load(vault).unwrap_or_else(|| json!({}));
    let root = if Path::new(notes).is_dir() { PathBuf::from(notes) } else { PathBuf::from(vault) };
    let (open_h, status_h) = (alt(&list(&cfg, &["headings", "open"], &["Open"])), alt(&list(&cfg, &["headings", "status"], &["Status", "Stand van zaken"])));
    let n = Notes {
        skip: list(&cfg, &["skip"], &["Documents", "Gesprekken", "_archive"]),
        open: rx(&format!(r"(?mi)^## {open_h}[ \t]*\n")),
        status: rx(&format!(r"(?mi)^## {status_h}[ \t]*\n")),
        status_line: rx(&format!(r"(?i)^\*{status_h}[^\n]*\n")),
        root,
    };
    // a context is a work-state heading the config names, or one named after a folder of the notes (Contexts/Work…)
    let mut contexts: HashSet<String> = list(&cfg, &["contexts"], &[]).into_iter().collect();
    for e in fs::read_dir(&n.root).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with('.') && e.path().is_dir() { contexts.insert(name); }
    }
    Ok((projects(work_state, &contexts, &n)?, n.root))
}

fn projects(work_state: &str, contexts: &HashSet<String>, n: &Notes) -> Result<Vec<Value>, String> {
    let text = read(Path::new(work_state)).ok_or_else(|| format!("snapshot: cannot read {work_state}"))?;
    let (head, row) = (rx(r"^#{2,3} (.+?)\s*$"), rx(r"^\| (?:\[\[([^\]]+)\]\][^|]*|([^|\[]+?)) \| (\w+) \| ([\d-]+) \| (.*) \|$"));
    let (mut out, mut context) = (vec![], None::<String>);
    for line in text.split('\n') {
        if let Some(h) = head.captures(line) { context = Some(h[1].to_string()).filter(|c| contexts.contains(c)); }
        let (Some(m), Some(ctx)) = (row.captures(line), &context) else { continue };
        let name = m.get(1).map_or_else(|| m[2].trim().to_string(), |l| l.as_str().to_string());
        let mut p = json!({ "name": name, "context": ctx, "state": &m[3], "last": &m[4], "summary": &m[5] });
        p.as_object_mut().unwrap().extend(note_state(&name, n));
        out.push(p);
    }
    Ok(out)
}

/// The notes called `name`.md under the notes, walking dirs as python's glob("**") did: hidden ones skipped, symlinks followed.
fn find_notes(dir: &Path, rel_skip: &[String], file: &str, depth: u8, hits: &mut Vec<PathBuf>) {
    if dir.join(file).symlink_metadata().is_ok() { hits.push(dir.join(file)); }
    if depth > 12 { return; }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut subs: Vec<_> = rd.flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), e.path())).filter(|(n, p)| !n.starts_with('.') && !rel_skip.contains(n) && p.is_dir()).collect();
    subs.sort();
    for (_, p) in subs { find_notes(&p, rel_skip, file, depth + 1, hits); }
}

/// The text after the `## <heading>` line up to the next `## ` line.
fn section<'a>(heading: &Regex, s: &'a str) -> Option<&'a str> {
    let rest = &s[heading.find(s)?.end()..];
    Some(&rest[..rx(r"(?m)^## ").find(rest).map_or(rest.len(), |m| m.start())])
}

fn note_state(name: &str, n: &Notes) -> Map<String, Value> {
    // "Kestrel (ERP)": Kestrel.md too
    let short = rx(r"\s*\(.*\)$").replace(name, "").into_owned();
    let mut names = vec![name.to_string()];
    if short != name { names.push(short); }
    let mut hits = vec![];
    for nm in &names { find_notes(&n.root, &n.skip, &format!("{nm}.md"), 0, &mut hits); }
    let s = hits.first().and_then(|p| read(p));
    let (mut items, mut stand, mut aliases, mut open) = (vec![], Value::Null, vec![], Value::Null);
    if let Some(s) = &s {
        if let Some(op) = section(&n.open, s) {
            items = rx(r"(?m)^\s*- \[ \] (.+)$").captures_iter(op).map(|c| unlink(&c[1])).collect();
            open = json!(items.len());
        }
        if let Some(st) = section(&n.status, s) {
            stand = json!(unlink(&n.status_line.replace(st.trim(), "")).trim());
        }
        if let Some(fm) = rx(r"(?s)^---\n(.*?)\n---").captures(s) {
            if let Some(a) = rx(r"(?m)^aliases:\n((?:\s+-.*\n?)*)").captures(&fm[1]).filter(|_| rx(r"(?m)^aliases:\n\s+-").is_match(&fm[1])) {
                aliases = rx(r#"(?m)^\s*-\s*"?([^"\n]+?)"?\s*$"#).captures_iter(&a[1]).map(|c| c[1].to_string()).collect();
            }
        }
    }
    let mut m = Map::new();
    m.insert("open".into(), open);
    m.insert("open_items".into(), json!(items));
    m.insert("stand".into(), stand);
    m.insert("aliases".into(), json!(aliases));
    m
}

fn unlink(text: &str) -> String { rx(r"\[\[([^\]|]+)(\|[^\]]+)?\]\]").replace_all(text, "${1}").into_owned() }

// ---------- sessions

fn sessions(path: &str) -> Value {
    let err = |e: String| json!({ "error": e, "items": [] });
    let Ok(mut child) = Command::new("claude").args(["agents", "--json"]).env("PATH", path)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return err("cannot run claude".into()) };
    let mut out = child.stdout.take().unwrap();
    let (tx, rx_) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let mut b = vec![]; out.read_to_end(&mut b).ok(); tx.send(b).ok(); });
    let Ok(raw) = rx_.recv_timeout(Duration::from_secs(15)) else {
        child.kill().ok();
        child.wait().ok();
        return err("claude agents --json timed out after 15 seconds".into());
    };
    child.wait().ok();
    match serde_json::from_slice::<Value>(&raw) {
        Ok(items) if items.is_array() => json!({ "error": null, "items": items }),
        Ok(_) => err("claude agents --json: not a list".into()),
        Err(e) => err(e.to_string()),
    }
}

/// The names (project or alias, 3+ chars) a text mentions, as whole words, case-insensitive.
struct Matcher(Vec<(Regex, String)>);
impl Matcher {
    fn new(projs: &[Value]) -> Self {
        let mut v = vec![];
        for p in projs {
            let name = p["name"].as_str().unwrap_or("");
            for t in std::iter::once(name).chain(p["aliases"].as_array().into_iter().flatten().filter_map(Value::as_str)) {
                if t.chars().count() >= 3 { v.push((rx(&format!("(?i){}", regex::escape(t))), name.to_string())); }
            }
        }
        Matcher(v)
    }
    fn find(&self, text: &str) -> Vec<String> {
        let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        let mut out: Vec<String> = vec![];
        for (r, n) in &self.0 {
            // rust's regex has no lookaround: test the chars around each match, retrying one char further on a miss
            let mut at = 0;
            while let Some(m) = r.find_at(text, at) {
                if !word(text[..m.start()].chars().next_back()) && !word(text[m.end()..].chars().next()) { out.push(n.clone()); break; }
                at = m.start() + text[m.start()..].chars().next().map_or(1, char::len_utf8);
            }
        }
        out.sort();
        out.dedup();
        out
    }
}

/// Which project each open session is about, from the tail of its transcript.
///
/// Transcripts only grow at the end, so per session we keep an offset and the last 40 project hits
/// (user messages naming a project, project notes Claude read or edited). Recent hits decide, so a
/// session that moved on to another project follows. Parsing 200 MB once, then only new lines.
fn topics(items: &mut [Value], projs: &[Value], notes: &Path, vault: &str, cache_file: &Path, home: &str) {
    let mut cache: Map<String, Value> = fs::read_to_string(cache_file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let transcripts = Path::new(home).join(".claude/projects").join(vault.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>());
    let (find, names) = (Matcher::new(projs), projs.iter().filter_map(|p| p["name"].as_str()).collect::<HashSet<_>>());
    let (relay_project, auto) = (rx(r"(?s)^<relay-project>.*?</relay-project>\s*"), rx(r"^obsidian-context-management-\w+$"));
    let notes_prefix = format!("{}/", notes.to_string_lossy());
    for it in items.iter_mut() {
        let Some(sid) = it["sessionId"].as_str().filter(|s| !s.is_empty()).map(String::from) else { continue };
        let Ok(mut fh) = fs::File::open(transcripts.join(format!("{sid}.jsonl"))) else { continue };
        let c = cache.get(&sid).cloned().unwrap_or_else(|| json!({}));
        let mut offset = c["offset"].as_u64().unwrap_or(0);
        let mut hits: Vec<String> = c["hits"].as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
        let (mut last, mut last_at) = (c["last"].as_str().unwrap_or("").to_string(), c["last_at"].as_str().unwrap_or("").to_string());
        if fh.metadata().map_or(0, |m| m.len()) < offset { (offset, hits, last, last_at) = (0, vec![], String::new(), String::new()); }
        let mut buf = vec![];
        std::io::Seek::seek(&mut fh, std::io::SeekFrom::Start(offset)).ok();
        fh.read_to_end(&mut buf).ok();
        offset += buf.len() as u64;
        for raw in buf.split(|b| *b == b'\n') {
            let has = |n: &[u8]| raw.windows(n.len()).any(|w| w == n);
            if !has(br#""type":"user""#) && !has(br#""tool_use""#) { continue; }
            let Ok(e) = serde_json::from_slice::<Value>(raw) else { continue };
            let content = &e["message"]["content"];
            if e["type"] == "user" && !e["isSidechain"].as_bool().unwrap_or(false) {
                let texts: Vec<&str> = match content {
                    Value::String(s) => vec![s],
                    Value::Array(a) => a.iter().filter(|x| x["type"] == "text").filter_map(|x| x["text"].as_str()).collect(),
                    _ => vec![],
                };
                for t in texts.into_iter().filter(|t| !t.is_empty() && !INJECTED.iter().any(|p| t.starts_with(p))) {
                    last = relay_project.replace(t, "").chars().take(80).collect(); // the app's project line, see events.ts
                    last_at = e["timestamp"].as_str().unwrap_or("").to_string();
                    hits.extend(find.find(t));
                }
            } else if e["type"] == "assistant" {
                for x in content.as_array().into_iter().flatten().filter(|x| x["type"] == "tool_use") {
                    // a note or folder inside the notes named after a project, wherever the vault keeps it
                    let Some(rel) = x["input"]["file_path"].as_str().and_then(|p| p.strip_prefix(&notes_prefix)) else { continue };
                    let mut segs: Vec<&str> = vec![];
                    for s in rel.split('/').filter(|s| !s.is_empty() && *s != ".") { if s == ".." && !segs.is_empty() { segs.pop(); } else { segs.push(s); } }
                    if let Some(hit) = segs.iter().map(|s| s.strip_suffix(".md").unwrap_or(s)).find(|s| names.contains(s)) {
                        hits.extend([hit.to_string(), hit.to_string()]);
                    }
                }
            }
        }
        hits.drain(..hits.len().saturating_sub(40));
        cache.insert(sid, json!({ "offset": offset, "hits": hits, "last": last, "last_at": last_at }));
        let name = it["name"].as_str().unwrap_or("");
        let named = if auto.is_match(name) { vec![] } else { find.find(name).into_iter().flat_map(|n| [n.clone(), n.clone(), n]).collect() };
        let recent: Vec<&String> = hits[hits.len().saturating_sub(20)..].iter().chain(named.iter()).collect();
        // most mentions wins, the latest mention breaks a tie
        let mut score: HashMap<&String, (usize, usize)> = HashMap::new();
        for (i, n) in recent.iter().enumerate() { let s = score.entry(n).or_default(); *s = (s.0 + 1, i); }
        it["project"] = score.into_iter().max_by_key(|(_, s)| *s).map_or(Value::Null, |(n, _)| json!(n));
        it["last_user"] = json!(last);
        it["last_at"] = json!(last_at);
    }
    let live: HashSet<&str> = items.iter().filter_map(|i| i["sessionId"].as_str()).collect();
    cache.retain(|k, _| live.contains(k.as_str()));
    if let Some(d) = cache_file.parent() { fs::create_dir_all(d).ok(); }
    let tmp = cache_file.with_extension("json.tmp");
    fs::write(&tmp, Value::Object(cache).to_string()).and_then(|_| fs::rename(&tmp, cache_file)).ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_the_vault() {
        let d = std::env::temp_dir().join(format!("relay-snap-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let notes = d.join("Contexts");
        fs::create_dir_all(notes.join("Acme/Portfolio/Documents")).unwrap();
        fs::create_dir_all(d.join(".relay")).unwrap();
        fs::write(d.join(".relay/config.json"), r#"{"headings":{"open":["Openstaand"]},"contexts":["Elders"]}"#).unwrap();
        fs::write(notes.join("Acme/Portfolio/Bluebird.md"), "---\ntype: Product\naliases:\n  - \"Blue\"\n  - Bird\n---\n# Bluebird\n## OPENSTAAND\n- [ ] Ask [[Jane|P]] now\n- [x] done\n- [ ] Second\n## Stand van zaken\n*Stand van zaken: bold*\nGoing [[well]].\n## Other\n").unwrap();
        fs::write(notes.join("Acme/Portfolio/Documents/Kestrel.md"), "## Openstaand\n- [ ] skipped folder\n").unwrap();
        fs::write(notes.join("Acme/Portfolio/Kestrel.md"), "## Openstaand\n\n").unwrap();
        let ws = d.join("work-state.md");
        fs::write(&ws, "# W\n## Acme\n| P | S | L | N |\n|---|---|---|---|\n| Bluebird | Active | 2026-10-01 | sum |\n| [[Kestrel (ERP)]] extra | Quiet | 2026-01-02 | x |\n| Ghost | Active | 2026-01-01 | y |\n## Nope\n| Skipped | Active | 2026-01-01 | z |\n### Elders\n| Else | Active | 2026-01-01 | w |\n").unwrap();
        let p = projects(ws.to_str().unwrap(), &["Elders".into(), "Acme".into()].into_iter().collect(), &Notes {
            root: notes.clone(), skip: vec!["Documents".into()], open: rx(r"(?mi)^## (?:Openstaand)[ \t]*\n"),
            status: rx(r"(?mi)^## (?:Stand van zaken)[ \t]*\n"), status_line: rx(r"(?i)^\*(?:Stand van zaken)[^\n]*\n") }).unwrap();
        let names: Vec<_> = p.iter().map(|p| p["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Bluebird", "Kestrel (ERP)", "Ghost", "Else"]);
        assert_eq!(p[0]["context"], "Acme");
        assert_eq!(p[0]["open"], 2);
        assert_eq!(p[0]["open_items"], json!(["Ask Jane now", "Second"]));
        assert_eq!(p[0]["stand"], "Going well.");
        assert_eq!(p[0]["aliases"], json!(["Blue", "Bird"]));
        assert_eq!((p[1]["open"].clone(), p[1]["open_items"].clone()), (json!(0), json!([])), "falls back to Kestrel.md, not the skipped Documents one");
        assert_eq!((p[2]["open"].clone(), p[2]["stand"].clone()), (Value::Null, Value::Null), "no note");
        let m = Matcher::new(&p);
        assert_eq!(m.find("talk to BLUEBIRD, not Bluebirder or xBird"), ["Bluebird"]);
        fs::remove_dir_all(&d).ok();
    }
}
#[cfg(test)]
mod dry_run {
    // VAULT=/path WORK_STATE=… NOTES=… cargo test show_snapshot -- --ignored --nocapture
    #[test]
    #[ignore]
    fn show_snapshot() {
        let e = |k: &str| std::env::var(k).unwrap_or_default();
        let s = super::snapshot(&e("VAULT"), &e("WORK_STATE"), &e("NOTES"), chrono::NaiveDate::from_ymd_opt(2026, 10, 2).unwrap(), &e("PATH"), std::path::Path::new(&e("CACHE")), &e("HOME")).unwrap();
        std::fs::write(e("OUT"), serde_json::to_string_pretty(&s).unwrap()).unwrap();
    }
}
