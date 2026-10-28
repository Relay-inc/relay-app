//! A shared vault's documents on the server (docs/workspaces.md, Documents): per document an append-only log of
//! sealed Yjs updates and the sealed snapshots members write now and then. Nothing here reads, merges or deletes them:
//! the log is the document's history. A document is a folder under the vault, named as the members name it (64 hex,
//! the vault's naming key over its id); `log/<seq>` and `snap/<upto>`, each written whole (temp file and rename).

use crate::vaults::{dir, hex, Vaults};
use relay_remote::docs::{MAX_PULL, MAX_UPDATE};
use relay_remote::sync;
use relay_remote::vault::{epoch, MAX_RECORD};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// One push at most, in bytes.
pub const MAX_PUSH: u64 = 4 * MAX_UPDATE;
/// The shortest sealed part: the header, a nonce, a tag.
const MIN_PART: usize = 4 + 12 + 16;

/// The numbered entries of a folder (log or snap), ascending; temp files and anything else left out.
fn numbered(p: &Path) -> Vec<u64> {
    let mut v: Vec<u64> = fs::read_dir(p).into_iter().flatten().flatten()
        .filter_map(|e| { let n = e.file_name().into_string().ok()?; (n.len() == 12 && n.bytes().all(|b| b.is_ascii_digit())).then(|| n.parse().ok())? }).collect();
    v.sort_unstable();
    v
}
fn at(p: &Path, n: u64) -> PathBuf { p.join(format!("{n:012}")) }
/// The log's length: its entries are 1..=n with no gap (each written under the vault's lock).
// ponytail: counts the folder on every push and pull, O(log length); a stored counter when logs get long
fn length(doc: &Path) -> u64 { numbered(&doc.join("log")).last().copied().unwrap_or(0) }

impl Vaults {
    fn doc(&self, id: &str, name: &str) -> PathBuf { dir(self.data()).join(id).join("docs").join(name) }

    /// Append `parts` (sealed updates) to a document's log, under the vault's current key; returns their seqs. The
    /// other members' live streams get each one that fits a frame.
    pub fn doc_push(&self, fp: &str, id: &str, name: &str, parts: Vec<Vec<u8>>) -> Result<Vec<u64>, String> {
        if !hex(name, 64) { return Err("bad doc".into()); }
        if parts.is_empty() || parts.iter().any(|p| p.len() < MIN_PART || p.len() as u64 > MAX_UPDATE) { return Err("not an update".into()); }
        let seqs = self.with(id, fp, |v, _| {
            for p in &parts {
                match epoch(p).unwrap_or(0).cmp(&v.epoch) {
                    std::cmp::Ordering::Less => return Err("key changed".into()),
                    std::cmp::Ordering::Greater => return Err("no such key epoch".into()),
                    std::cmp::Ordering::Equal => {}
                }
            }
            let log = self.doc(id, name).join("log");
            let mut n = length(&self.doc(id, name));
            let mut seqs = vec![];
            for p in &parts {
                n += 1;
                sync::write_atomic(&at(&log, n), p, None).map_err(|e| e.to_string())?;
                seqs.push(n);
            }
            Ok(seqs)
        })?;
        for (p, s) in parts.iter().zip(&seqs) { self.rooms.doc(id, fp, name, *s, p); }
        Ok(seqs)
    }

    /// A document's log after `since`: the newest snapshot past `since` when there is one (then the updates after
    /// it), else the updates themselves, up to MAX_PULL bytes (`more`: there is more after). Returns the answer and
    /// the parts, back to back.
    pub fn doc_pull(&self, fp: &str, id: &str, name: &str, since: u64) -> Result<(Value, Vec<u8>), String> {
        self.member(id, fp)?;
        if !hex(name, 64) { return Err("bad doc".into()); }
        let d = self.doc(id, name);
        let n = length(&d);
        let snap = numbered(&d.join("snap")).into_iter().filter(|u| *u > since && *u <= n).next_back();
        let (mut body, mut from, mut snapshot) = (vec![], since, Value::Null);
        if let Some(u) = snap {
            let b = fs::read(at(&d.join("snap"), u)).map_err(|e| e.to_string())?;
            snapshot = json!({"upto": u, "len": b.len()});
            body.extend(b);
            from = u;
        }
        let mut updates = vec![];
        let mut last = from;
        for s in from + 1..=n {
            if !updates.is_empty() && body.len() as u64 > MAX_PULL { break; }
            let b = fs::read(at(&d.join("log"), s)).map_err(|e| e.to_string())?;
            updates.push(json!({"seq": s, "len": b.len()}));
            body.extend(b);
            last = s;
        }
        Ok((json!({"snapshot": snapshot, "updates": updates, "seq": n, "more": last < n, "len": body.len()}), body))
    }

    /// A member's snapshot of a document, holding every update up to `upto`. The first one for a place stays.
    pub fn doc_snapshot(&self, fp: &str, id: &str, name: &str, upto: u64, part: &[u8]) -> Result<(), String> {
        if !hex(name, 64) { return Err("bad doc".into()); }
        if part.len() < MIN_PART || part.len() as u64 > MAX_RECORD { return Err("not a snapshot".into()); }
        self.with(id, fp, |v, _| {
            if epoch(part) != Some(v.epoch) { return Err("key changed".into()); }
            let d = self.doc(id, name);
            if upto == 0 || upto > length(&d) { return Err("no such place in the log".into()); }
            let p = at(&d.join("snap"), upto);
            if !p.exists() { sync::write_atomic(&p, part, None).map_err(|e| e.to_string())?; }
            Ok(())
        })
    }

    /// The vault's documents: each one's name, log length and last snapshot.
    pub fn doc_list(&self, fp: &str, id: &str) -> Result<Value, String> {
        self.member(id, fp)?;
        let docs: Vec<Value> = fs::read_dir(dir(self.data()).join(id).join("docs")).into_iter().flatten().flatten()
            .filter_map(|e| e.file_name().into_string().ok().filter(|n| hex(n, 64)))
            .map(|n| { let d = self.doc(id, &n); json!({"doc": n, "seq": length(&d), "snap": numbered(&d.join("snap")).last().copied().unwrap_or(0)}) })
            .collect();
        Ok(json!({"docs": docs}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// The server's walls for a document: only a member, only under the vault's current key, a log with no gap, a
    /// snapshot only of a place the log has, the first snapshot of a place kept.
    #[test]
    fn a_document_log_takes_only_current_key_parts_from_members() {
        let data = std::env::temp_dir().join(format!("relay-docs-unit-{}", std::process::id()));
        let vs = Vaults::new(&data, &"f".repeat(64));
        let me = "a".repeat(64);
        let id = vs.create(&me, "laptop", "Team").unwrap()["vault"]["id"].as_str().unwrap().to_string();
        let name = "d".repeat(64);
        let part = |e: u32| { let mut p = (e << 20).to_be_bytes().to_vec(); p.extend([7u8; 40]); p };
        assert_eq!(vs.doc_push(&me, &id, &name, vec![part(0), part(0)]).unwrap(), vec![1, 2]);
        assert_eq!(vs.doc_push(&me, &id, &name, vec![part(0)]).unwrap(), vec![3]);
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
        assert_eq!(vs.doc_push(&me, &id, &name, vec![part(1)]).unwrap(), vec![4]);
        // snapshots: only of a place in the log, under the current key; the first for a place stays
        assert!(vs.doc_snapshot(&me, &id, &name, 9, &part(1)).is_err());
        assert!(vs.doc_snapshot(&me, &id, &name, 3, &part(0)).is_err());
        vs.doc_snapshot(&me, &id, &name, 3, &part(1)).unwrap();
        let mut other = part(1);
        other.push(1);
        vs.doc_snapshot(&me, &id, &name, 3, &other).unwrap();
        // a pull from before the snapshot: the snapshot, then the rest; from after it: the updates only
        let (v, b) = vs.doc_pull(&me, &id, &name, 0).unwrap();
        assert_eq!((v["snapshot"]["upto"].as_u64(), v["updates"].as_array().unwrap().len(), v["seq"].as_u64(), b.len()), (Some(3), 1, Some(4), 2 * part(1).len()));
        let (v, _) = vs.doc_pull(&me, &id, &name, 3).unwrap();
        assert_eq!((v["snapshot"].is_null(), v["updates"][0]["seq"].as_u64()), (true, Some(4)));
        assert_eq!(vs.doc_list(&me, &id).unwrap()["docs"], json!([{"doc": name, "seq": 4, "snap": 3}]));
        // nothing was deleted: every update is still in the log
        assert_eq!(numbered(&vs.doc(&id, &name).join("log")), vec![1, 2, 3, 4]);
        fs::remove_dir_all(&data).ok();
    }
}
