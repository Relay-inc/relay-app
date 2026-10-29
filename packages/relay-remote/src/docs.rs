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
/// Documents in one vault at most (the server refuses more).
pub const MAX_DOCS: usize = 10_000;

/// How far this Mac has a document: every update up to `seq` taken (or skipped, warned), `epoch` the newest key when it
/// last pulled (an update under an older key after that is a removed member's).
/// `path`: where the manifest last put it. `at`, `out`: where and what (hash) it was last written as a note. `pending`:
/// an edit here the server has not taken yet; `acked` the state vector (hex) it holds of this Mac's edits; `mine` this
/// device's counter of updates to it; `seen` the last counter of each author (a gap: updates held back); `lost` the
/// authors of parts left out (named when edits are missing). `via`: who made the edit not sent yet when it came from
/// the note's file ("claude", "disk", "relay"; kept with the update for history). `bound`: the server knows the note's
/// record name is a document's (`doc_bind`). `bound_as`: the path the server was told is this document's (`doc_bind`),
/// "" none yet. `seeded`: made from an existing file here (8b), not by an edit.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Cursor { seq: u64, epoch: u32, path: String, at: String, out: String, pending: bool, acked: String, mine: u64, seen: BTreeMap<String, u64>,
    lost: std::collections::BTreeSet<String>, via: String, bound_as: String, seeded: bool }
struct Open { doc: Doc, c: Cursor }

type On = Arc<dyn Fn(&str, &[u8]) + Send + Sync>;
/// One shared vault's documents on this Mac. `me`: this device (the first 16 hex of its fingerprint), the author of
/// what it writes. `on`: called with (document id, Yjs update) for every update another member made (ticket 9's
/// editor). `busy`: one lock per document, so a live update and a round never work on it at once. `warnings`: what
/// the user should hear of (`take_warnings`).
pub struct Docs {
    vault: String, me: String, keys: Mutex<Keys>, call: Call, dir: PathBuf, open: Mutex<BTreeMap<String, Open>>, on: Mutex<Vec<On>>,
    busy: Mutex<BTreeMap<String, Arc<Mutex<()>>>>, warnings: Mutex<Vec<String>>, walker: Mutex<sync::Walker>,
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
/// A file's text as a document holds it: no byte-order mark, "\n" line ends.
fn doc_text(b: &[u8]) -> String {
    let s = String::from_utf8_lossy(b);
    s.strip_prefix('\u{feff}').unwrap_or(&s).replace("\r\n", "\n")
}
/// One change from `a` to `b`, in chars: a[s..e] became b[t..u].
type Hunk = (usize, usize, usize, usize);
/// Where each line of `s` starts, then its end.
fn line_starts(s: &[char]) -> Vec<usize> {
    let mut v = vec![0];
    v.extend(s.iter().enumerate().filter(|(_, c)| **c == '\n').map(|(i, _)| i + 1));
    if *v.last().unwrap() != s.len() { v.push(s.len()); }
    v
}
/// The changes from `a` to `b`: whole lines matched (Myers, linear space), each changed run between them trimmed to
/// the chars that differ.
fn diff(a: &[char], b: &[char]) -> Vec<Hunk> {
    let (la, lb) = (line_starts(a), line_starts(b));
    let lines = |s: &[char], l: &[usize]| -> Vec<String> { (0..l.len() - 1).map(|i| s[l[i]..l[i + 1]].iter().collect()).collect() };
    let (xa, xb) = (lines(a, &la), lines(b, &lb));
    let mut runs: Vec<(usize, usize, usize, usize)> = vec![];
    for op in similar::capture_diff_slices(similar::Algorithm::Myers, &xa, &xb) {
        if matches!(op, similar::DiffOp::Equal { .. }) { continue; }
        let (o, n) = (op.old_range(), op.new_range());
        // a removal and an insertion next to each other are one run
        match runs.last_mut() { Some(r) if r.1 == o.start && r.3 == n.start => { r.1 = o.end; r.3 = n.end; } _ => runs.push((o.start, o.end, n.start, n.end)) }
    }
    let mut out = vec![];
    for (i, pi, j, pj) in runs {
        let (mut s, mut e, mut t, mut u) = (la[i], la[pi], lb[j], lb[pj]);
        while s < e && t < u && a[s] == b[t] { s += 1; t += 1; }
        while s < e && t < u && a[e - 1] == b[u - 1] { e -= 1; u -= 1; }
        if s < e || t < u { out.push((s, e, t, u)); }
    }
    out
}
/// `disk`'s changes to `base`, made on `cur` (which holds others' changes to `base`), as diff3 does: (char position
/// in `cur`, chars removed, text put there), the last place first, removals before what goes in at one place. A
/// change both sides made alike counts once; text others changed or removed is theirs (not removed again); text both
/// put at one place stays, theirs first.
fn merge3(base: &[char], cur: &[char], disk: &[char]) -> Vec<(usize, usize, String)> {
    let theirs = diff(base, cur);
    // where base position p (between two chars) is in `cur`: inside a run others changed, after their text
    let place = |p: usize| -> usize {
        let mut d = 0isize;
        for &(s, e, t, u) in &theirs {
            if s > p { break; }
            if s < p && p < e { return u; }
            if e > p { break; }
            d += (u - t) as isize - (e - s) as isize;
        }
        (p as isize + d) as usize
    };
    let gone = |x: usize| theirs.iter().any(|&(s, e, _, _)| s <= x && x < e);
    let mut edits = vec![];
    for (s, e, t, u) in diff(base, disk) {
        // the same change on both sides: already in `cur`
        if theirs.iter().any(|&(ts, te, tt, tu)| ts == s && te == e && cur[tt..tu] == disk[t..u]) { continue; }
        let mut run: Option<(usize, usize)> = None;
        for x in s..e {
            if gone(x) { continue; }
            let at = place(x);
            run = match run { Some((p, l)) if p + l == at => Some((p, l + 1)), Some(r) => { edits.push((r.0, r.1, String::new())); Some((at, 1)) } None => Some((at, 1)) };
        }
        if let Some((p, l)) = run { edits.push((p, l, String::new())); }
        if t < u { edits.push((place(s), 0, disk[t..u].iter().collect())); }
    }
    edits.sort_by(|a, b| b.0.cmp(&a.0).then(a.2.is_empty().cmp(&b.2.is_empty()).reverse()));
    edits
}
/// The edits of `merge3` made on a document whose text is `cur`, as one change (Y.Text counts UTF-8 bytes).
fn make_edits(doc: &Doc, cur: &str, edits: &[(usize, usize, String)]) -> Vec<u8> {
    let at: Vec<u32> = cur.char_indices().map(|(i, _)| i as u32).chain([cur.len() as u32]).collect();
    change(doc, |d| {
        let t = d.get_or_insert_text("md");
        let mut txn = d.transact_mut();
        for (p, del, ins) in edits {
            if *del > 0 { t.remove_range(&mut txn, at[*p], at[p + del] - at[*p]); }
            if !ins.is_empty() { t.insert(&mut txn, at[*p], ins); }
        }
    })
}
/// A note's conflict name: "Plan.md" -> "Plan (conflict 1a2b3c4d).md", the same on every Mac for the same document.
fn conflict_path(path: &str, id: &str) -> String { format!("{} (conflict {}).md", path.trim_end_matches(".md"), &id[..8]) }

/// One editing session of a document as history shows it: the updates `from`..=`to` (log seqs), all by `author` with
/// less than SESSION_GAP between them; `by` what made them ("claude", "disk", "relay", "restore", "" typed in a page);
/// `start`, `end` (ms) the first and last update's time; `text` the note after the session, `added`/`removed` its lines
/// against the session before.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Version { pub from: u64, pub to: u64, pub author: String, pub by: Vec<String>, pub start: u64, pub end: u64, pub text: String, pub added: usize, pub removed: usize }
/// A document's history as far as this Mac read its log: the next seq to read, the text so far (Yjs state, hex) and
/// the sessions.
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct History { seq: u64, state: String, versions: Vec<Version> }
/// Two updates of one author further apart than this are two sessions.
const SESSION_GAP: u64 = 10 * 60 * 1000;
/// Lines `b` adds and removes against `a`.
fn line_counts(a: &str, b: &str) -> (usize, usize) {
    similar::TextDiff::from_lines(a, b).iter_all_changes().fold((0, 0), |(p, m), c| match c.tag() {
        similar::ChangeTag::Insert => (p + 1, m), similar::ChangeTag::Delete => (p, m + 1), similar::ChangeTag::Equal => (p, m) })
}

impl Docs {
    pub(crate) fn new(vault: &str, keys: Keys, call: Call, dir: &Path, me: &str) -> Docs {
        let index: BTreeMap<String, Cursor> = std::fs::read_to_string(dir.join("index.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let open = index.into_iter().filter(|(id, _)| valid_id(id)).map(|(id, c)| {
            let doc = Doc::new();
            // a state that does not read (a disk error) starts empty: the next pull from 0 brings it back
            let c = match std::fs::read(dir.join(Self::file(&id))).ok().map(|b| apply(&doc, &b)) { Some(Ok(())) => c, _ => Cursor { path: c.path, at: c.at, out: c.out, ..Cursor::default() } };
            (id, Open { doc, c })
        }).collect();
        Docs { vault: vault.into(), me: me.into(), keys: Mutex::new(keys), call, dir: dir.into(), open: Mutex::new(open), on: Mutex::default(), busy: Mutex::default(), warnings: Mutex::default(), walker: Mutex::default() }
    }
    fn file(id: &str) -> String { format!("{}.bin", id.replace('#', "~")) }
    /// The text Relay last wrote to the note's file (or took from it): what a change on disk is measured against.
    fn out_file(&self, id: &str) -> PathBuf { self.dir.join(format!("{}.out", id.replace('#', "~"))) }
    /// The newest keys (after a rotation, keep_keys).
    pub fn set_keys(&self, k: Keys) { *lock(&self.keys) = k; }
    /// A document's name on the server.
    pub fn name(&self, id: &str) -> String { lock(&self.keys).name(&format!("doc:{id}")) }
    /// Called with every update this Mac's editor did not make: another member's, or a change of the note's file taken
    /// in (absorb, export): (document id, Yjs update). Not with what `apply_local` took.
    pub fn subscribe(&self, f: impl Fn(&str, &[u8]) + Send + Sync + 'static) { lock(&self.on).push(Arc::new(f)); }
    /// What went wrong or looked wrong since the last call (a part that did not open, updates held back), for the user.
    pub fn take_warnings(&self) -> Vec<String> { std::mem::take(&mut *lock(&self.warnings)) }
    fn warn(&self, w: String) { let mut all = lock(&self.warnings); if !all.contains(&w) { all.push(w); } }
    fn busy(&self, id: &str) -> Arc<Mutex<()>> { lock(&self.busy).entry(id.into()).or_default().clone() }

    fn save(&self, open: &BTreeMap<String, Open>, id: &str) -> Result<(), String> {
        let o = &open[id];
        sync::write_atomic(&self.dir.join(Self::file(id)), &o.doc.transact().encode_state_as_update_v1(&StateVector::default()), None).map_err(|e| e.to_string())?;
        self.save_index(open)
    }
    fn save_index(&self, open: &BTreeMap<String, Open>) -> Result<(), String> {
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
    /// The notes deleted in the Pages tab (manifest map "gone"): document id -> the path it had. The document and its
    /// log stay on the server (history); no Mac brings one back, and Undo puts it back at that path.
    pub fn gone(&self) -> BTreeMap<String, String> {
        let open = lock(&self.open);
        let Some(m) = open.get(MANIFEST) else { return BTreeMap::new() };
        let map = m.doc.get_or_insert_map("gone");
        let txn = m.doc.transact();
        map.iter(&txn).filter_map(|(id, v)| Some((id.to_string(), v.to_string(&txn)))).filter(|(id, p)| note_id(id) && safe_path(p)).collect()
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
    /// A new note as a document: its text, then its path in the manifest, so no Mac learns of the note before its text
    /// can reach it. Kept here first; sent now if the server can be reached, else with the next sync (the documents
    /// before the manifest).
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
        self.send(&id);
        self.manifest(|m, _, txn| { m.insert(txn, path, id.clone()); })?;
        Ok(id)
    }
    /// A note moved: only the manifest changes, the document (and its history) stays. The old file goes at the next
    /// export (`file_moved` when the Pages tab moved it already).
    pub fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        if !safe_path(to) { return Err(format!("not a note path: {to}")); }
        let id = self.paths().get(from).ok_or_else(|| format!("not a document: {from}"))?.clone();
        if self.taken(to, Some(from)) { return Err(format!("already a document: {to}")); }
        self.manifest(|m, _, txn| { m.remove(txn, from); m.insert(txn, to, id.clone()); })?;
        let mut open = lock(&self.open);
        if let Some(o) = open.get_mut(&id) { o.c.path = to.into(); }
        self.save(&open, &id)
    }
    /// The Pages tab moved the note's file to `path` (its document renamed there): the file there is the one Relay
    /// wrote, so a change to it (links the move rewrote) is measured as usual.
    pub fn file_moved(&self, path: &str) {
        let Some(id) = self.paths().get(path).cloned() else { return };
        let mut open = lock(&self.open);
        if let Some(o) = open.get_mut(&id) { o.c.at = path.into(); }
        self.save(&open, &id).ok();
    }
    /// A note deleted in the Pages tab (its file is in the trash already): out of the manifest, into "gone", so every
    /// Mac removes its file. Returns its document id, None when it is no document.
    pub fn remove(&self, path: &str) -> Result<Option<String>, String> {
        let Some(id) = self.paths().get(path).cloned() else { return Ok(None) };
        self.manifest(|m, g, txn| { m.remove(txn, path); g.insert(txn, id.as_str(), path); })?;
        let mut open = lock(&self.open);
        if let Some(o) = open.get_mut(&id) { o.c.at.clear(); }
        self.save(&open, &id)?;
        Ok(Some(id))
    }
    /// Undo of `remove`: the document back at `path` (its file is back from the trash). Whether there was one.
    pub fn restore(&self, path: &str) -> Result<bool, String> {
        let Some(id) = self.gone().into_iter().find(|(_, p)| p == path).map(|(id, _)| id) else { return Ok(false) };
        if self.taken(path, None) { return Err(format!("already a document: {path}")); }
        self.manifest(|m, g, txn| { g.remove(txn, id.as_str()); m.insert(txn, path, id.clone()); })?;
        let mut open = lock(&self.open);
        let o = Self::entry(&mut open, &id);
        (o.c.path, o.c.at) = (path.into(), path.into());
        self.save(&open, &id)?;
        Ok(true)
    }
    /// A change to the manifest (its maps "paths" and "gone"), kept here and sent.
    fn manifest(&self, f: impl FnOnce(&yrs::MapRef, &yrs::MapRef, &mut yrs::TransactionMut)) -> Result<(), String> {
        let busy = self.busy(MANIFEST);
        let _one = lock(&busy);
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, MANIFEST);
            change(&o.doc, |d| { let (m, g) = (d.get_or_insert_map("paths"), d.get_or_insert_map("gone")); f(&m, &g, &mut d.transact_mut()); });
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
        let (update, sv, n, via) = {
            let open = lock(&self.open);
            let Some(o) = open.get(id).filter(|o| o.c.pending) else { return Ok(()) };
            let txn = o.doc.transact();
            (txn.encode_state_as_update_v1(&sv_of(&o.c.acked)), txn.state_vector().encode_v1(), o.c.mine + 1, o.c.via.clone())
        };
        let meta = if via.is_empty() { json!({"n": n}) } else { json!({"n": n, "o": via}) };
        if update.len() as u64 > MAX_UPDATE { return Err("an edit too big for one update".into()); }
        let (name, part) = {
            let k = lock(&self.keys);
            let name = k.name(&format!("doc:{id}"));
            (name.clone(), k.seal_doc(&self.vault, &name, "u", 0, &self.me, meta, &update)?)
        };
        let (v, _) = (self.call)(json!({"op": "doc_push", "vault": self.vault, "doc": name, "updates": [part.len()]}), Some(part), None)?;
        let seq = v["seq"].as_u64().ok_or("no seq")?;
        let epoch = lock(&self.keys).epoch();
        {
            let mut open = lock(&self.open);
            let o = Self::entry(&mut open, id);
            // an edit made after `update` was taken is still pending: only what was sent counts as held
            let now = o.doc.transact().state_vector().encode_v1();
            (o.c.acked, o.c.mine, o.c.pending, o.c.via) = (hex(&sv), n, now != sv, String::new());
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

    /// A document's history, oldest session first: its whole log read from the server (only what this Mac did not
    /// read before, the rest kept in `history/`), every part opened as its author and replayed into a document of
    /// its own, never a snapshot. A part that does not open is left out of the history (the live document warns of
    /// it). Nothing here touches the document itself.
    pub fn history(&self, id: &str) -> Result<Vec<Version>, String> {
        if !note_id(id) { return Err("not a note's document".into()); }
        let file = self.dir.join("history").join(format!("{id}.json"));
        let mut h: History = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let doc = Doc::new();
        if let Some(b) = unhex(&h.state).filter(|b| !b.is_empty()) { apply(&doc, &b)?; }
        let name = self.name(id);
        loop {
            let since = h.seq;
            let (v, body) = (self.call)(json!({"op": "doc_pull", "vault": self.vault, "doc": name, "since": since, "limit": PULL_LIMIT}), None, Some(MAX_PULL + MAX_UPDATE))?;
            let keys = lock(&self.keys).clone();
            let mut at = 0usize;
            for u in v["updates"].as_array().into_iter().flatten() {
                let (Some(seq), Some(len)) = (u["seq"].as_u64(), u["len"].as_u64()) else { break };
                let Some(part) = body.get(at..at + len as usize) else { break };
                at += len as usize;
                if seq != h.seq + 1 { break; }
                h.seq = seq;
                let from = u["from"].as_str().unwrap_or("");
                let Ok(p) = keys.open_doc(&self.vault, &name, "u", 0, from, part) else { continue };
                if apply(&doc, &p.body).is_err() { continue; }
                let (t, by, text) = (p.meta["t"].as_u64().unwrap_or(0), p.meta["o"].as_str().unwrap_or("").to_string(), text_of(&doc));
                let n = h.versions.len();
                let same = h.versions.last().is_some_and(|l| l.author == p.author && t.saturating_sub(l.end) < SESSION_GAP);
                if !same { h.versions.push(Version { from: seq, author: p.author.clone(), start: t, ..Default::default() }); }
                let before = if same { n.checked_sub(2) } else { n.checked_sub(1) }.map(|i| h.versions[i].text.clone()).unwrap_or_default();
                let l = h.versions.last_mut().unwrap();
                (l.added, l.removed) = line_counts(&before, &text);
                (l.to, l.end, l.text) = (seq, t, text);
                if !l.by.contains(&by) { l.by.push(by); }
            }
            let more = v["more"] == true && h.seq > since && h.seq < v["seq"].as_u64().unwrap_or(0);
            if !more { break; }
        }
        h.state = hex(&doc.transact().encode_state_as_update_v1(&StateVector::default()));
        // ponytail: every session's whole text is kept; a note with thousands of long sessions makes a big file, keep
        // texts only at every Nth session and replay between them if that bites
        if let Some(dir) = file.parent() { std::fs::create_dir_all(dir).ok(); }
        sync::write_atomic(&file, serde_json::to_string(&h).map_err(|e| e.to_string())?.as_bytes(), None).map_err(|e| format!("{id}: {e}"))?;
        Ok(h.versions)
    }
    /// A document's text made `text` again (a version from its history), as this Mac's edit made by `by`, on top of
    /// whatever it holds now: only what differs changes, and it is sent and passed on like any edit.
    pub fn set_text(&self, id: &str, text: &str, by: &str) -> Result<(), String> {
        if !note_id(id) { return Err("not a note's document".into()); }
        let busy = self.busy(id);
        let _one = lock(&busy);
        let u = {
            let mut open = lock(&self.open);
            let o = open.get_mut(id).ok_or("no such document here")?;
            let cur = text_of(&o.doc);
            let (a, b): (Vec<char>, Vec<char>) = (cur.chars().collect(), text.chars().collect());
            let edits: Vec<(usize, usize, String)> = diff(&a, &b).into_iter().rev().map(|(s, e, t, u)| (s, e - s, b[t..u].iter().collect())).collect();
            if edits.is_empty() { return Ok(()); }
            let u = make_edits(&o.doc, &cur, &edits);
            (o.c.pending, o.c.via) = (true, by.into());
            self.save(&open, id)?;
            u
        };
        for f in lock(&self.on).clone() { f(id, &u); }
        if let Err(e) = self.push(id) { self.warn(format!("not sent yet, again at the next sync: {e}")); }
        Ok(())
    }

    /// Every document whose log the server has further than this Mac, the manifest first (it names the others), then
    /// each note's and its sidecars'; then whatever this Mac has not sent yet (the documents before the manifest). A
    /// document that fails is warned and the others go on. Returns the ids that changed.
    pub fn sync(&self) -> Result<Vec<String>, String> {
        let (v, _) = (self.call)(json!({"op": "doc_list", "vault": self.vault}), None, None)?;
        let server: BTreeMap<String, u64> = v["docs"].as_array().into_iter().flatten().filter_map(|d| Some((d["doc"].as_str()?.to_string(), d["seq"].as_u64()?))).collect();
        let behind = |id: &str| server.get(&self.name(id)).is_some_and(|s| *s > lock(&self.open).get(id).map_or(0, |o| o.c.seq));
        let mut changed = vec![];
        let mut pull = |id: &str| match self.pull(id) { Ok(true) => changed.push(id.to_string()), Ok(false) => {} Err(e) => self.warn(format!("{}: {e}", self.label(id))) };
        if behind(MANIFEST) { pull(MANIFEST); }
        // where the manifest puts each document now
        self.one_per_name();
        self.one_path_per_doc();
        let paths = self.paths();
        { let mut open = lock(&self.open); for (p, id) in &paths { Self::entry(&mut open, id).c.path = p.clone(); } }
        let mut ids: Vec<String> = self.paths().into_values().collect();
        ids.extend(lock(&self.open).keys().filter(|k| k.contains('#')).cloned());
        let sidecars: Vec<String> = ids.iter().filter(|id| !id.contains('#')).map(|id| format!("{id}#comments")).collect();
        ids.extend(sidecars);
        ids.sort();
        ids.dedup();
        for id in &ids { if behind(id) { pull(id); } }
        // after the notes came: a note left out of the manifest is compared with the one that kept its place
        self.keep_orphans(&self.paths());
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
        // a note's text before its place in the manifest: no Mac learns of a note it cannot read yet
        let mut pending: Vec<String> = lock(&self.open).iter().filter(|(_, o)| o.c.pending).map(|(k, _)| k.clone()).collect();
        pending.sort_by_key(|id| id == MANIFEST);
        for id in pending { self.send(&id); }
        self.bind();
        Ok(changed)
    }
    /// The notes that are documents, named to the server by their record names (the vault's naming key over the path,
    /// as the file rounds name them): a Relay from before documents is refused a write or delete of one, so it does not
    /// keep a second, stale copy in sync as a file. A moved note's old name, and a deleted one's, are let go again
    /// (`doc_unbind`). A relay-server from before documents: quiet.
    fn bind(&self) {
        let keys = lock(&self.keys).clone();
        let paths = self.paths();
        let gone = self.gone();
        // (id, the path to bind or "", the path to let go or "")
        let todo: Vec<(String, String, String)> = {
            let open = lock(&self.open);
            let mut v: Vec<(String, String, String)> = paths.iter().filter_map(|(p, id)| open.get(id).filter(|o| o.c.bound_as != *p).map(|o| (id.clone(), p.clone(), o.c.bound_as.clone()))).collect();
            v.extend(gone.keys().filter_map(|id| open.get(id).filter(|o| !o.c.bound_as.is_empty()).map(|o| (id.clone(), String::new(), o.c.bound_as.clone()))));
            v
        };
        for chunk in todo.chunks(1000) {
            let bind: Vec<String> = chunk.iter().filter(|t| !t.1.is_empty()).map(|t| keys.name(&t.1)).collect();
            let unbind: Vec<String> = chunk.iter().filter(|t| !t.2.is_empty()).map(|t| keys.name(&t.2)).collect();
            let mut r = Ok((json!({}), vec![]));
            if !bind.is_empty() { r = (self.call)(json!({"op": "doc_bind", "vault": self.vault, "names": bind}), None, None); }
            if r.is_ok() && !unbind.is_empty() { r = (self.call)(json!({"op": "doc_unbind", "vault": self.vault, "names": unbind}), None, None); }
            match r {
                Ok(_) => {
                    let mut open = lock(&self.open);
                    for (id, p, _) in chunk { if let Some(o) = open.get_mut(id) { o.c.bound_as = p.clone(); } }
                    self.save_index(&open).ok();
                }
                Err(e) if e.contains("unknown request") || e.contains("is not allowed") => return,
                Err(e) => { self.warn(format!("notes not marked as documents on the server yet: {e}")); return; }
            }
        }
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
            if self.manifest(|m, _, txn| { m.remove(txn, from.as_str()); m.insert(txn, to.as_str(), id.clone()); }).is_ok() { self.warn(format!("{from}: the same name as another note on a Mac's disk, moved to {to}")); }
        }
    }
    /// One document at two paths (two members moved it apart): the path that sorts first keeps it, the other leaves
    /// the manifest, the same on every Mac.
    fn one_path_per_doc(&self) {
        let mut first: BTreeMap<String, String> = BTreeMap::new();
        let mut drop = vec![];
        for (p, id) in self.paths() { if first.contains_key(&id) { drop.push((p, id)); } else { first.insert(id, p); } }
        for (p, id) in drop {
            if self.manifest(|m, _, txn| { m.remove(txn, p.as_str()); }).is_ok() { self.warn(format!("{p}: moved to two places at once; it stays at {}", first[&id])); }
        }
    }
    /// A document the manifest no longer names, though this Mac had it at a path and it has text: two members made
    /// a note at the same path at once and the manifest kept the other one. Made from an existing file here and not
    /// edited since: dropped (the file's text is the other one's too, or the export keeps it as a conflict copy). The
    /// same text as the one that kept the place: dropped too. Else it goes back in next to it, as a conflict copy (the
    /// same name on every Mac, so they agree). A deleted note ("gone") is no orphan.
    fn keep_orphans(&self, paths: &BTreeMap<String, String>) {
        let named: std::collections::BTreeSet<&String> = paths.values().collect();
        let gone = self.gone();
        let lost: Vec<(String, String, String, bool)> = lock(&self.open).iter()
            .filter(|(id, o)| note_id(id) && !named.contains(id) && !gone.contains_key(*id) && !o.c.path.is_empty() && !text_of(&o.doc).is_empty())
            .map(|(id, o)| (id.clone(), conflict_path(&o.c.path, id), o.c.path.clone(), o.c.seeded && o.c.mine <= 1)).collect();
        for (id, p, was, seeded) in lost {
            if seeded || paths.get(&was).is_some_and(|w| self.text(w) == self.text(&id)) {
                let mut open = lock(&self.open);
                open.remove(&id);
                std::fs::remove_file(self.dir.join(Self::file(&id))).ok();
                std::fs::remove_file(self.out_file(&id)).ok();
                self.save_index(&open).ok();
                continue;
            }
            if self.taken(&p, None) { continue; }
            if self.manifest(|m, _, txn| { m.insert(txn, p.as_str(), id.clone()); }).is_ok() { self.warn(format!("{p}: made at the same path as another note at the same time, kept next to it")); }
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

    /// What the note's file `b` changes in its document (whose text is `cur`): measured against the text Relay last
    /// wrote there or took from it (`out_file`), made on top of what others changed meanwhile (`merge3`), never the
    /// file over the document. None: there is no such text to measure against, so the file is not diffed (the export
    /// keeps it as a conflict copy). Also the file's text, the next one to measure against.
    fn disk_edits(&self, id: &str, cur: &str, b: &[u8]) -> Option<(Vec<(usize, usize, String)>, String)> {
        let base = std::fs::read_to_string(self.out_file(id)).ok()?;
        let disk = doc_text(b);
        if disk == base { return Some((vec![], disk)); }
        let (bc, cc, dc): (Vec<char>, Vec<char>, Vec<char>) = (base.chars().collect(), cur.chars().collect(), disk.chars().collect());
        Some((merge3(&bc, &cc, &dc), disk))
    }
    /// The text a change on disk is measured against next, written once the cursor that names it is saved.
    fn set_base(&self, id: &str, text: &str) -> Result<(), String> { sync::write_atomic(&self.out_file(id), text.as_bytes(), None).map(|_| ()).map_err(|e| format!("{id}: {e}")) }

    /// A note's file changed (a page's save, the watcher, Claude): what changed taken into its document as this Mac's
    /// edit (`disk_edits`), with who made it (`by`: "claude", "disk", "relay"), and sent. Nothing when the file is no
    /// document's, sits where documents are not written, was not written here yet or has nothing to be measured
    /// against (the next export decides), or is what Relay last wrote there. The diff runs outside the lock on all
    /// documents; the document's own lock keeps everything else off it meanwhile.
    pub fn absorb(&self, root: &Path, filter: &Filter, path: &str, by: &str) -> Result<bool, String> {
        let Some(id) = self.paths().get(path).cloned() else { return Ok(false) };
        if filter.skips(path, false) || through_link(root, path) { return Ok(false); }
        let busy = self.busy(&id);
        let _one = lock(&busy);
        let (cur, b) = {
            let open = lock(&self.open);
            let Some(o) = open.get(&id) else { return Ok(false) };
            if fold(&o.c.at) != fold(path) { return Ok(false); }
            let Ok(b) = std::fs::read(root.join(path)) else { return Ok(false) };
            if sync::sha256_hex(&b) == o.c.out { return Ok(false); }
            (text_of(&o.doc), b)
        };
        let Some((edits, disk)) = self.disk_edits(&id, &cur, &b) else { return Ok(false) };
        let mut u = vec![];
        {
            let mut open = lock(&self.open);
            let Some(o) = open.get_mut(&id) else { return Ok(false) };
            if !edits.is_empty() { u = make_edits(&o.doc, &cur, &edits); (o.c.pending, o.c.via) = (true, by.into()); }
            o.c.out = sync::sha256_hex(&b);
            self.save(&open, &id)?;
        }
        self.set_base(&id, &disk)?;
        if !u.is_empty() { for f in lock(&self.on).clone() { f(&id, &u); } }
        if !edits.is_empty() { if let Err(e) = self.push(&id) { self.warn(format!("not sent yet, again at the next sync: {e}")); } }
        Ok(!edits.is_empty())
    }
    /// The folder's notes made documents, at most `batch` a call (seeding; only when the workspace has it on and on an
    /// admin's Mac, the caller decides): each .md no document has, that `filter` lets through, not through a link, no
    /// conflict copy, at most one update big, and `agreed` (path, hash: the file as the last file round left it on
    /// both sides), with its text now. Never past MAX_DOCS documents. Another Mac making the same note a document at
    /// once: the manifest keeps one (`keep_orphans`). Returns the paths made documents.
    pub fn seed(&self, root: &Path, filter: &Filter, batch: usize, agreed: &dyn Fn(&str, &str) -> bool) -> Vec<String> {
        let Ok((files, _)) = lock(&self.walker).scan(root, filter) else { return vec![] };
        let held: std::collections::BTreeSet<String> = self.excluded(filter).iter().map(|p| fold(p)).collect();
        let mut made = vec![];
        let mut count = self.paths().len();
        for (path, entry) in files {
            if made.len() >= batch || count >= MAX_DOCS { break; }
            if !safe_path(&path) || path.contains(" (conflict ") || held.contains(&fold(&path)) || self.taken(&path, None) || through_link(root, &path) { continue; }
            if !agreed(&path, &entry.hash) { continue; }
            if entry.size > MAX_UPDATE / 2 { self.warn(format!("{path}: too big to be a document, stays a file")); continue; }
            let Ok(b) = std::fs::read(root.join(&path)) else { continue };
            if sync::sha256_hex(&b) != entry.hash { continue; }
            let text = doc_text(&b);
            let Ok(id) = self.create(&path, &text) else { continue };
            {
                let mut open = lock(&self.open);
                if let Some(o) = open.get_mut(&id) { (o.c.at, o.c.out, o.c.seeded) = (path.clone(), entry.hash.clone(), true); }
                if self.save(&open, &id).is_err() { continue; }
            }
            if let Err(e) = self.set_base(&id, &text) { self.warn(e); }
            made.push(path);
            count += 1;
        }
        made
    }

    /// Write each note whose document's text changed since it was last written here, under `root` (temp file and
    /// rename). Never where `filter` keeps files out (System/, hidden), never through a symlink, never a document that
    /// has no text here yet (another Mac's, its text not come). A note's file changed here since Relay wrote it is
    /// taken in first (`disk_edits`), never written over; one with nothing to measure against, or not what Relay last
    /// wrote at a place it had not written yet, goes to `keep` first (a conflict copy); a renamed note's old file goes
    /// once it is as Relay wrote it (else to `keep`); a deleted note's file goes from every Mac (to `keep` when it was
    /// changed here). A file that changes while it is being written is left for the next export. Returns the paths
    /// written (Relay's own, for a watcher) and what failed.
    pub fn export(&self, root: &Path, filter: &Filter, keep: &dyn Fn(&str, &[u8])) -> (Vec<String>, Vec<String>) {
        let (mut wrote, mut errors, mut taken) = (vec![], vec![], vec![]);
        // a renamed note's old place another note has taken since: that file is the other note's, not removed
        let owned: std::collections::BTreeSet<String> = self.paths().keys().map(|p| fold(p)).collect();
        for (path, id) in self.paths() {
            if filter.skips(&path, false) || through_link(root, &path) { self.warn(format!("{path}: a document is not written there (a guarded or linked folder)")); continue; }
            let busy = self.busy(&id);
            let _one = lock(&busy);
            let file = root.join(&path);
            let Some((at, out, fresh)) = lock(&self.open).get(&id).map(|o| (o.c.at.clone(), o.c.out.clone(), o.c.seq == 0 && !o.c.pending && o.c.at.is_empty())) else { continue };
            // another Mac's note whose text has not come yet: nothing to write
            if fresh { continue; }
            let seen = std::fs::read(&file).ok();
            // changed here since Relay wrote it (Claude, an editor, git): taken in first, never written over; gone:
            // written back (a note the workspace shares is not deleted by removing its file here)
            if at == path {
                match &seen {
                    Some(b) if sync::sha256_hex(b) != out => {
                        let cur = self.text(&id);
                        if let Some((edits, disk)) = self.disk_edits(&id, &cur, b) {
                            let mut open = lock(&self.open);
                            let Some(o) = open.get_mut(&id) else { continue };
                            let u = if edits.is_empty() { vec![] } else { taken.push(id.clone()); make_edits(&o.doc, &cur, &edits) };
                            if !u.is_empty() { (o.c.pending, o.c.via) = (true, "disk".into()); }
                            o.c.out = sync::sha256_hex(b);
                            if let Err(e) = self.save(&open, &id) { errors.push(e); continue; }
                            drop(open);
                            if !u.is_empty() { for f in lock(&self.on).clone() { f(&id, &u); } }
                            if let Err(e) = self.set_base(&id, &disk) { errors.push(e); continue; }
                        }
                    }
                    None if !out.is_empty() => self.warn(format!("{path}: deleted here, but the workspace shares it as a document: written back")),
                    _ => {}
                }
            }
            let (text, at, out) = { let open = lock(&self.open); let o = &open[&id]; (text_of(&o.doc), o.c.at.clone(), o.c.out.clone()) };
            let h = sync::sha256_hex(text.as_bytes());
            if at == path && h == out && seen.as_ref().is_some_and(|b| sync::sha256_hex(b) == out) { continue; }
            // the note's old place, after a rename: as Relay wrote it, it goes; anything else is kept first
            if !at.is_empty() && fold(&at) != fold(&path) && !owned.contains(&fold(&at)) && !filter.skips(&at, false) && !through_link(root, &at) {
                let old = root.join(&at);
                if let Ok(b) = std::fs::read(&old) {
                    if sync::sha256_hex(&b) != out { keep(&at, &b); }
                    if let Err(e) = std::fs::remove_file(&old) { errors.push(format!("{at}: {e}")); continue; }
                }
            }
            // a file here this Mac has no measure for (not written here yet, or nothing to diff against): kept first
            if let Some(b) = &seen { if sync::sha256_hex(b) != out && sync::sha256_hex(b) != h { keep(&path, b); } }
            // changed while this ran: the next export takes it in
            if std::fs::read(&file).ok().map(|b| sync::sha256_hex(&b)) != seen.as_ref().map(|b| sync::sha256_hex(b)) { continue; }
            if let Err(e) = sync::write_atomic(&file, text.as_bytes(), None) { errors.push(format!("{path}: {e}")); continue; }
            // the text a later change is measured against, then the cursor that says it was written
            if let Err(e) = self.set_base(&id, &text) { errors.push(e); continue; }
            let mut open = lock(&self.open);
            if let Some(o) = open.get_mut(&id) { (o.c.out, o.c.at) = (h, path.clone()); }
            if let Err(e) = self.save(&open, &id) { errors.push(e); }
            wrote.push(path.clone());
        }
        // deleted in the Pages tab (on any Mac): its file goes here too, kept first when it was changed here
        for (id, _) in self.gone() {
            let mut open = lock(&self.open);
            let Some(o) = open.get_mut(&id) else { continue };
            if o.c.at.is_empty() { continue; }
            let at = std::mem::take(&mut o.c.at);
            if !owned.contains(&fold(&at)) && !filter.skips(&at, false) && !through_link(root, &at) {
                if let Ok(b) = std::fs::read(root.join(&at)) {
                    if sync::sha256_hex(&b) != o.c.out { keep(&at, &b); }
                    if let Err(e) = std::fs::remove_file(root.join(&at)) { errors.push(format!("{at}: {e}")); }
                }
            }
            self.save_index(&open).ok();
        }
        for id in taken { self.send(&id); }
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
    struct Fake { logs: BTreeMap<String, Vec<(Vec<u8>, String)>>, bound: Vec<String>, order: Vec<String> }
    type Server = Arc<Mutex<Fake>>;
    fn call(srv: &Server, me: &str, online: &Arc<AtomicBool>) -> Call {
        let (srv, me, online) = (srv.clone(), me.to_string(), online.clone());
        Box::new(move |req, body, _| {
            if !online.load(Ordering::SeqCst) { return Err("no answer".into()); }
            let mut f = srv.lock().unwrap();
            let doc = req["doc"].as_str().unwrap_or("").to_string();
            match req["op"].as_str().unwrap() {
                "doc_push" => { f.order.push(doc.clone()); let log = f.logs.entry(doc).or_default(); log.push((body.unwrap(), me.clone())); Ok((json!({"seq": log.len()}), vec![])) }
                "doc_pull" => {
                    let since = req["since"].as_u64().unwrap() as usize;
                    let log = f.logs.get(&doc).cloned().unwrap_or_default();
                    let end = log.len().min(since + req["limit"].as_u64().unwrap_or(1000) as usize);
                    let mut body = vec![];
                    let ups: Vec<Value> = (since..end).map(|i| { body.extend(&log[i].0); json!({"seq": i + 1, "len": log[i].0.len(), "from": log[i].1}) }).collect();
                    Ok((json!({"updates": ups, "seq": log.len(), "more": end < log.len()}), body))
                }
                "doc_list" => Ok((json!({"docs": f.logs.iter().map(|(d, l)| json!({"doc": d, "seq": l.len()})).collect::<Vec<_>>()}), vec![])),
                "doc_bind" => { f.bound.extend(req["names"].as_array().unwrap().iter().map(|n| n.as_str().unwrap().to_string())); Ok((json!({}), vec![])) }
                "doc_unbind" => { let gone: Vec<String> = req["names"].as_array().unwrap().iter().map(|n| n.as_str().unwrap().to_string()).collect(); f.bound.retain(|n| !gone.contains(n)); Ok((json!({}), vec![])) }
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

    /// Three sessions by two authors (A, B, A again) read from the log as three versions with their texts; a version
    /// restored is an edit like any other: the other Mac gets it, and history shows the restore as a session of its own.
    #[test]
    fn history_lists_each_authors_sessions_and_a_restore_goes_to_everyone() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "hist-a", A), mac(&srv, &k, "hist-b", B));
        let id = a.create("Plan.md", "one\n").unwrap();
        append(&a, &id, "two\n");
        b.sync().unwrap();
        append(&b, &id, "three\n");
        a.sync().unwrap();
        append(&a, &id, "four\n");
        let v = a.history(&id).unwrap();
        let got: Vec<(&str, &str, usize, usize)> = v.iter().map(|v| (v.author.as_str(), v.text.as_str(), v.added, v.removed)).collect();
        assert_eq!(got, [(A, "one\ntwo\n", 2, 0), (B, "one\ntwo\nthree\n", 1, 0), (A, "one\ntwo\nthree\nfour\n", 1, 0)]);
        // B restores the first version: B's text and, after a sync, A's are that version again
        b.sync().unwrap();
        b.set_text(&id, &v[0].text, "restore").unwrap();
        assert_eq!(b.text(&id), "one\ntwo\n");
        a.sync().unwrap();
        assert_eq!(a.text(&id), "one\ntwo\n");
        let v2 = a.history(&id).unwrap();
        assert_eq!(v2.len(), 4, "read on from where it was, the restore a session of its own");
        let last = v2.last().unwrap();
        assert_eq!((last.author.as_str(), last.by.as_slice(), last.text.as_str(), last.removed), (B, &["restore".to_string()][..], "one\ntwo\n", 2));
        std::fs::remove_dir_all(tmp("hist-a")).ok();
        std::fs::remove_dir_all(tmp("hist-b")).ok();
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


    /// `merge3`'s edits made on a string, as `take_disk` makes them on the document.
    fn merged(base: &str, cur: &str, disk: &str) -> String {
        let (b, c, d): (Vec<char>, Vec<char>, Vec<char>) = (base.chars().collect(), cur.chars().collect(), disk.chars().collect());
        let mut out = c.clone();
        for (p, del, ins) in merge3(&b, &c, &d) { out.splice(p..p + del, ins.chars()); }
        out.into_iter().collect()
    }

    /// A file's change since Relay wrote it, made on a document others changed meanwhile: both stay. A whole-file
    /// rewrite (Claude writes all of it) keeps a paragraph another member put in after Claude read the file.
    #[test]
    fn a_change_on_disk_is_made_on_top_of_what_others_changed() {
        let base = "# Plan\none\ntwo\nthree\n";
        let cur = "# Plan\none\ntwo\nB's paragraph\nthree\n";
        assert_eq!(merged(base, cur, "# Plan\nONE\ntwo\nthree\nfour\n"), "# Plan\nONE\ntwo\nB's paragraph\nthree\nfour\n");
        // what others removed stays removed, what they changed is theirs
        assert_eq!(merged(base, "# Plan\ntwo\nthree\n", "# Plan\none\ntwo\nthree!\n"), "# Plan\ntwo\nthree!\n");
        // both added to one line at one place: both kept, theirs first
        assert_eq!(merged("x\n", "x theirs\n", "x mine\n"), "x theirs mine\n");
        // the same change on both sides counts once: an edit, a removed line, an added line
        assert_eq!(merged("x\n", "x mine\n", "x mine\n"), "x mine\n");
        assert_eq!(merged("a\nb\nc\n", "a\nc\n", "a\nc\n"), "a\nc\n");
        assert_eq!(merged("a\nc\n", "a\nb\nc\n", "a\nb\nc\n"), "a\nb\nc\n");
        // both rewrote one word: theirs replaced it, mine goes after it
        assert_eq!(merged("a b c\n", "a B c\n", "a bee c\n"), "a Bee c\n");
        // nothing changed on disk: nothing done; unicode counts as chars
        assert!(merge3(&base.chars().collect::<Vec<_>>(), &cur.chars().collect::<Vec<_>>(), &base.chars().collect::<Vec<_>>()).is_empty());
        assert_eq!(merged("café\n", "café crème\n", "thé café\n"), "thé café crème\n");
    }

    /// Two Macs: Claude rewrites the note's file on A while B adds a paragraph to the document. A takes the file in as
    /// an edit (tagged "claude"); after both sync, both have both. Then B adds another while A's Claude writes from the
    /// file it read before: A's export takes it in on top, nothing of B's lost. Relay's own export is no change; a file
    /// with a byte-order mark and CRLF goes in as plain text; a deleted file is written back, warned.
    #[test]
    fn an_open_editor_hears_of_a_file_change_taken_in_but_not_of_its_own_edit() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let (a, _) = mac(&srv, &k, "editor-a", A);
        let root = tmp("editor-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();
        let f = Filter::vault_default();
        let id = a.create("Plan.md", "one\n").unwrap();
        a.export(&root, &f, &|_: &str, _: &[u8]| panic!("nothing is replaced"));
        let heard = Arc::new(Mutex::new(vec![]));
        { let h = heard.clone(); a.subscribe(move |d, u| h.lock().unwrap().push((d.to_string(), u.to_vec()))); }
        // the editor's own edit: taken, not echoed back to it
        append(&a, &id, "two\n");
        assert!(heard.lock().unwrap().is_empty());
        // Claude writes the file: the editor gets the change as an update that brings its copy to the document's text
        let editor = Doc::new();
        apply(&editor, &a.diff(&id, &[0]).unwrap()).unwrap();
        std::fs::write(root.join("Plan.md"), "ONE\n").unwrap();
        assert!(a.absorb(&root, &f, "Plan.md", "claude").unwrap());
        let got = heard.lock().unwrap().clone();
        assert_eq!(got.len(), 1);
        apply(&editor, &got[0].1).unwrap();
        assert_eq!((got[0].0.as_str(), text_of(&editor)), (id.as_str(), a.text(&id)));
    }
    #[test]
    fn claude_rewriting_the_file_and_a_members_edit_both_stay() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "disk-a", A), mac(&srv, &k, "disk-b", B));
        let root = tmp("disk-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();
        let f = Filter::vault_default();
        let none = |_: &str, _: &[u8]| panic!("nothing is replaced");
        let id = a.create("Plan.md", "one\ntwo\nthree\n").unwrap();
        a.export(&root, &f, &none);
        assert!(!a.absorb(&root, &f, "Plan.md", "disk").unwrap(), "Relay's own export is no change");
        b.sync().unwrap();
        append(&b, &id, "four\n");
        std::fs::write(root.join("Plan.md"), "ONE\ntwo\nthree\n").unwrap();
        assert!(a.absorb(&root, &f, "Plan.md", "claude").unwrap());
        let name = a.name(&id);
        let (part, who) = srv.lock().unwrap().logs[&name].last().unwrap().clone();
        assert_eq!(k.open_doc(V, &name, "u", 0, &who, &part).unwrap().meta["o"], "claude", "who made it goes with the update");
        a.sync().unwrap();
        b.sync().unwrap();
        assert_eq!((a.text(&id), b.text(&id)), ("ONE\ntwo\nthree\nfour\n".to_string(), "ONE\ntwo\nthree\nfour\n".to_string()));
        // A has B's next paragraph but has not written it out yet; Claude writes from what it read before
        a.export(&root, &f, &none);
        append(&b, &id, "five\n");
        a.sync().unwrap();
        std::fs::write(root.join("Plan.md"), "ONE\nTWO\nthree\nfour\n").unwrap();
        a.export(&root, &f, &none);
        b.sync().unwrap();
        assert_eq!(std::fs::read_to_string(root.join("Plan.md")).unwrap(), "ONE\nTWO\nthree\nfour\nfive\n");
        assert_eq!(b.text(&id), "ONE\nTWO\nthree\nfour\nfive\n");
        // a byte-order mark and CRLF: the text without them
        std::fs::write(root.join("Plan.md"), "\u{feff}ONE\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix\r\n").unwrap();
        a.absorb(&root, &f, "Plan.md", "disk").unwrap();
        assert_eq!(a.text(&id), "ONE\nTWO\nthree\nfour\nfive\nsix\n");
        // deleted here: written back, warned, the document untouched
        a.export(&root, &f, &none);
        a.take_warnings();
        std::fs::remove_file(root.join("Plan.md")).unwrap();
        assert_eq!(a.export(&root, &f, &none).0, vec!["Plan.md".to_string()]);
        assert!(a.take_warnings().iter().any(|w| w.contains("written back")));
        assert_eq!(a.text(&id), "ONE\nTWO\nthree\nfour\nfive\nsix\n");
        for t in ["disk-a", "disk-b", "disk-root"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// The folder's notes made documents: one per note, conflict copies and guarded folders left as files, the
    /// server told their record names. Two Macs doing it at once with the same text end on one document; with a
    /// different text the other stays as a conflict copy.
    #[test]
    fn existing_notes_become_documents_once() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, a_on), (b, b_on)) = (mac(&srv, &k, "seed-a", A), mac(&srv, &k, "seed-b", B));
        let (ra, rb) = (tmp("seed-ra"), tmp("seed-rb"));
        let mut f = Filter::vault_default();
        f.guarded = vec!["System".into()];
        f.only = vec!["System/rules".into()];
        for r in [&ra, &rb] {
            std::fs::remove_dir_all(r).ok();
            std::fs::create_dir_all(r.join("System/commands")).unwrap();
            std::fs::write(r.join("Same.md"), "same text").unwrap();
            std::fs::write(r.join("Plan (conflict mac 2026-10-28 1200).md"), "a copy").unwrap();
            std::fs::write(r.join("System/commands/x.md"), "guarded").unwrap();
        }
        std::fs::write(ra.join("Differs.md"), "from a").unwrap();
        std::fs::write(rb.join("Differs.md"), "from b").unwrap();
        a_on.store(false, Ordering::SeqCst);
        b_on.store(false, Ordering::SeqCst);
        let (sa, sb) = (a.seed(&ra, &f, 50, &|_, _| true), b.seed(&rb, &f, 50, &|_, _| true));
        assert_eq!((sa.clone(), sb), (vec!["Differs.md".to_string(), "Same.md".to_string()], vec!["Differs.md".to_string(), "Same.md".to_string()]));
        assert!(a.seed(&ra, &f, 50, &|_, _| true).is_empty(), "made once");
        a_on.store(true, Ordering::SeqCst);
        b_on.store(true, Ordering::SeqCst);
        for _ in 0..3 { a.sync().unwrap(); b.sync().unwrap(); }
        assert_eq!(a.paths(), b.paths());
        let paths: Vec<String> = a.paths().into_keys().collect();
        assert_eq!(paths.iter().filter(|p| p.starts_with("Same")).count(), 1, "the same text: one document, {paths:?}");
        assert_eq!(paths.iter().filter(|p| p.starts_with("Differs")).count(), 1, "one document, {paths:?}");
        // the Mac whose seed lost keeps its own file's text as a conflict copy when it differs
        let lost: Arc<Mutex<Vec<String>>> = Arc::default();
        for (d, r) in [(&a, &ra), (&b, &rb)] { let lost = lost.clone(); d.export(r, &f, &move |p, b| lost.lock().unwrap().push(format!("{p}={}", String::from_utf8_lossy(b)))); }
        let kept = lost.lock().unwrap().clone();
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0] == "Differs.md=from a" || kept[0] == "Differs.md=from b", "{kept:?}");
        assert_eq!(std::fs::read_to_string(ra.join("Differs.md")).unwrap(), std::fs::read_to_string(rb.join("Differs.md")).unwrap());
        let bound = srv.lock().unwrap().bound.clone();
        assert!(bound.contains(&k.name("Same.md")) && bound.contains(&k.name("Differs.md")), "the server knows them");
        for t in ["seed-a", "seed-b", "seed-ra", "seed-rb"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// A note moved: the same document at its new place, the new record name told to the server.
    #[test]
    fn a_moved_note_keeps_its_document() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let (a, _) = mac(&srv, &k, "mv-a", A);
        let root = tmp("mv-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("Old")).unwrap();
        std::fs::write(root.join("Old/Plan.md"), "text").unwrap();
        let f = Filter::vault_default();
        a.seed(&root, &f, 50, &|_, _| true);
        let id = a.paths()["Old/Plan.md"].clone();
        a.sync().unwrap();
        // the Pages tab moves the file, then the document follows it
        std::fs::create_dir_all(root.join("New")).unwrap();
        std::fs::rename(root.join("Old/Plan.md"), root.join("New/Plan.md")).unwrap();
        a.rename("Old/Plan.md", "New/Plan.md").unwrap();
        a.sync().unwrap();
        a.export(&root, &f, &|_, _| panic!("nothing kept"));
        assert_eq!(a.paths().get("New/Plan.md"), Some(&id));
        assert!(!root.join("Old/Plan.md").exists() && std::fs::read_to_string(root.join("New/Plan.md")).unwrap() == "text");
        let bound = srv.lock().unwrap().bound.clone();
        assert!(bound.contains(&k.name("New/Plan.md")) && !bound.contains(&k.name("Old/Plan.md")), "the old name let go");
        for t in ["mv-a", "mv-root"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }


    /// A long note (5000 lines), changed on disk at lines 10, 1000, 1990 and 4000 while another member changed line
    /// 3000: every change lands where it was made, quickly.
    #[test]
    fn a_long_note_changed_in_many_places_merges_line_by_line() {
        let base: Vec<String> = (0..5000).map(|i| format!("line {i}\n")).collect();
        let mut cur = base.clone();
        cur[3000] = "line 3000 by B\n".into();
        let mut disk = base.clone();
        for i in [10, 1000, 1990, 4000] { disk[i] = format!("line {i} by Claude\n"); }
        let t = std::time::Instant::now();
        let out = merged(&base.concat(), &cur.concat(), &disk.concat());
        assert!(t.elapsed() < std::time::Duration::from_secs(2), "took {:?}", t.elapsed());
        let mut want = disk.clone();
        want[3000] = "line 3000 by B\n".into();
        assert_eq!(out, want.concat());
    }

    /// A note's text goes to the server before its place in the manifest; a Mac that has the place but not the text
    /// writes nothing for it.
    #[test]
    fn a_notes_text_goes_before_its_place_and_a_place_without_text_is_not_written() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "first-a", A), mac(&srv, &k, "first-b", B));
        let id = a.create("Plan.md", "text").unwrap();
        let order = srv.lock().unwrap().order.clone();
        assert_eq!(order, vec![a.name(&id), a.name(MANIFEST)]);
        // the text held back from B: the manifest names the note, B writes nothing for it
        srv.lock().unwrap().logs.remove(&a.name(&id));
        b.sync().unwrap();
        let root = tmp("first-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();
        assert!(b.export(&root, &Filter::vault_default(), &|_, _| panic!("nothing kept")).0.is_empty());
        assert!(!root.join("Plan.md").exists());
        for t in ["first-a", "first-b", "first-root"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// No text to measure a file against (a document from before this kept one): the file is not diffed; it stays as
    /// a conflict copy when it differs, and the document is written.
    #[test]
    fn a_file_with_nothing_to_measure_against_is_kept_not_diffed() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let (a, _) = mac(&srv, &k, "nobase-a", A);
        let root = tmp("nobase-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();
        let f = Filter::vault_default();
        let id = a.create("Plan.md", "doc").unwrap();
        a.export(&root, &f, &|_, _| panic!("nothing kept"));
        std::fs::remove_file(a.out_file(&id)).unwrap();
        std::fs::write(root.join("Plan.md"), "edited").unwrap();
        assert!(!a.absorb(&root, &f, "Plan.md", "disk").unwrap());
        let kept: Arc<Mutex<Vec<(String, Vec<u8>)>>> = Arc::default();
        { let kept = kept.clone(); a.export(&root, &f, &move |p, b| kept.lock().unwrap().push((p.into(), b.to_vec()))); }
        assert_eq!(kept.lock().unwrap().clone(), vec![("Plan.md".to_string(), b"edited".to_vec())]);
        assert_eq!((a.text(&id).as_str(), std::fs::read_to_string(root.join("Plan.md")).unwrap().as_str()), ("doc", "doc"));
        for t in ["nobase-a", "nobase-root"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// Deleted in the Pages tab on A: out of the manifest, its file goes on B too, its server name let go; Undo puts
    /// it back for both.
    #[test]
    fn a_note_deleted_in_the_pages_tab_goes_from_every_mac_and_comes_back_with_undo() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, _), (b, _)) = (mac(&srv, &k, "del-a", A), mac(&srv, &k, "del-b", B));
        let (ra, rb) = (tmp("del-ra"), tmp("del-rb"));
        for r in [&ra, &rb] { std::fs::remove_dir_all(r).ok(); std::fs::create_dir_all(r).unwrap(); }
        let f = Filter::vault_default();
        let none = |_: &str, _: &[u8]| panic!("nothing kept");
        let id = a.create("Plan.md", "text").unwrap();
        a.sync().unwrap();
        a.export(&ra, &f, &none);
        b.sync().unwrap();
        b.export(&rb, &f, &none);
        assert!(rb.join("Plan.md").exists() && srv.lock().unwrap().bound.contains(&k.name("Plan.md")));
        // A's Pages tab trashed the file, then the document goes
        std::fs::remove_file(ra.join("Plan.md")).unwrap();
        assert_eq!(a.remove("Plan.md").unwrap(), Some(id.clone()));
        a.sync().unwrap();
        b.sync().unwrap();
        b.export(&rb, &f, &none);
        assert!(!rb.join("Plan.md").exists(), "gone on B too");
        assert!(!srv.lock().unwrap().bound.contains(&k.name("Plan.md")), "its name let go");
        assert!(b.paths().is_empty() && b.gone().contains_key(&id));
        // Undo on A: back on both
        std::fs::write(ra.join("Plan.md"), "text").unwrap();
        assert!(a.restore("Plan.md").unwrap());
        b.sync().unwrap();
        b.export(&rb, &f, &none);
        assert_eq!(std::fs::read_to_string(rb.join("Plan.md")).unwrap(), "text");
        for t in ["del-a", "del-b", "del-ra", "del-rb"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// Moved to two places at once on two Macs: both end with the one that sorts first.
    #[test]
    fn a_note_moved_to_two_places_at_once_ends_at_one() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let ((a, a_on), (b, b_on)) = (mac(&srv, &k, "two-a", A), mac(&srv, &k, "two-b", B));
        let id = a.create("X.md", "x").unwrap();
        b.sync().unwrap();
        a_on.store(false, Ordering::SeqCst);
        b_on.store(false, Ordering::SeqCst);
        a.rename("X.md", "Z.md").unwrap();
        b.rename("X.md", "Y.md").unwrap();
        a_on.store(true, Ordering::SeqCst);
        b_on.store(true, Ordering::SeqCst);
        for _ in 0..3 { a.sync().unwrap(); b.sync().unwrap(); }
        assert_eq!(a.paths(), b.paths());
        assert_eq!(a.paths(), [("Y.md".to_string(), id)].into_iter().collect());
        for t in ["two-a", "two-b"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }

    /// Seeding takes only notes the last file round left the same on both sides, and none too big for an update.
    #[test]
    fn only_agreed_and_small_notes_are_seeded() {
        let (srv, k) = (Server::default(), Keys::from(VaultKey::generate()));
        let (a, _) = mac(&srv, &k, "agree-a", A);
        let root = tmp("agree-root");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Synced.md"), "same").unwrap();
        std::fs::write(root.join("Changed here.md"), "not synced yet").unwrap();
        std::fs::write(root.join("Huge.md"), "h".repeat(3 << 20)).unwrap();
        let synced = sync::sha256_hex(b"same");
        let big = sync::sha256_hex("h".repeat(3 << 20).as_bytes());
        let made = a.seed(&root, &Filter::vault_default(), 50, &|p, h| (p == "Synced.md" && h == synced) || (p == "Huge.md" && h == big));
        assert_eq!(made, vec!["Synced.md".to_string()]);
        assert!(a.take_warnings().iter().any(|w| w.contains("Huge.md: too big")));
        for t in ["agree-a", "agree-root"] { std::fs::remove_dir_all(tmp(t)).ok(); }
    }
}
