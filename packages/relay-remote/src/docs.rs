//! A shared vault's documents (docs/workspaces.md, Documents): a note several members edit at once is a Yjs document,
//! not a file the rounds copy whole. Its markdown is one Y.Text, so the .md written out is that text and nothing is
//! lost going back and forth. The server keeps per document an append-only log of sealed updates and, now and then, a
//! sealed snapshot a member wrote; it never reads, merges or deletes them (history, ticket 10).
//!
//! Which note a document is: the vault's manifest document (id "manifest") maps each path to a random document id, so
//! a rename changes only the manifest and a document keeps its history. A document's name on the server is the vault's
//! naming key over "doc:<id>"; a sidecar (comments, ticket 11) is "<id>#<what>".
//!
//! On this Mac, per vault: each document's state (dir/<id>.bin) and how far it has the log (`Cursor`, dir/index.json).

use crate::sync;
use crate::tls::hex;
use crate::vault::{Call, Keys, MAX_RECORD};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, Map, ReadTxn, StateVector, Text, Transact, Update};

/// The manifest's id: path -> document id, in its map "paths".
pub const MANIFEST: &str = "manifest";
/// One update at most, and one pull's parts at most (a snapshot may be a whole record's size on its own).
pub const MAX_UPDATE: u64 = 4 << 20;
pub const MAX_PULL: u64 = 32 << 20;
/// Updates in the log after the last snapshot before this Mac writes a new one: a document opened later reads the
/// snapshot and what follows, not the whole log.
const SNAPSHOT_EVERY: u64 = 200;

/// How far this Mac has a document's log: every update up to `seq` is in its state, `epoch` the newest key when it
/// last pulled (an update under an older key after that is a removed member's), `snap` the last snapshot's place, and
/// `out` the hash of the text last written to the note.
#[derive(Default, Clone, Serialize, Deserialize)]
struct Cursor { seq: u64, epoch: u32, snap: u64, #[serde(default)] out: String }
struct Open { doc: Doc, c: Cursor }

type On = Arc<dyn Fn(&str, &[u8]) + Send + Sync>;
/// One shared vault's documents on this Mac. `me`: this device (the first 16 hex of its fingerprint), the author of
/// what it writes. `on`: called with (document id, Yjs update) for every update another member made (ticket 9's editor).
pub struct Docs { vault: String, me: String, keys: Mutex<Keys>, call: Call, dir: PathBuf, open: Mutex<BTreeMap<String, Open>>, on: Mutex<Vec<On>> }
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

/// A document id: 32 hex, or the manifest, either with an optional sidecar ("#comments").
pub fn valid_id(id: &str) -> bool {
    let (main, side) = id.split_once('#').map_or((id, None), |(m, s)| (m, Some(s)));
    (main == MANIFEST || (main.len() == 32 && main.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))))
        && side.is_none_or(|s| !s.is_empty() && s.len() <= 16 && s.bytes().all(|b| b.is_ascii_lowercase()))
}
/// A path a document may be written to: relative, no "..", no hidden part, a .md file.
fn safe_path(p: &str) -> bool {
    let path = Path::new(p);
    p.ends_with(".md") && path.components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')))
}
fn text_of(doc: &Doc) -> String { doc.get_or_insert_text("md").get_string(&doc.transact()) }
fn apply(doc: &Doc, update: &[u8]) -> Result<(), String> {
    let u = Update::decode_v1(update).map_err(|e| format!("not a Yjs update: {e}"))?;
    doc.transact_mut().apply_update(u).map_err(|e| format!("update does not apply: {e}"))
}
/// What `f` changed in `doc`, as one update.
fn change(doc: &Doc, f: impl FnOnce(&Doc)) -> Vec<u8> {
    let before = doc.transact().state_vector();
    f(doc);
    doc.transact().encode_state_as_update_v1(&before)
}

impl Docs {
    pub(crate) fn new(vault: &str, keys: Keys, call: Call, dir: &Path, me: &str) -> Docs {
        let index: BTreeMap<String, Cursor> = std::fs::read_to_string(dir.join("index.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let open = index.into_iter().filter(|(id, _)| valid_id(id)).map(|(id, c)| {
            let doc = Doc::new();
            // a state that does not read (a disk error) starts empty: the next pull from 0 brings it back
            let c = match std::fs::read(dir.join(Self::file(&id))).ok().map(|b| apply(&doc, &b)) { Some(Ok(())) => c, _ => Cursor::default() };
            (id, Open { doc, c })
        }).collect();
        Docs { vault: vault.into(), me: me.into(), keys: Mutex::new(keys), call, dir: dir.into(), open: Mutex::new(open), on: Mutex::default() }
    }
    fn file(id: &str) -> String { format!("{}.bin", id.replace('#', "~")) }
    /// The newest keys (after a rotation, keep_keys).
    pub fn set_keys(&self, k: Keys) { *lock(&self.keys) = k; }
    /// A document's name on the server.
    pub fn name(&self, id: &str) -> String { lock(&self.keys).name(&format!("doc:{id}")) }
    /// Called with every update another member made: (document id, Yjs update).
    pub fn subscribe(&self, f: impl Fn(&str, &[u8]) + Send + Sync + 'static) { lock(&self.on).push(Arc::new(f)); }

    fn save(&self, open: &BTreeMap<String, Open>, id: &str) -> Result<(), String> {
        let o = &open[id];
        sync::write_atomic(&self.dir.join(Self::file(id)), &o.doc.transact().encode_state_as_update_v1(&StateVector::default()), None).map_err(|e| e.to_string())?;
        let index: BTreeMap<&String, &Cursor> = open.iter().map(|(k, o)| (k, &o.c)).collect();
        sync::write_atomic(&self.dir.join("index.json"), serde_json::to_string(&index).unwrap().as_bytes(), None).map_err(|e| e.to_string())
    }
    fn entry<'a>(open: &'a mut BTreeMap<String, Open>, id: &str) -> &'a mut Open { open.entry(id.into()).or_insert_with(|| Open { doc: Doc::new(), c: Cursor::default() }) }

    /// The notes that are documents: path -> document id.
    pub fn paths(&self) -> BTreeMap<String, String> {
        let open = lock(&self.open);
        let Some(m) = open.get(MANIFEST) else { return BTreeMap::new() };
        // the map first: getting it takes a write transaction, which waits forever behind an open read one
        let map = m.doc.get_or_insert_map("paths");
        let txn = m.doc.transact();
        map.iter(&txn).filter_map(|(p, v)| Some((p.to_string(), v.to_string(&txn)))).filter(|(p, id)| safe_path(p) && valid_id(id) && !id.contains('#')).collect()
    }
    pub fn text(&self, id: &str) -> String { lock(&self.open).get(id).map(|o| text_of(&o.doc)).unwrap_or_default() }
    /// This Mac's state vector of a document (Yjs v1), for an editor to ask what it misses.
    pub fn state_vector(&self, id: &str) -> Vec<u8> { lock(&self.open).get(id).map(|o| o.doc.transact().state_vector().encode_v1()).unwrap_or_else(|| StateVector::default().encode_v1()) }
    /// Everything this Mac has of a document that a peer with state vector `sv` lacks.
    pub fn diff(&self, id: &str, sv: &[u8]) -> Result<Vec<u8>, String> {
        let sv = StateVector::decode_v1(sv).map_err(|e| format!("not a state vector: {e}"))?;
        // a document not here yet: an empty update, which any editor can apply
        Ok(lock(&self.open).get(id).map_or_else(|| Doc::new().transact().encode_state_as_update_v1(&sv), |o| o.doc.transact().encode_state_as_update_v1(&sv)))
    }

    /// A new note as a document (8a: only this, no UI; seeding existing files is 8b): its text, its path in the manifest.
    pub fn create(&self, path: &str, text: &str) -> Result<String, String> {
        if !safe_path(path) { return Err(format!("not a note path: {path}")); }
        if self.paths().contains_key(path) { return Err(format!("already a document: {path}")); }
        let mut raw = [0u8; 16];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut raw).map_err(|_| "no randomness")?;
        let id = hex(&raw);
        let u = { let mut open = lock(&self.open); change(&Self::entry(&mut open, &id).doc, |d| { let t = d.get_or_insert_text("md"); t.insert(&mut d.transact_mut(), 0, text); }) };
        self.push(&id, &u)?;
        self.map(|m, txn| { m.insert(txn, path, id.clone()); })?;
        Ok(id)
    }
    /// A note moved: only the manifest changes, the document (and its history) stays.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        if !safe_path(to) { return Err(format!("not a note path: {to}")); }
        let paths = self.paths();
        let id = paths.get(from).ok_or_else(|| format!("not a document: {from}"))?.clone();
        if paths.contains_key(to) { return Err(format!("already a document: {to}")); }
        self.map(|m, txn| { m.remove(txn, from); m.insert(txn, to, id.clone()); })
    }
    fn map(&self, f: impl FnOnce(&yrs::MapRef, &mut yrs::TransactionMut)) -> Result<(), String> {
        let u = { let mut open = lock(&self.open); change(&Self::entry(&mut open, MANIFEST).doc, |d| { let m = d.get_or_insert_map("paths"); f(&m, &mut d.transact_mut()); }) };
        self.push(MANIFEST, &u)
    }
    /// An edit made here (ticket 9's editor): into this Mac's state, then to the server.
    pub fn apply_local(&self, id: &str, update: &[u8]) -> Result<(), String> {
        if !valid_id(id) { return Err("not a document id".into()); }
        { let mut open = lock(&self.open); apply(&Self::entry(&mut open, id).doc, update)?; self.save(&open, id)?; }
        self.push(id, update)
    }

    /// Send one update to the document's log. Its seq is the next one when this Mac had the log up to just before:
    /// then the cursor moves on; otherwise others wrote meanwhile and the next pull brings theirs (and this one again,
    /// which applies as nothing).
    fn push(&self, id: &str, update: &[u8]) -> Result<(), String> {
        if update.len() as u64 > MAX_UPDATE { return Err("an edit too big for one update".into()); }
        let (name, blob) = { let k = lock(&self.keys); let name = k.name(&format!("doc:{id}")); (name.clone(), k.seal_doc(&self.vault, &name, "u", 0, &self.me, update)?) };
        let (v, _) = (self.call)(json!({"op": "doc_push", "vault": self.vault, "doc": name, "updates": [blob.len()]}), Some(blob), None)?;
        let seq = v["seq"].as_u64().ok_or("no seq")?;
        let mut open = lock(&self.open);
        let epoch = lock(&self.keys).epoch();
        let o = Self::entry(&mut open, id);
        if seq == o.c.seq + 1 { o.c.seq = seq; o.c.epoch = epoch; }
        self.save(&open, id)?;
        drop(open);
        self.compact(id)
    }

    /// The document's log from where this Mac has it: a newer snapshot first, then the updates after it, in order.
    /// Returns whether anything new came. An update under an older key than this Mac's newest, past where it had the
    /// log when it took that key, is a removed member's: refused, and the pull stops there.
    pub fn pull(&self, id: &str) -> Result<bool, String> {
        if !valid_id(id) { return Err("not a document id".into()); }
        let name = self.name(id);
        let mut any = false;
        loop {
            let since = lock(&self.open).get(id).map_or(0, |o| o.c.seq);
            let (v, body) = (self.call)(json!({"op": "doc_pull", "vault": self.vault, "doc": name, "since": since}), None, Some(MAX_PULL + MAX_RECORD))?;
            let keys = lock(&self.keys).clone();
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, id);
            let mut at = 0usize;
            let mut take = |len: u64| -> Result<&[u8], String> { let b = body.get(at..at + len as usize).ok_or("pull cut short")?; at += len as usize; Ok(b) };
            let mut got: Vec<Vec<u8>> = vec![];
            if let Some(s) = v["snapshot"].as_object() {
                let upto = s["upto"].as_u64().ok_or("snapshot without upto")?;
                let part = keys.open_doc(&self.vault, &name, "s", upto, take(s["len"].as_u64().unwrap_or(0))?)?;
                apply(&o.doc, &part.body)?;
                (o.c.seq, o.c.snap) = (upto, upto);
                got.push(part.body);
            }
            let mut refused = None;
            for u in v["updates"].as_array().into_iter().flatten() {
                let seq = u["seq"].as_u64().ok_or("update without seq")?;
                let blob = take(u["len"].as_u64().unwrap_or(0))?;
                if seq != o.c.seq + 1 { return Err(format!("the log skips from {} to {seq}", o.c.seq)); }
                let part = keys.open_doc(&self.vault, &name, "u", 0, blob)?;
                if part.epoch < keys.epoch() && o.c.epoch == keys.epoch() { refused = Some(format!("update {seq} is sealed under an old key")); break; }
                apply(&o.doc, &part.body)?;
                o.c.seq = seq;
                got.push(part.body);
            }
            o.c.epoch = keys.epoch();
            let more = v["more"] == true && refused.is_none() && !got.is_empty();
            any |= !got.is_empty();
            self.save(&open, id)?;
            drop(open);
            let on = lock(&self.on).clone();
            for b in &got { for f in &on { f(id, b); } }
            if let Some(e) = refused { return Err(e); }
            if !more { break; }
        }
        self.compact(id)?;
        Ok(any)
    }

    /// Every document whose log the server has further than this Mac: the manifest first (it names the others), then
    /// each note's and its sidecars'. Returns the ids that changed.
    pub fn sync(&self) -> Result<Vec<String>, String> {
        let (v, _) = (self.call)(json!({"op": "doc_list", "vault": self.vault}), None, None)?;
        let server: BTreeMap<String, u64> = v["docs"].as_array().into_iter().flatten().filter_map(|d| Some((d["doc"].as_str()?.to_string(), d["seq"].as_u64()?))).collect();
        let behind = |id: &str| server.get(&self.name(id)).is_some_and(|s| *s > lock(&self.open).get(id).map_or(0, |o| o.c.seq));
        let mut changed = vec![];
        if behind(MANIFEST) && self.pull(MANIFEST)? { changed.push(MANIFEST.to_string()); }
        let mut ids: Vec<String> = self.paths().into_values().collect();
        ids.extend(lock(&self.open).keys().filter(|k| k.contains('#')).cloned());
        let sidecars: Vec<String> = ids.iter().map(|id| format!("{id}#comments")).collect();
        ids.extend(sidecars);
        ids.sort();
        ids.dedup();
        for id in ids { if behind(&id) && self.pull(&id)? { changed.push(id); } }
        Ok(changed)
    }

    /// An update another member pushed, passed on by the live channel (`Event::Doc`): applied when it is the next in
    /// the log, otherwise the log is pulled. Returns the document's id when this Mac knows it.
    pub fn take_live(&self, name: &str, seq: u64, blob: &[u8]) -> Result<Option<String>, String> {
        let mut ids: Vec<String> = self.paths().into_values().collect();
        ids.extend(lock(&self.open).keys().cloned());
        let Some(id) = ids.into_iter().find(|id| self.name(id) == name) else { return Ok(None) };
        let next = lock(&self.open).get(&id).map_or(0, |o| o.c.seq) + 1;
        if seq != next { self.pull(&id)?; return Ok(Some(id)); }
        let keys = lock(&self.keys).clone();
        let part = keys.open_doc(&self.vault, name, "u", 0, blob)?;
        if part.epoch < keys.epoch() { return Err("a live update under an old key".into()); }
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, &id);
            apply(&o.doc, &part.body)?;
            (o.c.seq, o.c.epoch) = (seq, keys.epoch());
            self.save(&open, &id)?;
        }
        for f in lock(&self.on).clone() { f(&id, &part.body); }
        self.compact(&id)?;
        Ok(Some(id))
    }

    /// A snapshot once the log since the last one is long: this Mac's whole state, which holds every update up to its
    /// cursor. The server keeps the updates too.
    fn compact(&self, id: &str) -> Result<(), String> {
        let (upto, state) = {
            let open = lock(&self.open);
            let Some(o) = open.get(id) else { return Ok(()) };
            if o.c.seq < o.c.snap + SNAPSHOT_EVERY { return Ok(()); }
            let state = o.doc.transact().encode_state_as_update_v1(&StateVector::default());
            (o.c.seq, state)
        };
        let (name, blob) = { let k = lock(&self.keys); let name = k.name(&format!("doc:{id}")); (name.clone(), k.seal_doc(&self.vault, &name, "s", upto, &self.me, &state)?) };
        (self.call)(json!({"op": "doc_snapshot_put", "vault": self.vault, "doc": name, "upto": upto, "len": blob.len()}), Some(blob), None)?;
        let mut open = lock(&self.open);
        if let Some(o) = open.get_mut(id) { o.c.snap = o.c.snap.max(upto); }
        self.save(&open, id)
    }

    /// Write each note whose document's text changed since it was last written here, under `root` (temp file and
    /// rename). Returns the paths written, so the caller can tell its watcher these are Relay's own (8b, with #305).
    pub fn export(&self, root: &Path) -> (Vec<String>, Vec<String>) {
        let (mut wrote, mut errors) = (vec![], vec![]);
        for (path, id) in self.paths() {
            let mut open = lock(&self.open);
            let Some(o) = open.get_mut(&id) else { continue };
            let text = text_of(&o.doc);
            let h = sync::sha256_hex(text.as_bytes());
            if h == o.c.out { continue; }
            match sync::write_atomic(&root.join(&path), text.as_bytes(), None) {
                Ok(_) => { o.c.out = h; wrote.push(path.clone()); if let Err(e) = self.save(&open, &id) { errors.push(e); } }
                Err(e) => errors.push(format!("{path}: {e}")),
            }
        }
        (wrote, errors)
    }
}

/// What the server lists for a vault's documents (`doc_list`), for tests and Settings: name -> (log length, last snapshot).
pub fn listing(v: &Value) -> BTreeMap<String, (u64, u64)> {
    v["docs"].as_array().into_iter().flatten().filter_map(|d| Some((d["doc"].as_str()?.to_string(), (d["seq"].as_u64()?, d["snap"].as_u64().unwrap_or(0))))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::VaultKey;

    /// A server's document ops in memory: per name its log; snapshots ignored.
    fn fake() -> (Arc<Mutex<BTreeMap<String, Vec<Vec<u8>>>>>, Call) {
        let logs: Arc<Mutex<BTreeMap<String, Vec<Vec<u8>>>>> = Arc::default();
        let l = logs.clone();
        let call: Call = Box::new(move |req, body, _| {
            let mut logs = l.lock().unwrap();
            let doc = req["doc"].as_str().unwrap_or("").to_string();
            match req["op"].as_str().unwrap() {
                "doc_push" => { let log = logs.entry(doc).or_default(); log.push(body.unwrap()); Ok((json!({"seq": log.len()}), vec![])) }
                "doc_pull" => {
                    let since = req["since"].as_u64().unwrap() as usize;
                    let log = logs.get(&doc).cloned().unwrap_or_default();
                    let ups: Vec<Value> = (since..log.len()).map(|i| json!({"seq": i + 1, "len": log[i].len()})).collect();
                    Ok((json!({"snapshot": null, "updates": ups, "seq": log.len(), "more": false}), log[since..].concat()))
                }
                "doc_list" => Ok((json!({"docs": logs.iter().map(|(d, l)| json!({"doc": d, "seq": l.len()})).collect::<Vec<_>>()}), vec![])),
                _ => Ok((json!({}), vec![])),
            }
        });
        (logs, call)
    }

    /// After this Mac took a new key and pulled, an update under the old key appended to the log is a removed
    /// member's (they keep the old key): refused, and nothing of it gets into the text.
    #[test]
    fn an_update_under_an_old_key_after_the_key_changed_is_refused() {
        let dir = std::env::temp_dir().join(format!("relay-docs-old-{}", std::process::id()));
        let (logs, call) = fake();
        let old = Keys::from(VaultKey::generate());
        let d = Docs::new("0123456789abcdef", old.clone(), call, &dir, "aaaaaaaaaaaaaaaa");
        let id = d.create("A.md", "hello").unwrap();
        let mut new = old.clone();
        new.add(1, VaultKey::generate());
        d.set_keys(new);
        d.pull(&id).unwrap();
        // the removed member writes under the key it still has
        let name = d.name(&id);
        let doc = Doc::new();
        let u = change(&doc, |x| { x.get_or_insert_text("md").insert(&mut x.transact_mut(), 0, "evil "); });
        logs.lock().unwrap().get_mut(&name).unwrap().push(old.seal_doc("0123456789abcdef", &name, "u", 0, "bbbbbbbbbbbbbbbb", &u).unwrap());
        assert!(d.pull(&id).unwrap_err().contains("old key"));
        assert_eq!(d.text(&id), "hello");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ids_and_paths_are_checked() {
        assert!(valid_id(MANIFEST) && valid_id(&"a".repeat(32)) && valid_id(&format!("{}#comments", "0".repeat(32))));
        assert!(!valid_id("x") && !valid_id(&"A".repeat(32)) && !valid_id(&format!("{}#", "0".repeat(32))) && !valid_id("manifest#Bad"));
        assert!(safe_path("Projects/Plan.md") && !safe_path("../x.md") && !safe_path("/etc/x.md") && !safe_path(".obsidian/x.md") && !safe_path("a/b.txt"));
    }
}
