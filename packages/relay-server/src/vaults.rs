//! Shared vaults (docs/shared-vaults.md): a vault several people share through this server. Each member's Relay syncs
//! it into a plain folder on its own Mac; here it is only ciphertext, one record per file, named by an HMAC of its path,
//! under a key this server never has. Access is by device certificate: a vault's members are fingerprints, and a device
//! that came in through an invite link is a vault-only client that may do nothing else here.
//!
//! On disk, per vault: `vaults/<id>/vault.json` (0600: name, members, open invites) and `vaults/<id>/blobs/<name>`.
//! A record is `u32 meta_len || meta || data`; only `meta_len` is read here, to list `meta` in the manifest. Every write
//! is a compare-and-swap on the record's etag (sha256 of the file), under a lock per vault.

use crate::{clients, now, save_clients, write_private, Client, CLIENTS};
use relay_remote::{sync, tls};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::{fs, io};

/// How long an invite link works, and how many wrong proofs drop it.
const INVITE_SECS: u64 = 24 * 3600;
const INVITE_TRIES: u32 = 5;
/// A record's meta part at most, and a record at most: the mirror's biggest file plus that.
const MAX_META: usize = 64 << 10;
pub const MAX_RECORD: u64 = crate::mirror::MAX_FILE + MAX_META as u64;
/// A vault's name at most, in characters; a wrapped vault key at most, in hex characters.
const MAX_NAME: usize = 100;
const MAX_WRAPPED: usize = 512;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct Member { pub fp: String, pub name: String, pub role: String, pub added: u64 }
/// `code`: the pairing-style secret the link holds, proven with `tls::proof`. `wrapped`: the vault key sealed under the
/// link's other secret, handed out on a good proof. `by`: the admin who made it.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct Invite { pub id: String, code: String, pub role: String, wrapped: String, pub expires: u64, #[serde(default)] fails: u32, by: String }
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct Vault { pub id: String, pub name: String, pub created: u64, pub members: Vec<Member>, pub invites: Vec<Invite> }
impl Vault {
    fn role(&self, fp: &str) -> Option<&str> { self.members.iter().find(|m| m.fp == fp).map(|m| m.role.as_str()) }
    fn has_admin(&self) -> bool { self.members.iter().any(|m| m.role == "admin") }
}

/// Exactly `n` lowercase hex characters: every id, code and blob name. Anything else never reaches a path.
fn hex(s: &str, n: usize) -> bool { s.len() == n && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) }
fn to_hex(b: &[u8]) -> String { b.iter().map(|b| format!("{b:02x}")).collect() }
fn dir(data: &Path) -> PathBuf { data.join("vaults") }

/// A vault's file, its expired and used-up invites left out. None when there is no such vault.
fn load(data: &Path, id: &str) -> Option<Vault> {
    let mut v: Vault = serde_json::from_str(&fs::read_to_string(dir(data).join(id).join("vault.json")).ok()?).ok()?;
    let t = now();
    v.invites.retain(|i| i.expires > t && i.fails < INVITE_TRIES);
    Some(v)
}
fn save(data: &Path, v: &Vault) -> Result<(), String> {
    write_private(&dir(data).join(&v.id).join("vault.json"), &serde_json::to_string_pretty(v).unwrap()).map_err(|e| e.to_string())
}
/// Every vault here.
pub(crate) fn all(data: &Path) -> Vec<Vault> {
    let mut v: Vec<Vault> = fs::read_dir(dir(data)).into_iter().flatten().flatten().filter_map(|e| e.file_name().to_str().filter(|n| hex(n, 16)).and_then(|n| load(data, n))).collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}
/// For the handshake: a device that is not paired gets in while some vault has an invite open (it may then only join).
pub fn invite_open(data: &Path) -> bool { all(data).iter().any(|v| !v.invites.is_empty()) }

/// A revoked device leaves every vault. Nobody left: the vault goes, its ciphertext is of no use to anyone here.
// ponytail: no lock against a running server (revoke is the CLI's own process); clients.json has the same race with pair
pub(crate) fn forget(data: &Path, fps: &[String]) {
    for mut v in all(data) {
        let n = v.members.len() + v.invites.len();
        v.members.retain(|m| !fps.contains(&m.fp));
        // the invites they made go too: a link of someone who is out lets nobody in
        v.invites.retain(|i| !fps.contains(&i.by));
        if v.members.is_empty() { fs::remove_dir_all(dir(data).join(&v.id)).ok(); } else if v.members.len() + v.invites.len() != n { save(data, &v).ok(); }
    }
}

/// The meta part of a record: what the 4-byte length in front says, at most MAX_META and inside the record.
fn meta_of(record: &[u8]) -> Option<&[u8]> {
    let n = u32::from_be_bytes(record.get(..4)?.try_into().ok()?) as usize;
    if n > MAX_META { return None; }
    record.get(4..4 + n)
}
/// The etag of the record at `p`, "" when there is none.
fn etag_at(p: &Path) -> Result<String, String> {
    match fs::read(p) { Ok(b) => Ok(sync::sha256_hex(&b)), Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()), Err(e) => Err(e.to_string()) }
}

/// A blob as the manifest last listed it, by (inode, size, mtime): a manifest reads only what changed since. Writes
/// never trust it, they hash the file under the vault's lock.
type Stamp = (u64, u64, i64, i64);

/// `fp`: this server's certificate, which an invite's proof is bound to. `locks`: one per vault, for every write.
pub struct Vaults { data: PathBuf, fp: String, locks: Mutex<HashMap<String, Arc<Mutex<()>>>>, seen: Mutex<HashMap<PathBuf, (Stamp, Value)>> }

impl Vaults {
    pub fn new(data: &Path, fp: &str) -> Vaults { Vaults { data: data.into(), fp: fp.into(), locks: Mutex::default(), seen: Mutex::default() } }
    fn blobs(&self, id: &str) -> PathBuf { dir(&self.data).join(id).join("blobs") }

    /// Vault `id`, read and changed by `f` without another request in between. A vault that is not there and one the
    /// caller is not a member of answer the same.
    fn locked<T>(&self, id: &str, f: impl FnOnce(&mut Vault) -> Result<T, String>) -> Result<T, String> {
        if !hex(id, 16) || !dir(&self.data).join(id).is_dir() { return Err("no such vault".into()); }
        let l = self.locks.lock().unwrap().entry(id.into()).or_default().clone();
        let _one = l.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut load(&self.data, id).ok_or("no such vault")?)
    }
    /// The same for a member, with its role.
    fn with<T>(&self, id: &str, fp: &str, f: impl FnOnce(&mut Vault, &str) -> Result<T, String>) -> Result<T, String> {
        self.locked(id, |v| { let role = v.role(fp).ok_or("no such vault")?.to_string(); f(v, &role) })
    }
    /// A read: the caller must be a member now, the blobs it reads are each written whole (temp file and rename).
    fn member(&self, id: &str, fp: &str) -> Result<Vault, String> {
        let v = if hex(id, 16) { load(&self.data, id) } else { None };
        v.filter(|v| v.role(fp).is_some()).ok_or_else(|| "no such vault".into())
    }

    /// A new vault, `who` (the caller's device name) its admin.
    pub fn create(&self, fp: &str, who: &str, name: &str) -> Result<Value, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME || name.chars().any(char::is_control) { return Err(format!("a vault name is 1 to {MAX_NAME} characters")); }
        let id = tls::random_secret()[..16].to_string();
        let v = Vault { id: id.clone(), name: name.into(), created: now(), members: vec![Member { fp: fp.into(), name: who.into(), role: "admin".into(), added: now() }], invites: vec![] };
        fs::create_dir_all(self.blobs(&id)).map_err(|e| e.to_string())?;
        save(&self.data, &v)?;
        Ok(json!({"vault": {"id": id, "name": v.name}}))
    }
    pub fn list(&self, fp: &str) -> Value {
        let mine: Vec<Value> = all(&self.data).iter().filter_map(|v| Some(json!({"id": v.id, "name": v.name, "role": v.role(fp)?, "members": v.members.len()}))).collect();
        json!({"vaults": mine})
    }
    /// Its members, and its open invites for an admin.
    pub fn info(&self, fp: &str, id: &str) -> Result<Value, String> {
        let v = self.member(id, fp)?;
        let role = v.role(fp).unwrap_or_default();
        let members: Vec<Value> = v.members.iter().map(|m| json!({"name": m.name, "fp": m.fp, "role": m.role, "added": m.added})).collect();
        let invites: Vec<Value> = if role == "admin" { v.invites.iter().map(|i| json!({"id": i.id, "role": i.role, "expires": i.expires})).collect() } else { vec![] };
        Ok(json!({"vault": {"id": v.id, "name": v.name, "role": role, "members": members, "invites": invites}}))
    }

    /// An admin opens an invite: its code goes into the link, with this server's fingerprint.
    pub fn invite(&self, fp: &str, id: &str, role: &str, wrapped: &str) -> Result<Value, String> {
        if role != "admin" && role != "member" { return Err("role is admin or member".into()); }
        if wrapped.is_empty() || wrapped.len() > MAX_WRAPPED || !hex(wrapped, wrapped.len()) { return Err("bad wrapped key".into()); }
        self.with(id, fp, |v, me| {
            if me != "admin" { return Err("only an admin can invite".into()); }
            let i = Invite { id: tls::random_secret()[..16].into(), code: tls::random_secret(), role: role.into(), wrapped: wrapped.into(), expires: now() + INVITE_SECS, fails: 0, by: fp.into() };
            let out = json!({"invite": {"id": i.id, "code": i.code, "expires": i.expires}, "fp": self.fp});
            v.invites.push(i);
            save(&self.data, v)?;
            Ok(out)
        })
    }
    pub fn invite_revoke(&self, fp: &str, id: &str, invite: &str) -> Result<(), String> {
        self.with(id, fp, |v, me| {
            if me != "admin" { return Err("only an admin can revoke an invite".into()); }
            v.invites.retain(|i| i.id != invite);
            save(&self.data, v)
        })
    }

    /// A device joins with an invite link: the proof binds the link's code to both certificates. A wrong one counts,
    /// the fifth drops the invite; a good one uses it up. A device new here becomes a vault-only client. One that is a
    /// member already keeps its membership, raised to admin by an admin invite, never lowered (that could leave the
    /// vault without an admin).
    pub fn join(&self, fp: &str, id: &str, invite: &str, name: &str, proof: &str) -> Result<Value, String> {
        if !hex(invite, 16) { return Err("bad invite".into()); }
        self.locked(id, |v| {
            let i = v.invites.iter().position(|i| i.id == invite).ok_or("this invite is used, expired or revoked")?;
            if !tls::verify_proof(&v.invites[i].code, fp, &self.fp, proof) {
                v.invites[i].fails += 1;
                if v.invites[i].fails >= INVITE_TRIES { v.invites.remove(i); }
                save(&self.data, v).ok();
                return Err("wrong invite code".into());
            }
            let inv = v.invites.remove(i);
            // an invite counts only while its maker is still an admin here
            if v.role(&inv.by) != Some("admin") { save(&self.data, v).ok(); return Err("this invite is used, expired or revoked".into()); }
            let _c = CLIENTS.lock().unwrap_or_else(|e| e.into_inner());
            let mut list = clients(&self.data);
            let known = list.iter().find(|c| c.fp == fp).map(|c| c.name.clone());
            let who = known.clone().unwrap_or_else(|| {
                // the name as `pair` takes it, a number on a name that is taken
                let name: String = name.trim().chars().filter(|c| !c.is_control()).take(60).collect();
                let name = if name.is_empty() { format!("device-{}", &fp[..8]) } else { name };
                let (mut n, mut k) = (name.clone(), 2);
                while list.iter().any(|c| c.name == n) { n = format!("{name} {k}"); k += 1; }
                n
            });
            match v.members.iter_mut().find(|m| m.fp == fp) {
                Some(m) => if inv.role == "admin" { m.role = "admin".into(); },
                None => v.members.push(Member { fp: fp.into(), name: who.clone(), role: inv.role.clone(), added: now() }),
            }
            // the vault first: a member that is not a client yet cannot connect, a client in no vault could
            save(&self.data, v)?;
            if known.is_none() {
                list.push(Client { name: who, fp: fp.into(), added: now(), parent: None, vaults_only: true });
                save_clients(&self.data, &list).map_err(|e| e.to_string())?;
            }
            Ok(json!({"vault": {"id": v.id, "name": v.name}, "role": v.role(fp), "wrapped": inv.wrapped}))
        })
    }

    /// An admin removes a member, or a member leaves. Never the last admin while others stay; the last member takes the
    /// vault with it. A vault-only device in no vault any more is unpaired.
    pub fn remove(&self, fp: &str, id: &str, who: &str) -> Result<(), String> {
        self.with(id, fp, |v, me| {
            if me != "admin" && fp != who { return Err("only an admin can remove someone else".into()); }
            if v.role(who).is_none() { return Err("not a member of this vault".into()); }
            v.members.retain(|m| m.fp != who);
            v.invites.retain(|i| i.by != who);
            if v.members.is_empty() { return fs::remove_dir_all(dir(&self.data).join(&v.id)).map_err(|e| e.to_string()); }
            if !v.has_admin() { return Err("that would leave the vault without an admin".into()); }
            save(&self.data, v)
        })?;
        let _c = CLIENTS.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = clients(&self.data);
        if list.iter().any(|c| c.fp == who && c.vaults_only) && !all(&self.data).iter().any(|v| v.role(who).is_some()) {
            list.retain(|c| c.fp != who);
            save_clients(&self.data, &list).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Every record: its name, etag, size and meta part (hex).
    pub fn manifest(&self, fp: &str, id: &str) -> Result<Vec<Value>, String> {
        self.member(id, fp)?;
        let mut out = vec![];
        for e in fs::read_dir(self.blobs(id)).into_iter().flatten().flatten() {
            // a write's temp file is no record
            if !e.file_name().to_str().is_some_and(|n| hex(n, 64)) { continue; }
            let (p, Ok(m)) = (e.path(), e.metadata()) else { continue };
            let stamp = (m.ino(), m.len(), m.mtime(), m.mtime_nsec());
            if let Some((s, v)) = self.seen.lock().unwrap().get(&p) { if *s == stamp { out.push(v.clone()); continue; } }
            let Ok(b) = fs::read(&p) else { continue };
            let Some(meta) = meta_of(&b) else { continue };
            let v = json!({"name": e.file_name().to_string_lossy(), "etag": sync::sha256_hex(&b), "size": b.len(), "meta": to_hex(meta)});
            self.seen.lock().unwrap().insert(p, (stamp, v.clone()));
            out.push(v);
        }
        Ok(out)
    }
    /// A record and its etag.
    pub fn get(&self, fp: &str, id: &str, name: &str) -> Result<(Vec<u8>, String), String> {
        self.member(id, fp)?;
        if !hex(name, 64) { return Err("bad name".into()); }
        let b = fs::read(self.blobs(id).join(name)).map_err(|_| "no such file")?;
        let etag = sync::sha256_hex(&b);
        Ok((b, etag))
    }
    /// Write a record while the one there still has etag `expect` ("": none). Returns the new etag.
    pub fn put(&self, fp: &str, id: &str, name: &str, record: &[u8], expect: Option<&str>) -> Result<String, String> {
        if !hex(name, 64) { return Err("bad name".into()); }
        if record.len() as u64 > MAX_RECORD || meta_of(record).is_none() { return Err("not a record".into()); }
        let expect = expect.ok_or("expect missing")?;
        self.with(id, fp, |_, _| {
            let p = self.blobs(id).join(name);
            if etag_at(&p)? != expect { return Err("changed meanwhile".into()); }
            sync::write_atomic(&p, record, None).map_err(|e| e.to_string())?;
            Ok(sync::sha256_hex(record))
        })
    }
    /// Delete a record while it still has etag `expect`.
    pub fn delete(&self, fp: &str, id: &str, name: &str, expect: Option<&str>) -> Result<(), String> {
        if !hex(name, 64) { return Err("bad name".into()); }
        let expect = expect.ok_or("expect missing")?;
        self.with(id, fp, |_, _| {
            let p = self.blobs(id).join(name);
            if etag_at(&p)? != expect { return Err("changed meanwhile".into()); }
            if !expect.is_empty() { fs::remove_file(&p).map_err(|e| e.to_string())?; }
            self.seen.lock().unwrap().remove(&p);
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ADMIN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const SERVER: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    fn store(tag: &str) -> Vaults {
        let d = std::env::temp_dir().join(format!("relay-vaults-{tag}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        Vaults::new(&d, SERVER)
    }
    /// A record the server accepts: a meta part of `meta` bytes, then `data`. Never decrypted here.
    fn record(meta: &[u8], data: &[u8]) -> Vec<u8> { [&(meta.len() as u32).to_be_bytes()[..], meta, data].concat() }
    fn name(c: char) -> String { c.to_string().repeat(64) }
    fn made(s: &Vaults) -> String { s.create(ADMIN, "laptop", "Team").unwrap()["vault"]["id"].as_str().unwrap().to_string() }
    fn invite(s: &Vaults, id: &str, role: &str) -> (String, String) {
        let v = s.invite(ADMIN, id, role, &"ab".repeat(32)).unwrap();
        (v["invite"]["id"].as_str().unwrap().into(), v["invite"]["code"].as_str().unwrap().into())
    }
    fn join(s: &Vaults, fp: &str, id: &str, role: &str) {
        let (inv, code) = invite(s, id, role);
        s.join(fp, id, &inv, "colleague", &tls::proof(&code, fp, SERVER)).unwrap();
    }

    #[test]
    fn puts_and_deletes_are_compare_and_swap() {
        let s = store("cas");
        let id = made(&s);
        let (one, two) = (record(b"m1", b"one"), record(b"m2", b"two"));
        assert!(s.put(ADMIN, &id, &name('1'), &one, None).unwrap_err().contains("expect missing"));
        assert!(s.put(ADMIN, &id, &name('1'), &one, Some("ff")).unwrap_err().contains("changed meanwhile"), "absent is \"\"");
        let e1 = s.put(ADMIN, &id, &name('1'), &one, Some("")).unwrap();
        assert_eq!(e1, sync::sha256_hex(&one));
        assert!(s.put(ADMIN, &id, &name('1'), &two, Some("")).unwrap_err().contains("changed meanwhile"), "it exists now");
        let e2 = s.put(ADMIN, &id, &name('1'), &two, Some(&e1)).unwrap();
        assert!(s.put(ADMIN, &id, &name('1'), &one, Some(&e1)).unwrap_err().contains("changed meanwhile"), "an older etag");
        assert_eq!(s.get(ADMIN, &id, &name('1')).unwrap(), (two.clone(), e2.clone()));
        assert!(s.delete(ADMIN, &id, &name('1'), Some(&e1)).unwrap_err().contains("changed meanwhile"));
        s.delete(ADMIN, &id, &name('1'), Some(&e2)).unwrap();
        assert!(s.get(ADMIN, &id, &name('1')).is_err());
        assert!(s.delete(ADMIN, &id, &name('1'), Some(&e2)).unwrap_err().contains("changed meanwhile"), "already gone");
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn the_manifest_lists_meta_etag_and_size_and_a_malformed_record_is_refused() {
        let s = store("manifest");
        let id = made(&s);
        let r = record(&[1, 2, 0xfe], b"ciphertext");
        let etag = s.put(ADMIN, &id, &name('a'), &r, Some("")).unwrap();
        fs::write(s.blobs(&id).join(".tmp-left-over"), b"x").unwrap();
        let m = s.manifest(ADMIN, &id).unwrap();
        assert_eq!(m, vec![json!({"name": name('a'), "etag": etag, "size": r.len(), "meta": "0102fe"})]);
        assert_eq!(s.manifest(ADMIN, &id).unwrap(), m, "from the cache the second time");
        // rewritten: the manifest sees the new one, not the cached one
        let r2 = record(b"", b"x");
        let e2 = s.put(ADMIN, &id, &name('a'), &r2, Some(&etag)).unwrap();
        assert_eq!(s.manifest(ADMIN, &id).unwrap()[0]["etag"], e2);
        for bad in [vec![], vec![0, 0, 0], record(b"meta", b"")[..6].to_vec(), [&(MAX_META as u32 + 1).to_be_bytes()[..], &vec![0; MAX_META + 1]].concat()] {
            assert!(s.put(ADMIN, &id, &name('b'), &bad, Some("")).unwrap_err().contains("not a record"), "{bad:?}");
        }
        assert!(s.put(ADMIN, &id, &name('b'), &record(&vec![0; MAX_META], b""), Some("")).is_ok(), "64 KiB of meta is fine");
        for bad in ["../vault.json", &name('A'), &"a".repeat(63)] { assert!(s.put(ADMIN, &id, bad, &r, Some("")).unwrap_err().contains("bad name"), "{bad}"); }
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn input_is_checked() {
        let s = store("input");
        assert!(s.create(ADMIN, "laptop", " ").is_err());
        assert!(s.create(ADMIN, "laptop", &"x".repeat(MAX_NAME + 1)).is_err());
        let id = made(&s);
        assert!(s.invite(ADMIN, &id, "owner", "ab").unwrap_err().contains("role"));
        assert!(s.invite(ADMIN, &id, "member", &"a".repeat(MAX_WRAPPED + 1)).unwrap_err().contains("wrapped"));
        assert!(s.invite(ADMIN, &id, "member", "xyz").unwrap_err().contains("wrapped"));
        assert!(s.invite(ADMIN, &id, "member", &"a".repeat(MAX_WRAPPED)).is_ok());
        assert!(s.info(ADMIN, &id.to_uppercase()).is_err());
        assert!(s.info(ADMIN, "../../clients.js").is_err());
        assert!(s.join(OTHER, &id, "nothex", "x", "00").unwrap_err().contains("bad invite"));
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn invites_expire_and_five_wrong_proofs_drop_one() {
        let s = store("invites");
        let id = made(&s);
        assert!(!invite_open(&s.data));
        let (inv, code) = invite(&s, &id, "member");
        assert!(invite_open(&s.data));
        for _ in 0..4 { assert!(s.join(OTHER, &id, &inv, "x", &tls::proof("0".repeat(32).as_str(), OTHER, SERVER)).unwrap_err().contains("wrong invite code")); }
        assert_eq!(s.info(ADMIN, &id).unwrap()["vault"]["invites"].as_array().unwrap().len(), 1, "four wrong ones leave it");
        assert!(s.join(OTHER, &id, &inv, "x", "00").is_err());
        assert!(s.join(OTHER, &id, &inv, "x", &tls::proof(&code, OTHER, SERVER)).unwrap_err().contains("used, expired or revoked"), "the fifth dropped it");
        assert!(!invite_open(&s.data));
        // a day later
        let (inv, code) = invite(&s, &id, "member");
        let mut v = load(&s.data, &id).unwrap();
        v.invites[0].expires = now() - 1;
        save(&s.data, &v).unwrap();
        assert!(!invite_open(&s.data));
        assert!(s.join(OTHER, &id, &inv, "x", &tls::proof(&code, OTHER, SERVER)).is_err());
        assert!(s.info(ADMIN, &id).unwrap()["vault"]["invites"].as_array().unwrap().is_empty());
        // revoked
        let (inv, code) = invite(&s, &id, "member");
        s.invite_revoke(ADMIN, &id, &inv).unwrap();
        assert!(s.join(OTHER, &id, &inv, "x", &tls::proof(&code, OTHER, SERVER)).is_err());
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn a_join_uses_the_invite_and_adds_a_vault_only_client() {
        let s = store("join");
        save_clients(&s.data, &[Client { name: "colleague".into(), fp: SERVER.into(), added: 1, parent: None, vaults_only: false }]).unwrap();
        let id = made(&s);
        let (inv, code) = invite(&s, &id, "member");
        // a proof for another device's certificate does not count for this one
        assert!(s.join(OTHER, &id, &inv, "colleague", &tls::proof(&code, ADMIN, SERVER)).is_err());
        let r = s.join(OTHER, &id, &inv, "colleague", &tls::proof(&code, OTHER, SERVER)).unwrap();
        assert_eq!((r["role"].as_str(), r["wrapped"].as_str(), r["vault"]["name"].as_str()), (Some("member"), Some("ab".repeat(32).as_str()), Some("Team")));
        let c = clients(&s.data).into_iter().find(|c| c.fp == OTHER).unwrap();
        assert!(c.vaults_only);
        assert_eq!(c.name, "colleague 2", "deduplicated as pair does");
        assert!(s.join(OTHER, &id, &inv, "colleague", &tls::proof(&code, OTHER, SERVER)).is_err(), "single use");
        assert_eq!(s.list(OTHER)["vaults"], json!([{"id": id, "name": "Team", "role": "member", "members": 2}]));
        // a member sees the members, not the invites
        invite(&s, &id, "member");
        let info = s.info(OTHER, &id).unwrap();
        assert_eq!(info["vault"]["members"].as_array().unwrap().len(), 2);
        assert!(info["vault"]["invites"].as_array().unwrap().is_empty());
        assert_eq!(s.info(ADMIN, &id).unwrap()["vault"]["invites"].as_array().unwrap().len(), 1);
        // a member may not invite; joining again with an admin invite raises it, a member invite never lowers
        assert!(s.invite(OTHER, &id, "member", "ab").unwrap_err().contains("only an admin"));
        join(&s, OTHER, &id, "admin");
        join(&s, OTHER, &id, "member");
        assert_eq!(s.list(OTHER)["vaults"][0]["role"], "admin");
        assert_eq!(clients(&s.data).len(), 2, "a known device is not added twice");
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn a_non_member_gets_nothing() {
        let s = store("walls");
        let id = made(&s);
        let e1 = s.put(ADMIN, &id, &name('1'), &record(b"m", b"d"), Some("")).unwrap();
        let no = |r: Result<Value, String>| assert_eq!(r.unwrap_err(), "no such vault");
        no(s.info(OTHER, &id));
        no(s.invite(OTHER, &id, "admin", "ab"));
        no(s.invite_revoke(OTHER, &id, "0000000000000000").map(|_| json!({})));
        no(s.remove(OTHER, &id, ADMIN).map(|_| json!({})));
        no(s.remove(OTHER, &id, OTHER).map(|_| json!({})));
        no(s.manifest(OTHER, &id).map(|m| json!(m)));
        no(s.get(OTHER, &id, &name('1')).map(|_| json!({})));
        no(s.put(OTHER, &id, &name('1'), &record(b"m", b"x"), Some(&e1)).map(|e| json!(e)));
        no(s.put(OTHER, &id, &name('2'), &record(b"m", b"x"), Some("")).map(|e| json!(e)));
        no(s.delete(OTHER, &id, &name('1'), Some(&e1)).map(|_| json!({})));
        no(s.info(OTHER, "0123456789abcdef"));
        assert_eq!(s.list(OTHER)["vaults"], json!([]));
        assert_eq!(s.get(ADMIN, &id, &name('1')).unwrap().1, e1, "untouched");
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn the_last_admin_stays_and_a_leaver_with_no_vault_is_unpaired() {
        let s = store("admin");
        let id = made(&s);
        join(&s, OTHER, &id, "member");
        assert!(s.remove(ADMIN, &id, ADMIN).unwrap_err().contains("without an admin"));
        assert!(s.remove(OTHER, &id, ADMIN).unwrap_err().contains("only an admin"));
        // a second vault keeps the colleague paired after it leaves the first
        let id2 = made(&s);
        join(&s, OTHER, &id2, "member");
        s.remove(OTHER, &id, OTHER).unwrap();
        assert!(clients(&s.data).iter().any(|c| c.fp == OTHER));
        assert!(s.remove(OTHER, &id, OTHER).is_err(), "gone");
        // the admin removes it from the last one: no vault left, so no client either
        s.remove(ADMIN, &id2, OTHER).unwrap();
        assert!(!clients(&s.data).iter().any(|c| c.fp == OTHER));
        // the last member leaving takes the vault along
        s.remove(ADMIN, &id, ADMIN).unwrap();
        assert!(!dir(&s.data).join(&id).exists());
        fs::remove_dir_all(&s.data).ok();
    }

    #[test]
    fn an_invite_dies_with_its_maker() {
        let s = store("maker");
        let id = made(&s);
        join(&s, OTHER, &id, "admin");
        let (inv, code) = invite(&s, &id, "member");
        // ADMIN made that invite; the second admin removes ADMIN, and the link lets nobody in any more
        s.remove(OTHER, &id, ADMIN).unwrap();
        let late = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
        assert!(s.join(late, &id, &inv, "late", &tls::proof(&code, late, SERVER)).is_err());
    }
    #[test]
    fn revoke_removes_the_memberships() {
        let s = store("revoke");
        save_clients(&s.data, &[Client { name: "laptop".into(), fp: ADMIN.into(), added: 1, parent: None, vaults_only: false }]).unwrap();
        let (id, solo) = (made(&s), made(&s));
        join(&s, OTHER, &id, "member");
        let gone = crate::revoke(&s.data, "colleague").unwrap();
        assert_eq!(gone.len(), 1);
        assert_eq!(s.info(ADMIN, &id).unwrap()["vault"]["members"].as_array().unwrap().len(), 1);
        assert!(s.manifest(OTHER, &id).is_err());
        crate::revoke(&s.data, "laptop").unwrap();
        assert!(all(&s.data).is_empty(), "nobody left in either: {solo} and {id} are gone");
        fs::remove_dir_all(&s.data).ok();
    }
}
