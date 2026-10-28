// Comments on a page (ticket 11): threads beside a note, never in its .md. Each is a log of entries, never rewritten:
// a comment, a reply to one, resolve, reopen and delete. A shared workspace's document keeps them in its sidecar
// (`<id>#comments`, docs.rs), where who wrote an entry is the author of the sealed update, not what the entry says; any
// other note in `<workspace>/.relay/comments/<path>.json` on this Mac (hidden, so no round syncs it).
//
// What an entry holds (JSON): `k` comment|reply|resolve|reopen|delete, `on` the comment it is about (all but a comment),
// `t` the text (comment, reply), `q` the quoted text and `a` the anchor (comment: Yjs relative positions on a document,
// an offset in the body elsewhere), `m` the members a comment or reply mentions (ticket 12: the first 16 hex of their
// fingerprint, as an author is), `at` ms. Who may: anyone resolves, reopens and replies; only an entry's author
// deletes it (a delete by anyone else is left out when the threads are read: any member can write the sidecar).

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Comment text at most (characters), quote at most, members mentioned at most.
const TEXT_MAX: usize = 10_000;
const QUOTE_MAX: usize = 500;
const MENTIONS_MAX: usize = 20;

/// One entry as read: its key, who wrote it (a member's fingerprint, or "" on this Mac's own notes) and its JSON.
pub type Entry = (String, String, Value);

/// The threads the entries make, oldest first: each comment with its replies, resolved or not, without what its author
/// deleted. `mine`: whether an author is this Mac (its Delete shows); `name`: an author's name.
pub fn threads(entries: &[Entry], mine: &dyn Fn(&str) -> bool, name: &dyn Fn(&str) -> String) -> Vec<Value> {
    let kind = |v: &Value| v["k"].as_str().unwrap_or("").to_string();
    let at = |v: &Value| v["at"].as_u64().unwrap_or(0);
    let deleted = deleted(entries);
    let item = |k: &str, a: &str, v: &Value| json!({"id": k, "by": name(a), "mine": mine(a), "at": at(v), "text": v["t"].as_str().unwrap_or("")});
    let mut out: Vec<(u64, Value)> = entries.iter().filter(|(k, _, v)| kind(v) == "comment" && !deleted.contains(k.as_str())).map(|(k, a, v)| {
        let of = |w: &Value| w["on"].as_str() == Some(k.as_str());
        let mut replies: Vec<(u64, Value)> = entries.iter().filter(|(rk, _, w)| kind(w) == "reply" && of(w) && !deleted.contains(rk.as_str()))
            .map(|(rk, ra, w)| (at(w), item(rk, ra, w))).collect();
        replies.sort_by_key(|r| r.0);
        // the newest resolve or reopen decides
        let resolved = entries.iter().filter(|(_, _, w)| of(w) && matches!(kind(w).as_str(), "resolve" | "reopen")).max_by_key(|(_, _, w)| at(w))
            .is_some_and(|(_, _, w)| kind(w) == "resolve");
        let mut t = item(k, a, v);
        t["quote"] = v["q"].clone();
        t["anchor"] = v["a"].clone();
        t["resolved"] = json!(resolved);
        // whether this Mac's member is mentioned in the comment or a reply still there (ticket 12, the Inbox)
        t["mentionsMe"] = json!(entries.iter().filter(|(rk, _, w)| (rk == k || (kind(w) == "reply" && of(w))) && !deleted.contains(rk.as_str()))
            .any(|(_, _, w)| mentioned(w).iter().any(|m| mine(m))));
        t["replies"] = Value::Array(replies.into_iter().map(|r| r.1).collect());
        (at(v), t)
    }).collect();
    out.sort_by_key(|t| t.0);
    out.into_iter().map(|t| t.1).collect()
}

/// The entries their own author deleted (a delete by anyone else counts for nothing: any member writes the sidecar).
fn deleted(entries: &[Entry]) -> std::collections::BTreeSet<&str> {
    let by: BTreeMap<&str, &str> = entries.iter().map(|(k, a, _)| (k.as_str(), a.as_str())).collect();
    entries.iter()
        .filter(|(_, a, v)| v["k"] == "delete" && v["on"].as_str().and_then(|on| by.get(on)).is_some_and(|owner| owner == a))
        .filter_map(|(_, _, v)| v["on"].as_str()).collect()
}
/// The members an entry mentions; anything else in `m` is left out.
fn mentioned(v: &Value) -> Vec<&str> {
    v["m"].as_array().map(|a| a.iter().filter_map(|m| m.as_str()).filter(|m| member_id(m)).collect()).unwrap_or_default()
}
/// A member as a mention names one: the first 16 hex of the fingerprint.
fn member_id(m: &str) -> bool { m.len() == 16 && m.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }

/// The comments and replies that mention this Mac's member (`mine`), written by someone else, not deleted and not in
/// `seen`: (entry key, author), what a notification goes out for once.
pub fn fresh_mentions(entries: &[Entry], mine: &dyn Fn(&str) -> bool, seen: &std::collections::BTreeSet<String>) -> Vec<(String, String)> {
    let deleted = deleted(entries);
    entries.iter()
        .filter(|(k, a, v)| matches!(v["k"].as_str(), Some("comment" | "reply")) && !mine(a) && !deleted.contains(k.as_str()) && !seen.contains(k))
        .filter(|(_, _, v)| mentioned(v).iter().any(|m| mine(m)))
        .map(|(k, a, _)| (k.clone(), a.clone())).collect()
}
/// The entry keys a workspace's mentions were already told for, kept beside its documents.
pub fn load_seen(path: &Path) -> Option<std::collections::BTreeSet<String>> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}
pub fn save_seen(path: &Path, seen: &std::collections::BTreeSet<String>) {
    relay_remote::sync::write_atomic(path, serde_json::to_string(seen).unwrap().as_bytes(), None).ok();
}

/// A new entry from the page or an agent, checked: what it may hold, and when. `mentions`: members a comment or reply
/// mentions (16 hex each), at most 20; others are left out.
pub fn entry(kind: &str, on: &str, text: &str, quote: &str, anchor: &Value, mentions: &[String]) -> Result<Value, String> {
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut m: Vec<&String> = mentions.iter().filter(|m| member_id(m)).collect();
    m.dedup();
    m.truncate(MENTIONS_MAX);
    let with = |mut v: Value| { if !m.is_empty() { v["m"] = json!(m); } Ok(v) };
    match kind {
        "comment" => {
            if text.trim().is_empty() || quote.is_empty() { return Err("a comment needs text and the text it is on".into()); }
            with(json!({"k": kind, "t": cut(text, TEXT_MAX), "q": cut(quote, QUOTE_MAX), "a": anchor, "at": at}))
        }
        "reply" if !text.trim().is_empty() && !on.is_empty() => with(json!({"k": kind, "on": on, "t": cut(text, TEXT_MAX), "at": at})),
        "resolve" | "reopen" | "delete" if !on.is_empty() => Ok(json!({"k": kind, "on": on, "at": at})),
        _ => Err(format!("not a comment entry: {kind}")),
    }
}
fn cut(s: &str, max: usize) -> String { s.chars().take(max).collect() }

/// A key for a new entry: 16 random hex.
pub fn new_key() -> String { relay_remote::tls::random_secret()[..16].to_string() }

/// Where a note of this Mac's own keeps its comments: `<root>/.relay/comments/<rel>.json`. `rel` is the note's path in
/// the workspace, already checked to be one.
fn file(root: &Path, rel: &str) -> PathBuf { root.join(".relay").join("comments").join(format!("{rel}.json")) }
/// A note of this Mac's own: its entries (each by "", this Mac).
pub fn read_local(root: &Path, rel: &str) -> Vec<Entry> {
    let all: Vec<Value> = std::fs::read_to_string(file(root, rel)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    all.into_iter().filter_map(|v| Some((v["id"].as_str()?.to_string(), String::new(), v))).collect()
}
/// One entry added to a note of this Mac's own.
pub fn add_local(root: &Path, rel: &str, key: &str, mut v: Value) -> Result<(), String> {
    let path = file(root, rel);
    let mut all: Vec<Value> = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    v["id"] = json!(key);
    all.push(v);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.relay-tmp");
    std::fs::write(&tmp, serde_json::to_string(&all).unwrap()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| { std::fs::remove_file(&tmp).ok(); e.to_string() })
}

/// The workspace folder (one of `roots`) a note is in and its path there; None when it is in none, is no .md file or
/// does not exist.
pub fn locate(roots: &[String], target: &str) -> Option<(PathBuf, String)> {
    let main = PathBuf::from(crate::vault::canon(roots.first()?));
    let asked = if target.starts_with('/') { PathBuf::from(target) } else { main.join(target) };
    let real = std::fs::canonicalize(&asked).ok().filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "md"))?;
    roots.iter().map(|r| PathBuf::from(crate::vault::canon(r))).filter(|r| real.starts_with(r)).max_by_key(|r| r.as_os_str().len())
        .and_then(|r| { let rel = real.strip_prefix(&r).ok()?.to_string_lossy().into_owned(); Some((r, rel)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn e(k: &str, by: &str, v: Value) -> Entry { (k.into(), by.into(), v) }

    /// A comment with a reply, resolved then reopened then resolved again (the newest counts); a delete by someone else
    /// than the author is left out, the author's own counts.
    #[test]
    fn threads_follow_their_entries_and_only_an_author_deletes() {
        let all = vec![
            e("c1", "aa", json!({"k": "comment", "t": "Is this right?", "q": "the plan", "a": {"o": 4}, "at": 1})),
            e("r1", "bb", json!({"k": "reply", "on": "c1", "t": "Yes", "at": 2})),
            e("x1", "bb", json!({"k": "resolve", "on": "c1", "at": 3})),
            e("x2", "aa", json!({"k": "reopen", "on": "c1", "at": 4})),
            e("x3", "aa", json!({"k": "resolve", "on": "c1", "at": 5})),
            e("d1", "bb", json!({"k": "delete", "on": "c1", "at": 6})), // not B's comment: left out
            e("c2", "bb", json!({"k": "comment", "t": "Typo", "q": "teh", "a": {"o": 9}, "at": 7})),
            e("d2", "bb", json!({"k": "delete", "on": "c2", "at": 8})), // B's own: gone
        ];
        let t = threads(&all, &|a| a == "aa", &|a| a.to_uppercase());
        assert_eq!(t.len(), 1);
        assert_eq!((t[0]["id"].as_str(), t[0]["by"].as_str(), t[0]["mine"].as_bool(), t[0]["resolved"].as_bool()), (Some("c1"), Some("AA"), Some(true), Some(true)));
        assert_eq!(t[0]["replies"][0]["text"], "Yes");
        assert_eq!(t[0]["quote"], "the plan");
    }

    #[test]
    fn entries_are_checked() {
        assert!(entry("comment", "", "Why?", "the plan", &json!({"o": 1}), &[]).is_ok());
        assert!(entry("comment", "", " ", "the plan", &json!({}), &[]).is_err());
        assert!(entry("comment", "", "Why?", "", &json!({}), &[]).is_err());
        assert!(entry("reply", "", "x", "", &Value::Null, &[]).is_err());
        assert!(entry("resolve", "c1", "", "", &Value::Null, &[]).is_ok());
        assert!(entry("rewrite", "c1", "", "", &Value::Null, &[]).is_err());
        assert_eq!(entry("reply", "c1", &"x".repeat(20_000), "", &Value::Null, &[]).unwrap()["t"].as_str().unwrap().len(), TEXT_MAX);
    }

    /// Ticket 12: B mentions A in a comment and a reply. A gets each once (`seen`, kept in a file, so a restart tells
    /// nothing again); a mention A wrote, a deleted one and a malformed member are not told; resolving clears the thread's
    /// place in the Inbox (`mentionsMe` stays true, `resolved` decides).
    #[test]
    fn a_mention_is_told_once_and_resolving_takes_it_out_of_the_inbox() {
        let a = "aaaaaaaaaaaaaaaa".to_string();
        let mut c1 = entry("comment", "", "@Ann look", "the plan", &json!({"o": 1}), &[a.clone(), "NOTHEX".into()]).unwrap();
        c1["at"] = json!(1);
        assert_eq!(c1["m"], json!([a.clone()]));
        let all = vec![
            e("c1", "bbbbbbbbbbbbbbbb", c1),
            e("r1", "bbbbbbbbbbbbbbbb", entry("reply", "c1", "@Ann again", "", &Value::Null, &[a.clone()]).unwrap()),
            e("r2", "aaaaaaaaaaaaaaaa", entry("reply", "c1", "@Ann me", "", &Value::Null, &[a.clone()]).unwrap()),
            e("c2", "bbbbbbbbbbbbbbbb", json!({"k": "comment", "t": "x", "q": "y", "a": {}, "at": 2, "m": [a.clone()]})),
            e("d2", "bbbbbbbbbbbbbbbb", json!({"k": "delete", "on": "c2", "at": 3})),
        ];
        let mine = |m: &str| m == a;
        let dir = std::env::temp_dir().join(format!("relay-mentions-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("seen.json");
        std::fs::remove_file(&file).ok();
        let mut seen = load_seen(&file).unwrap_or_default();
        let told = fresh_mentions(&all, &mine, &seen);
        assert_eq!(told.iter().map(|t| t.0.as_str()).collect::<Vec<_>>(), ["c1", "r1"]);
        seen.extend(told.into_iter().map(|t| t.0));
        save_seen(&file, &seen);
        // after a restart: read back, nothing new
        assert!(fresh_mentions(&all, &mine, &load_seen(&file).unwrap()).is_empty());
        let t = threads(&all, &mine, &|x| x.to_string());
        assert_eq!((t.len(), t[0]["mentionsMe"].as_bool(), t[0]["resolved"].as_bool()), (1, Some(true), Some(false)));
        let mut done = all.clone();
        done.push(e("x1", "aaaaaaaaaaaaaaaa", json!({"k": "resolve", "on": "c1", "at": 9})));
        assert_eq!(threads(&done, &mine, &|x| x.to_string())[0]["resolved"], true);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A note of this Mac's own: entries added land in the hidden folder, never in the note, and read back in order.
    #[test]
    fn local_comments_live_beside_the_note() {
        let root = std::env::temp_dir().join(format!("relay-comments-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("Notes")).unwrap();
        std::fs::write(root.join("Notes/Plan.md"), "the plan\n").unwrap();
        let roots = vec![root.to_string_lossy().into_owned()];
        let (r, rel) = locate(&roots, &root.join("Notes/Plan.md").to_string_lossy()).unwrap();
        assert_eq!(rel, "Notes/Plan.md");
        add_local(&r, &rel, "c1", entry("comment", "", "Why?", "plan", &json!({"o": 4}), &[]).unwrap()).unwrap();
        add_local(&r, &rel, "r1", entry("reply", "c1", "Because", "", &Value::Null, &[]).unwrap()).unwrap();
        let read = read_local(&r, &rel);
        assert_eq!(read.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["c1", "r1"]);
        assert_eq!(std::fs::read_to_string(root.join("Notes/Plan.md")).unwrap(), "the plan\n");
        assert!(locate(&roots, "/etc/hosts").is_none());
        std::fs::remove_dir_all(&root).ok();
    }
}
