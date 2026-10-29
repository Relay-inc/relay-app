//! A shared vault's documents (docs/workspaces.md, Documents): a note several members edit at once is a Yjs document,
//! not a file the rounds copy whole. Its markdown is one Y.Text, so the .md written out is that text and nothing is
//! lost going back and forth. The server keeps per document an append-only log of sealed updates; it never reads,
//! merges or deletes them (history, ticket 10). A Mac builds a document only from that log and keeps its own state;
//! it writes no snapshots there and reads none (a member's snapshot cannot be checked cheaply against the log).
//!
//! Which note a document is: the vault's manifest document (id "manifest") maps each path to a random document id, so
//! a rename changes only the manifest and a document keeps its history. A document's name on the server is the vault's
//! naming key over "doc:<id>"; a sidecar (comments, ticket 11) is "<id>#<what>".
//!
//! What the server could do wrong, and what this side checks: it cannot read or forge a part (sealed, the author and
//! its counter bound in); it can hold updates back from this Mac, which shows as a gap in an author's counter (`n`,
//! warned) once a later one of that author comes, and as edits Yjs cannot place yet (warned, the log read again); it
//! can reorder or repeat updates, which changes nothing in the text (Yjs). Nothing shows when it gives an update to
//! nobody.
//!
//! On this Mac, per vault: each document's state (dir/<id>.bin) and how far it has the log (`Cursor`, dir/index.json).

use crate::sync::{self, fold, Filter};
use crate::tls::{hex, unhex};
use crate::vault::{Call, Keys};
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
/// One update at most, and one pull's parts at most (in bytes, and in updates: a pull says `more` past either).
pub const MAX_UPDATE: u64 = 4 << 20;
pub const MAX_PULL: u64 = 32 << 20;
pub const PULL_LIMIT: u64 = 1000;
/// Updates in the log between two snapshots the server takes (`doc_snapshot_put`, for ticket 10's history; this
/// side writes none).
pub const SNAPSHOT_EVERY: u64 = 200;

/// How far this Mac has a document: every update up to `seq` taken (or skipped, warned), `epoch` the newest key when it
/// last pulled (an update under an older key after that is a removed member's).
/// `path`: where the manifest last put it. `at`, `out`: where and what (hash) it was last written as a note. `pending`:
/// an edit here the server has not taken yet; `acked` the state vector (hex) it holds of this Mac's edits; `mine` this
/// device's counter of updates to it; `seen` the last counter of each author (a gap: updates held back); `lost` the
/// authors of parts left out (named when edits are missing).
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Cursor { seq: u64, epoch: u32, path: String, at: String, out: String, pending: bool, acked: String, mine: u64, seen: BTreeMap<String, u64>,
    lost: std::collections::BTreeSet<String> }
struct Open { doc: Doc, c: Cursor }

type On = Arc<dyn Fn(&str, &[u8]) + Send + Sync>;
/// One shared vault's documents on this Mac. `me`: this device (the first 16 hex of its fingerprint), the author of
/// what it writes. `on`: called with (document id, Yjs update) for every update another member made (ticket 9's
/// editor). `busy`: one lock per document, so a live update and a round never work on it at once. `warnings`: what
/// the user should hear of (`take_warnings`).
pub struct Docs {
    vault: String, me: String, keys: Mutex<Keys>, call: Call, dir: PathBuf, open: Mutex<BTreeMap<String, Open>>, on: Mutex<Vec<On>>,
    busy: Mutex<BTreeMap<String, Arc<Mutex<()>>>>, warnings: Mutex<Vec<String>>,
}
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }

/// A document id: 32 hex, or the manifest, either with an optional sidecar ("#comments").
pub fn valid_id(id: &str) -> bool {
    let (main, side) = id.split_once('#').map_or((id, None), |(m, s)| (m, Some(s)));
    (main == MANIFEST || (main.len() == 32 && main.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))))
        && side.is_none_or(|s| !s.is_empty() && s.len() <= 16 && s.bytes().all(|b| b.is_ascii_lowercase()))
}
/// A note's own document: 32 hex, not the manifest, not a sidecar.
fn note_id(id: &str) -> bool { valid_id(id) && id != MANIFEST && !id.contains('#') }
/// A path a document may be written to: relative, no "..", no hidden part, a .md file.
fn safe_path(p: &str) -> bool {
    let path = Path::new(p);
    p.ends_with(".md") && path.components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')))
}
/// Whether any part of `path` under `root` is a symlink (the root itself may be one): nothing is written through one.
fn through_link(root: &Path, path: &str) -> bool {
    let mut at = root.to_path_buf();
    Path::new(path).components().any(|c| { at.push(c); std::fs::symlink_metadata(&at).is_ok_and(|m| m.file_type().is_symlink()) })
}
fn text_of(doc: &Doc) -> String { doc.get_or_insert_text("md").get_string(&doc.transact()) }
fn decode(update: &[u8]) -> Result<Update, String> { Update::decode_v1(update).map_err(|e| format!("not a Yjs update: {e}")) }
fn apply(doc: &Doc, update: &[u8]) -> Result<(), String> {
    let u = decode(update)?;
    doc.transact_mut().apply_update(u).map_err(|e| format!("update does not apply: {e}"))
}
/// What `f` changed in `doc`, as one update.
fn change(doc: &Doc, f: impl FnOnce(&Doc)) -> Vec<u8> {
    let before = doc.transact().state_vector();
    f(doc);
    doc.transact().encode_state_as_update_v1(&before)
}
fn sv_of(hex_sv: &str) -> StateVector { unhex(hex_sv).and_then(|b| StateVector::decode_v1(&b).ok()).unwrap_or_default() }
/// What others wrote, taken here since `before`, counts as held by the server: per client, `acked` rises to the clock
/// it reached (this Mac's own edits do not move while the document's lock is held). With nothing of this Mac's
/// pending, everything here is held.
fn raise_acked(o: &mut Open, before: &StateVector) {
    let after = o.doc.transact().state_vector();
    let mut acked = sv_of(&o.c.acked);
    for (c, k) in after.iter() { if *k > before.get(c) && *k > acked.get(c) { acked.set_max(*c, *k); } }
    if !o.c.pending { acked = after; }
    o.c.acked = hex(&acked.encode_v1());
}
/// A note's conflict name: "Plan.md" -> "Plan (conflict 1a2b3c4d).md", the same on every Mac for the same document.
fn conflict_path(path: &str, id: &str) -> String { format!("{} (conflict {}).md", path.trim_end_matches(".md"), &id[..8]) }

impl Docs {
    pub(crate) fn new(vault: &str, keys: Keys, call: Call, dir: &Path, me: &str) -> Docs {
        let index: BTreeMap<String, Cursor> = std::fs::read_to_string(dir.join("index.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let open = index.into_iter().filter(|(id, _)| valid_id(id)).map(|(id, c)| {
            let doc = Doc::new();
            // a state that does not read (a disk error) starts empty: the next pull from 0 brings it back
            let c = match std::fs::read(dir.join(Self::file(&id))).ok().map(|b| apply(&doc, &b)) { Some(Ok(())) => c, _ => Cursor { path: c.path, at: c.at, out: c.out, ..Cursor::default() } };
            (id, Open { doc, c })
        }).collect();
        Docs { vault: vault.into(), me: me.into(), keys: Mutex::new(keys), call, dir: dir.into(), open: Mutex::new(open), on: Mutex::default(), busy: Mutex::default(), warnings: Mutex::default() }
    }
    fn file(id: &str) -> String { format!("{}.bin", id.replace('#', "~")) }
    /// The newest keys (after a rotation, keep_keys).
    pub fn set_keys(&self, k: Keys) { *lock(&self.keys) = k; }
    /// A document's name on the server.
    pub fn name(&self, id: &str) -> String { lock(&self.keys).name(&format!("doc:{id}")) }
    /// Called with every update another member made: (document id, Yjs update).
    pub fn subscribe(&self, f: impl Fn(&str, &[u8]) + Send + Sync + 'static) { lock(&self.on).push(Arc::new(f)); }
    /// What went wrong or looked wrong since the last call (a part that did not open, updates held back), for the user.
    pub fn take_warnings(&self) -> Vec<String> { std::mem::take(&mut *lock(&self.warnings)) }
    fn warn(&self, w: String) { let mut all = lock(&self.warnings); if !all.contains(&w) { all.push(w); } }
    fn busy(&self, id: &str) -> Arc<Mutex<()>> { lock(&self.busy).entry(id.into()).or_default().clone() }

    fn save(&self, open: &BTreeMap<String, Open>, id: &str) -> Result<(), String> {
        let o = &open[id];
        sync::write_atomic(&self.dir.join(Self::file(id)), &o.doc.transact().encode_state_as_update_v1(&StateVector::default()), None).map_err(|e| e.to_string())?;
        let index: BTreeMap<&String, &Cursor> = open.iter().map(|(k, o)| (k, &o.c)).collect();
        sync::write_atomic(&self.dir.join("index.json"), serde_json::to_string(&index).unwrap().as_bytes(), None).map_err(|e| e.to_string())
    }
    fn entry<'a>(open: &'a mut BTreeMap<String, Open>, id: &str) -> &'a mut Open { open.entry(id.into()).or_insert_with(|| Open { doc: Doc::new(), c: Cursor::default() }) }

    /// The notes that are documents, as the manifest says: path -> document id.
    pub fn paths(&self) -> BTreeMap<String, String> {
        let open = lock(&self.open);
        let Some(m) = open.get(MANIFEST) else { return BTreeMap::new() };
        // the map first: getting it takes a write transaction, which waits forever behind an open read one
        let map = m.doc.get_or_insert_map("paths");
        let txn = m.doc.transact();
        map.iter(&txn).filter_map(|(p, v)| Some((p.to_string(), v.to_string(&txn)))).filter(|(p, id)| safe_path(p) && note_id(id)).collect()
    }
    /// The paths the file rounds must leave alone: every note `filter` lets a document have, and where a document was
    /// last written until its old file is gone.
    pub fn excluded(&self, filter: &Filter) -> Vec<String> {
        let mut v: Vec<String> = self.paths().into_keys().filter(|p| !filter.skips(p, false)).collect();
        v.extend(lock(&self.open).values().map(|o| o.c.at.clone()).filter(|p| !p.is_empty()));
        v.sort();
        v.dedup();
        v
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

    /// Whether `path` is taken by another note than `except` (as APFS compares names).
    fn taken(&self, path: &str, except: Option<&str>) -> bool {
        let f = fold(path);
        self.paths().keys().any(|p| fold(p) == f && Some(p.as_str()) != except)
    }
    /// A new note as a document (8a: only this, no UI; seeding existing files is 8b): its text, its path in the
    /// manifest. Kept here first; sent now if the server can be reached, else with the next sync.
    pub fn create(&self, path: &str, text: &str) -> Result<String, String> {
        if !safe_path(path) { return Err(format!("not a note path: {path}")); }
        if self.taken(path, None) { return Err(format!("already a document: {path}")); }
        let mut raw = [0u8; 16];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut raw).map_err(|_| "no randomness")?;
        let id = hex(&raw);
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, &id);
            change(&o.doc, |d| { let t = d.get_or_insert_text("md"); t.insert(&mut d.transact_mut(), 0, text); });
            (o.c.pending, o.c.path) = (true, path.into());
            self.save(&open, &id)?;
        }
        self.manifest(|m, txn| { m.insert(txn, path, id.clone()); })?;
        self.send(&id);
        Ok(id)
    }
    /// A note moved: only the manifest changes, the document (and its history) stays. Its old file goes at the next
    /// export.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        if !safe_path(to) { return Err(format!("not a note path: {to}")); }
        let id = self.paths().get(from).ok_or_else(|| format!("not a document: {from}"))?.clone();
        if self.taken(to, Some(from)) { return Err(format!("already a document: {to}")); }
        self.manifest(|m, txn| { m.remove(txn, from); m.insert(txn, to, id.clone()); })?;
        let mut open = lock(&self.open);
        if let Some(o) = open.get_mut(&id) { o.c.path = to.into(); }
        self.save(&open, &id)
    }
    /// A change to the manifest, kept here and sent.
    fn manifest(&self, f: impl FnOnce(&yrs::MapRef, &mut yrs::TransactionMut)) -> Result<(), String> {
        let busy = self.busy(MANIFEST);
        let _one = lock(&busy);
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, MANIFEST);
            change(&o.doc, |d| { let m = d.get_or_insert_map("paths"); f(&m, &mut d.transact_mut()); });
            o.c.pending = true;
            self.save(&open, MANIFEST)?;
        }
        if let Err(e) = self.push(MANIFEST) { self.warn(format!("not sent yet, again at the next sync: {e}")); }
        Ok(())
    }
    /// An edit made here (ticket 9's editor): into this Mac's state, then to the server (or with the next sync).
    pub fn apply_local(&self, id: &str, update: &[u8]) -> Result<(), String> {
        if !valid_id(id) { return Err("not a document id".into()); }
        let busy = self.busy(id);
        let _one = lock(&busy);
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, id);
            apply(&o.doc, update)?;
            o.c.pending = true;
            self.save(&open, id)?;
        }
        if let Err(e) = self.push(id) { self.warn(format!("not sent yet, again at the next sync: {e}")); }
        Ok(())
    }
    /// `flush` under the document's lock, a failure only warned (the edit stays pending).
    fn send(&self, id: &str) {
        let busy = self.busy(id);
        let _one = lock(&busy);
        if let Err(e) = self.push(id) { self.warn(format!("not sent yet, again at the next sync: {e}")); }
    }
    /// `flush`, and when what is not held yet is too big for one update (this Mac had not counted others' edits as
    /// held), the log pulled once first (which counts them) and tried again. The caller holds the document's lock.
    fn push(&self, id: &str) -> Result<(), String> {
        match self.flush(id) {
            Err(e) if e.contains("too big") => { self.pull_locked(id)?; self.flush(id) }
            r => r,
        }
    }

    /// Send what this Mac has of a document and the server does not hold yet (everything past `acked`), as one update
    /// with this device's next counter. Its seq moves the cursor only when it is the next one; else
    /// others wrote meanwhile and the next pull brings theirs (and this one, which applies as nothing).
    /// The caller holds the document's lock.
    fn flush(&self, id: &str) -> Result<(), String> {
        let (update, sv, n) = {
            let open = lock(&self.open);
            let Some(o) = open.get(id).filter(|o| o.c.pending) else { return Ok(()) };
            let txn = o.doc.transact();
            (txn.encode_state_as_update_v1(&sv_of(&o.c.acked)), txn.state_vector().encode_v1(), o.c.mine + 1)
        };
        if update.len() as u64 > MAX_UPDATE { return Err("an edit too big for one update".into()); }
        let (name, part) = {
            let k = lock(&self.keys);
            let name = k.name(&format!("doc:{id}"));
            (name.clone(), k.seal_doc(&self.vault, &name, "u", 0, &self.me, json!({"n": n}), &update)?)
        };
        let (v, _) = (self.call)(json!({"op": "doc_push", "vault": self.vault, "doc": name, "updates": [part.len()]}), Some(part), None)?;
        let seq = v["seq"].as_u64().ok_or("no seq")?;
        let epoch = lock(&self.keys).epoch();
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, id);
            // an edit made after `update` was taken is still pending: only what was sent counts as held
            let now = o.doc.transact().state_vector().encode_v1();
            (o.c.acked, o.c.mine, o.c.pending) = (hex(&sv), n, now != sv);
            o.c.seen.insert(self.me.clone(), n);
            if seq == o.c.seq + 1 { (o.c.seq, o.c.epoch) = (seq, epoch); }
            self.save(&open, id)?;
        }
        Ok(())
    }

    /// The document's log from where this Mac has it, a page at a time. A part that does not open or apply, or that
    /// is under an older key than this Mac's newest past where it had the log when it took that key, is skipped and
    /// warned. What came from others counts as held by the server (`acked`), so this Mac's next push is only its own.
    /// Returns whether anything new came.
    pub fn pull(&self, id: &str) -> Result<bool, String> {
        if !valid_id(id) { return Err("not a document id".into()); }
        let busy = self.busy(id);
        let _one = lock(&busy);
        self.pull_locked(id)
    }
    fn pull_locked(&self, id: &str) -> Result<bool, String> {
        let name = self.name(id);
        let mut any = false;
        let on = lock(&self.on).clone();
        loop {
            let since = lock(&self.open).get(id).map_or(0, |o| o.c.seq);
            let (v, body) = (self.call)(json!({"op": "doc_pull", "vault": self.vault, "doc": name, "since": since, "limit": PULL_LIMIT}), None, Some(MAX_PULL + MAX_UPDATE))?;
            let keys = lock(&self.keys).clone();
            let mut at = 0usize;
            let mut take = |len: u64| -> Result<&[u8], String> { let b = body.get(at..at + len as usize).ok_or("pull cut short")?; at += len as usize; Ok(b) };
            let mut got: Vec<Vec<u8>> = vec![];
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, id);
            let before = o.doc.transact().state_vector();
            let mut last = o.c.seq;
            // a page that breaks off (cut short, a gap) keeps what came before it: saved and passed on, then the error
            let mut broke = None;
            for u in v["updates"].as_array().into_iter().flatten() {
                let (Some(seq), Ok(part)) = (u["seq"].as_u64(), take(u["len"].as_u64().unwrap_or(0))) else { broke = Some("pull cut short".to_string()); break };
                if seq <= o.c.seq { continue; }
                if seq != o.c.seq + 1 { broke = Some(format!("the log skips from {} to {seq}", o.c.seq)); break; }
                o.c.seq = seq;
                last = seq;
                let from = u["from"].as_str().unwrap_or("");
                match self.take_part(&keys, &name, o, part, from) {
                    Ok(b) => got.push(b),
                    Err(e) => { if !from.is_empty() { o.c.lost.insert(from.to_string()); } let l = o.c.path.clone(); self.warn(format!("{}: update {seq} left out: {e}", if l.is_empty() { id.to_string() } else { l })); }
                }
            }
            o.c.epoch = keys.epoch();
            raise_acked(o, &before);
            let end = v["seq"].as_u64().unwrap_or(0);
            // more only when this page moved on: a server that says `more` and gives nothing new is not asked forever
            let more = broke.is_none() && v["more"] == true && last > since && last < end;
            if broke.is_none() && v["more"] == true && !more { self.warn(format!("{}: the server says there is more and gives nothing new", self.label_of(o, id))); }
            any |= !got.is_empty();
            self.save(&open, id)?;
            drop(open);
            for b in &got { for f in &on { f(id, b); } }
            if let Some(e) = broke { return Err(e); }
            if !more { break; }
        }
        Ok(any)
    }
    fn label_of(&self, o: &Open, id: &str) -> String { if o.c.path.is_empty() { id.to_string() } else { o.c.path.clone() } }
    /// Whether a document holds edits Yjs cannot place yet: they build on an update this Mac does not have.
    fn missing(&self, id: &str) -> bool { lock(&self.open).get(id).is_some_and(|o| o.doc.transact().has_missing_updates()) }
    fn label(&self, id: &str) -> String { lock(&self.open).get(id).map(|o| o.c.path.clone()).filter(|p| !p.is_empty()).unwrap_or_else(|| id.to_string()) }

    /// One update from the log or the live channel, checked and applied: its Yjs bytes. `from`: who the server says
    /// pushed it; a part sealed by anyone else does not open.
    fn take_part(&self, keys: &Keys, name: &str, o: &mut Open, part: &[u8], from: &str) -> Result<Vec<u8>, String> {
        if from.is_empty() { return Err("the server does not say who pushed it".into()); }
        let p = keys.open_doc(&self.vault, name, "u", 0, from, part)?;
        if p.epoch < keys.epoch() && o.c.epoch == keys.epoch() { return Err("sealed under an old key".into()); }
        apply(&o.doc, &p.body)?;
        // a gap in an author's counter: the server holds updates back (or gave them to nobody)
        if let Some(n) = p.meta["n"].as_u64() {
            let last = o.c.seen.get(&p.author).copied().unwrap_or(0);
            if last > 0 && n > last + 1 { self.warn(format!("updates from {} to {} held back by the server ({} missing)", p.author, if o.c.path.is_empty() { "a document" } else { &o.c.path }, n - last - 1)); }
            if n > last { o.c.seen.insert(p.author.clone(), n); }
        }
        // a longer member list than this Mac holds, as for records and frames
        let theirs = p.list.split_once(':').and_then(|(n, _)| n.parse::<u64>().ok()).unwrap_or(0);
        if theirs > keys.head.as_ref().map_or(0, |(n, _)| *n) { self.warn("Another member has seen a newer member list than the server gives this Mac.".into()); }
        Ok(p.body)
    }

    /// Every document whose log the server has further than this Mac, the manifest first (it names the others), then
    /// each note's and its sidecars'; then whatever this Mac has not sent yet. A document that fails is warned and the
    /// others go on. Returns the ids that changed.
    pub fn sync(&self) -> Result<Vec<String>, String> {
        let (v, _) = (self.call)(json!({"op": "doc_list", "vault": self.vault}), None, None)?;
        let server: BTreeMap<String, u64> = v["docs"].as_array().into_iter().flatten().filter_map(|d| Some((d["doc"].as_str()?.to_string(), d["seq"].as_u64()?))).collect();
        let behind = |id: &str| server.get(&self.name(id)).is_some_and(|s| *s > lock(&self.open).get(id).map_or(0, |o| o.c.seq));
        let mut changed = vec![];
        let mut pull = |id: &str| match self.pull(id) { Ok(true) => changed.push(id.to_string()), Ok(false) => {} Err(e) => self.warn(format!("{}: {e}", self.label(id))) };
        if behind(MANIFEST) { pull(MANIFEST); }
        // where the manifest puts each document now
        self.one_per_name();
        let paths = self.paths();
        { let mut open = lock(&self.open); for (p, id) in &paths { Self::entry(&mut open, id).c.path = p.clone(); } }
        self.keep_orphans(&paths);
        let mut ids: Vec<String> = self.paths().into_values().collect();
        ids.extend(lock(&self.open).keys().filter(|k| k.contains('#')).cloned());
        let sidecars: Vec<String> = ids.iter().filter(|id| !id.contains('#')).map(|id| format!("{id}#comments")).collect();
        ids.extend(sidecars);
        ids.sort();
        ids.dedup();
        for id in &ids { if behind(id) { pull(id); } }
        // edits that build on an update this Mac left out or never got: the log read once more from the start (the
        // server may serve the part now); still missing, it stays a warning every round until it is not
        let all: Vec<String> = lock(&self.open).keys().cloned().collect();
        let held: Vec<String> = all.into_iter().filter(|id| self.missing(id)).collect();
        for id in held {
            { let mut open = lock(&self.open); if let Some(o) = open.get_mut(&id) { o.c.seq = 0; } }
            pull(&id);
            if self.missing(&id) {
                let who = lock(&self.open).get(&id).map(|o| o.c.lost.iter().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default();
                self.warn(format!("{}: edits from {} are missing on this Mac", self.label(&id), if who.is_empty() { "another member".into() } else { who }));
            }
        }
        // a document with nothing missing names no lost authors any more
        let all: Vec<String> = lock(&self.open).keys().cloned().collect();
        for id in all { if !self.missing(&id) { if let Some(o) = lock(&self.open).get_mut(&id) { o.c.lost.clear(); } } }
        let pending: Vec<String> = lock(&self.open).iter().filter(|(_, o)| o.c.pending).map(|(k, _)| k.clone()).collect();
        for id in pending { self.send(&id); }
        Ok(changed)
    }
    /// Two manifest keys that are one name on a Mac's disk (case, normalization; two members made them apart): the
    /// first in order keeps it, the others move to a conflict name, the same on every Mac.
    fn one_per_name(&self) {
        let mut first: BTreeMap<String, String> = BTreeMap::new();
        let mut moves = vec![];
        for (p, id) in self.paths() {
            match first.get(&fold(&p)) { Some(_) => moves.push((p.clone(), conflict_path(&p, &id), id)), None => { first.insert(fold(&p), p); } }
        }
        for (from, to, id) in moves {
            if self.taken(&to, None) { continue; }
            if self.manifest(|m, txn| { m.remove(txn, from.as_str()); m.insert(txn, to.as_str(), id.clone()); }).is_ok() { self.warn(format!("{from}: the same name as another note on a Mac's disk, moved to {to}")); }
        }
    }
    /// A document the manifest no longer names, though this Mac had it at a path and it has text: two members made
    /// a note at the same path at once and the manifest kept the other one. It goes back in next to it, as a conflict
    /// copy (the same name on every Mac, so they agree).
    fn keep_orphans(&self, paths: &BTreeMap<String, String>) {
        let named: std::collections::BTreeSet<&String> = paths.values().collect();
        let lost: Vec<(String, String)> = lock(&self.open).iter()
            .filter(|(id, o)| note_id(id) && !named.contains(id) && !o.c.path.is_empty() && !text_of(&o.doc).is_empty())
            .map(|(id, o)| (id.clone(), conflict_path(&o.c.path, id))).collect();
        for (id, p) in lost {
            if self.taken(&p, None) { continue; }
            if self.manifest(|m, txn| { m.insert(txn, p.as_str(), id.clone()); }).is_ok() { self.warn(format!("{p}: made at the same path as another note at the same time, kept next to it")); }
            if let Some(o) = lock(&self.open).get_mut(&id) { o.c.path = p; }
        }
    }

    /// An update another member pushed, passed on by the live channel (`Event::Doc`): applied when it is the next in
    /// the log, otherwise the log is pulled. Returns the document's id when this Mac knows it. Not on the channel's
    /// own thread: it may pull.
    pub fn take_live(&self, name: &str, seq: u64, from: &str, part: &[u8]) -> Result<Option<String>, String> {
        let mut ids: Vec<String> = self.paths().into_values().collect();
        ids.extend(lock(&self.open).keys().cloned());
        let Some(id) = ids.into_iter().find(|id| self.name(id) == name) else { return Ok(None) };
        let busy = self.busy(&id);
        let _one = lock(&busy);
        let next = lock(&self.open).get(&id).map_or(0, |o| o.c.seq) + 1;
        if seq < next { return Ok(Some(id)); }
        if seq > next { self.pull_locked(&id)?; return Ok(Some(id)); }
        let keys = lock(&self.keys).clone();
        let body = {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, &id);
            let before = o.doc.transact().state_vector();
            o.c.seq = seq;
            let r = self.take_part(&keys, name, o, part, from);
            o.c.epoch = keys.epoch();
            raise_acked(o, &before);
            self.save(&open, &id)?;
            r
        };
        match body {
            Ok(b) => for f in lock(&self.on).clone() { f(&id, &b); },
            Err(e) => self.warn(format!("{}: update {seq} left out: {e}", self.label(&id))),
        }
        Ok(Some(id))
    }

    /// Write each note whose document's text changed since it was last written here, under `root` (temp file and
    /// rename). Never where `filter` keeps files out (System/, hidden), never through a symlink. A file there that is
    /// not what Relay last wrote goes to `keep` first; a renamed note's old file goes once it is as Relay wrote it
    /// (else to `keep`). Returns the paths written (Relay's own, for a watcher) and what failed.
    pub fn export(&self, root: &Path, filter: &Filter, keep: &dyn Fn(&str, &[u8])) -> (Vec<String>, Vec<String>) {
        let (mut wrote, mut errors) = (vec![], vec![]);
        // a renamed note's old place another note has taken since: that file is the other note's, not removed
        let owned: std::collections::BTreeSet<String> = self.paths().keys().map(|p| fold(p)).collect();
        for (path, id) in self.paths() {
            if filter.skips(&path, false) || through_link(root, &path) { self.warn(format!("{path}: a document is not written there (a guarded or linked folder)")); continue; }
            let busy = self.busy(&id);
            let _one = lock(&busy);
            let mut open = lock(&self.open);
            let Some(o) = open.get_mut(&id) else { continue };
            let text = text_of(&o.doc);
            let h = sync::sha256_hex(text.as_bytes());
            let file = root.join(&path);
            if o.c.at == path && h == o.c.out && file.exists() { continue; }
            // the note's old place, after a rename: as Relay wrote it, it goes; anything else is kept first
            if !o.c.at.is_empty() && fold(&o.c.at) != fold(&path) && !owned.contains(&fold(&o.c.at)) && !filter.skips(&o.c.at, false) && !through_link(root, &o.c.at) {
                let old = root.join(&o.c.at);
                if let Ok(b) = std::fs::read(&old) {
                    if sync::sha256_hex(&b) != o.c.out { keep(&o.c.at, &b); }
                    if let Err(e) = std::fs::remove_file(&old) { errors.push(format!("{}: {e}", o.c.at)); continue; }
                }
            }
            if let Ok(b) = std::fs::read(&file) { if sync::sha256_hex(&b) != o.c.out && sync::sha256_hex(&b) != h { keep(&path, &b); } }
            match sync::write_atomic(&file, text.as_bytes(), None) {
                Ok(_) => { (o.c.out, o.c.at) = (h, path.clone()); wrote.push(path.clone()); if let Err(e) = self.save(&open, &id) { errors.push(e); } }
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
    use std::sync::atomic::{AtomicBool, Ordering};

    const V: &str = "0123456789abcdef";
    /// A server's document ops in memory: per name its log (part, who pushed it).
    #[derive(Default)]
    struct Fake { logs: BTreeMap<String, Vec<(Vec<u8>, String)>> }
    type Server = Arc<Mutex<Fake>>;
    fn call(srv: &Server, me: &str, online: &Arc<AtomicBool>) -> Call {
        let (srv, me, online) = (srv.clone(), me.to_string(), online.clone());
        Box::new(move |req, body, _| {
            if !online.load(Ordering::SeqCst) { return Err("no answer".into()); }
            let mut f = srv.lock().unwrap();
            let doc = req["doc"].as_str().unwrap_or("").to_string();
            match req["op"].as_str().unwrap() {
                "doc_push" => { let log = f.logs.entry(doc).or_default(); log.push((body.unwrap(), me.clone())); Ok((json!({"seq": log.len()}), vec![])) }
                "doc_pull" => {
                    let since = req["since"].as_u64().unwrap() as usize;
                    let log = f.logs.get(&doc).cloned().unwrap_or_default();
                    let end = log.len().min(since + req["limit"].as_u64().unwrap_or(1000) as usize);
                    let mut body = vec![];
                    let ups: Vec<Value> = (since..end).map(|i| { body.extend(&log[i].0); json!({"seq": i + 1, "len": log[i].0.len(), "from": log[i].1}) }).collect();
                    Ok((json!({"updates": ups, "seq": log.len(), "more": end < log.len()}), body))
                }
                "doc_list" => Ok((json!({"docs": f.logs.iter().map(|(d, l)| json!({"doc": d, "seq": l.len()})).collect::<Vec<_>>()}), vec![])),
                _ => Ok((json!({}), vec![])),
            }
        })
    }
    fn tmp(tag: &str) -> PathBuf { std::env::temp_dir().join(format!("relay-docs-{tag}-{}", std::process::id())) }
    /// A Mac: its Docs on `srv`, this device `me`, a switch to take it off line.
    fn mac(srv: &Server, keys: &Keys, tag: &str, me: &str) -> (Docs, Arc<AtomicBool>) {
        let online = Arc::new(AtomicBool::new(true));
        let d = tmp(tag);
        std::fs::remove_dir_all(&d).ok();
        (Docs::new(V, keys.clone(), call(srv, me, &online), &d, me), online)
    }
    /// An edit as an editor makes it.
    fn edit(d: &Docs, id: &str, f: impl FnOnce(&yrs::TextRef, &mut yrs::TransactionMut)) {
        let doc = Doc::new();
        apply(&doc, &d.diff(id, &StateVector::default().encode_v1()).unwrap()).unwrap();
        let u = change(&doc, |x| { let t = x.get_or_insert_text("md"); f(&t, &mut x.transact_mut()); });
        d.apply_local(id, &u).unwrap();
    }
    fn append(d: &Docs, id: &str, s: &str) { edit(d, id, |t, txn| { let n = t.len(txn); t.insert(txn, n, s); }); }
    const A: &str = "aaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbb";

    #[test]
    fn ids_and_paths_are_checked() {
        assert!(valid_id(MANIFEST) && valid_id(&"a".repeat(32)) && valid_id(&format!("{}#comments", "0".repeat(32))));
        assert!(!valid_id("x") && !valid_id(&"A".repeat(32)) && !valid_id(&format!("{}#", "0".repeat(32))) && !valid_id("manifest#Bad"));
        assert!(safe_path("Projects/Plan.md") && !safe_path("../x.md") && !safe_path("/etc/x.md") && !safe_path(".obsidian/x.md") && !safe_path("a/b.txt"));
    }

    /// Made and edited while the server was out of reach: kept here, sent at the next sync, and the other Mac gets both.
    #[test]
    fn what_was_made_off_line_goes_out_at_the_next_sync() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, a_on), (b, _)) = (mac(&srv, &k, "off-a", A), mac(&srv, &k, "off-b", B));
        a_on.store(false, Ordering::SeqCst);
        let id = a.create("Plan.md", "one ").unwrap();
        append(&a, &id, "two");
        assert!(!a.take_warnings().is_empty(), "told it is not sent yet");
        a_on.store(true, Ordering::SeqCst);
        a.sync().unwrap();
        b.sync().unwrap();
        assert_eq!((b.paths().get("Plan.md"), b.text(&id).as_str()), (Some(&id), "one two"));
        std::fs::remove_dir_all(tmp("off-a")).ok();
        std::fs::remove_dir_all(tmp("off-b")).ok();
    }

    /// A part in the log that does not open (a member's broken write, a server's): left out, warned, the cursor moves
    /// past it, and what comes after it is taken.
    #[test]
    fn a_broken_update_is_left_out_and_the_rest_comes() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "bad-a", A), mac(&srv, &k, "bad-b", B));
        let id = a.create("Plan.md", "x").unwrap();
        let mut junk = (28u32).to_be_bytes().to_vec();
        junk.extend([9u8; 80]);
        srv.lock().unwrap().logs.get_mut(&a.name(&id)).unwrap().push((junk, B.into()));
        append(&a, &id, "y");
        b.sync().unwrap();
        assert_eq!(b.text(&id), "xy");
        assert!(b.take_warnings().iter().any(|w| w.contains("update 2 left out")), "warned with its place");
        // an update pushed by one device sealed as another's: does not open, left out too
        let name = a.name(&id);
        let forged = k.seal_doc(V, &name, "u", 0, A, json!({"n": 99, "k": {}}), &change(&Doc::new(), |d| { d.get_or_insert_text("md").insert(&mut d.transact_mut(), 0, "evil"); })).unwrap();
        srv.lock().unwrap().logs.get_mut(&name).unwrap().push((forged, B.into()));
        b.sync().unwrap();
        assert_eq!(b.text(&id), "xy");
        std::fs::remove_dir_all(tmp("bad-a")).ok();
        std::fs::remove_dir_all(tmp("bad-b")).ok();
    }

    /// A part this Mac left out, then an edit by the same author that builds on it: Yjs cannot place that edit, so
    /// the log is read again from the start; while the server still serves the part broken, the edit stays missing and
    /// is warned (naming the author); once it serves it whole, the next sync has everything.
    #[test]
    fn edits_that_build_on_a_part_left_out_are_warned_and_come_once_the_part_does() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "miss-a", A), mac(&srv, &k, "miss-b", B));
        let id = a.create("Plan.md", "x").unwrap();
        b.sync().unwrap();
        append(&a, &id, "1");
        let name = a.name(&id);
        let good = std::mem::replace(&mut srv.lock().unwrap().logs.get_mut(&name).unwrap()[1].0, vec![0u8, 0, 0, 28].into_iter().chain([9u8; 80]).collect());
        append(&a, &id, "2");
        b.sync().unwrap();
        let w = b.take_warnings();
        assert!(w.iter().any(|w| w.contains(&format!("edits from {A} are missing"))), "{w:?}");
        assert_eq!(b.text(&id), "x");
        srv.lock().unwrap().logs.get_mut(&name).unwrap()[1].0 = good;
        b.sync().unwrap();
        assert_eq!(b.text(&id), "x12");
        assert!(!b.take_warnings().iter().any(|w| w.contains("missing")));
        std::fs::remove_dir_all(tmp("miss-a")).ok();
        std::fs::remove_dir_all(tmp("miss-b")).ok();
    }

    /// A Mac that only pulled a long history, then edits: its push is that edit, not the history again.
    #[test]
    fn after_a_pull_a_push_is_only_this_macs_own_edit() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "ack-a", A), mac(&srv, &k, "ack-b", B));
        let id = a.create("Plan.md", "").unwrap();
        let mb = "m".repeat(1 << 20);
        for _ in 0..5 { append(&a, &id, &mb); }
        b.sync().unwrap();
        assert_eq!(b.text(&id).len(), 5 << 20);
        append(&b, &id, "!");
        let last = srv.lock().unwrap().logs[&a.name(&id)].last().unwrap().clone();
        assert!(last.1 == B && last.0.len() < 4096, "a push of {} bytes", last.0.len());
        assert!(b.take_warnings().is_empty());
        std::fs::remove_dir_all(tmp("ack-a")).ok();
        std::fs::remove_dir_all(tmp("ack-b")).ok();
    }

    /// A server that says there is more and gives nothing new: the pull stops (warned), it does not ask forever.
    #[test]
    fn a_server_that_says_more_and_gives_nothing_is_not_asked_forever() {
        let k = Keys::from(VaultKey::generate());
        let lies: Call = Box::new(|_, _, _| Ok((json!({"updates": [], "seq": 999_999, "more": true}), vec![])));
        let d = Arc::new(Docs::new(V, k, lies, &tmp("lie"), A));
        let (tx, rx) = std::sync::mpsc::channel();
        { let d = d.clone(); std::thread::spawn(move || { tx.send(d.pull(MANIFEST)).ok(); }); }
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).expect("the pull never ended"), Ok(false));
        assert!(d.take_warnings().iter().any(|w| w.contains("gives nothing new")));
        std::fs::remove_dir_all(tmp("lie")).ok();
    }

    /// A Mac kept current by live updates alone (5 MiB of another's edits), then an edit of its own: the push is only
    /// that edit.
    #[test]
    fn after_live_updates_a_push_is_only_this_macs_own_edit() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "live-a", A), mac(&srv, &k, "live-b", B));
        let id = a.create("Plan.md", "").unwrap();
        b.sync().unwrap();
        let mb = "m".repeat(1 << 20);
        for _ in 0..5 { append(&a, &id, &mb); }
        let name = a.name(&id);
        let log = srv.lock().unwrap().logs[&name].clone();
        for (i, (p, who)) in log.iter().enumerate().skip(1) { b.take_live(&name, i as u64 + 1, who, p).unwrap(); }
        assert_eq!(b.text(&id).len(), 5 << 20);
        append(&b, &id, "!");
        let last = srv.lock().unwrap().logs[&name].last().unwrap().clone();
        assert!(last.1 == B && last.0.len() < 4096, "a push of {} bytes", last.0.len());
        std::fs::remove_dir_all(tmp("live-a")).ok();
        std::fs::remove_dir_all(tmp("live-b")).ok();
    }

    /// The live channel and a round on one document at once: no update taken twice or lost.
    #[test]
    fn live_updates_and_a_round_at_once_end_the_same() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "race-a", A), mac(&srv, &k, "race-b", B));
        let id = a.create("Plan.md", "").unwrap();
        b.sync().unwrap();
        for i in 0..40 { append(&a, &id, &format!("{i},")); }
        let name = a.name(&id);
        let log = srv.lock().unwrap().logs[&name].clone();
        let b = Arc::new(b);
        let live = { let b = b.clone(); let name = name.clone(); std::thread::spawn(move || for (i, (p, from)) in log.iter().enumerate() { b.take_live(&name, i as u64 + 1, from, p).unwrap(); }) };
        b.sync().unwrap();
        live.join().unwrap();
        b.sync().unwrap();
        assert_eq!(b.text(&id), a.text(&id));
        std::fs::remove_dir_all(tmp("race-a")).ok();
        std::fs::remove_dir_all(tmp("race-b")).ok();
    }

    /// Export: a note written once; never in a guarded folder or through a link; a file there that is not what Relay
    /// wrote is kept first; after a rename the old file goes (kept first when someone changed it).
    #[test]
    fn export_writes_only_where_it_may_and_keeps_what_it_replaces() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let (a, _) = mac(&srv, &k, "exp-a", A);
        let root = tmp("exp-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("Notes")).unwrap();
        let elsewhere = tmp("exp-elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join("Linked")).unwrap();
        let mut f = Filter::vault_default();
        f.guarded = vec!["System".into()];
        f.only = vec!["System/rules".into()];
        std::fs::write(root.join("Notes/Plan.md"), "mine").unwrap();
        let id = a.create("Notes/Plan.md", "doc").unwrap();
        a.create("System/commands/x.md", "evil").unwrap();
        a.create("Linked/x.md", "out").unwrap();
        let kept: Arc<Mutex<Vec<(String, Vec<u8>)>>> = Arc::default();
        let keep = { let kept = kept.clone(); move |p: &str, b: &[u8]| kept.lock().unwrap().push((p.into(), b.to_vec())) };
        let (wrote, errors) = a.export(&root, &f, &keep);
        assert_eq!((wrote, errors), (vec!["Notes/Plan.md".to_string()], vec![]));
        assert_eq!(std::fs::read_to_string(root.join("Notes/Plan.md")).unwrap(), "doc");
        assert_eq!(kept.lock().unwrap().clone(), vec![("Notes/Plan.md".to_string(), b"mine".to_vec())]);
        assert!(!root.join("System").exists() && std::fs::read_dir(&elsewhere).unwrap().next().is_none(), "nothing in System/ or through the link");
        assert!(a.export(&root, &f, &keep).0.is_empty(), "unchanged: not written again");
        assert!(a.excluded(&f).contains(&"Notes/Plan.md".to_string()) && !a.excluded(&f).contains(&"System/commands/x.md".to_string()));
        // renamed: the old file goes, the new one comes
        a.rename("Notes/Plan.md", "Notes/Plan 2.md").unwrap();
        a.export(&root, &f, &keep);
        assert!(!root.join("Notes/Plan.md").exists() && root.join("Notes/Plan 2.md").exists());
        // renamed again after someone changed the file: kept first, then gone
        std::fs::write(root.join("Notes/Plan 2.md"), "changed by hand").unwrap();
        a.rename("Notes/Plan 2.md", "Notes/Plan 3.md").unwrap();
        a.export(&root, &f, &keep);
        assert!(!root.join("Notes/Plan 2.md").exists() && kept.lock().unwrap().iter().any(|(p, b)| p == "Notes/Plan 2.md" && b == b"changed by hand"));
        assert_eq!(a.paths().get("Notes/Plan 3.md"), Some(&id));
        // a path differing only in case is the same note
        assert!(a.create("notes/plan 3.md", "x").is_err());
        for t in ["exp-a", "exp-root", "exp-elsewhere"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// Two members make a note at the same path while apart: the manifest keeps one, and the other comes back next to
    /// it as a conflict copy, the same on both Macs.
    #[test]
    fn two_notes_made_at_one_path_both_stay() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, a_on), (b, b_on)) = (mac(&srv, &k, "same-a", A), mac(&srv, &k, "same-b", B));
        a_on.store(false, Ordering::SeqCst);
        b_on.store(false, Ordering::SeqCst);
        let x = a.create("Same.md", "from a").unwrap();
        let y = b.create("Same.md", "from b").unwrap();
        a_on.store(true, Ordering::SeqCst);
        b_on.store(true, Ordering::SeqCst);
        for _ in 0..3 { a.sync().unwrap(); b.sync().unwrap(); }
        assert_eq!(a.paths(), b.paths());
        let ids: std::collections::BTreeSet<String> = a.paths().into_values().collect();
        assert_eq!(ids, [x, y].into_iter().collect(), "{:?}", a.paths());
        assert!(a.paths().keys().any(|p| p.starts_with("Same (conflict ")));
        std::fs::remove_dir_all(tmp("same-a")).ok();
        std::fs::remove_dir_all(tmp("same-b")).ok();
    }

    /// After this Mac took a new key and pulled, an update under the old key appended to the log is a removed
    /// member's (they keep the old key): left out, warned, and nothing of it gets into the text.
    #[test]
    fn an_update_under_an_old_key_after_the_key_changed_is_refused() {
        let (srv, old) = (Server::default(), Keys::from(VaultKey::generate()));
        let (d, _) = mac(&srv, &old, "old-a", A);
        let id = d.create("A.md", "hello").unwrap();
        let mut new = old.clone();
        new.add(1, VaultKey::generate());
        d.set_keys(new);
        d.pull(&id).unwrap();
        let name = d.name(&id);
        let u = change(&Doc::new(), |x| { x.get_or_insert_text("md").insert(&mut x.transact_mut(), 0, "evil "); });
        srv.lock().unwrap().logs.get_mut(&name).unwrap().push((old.seal_doc(V, &name, "u", 0, B, json!({"n": 1, "k": {}}), &u).unwrap(), B.into()));
        d.pull(&id).unwrap();
        assert_eq!(d.text(&id), "hello");
        assert!(d.take_warnings().iter().any(|w| w.contains("old key")));
        std::fs::remove_dir_all(tmp("old-a")).ok();
    }

    /// A gap in an author's counter (the server holds an update back from this Mac): warned.
    #[test]
    fn a_gap_in_an_authors_updates_is_warned() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "gap-a", A), mac(&srv, &k, "gap-b", B));
        let id = a.create("Plan.md", "x").unwrap();
        b.sync().unwrap();
        append(&a, &id, "1");
        let name = a.name(&id);
        let held = srv.lock().unwrap().logs.get_mut(&name).unwrap().pop().unwrap();
        append(&a, &id, "2");
        let _ = held;
        b.sync().unwrap();
        assert!(b.take_warnings().iter().any(|w| w.contains("held back")), "the second update's counter skips one");
        std::fs::remove_dir_all(tmp("gap-a")).ok();
        std::fs::remove_dir_all(tmp("gap-b")).ok();
    }
}
