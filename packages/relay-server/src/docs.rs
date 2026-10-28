//! A shared vault's documents on the server (docs/workspaces.md, Documents): per document an append-only log of
//! sealed Yjs updates and the sealed snapshots members write now and then. Nothing here reads, merges or deletes them:
//! the log is the document's history. A document is a folder under the vault, named as the members name it (64 hex,
//! the vault's naming key over its id); `log/<seq>` (with `log/<seq>.from`, the device that pushed it) and
//! `snap/<upto>`, each written whole (temp file and rename).

use crate::vaults::{dir, hex, Vaults};
use relay_remote::docs::{MAX_PULL, MAX_UPDATE, SNAPSHOT_EVERY};
use relay_remote::sync;
use relay_remote::vault::{epoch, split, MAX_RECORD};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One push at most, in bytes.
pub const MAX_PUSH: u64 = 4 * MAX_UPDATE;
/// The shortest sealed part: the header, two nonces, two tags.
const MIN_PART: usize = 4 + 2 * (12 + 16);
/// Documents in one vault at most, and the bytes one member may push and snapshot into a vault in a day.
const MAX_DOCS: usize = 10_000;
const DAILY: u64 = 512 << 20;

/// What the server keeps in memory for the documents: each log's length (read from its folder once), and each
/// member's bytes today per vault.
// ponytail: the day's bytes start over at a restart; a file per member when a restart may not reset a quota
#[derive(Default)]
pub struct Kept { lengths: Mutex<HashMap<(String, String), u64>>, today: Mutex<HashMap<(String, String), (u64, u64)>> }

/// The numbered entries of a folder (log or snap), ascending; temp files and anything else left out.
fn numbered(p: &Path) -> Vec<u64> {
    let mut v: Vec<u64> = fs::read_dir(p).into_iter().flatten().flatten()
        .filter_map(|e| { let n = e.file_name().into_string().ok()?; (n.len() == 12 && n.bytes().all(|b| b.is_ascii_digit())).then(|| n.parse().ok())? }).collect();
    v.sort_unstable();
    v
}
fn at(p: &Path, n: u64) -> PathBuf { p.join(format!("{n:012}")) }
fn day() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400) }

impl Vaults {
    fn doc(&self, id: &str, name: &str) -> PathBuf { dir(self.data()).join(id).join("docs").join(name) }
    /// The log's length: its entries are 1..=n with no gap (each written under the vault's lock), counted once.
    fn length(&self, id: &str, name: &str) -> u64 {
        *self.docs.lengths.lock().unwrap().entry((id.into(), name.into())).or_insert_with(|| numbered(&self.doc(id, name).join("log")).last().copied().unwrap_or(0))
    }
    /// `bytes` more from `fp` into vault `id` today, or refused past DAILY.
    fn spend(&self, id: &str, fp: &str, bytes: u64) -> Result<(), String> {
        let mut t = self.docs.today.lock().unwrap();
        let e = t.entry((id.into(), fp.into())).or_insert((day(), 0));
        if e.0 != day() { *e = (day(), 0); }
        if e.1 + bytes > DAILY { return Err("too much written to this workspace's documents today".into()); }
        e.1 += bytes;
        Ok(())
    }

    /// Append `parts` (sealed updates) to a document's log, under the vault's current key; returns their seqs. The
    /// other members' live streams get each one that fits a frame.
    pub fn doc_push(&self, fp: &str, id: &str, name: &str, parts: Vec<Vec<u8>>) -> Result<Vec<u64>, String> {
        if !hex(name, 64) { return Err("bad doc".into()); }
        if parts.is_empty() || parts.iter().any(|p| p.len() < MIN_PART || p.len() as u64 > MAX_UPDATE || split(p).is_none()) { return Err("not an update".into()); }
        let seqs = self.with(id, fp, |v, _| {
            for p in &parts {
                match epoch(p).unwrap_or(0).cmp(&v.epoch) {
                    std::cmp::Ordering::Less => return Err("key changed".into()),
                    std::cmp::Ordering::Greater => return Err("no such key epoch".into()),
                    std::cmp::Ordering::Equal => {}
                }
            }
            let d = self.doc(id, name);
            if !d.is_dir() && fs::read_dir(dir(self.data()).join(id).join("docs")).map_or(0, |r| r.count()) >= MAX_DOCS { return Err("too many documents in this workspace".into()); }
            self.spend(id, fp, parts.iter().map(|p| p.len() as u64).sum())?;
            let log = d.join("log");
            let mut n = self.length(id, name);
            let mut seqs = vec![];
            for p in &parts {
                n += 1;
                sync::write_atomic(&log.join(format!("{n:012}.from")), fp[..16].as_bytes(), None).map_err(|e| e.to_string())?;
                sync::write_atomic(&at(&log, n), p, None).map_err(|e| e.to_string())?;
                self.docs.lengths.lock().unwrap().insert((id.into(), name.into()), n);
                seqs.push(n);
            }
            Ok(seqs)
        })?;
        for (p, s) in parts.iter().zip(&seqs) { self.rooms.doc(id, fp, name, *s, p); }
        Ok(seqs)
    }

    /// A document's log after `since`: when `snapshots`, the newest snapshot past `since` (with the metas of every
    /// update up to its place, so a member can check it holds them), then the updates after it, up to MAX_PULL bytes
    /// (`more`: there is more after). Each update says who pushed it. Returns the answer and the parts, back to back.
    pub fn doc_pull(&self, fp: &str, id: &str, name: &str, since: u64, snapshots: bool) -> Result<(Value, Vec<u8>), String> {
        self.member(id, fp)?;
        if !hex(name, 64) { return Err("bad doc".into()); }
        let d = self.doc(id, name);
        let n = self.length(id, name);
        let snap = if snapshots { numbered(&d.join("snap")).into_iter().filter(|u| *u > since && *u <= n).next_back() } else { None };
        let (mut body, mut from, mut snapshot, mut metas) = (vec![], since, Value::Null, vec![]);
        let read = |s: u64| fs::read(at(&d.join("log"), s)).map_err(|e| e.to_string());
        if let Some(u) = snap {
            let b = fs::read(at(&d.join("snap"), u)).map_err(|e| e.to_string())?;
            snapshot = json!({"upto": u, "len": b.len()});
            body.extend(b);
            for s in 1..=u {
                let p = read(s)?;
                let (meta, _) = split(&p).ok_or("a broken log entry")?;
                let m = &p[..4 + meta.len()];
                metas.push(json!({"seq": s, "len": m.len()}));
                body.extend(m);
            }
            from = u;
        }
        let mut updates = vec![];
        let mut last = from;
        for s in from + 1..=n {
            if !updates.is_empty() && body.len() as u64 > MAX_PULL { break; }
            let b = read(s)?;
            let who = fs::read_to_string(d.join("log").join(format!("{s:012}.from"))).unwrap_or_default();
            updates.push(json!({"seq": s, "len": b.len(), "from": who}));
            body.extend(b);
            last = s;
        }
        Ok((json!({"snapshot": snapshot, "metas": metas, "updates": updates, "seq": n, "more": last < n, "len": body.len()}), body))
    }

    /// A member's snapshot of a document, holding every update up to `upto`: at least SNAPSHOT_EVERY updates past the
    /// last one ("too soon" otherwise). Kept with the others; none is ever replaced.
    pub fn doc_snapshot(&self, fp: &str, id: &str, name: &str, upto: u64, part: &[u8]) -> Result<(), String> {
        if !hex(name, 64) { return Err("bad doc".into()); }
        if part.len() < MIN_PART || part.len() as u64 > MAX_RECORD || split(part).is_none() { return Err("not a snapshot".into()); }
        self.with(id, fp, |v, _| {
            if epoch(part) != Some(v.epoch) { return Err("key changed".into()); }
            let d = self.doc(id, name);
            if upto == 0 || upto > self.length(id, name) { return Err("no such place in the log".into()); }
            if upto < numbered(&d.join("snap")).last().copied().unwrap_or(0) + SNAPSHOT_EVERY { return Err("too soon after the last snapshot".into()); }
            self.spend(id, fp, part.len() as u64)?;
            sync::write_atomic(&at(&d.join("snap"), upto), part, None).map_err(|e| e.to_string())
        })
    }

    /// The vault's documents: each one's name, log length and last snapshot.
    pub fn doc_list(&self, fp: &str, id: &str) -> Result<Value, String> {
        self.member(id, fp)?;
        let docs: Vec<Value> = fs::read_dir(dir(self.data()).join(id).join("docs")).into_iter().flatten().flatten()
            .filter_map(|e| e.file_name().into_string().ok().filter(|n| hex(n, 64)))
            .map(|n| json!({"seq": self.length(id, &n), "snap": numbered(&self.doc(id, &n).join("snap")).last().copied().unwrap_or(0), "doc": n}))
            .collect();
        Ok(json!({"docs": docs}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// The server's walls for a document: only a member, only under the vault's current key, a log with no gap and
    /// who pushed each entry, a snapshot only of a place the log has and no sooner than SNAPSHOT_EVERY after the last,
    /// none replaced, nothing deleted.
    #[test]
    fn a_document_log_takes_only_current_key_parts_from_members() {
        let data = std::env::temp_dir().join(format!("relay-docs-unit-{}", std::process::id()));
        let vs = Vaults::new(&data, &"f".repeat(64));
        let me = "a".repeat(64);
        let id = vs.create(&me, "laptop", "Team").unwrap()["vault"]["id"].as_str().unwrap().to_string();
        let name = "d".repeat(64);
        // a part's shape: header (a 28-byte meta), meta, body; what is in them is the members' business
        let part = |e: u32| { let mut p = (28u32 | (e << 20)).to_be_bytes().to_vec(); p.extend([7u8; 28 + 40]); p };
        assert_eq!(vs.doc_push(&me, &id, &name, vec![part(0), part(0)]).unwrap(), vec![1, 2]);
        assert_eq!(vs.doc_push(&me, &id, &name, vec![part(1)]).unwrap_err(), "no such key epoch");
        assert_eq!(vs.doc_push(&"b".repeat(64), &id, &name, vec![part(0)]).unwrap_err(), "no such vault", "not a member");
        assert_eq!(vs.doc_push(&me, &id, "nothex", vec![part(0)]).unwrap_err(), "bad doc");
        assert_eq!(vs.doc_push(&me, &id, &name, vec![vec![0; 8]]).unwrap_err(), "not an update");
        // the vault's key changed: a part under the old one is a removed member's, or a Relay behind
        let file = dir(&data).join(&id).join("vault.json");
        let mut v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        v["epoch"] = json!(1);
        fs::write(&file, v.to_string()).unwrap();
        assert_eq!(vs.doc_push(&me, &id, &name, vec![part(0)]).unwrap_err(), "key changed");
        for _ in 3..=205 { vs.doc_push(&me, &id, &name, vec![part(1)]).unwrap(); }
        // snapshots: only of a place in the log, under the current key, SNAPSHOT_EVERY apart, none replaced
        assert!(vs.doc_snapshot(&me, &id, &name, 900, &part(1)).is_err());
        assert!(vs.doc_snapshot(&me, &id, &name, 200, &part(0)).is_err());
        assert!(vs.doc_snapshot(&me, &id, &name, 199, &part(1)).unwrap_err().contains("too soon"));
        vs.doc_snapshot(&me, &id, &name, 200, &part(1)).unwrap();
        assert!(vs.doc_snapshot(&me, &id, &name, 205, &part(1)).unwrap_err().contains("too soon"));
        // from before the snapshot: it, every update's meta up to it, then the rest with who pushed each
        let (v, b) = vs.doc_pull(&me, &id, &name, 0, true).unwrap();
        assert_eq!((v["snapshot"]["upto"].as_u64(), v["metas"].as_array().unwrap().len(), v["updates"].as_array().unwrap().len(), v["seq"].as_u64()), (Some(200), 200, 5, Some(205)));
        assert_eq!((v["metas"][0]["len"].as_u64(), v["updates"][0]["from"].as_str()), (Some(32), Some(&me[..16])));
        assert_eq!(b.len(), part(1).len() + 200 * 32 + 5 * part(1).len());
        // without snapshots (one a member could not check): the log itself
        let (v, _) = vs.doc_pull(&me, &id, &name, 0, false).unwrap();
        assert_eq!((v["snapshot"].is_null(), v["updates"].as_array().unwrap().len()), (true, 205));
        assert_eq!(vs.doc_list(&me, &id).unwrap()["docs"], json!([{"doc": name, "seq": 205, "snap": 200}]));
        assert_eq!(numbered(&vs.doc(&id, &name).join("log")), (1..=205).collect::<Vec<_>>(), "nothing deleted");
        fs::remove_dir_all(&data).ok();
    }
}
