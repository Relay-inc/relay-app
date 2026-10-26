//! A vault several people share through a relay-server (docs/shared-vaults.md). The server stores one record per file
//! and never has the key: the path and the content are sealed here with ChaCha20-Poly1305, the record is named by an
//! HMAC of its path, and both seals bind that name, so the server can neither read a record nor pass one off as
//! another. `SealedRemote` puts this behind `sync::Remote`, so `sync::run` syncs a shared vault like the mirror.

use crate::share::{hex, unhex};
use crate::sync::{self, Entry, Manifest};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use ring::{hkdf, hmac};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

const SALT: &[u8] = b"relay shared vault v1";
const INVITE_SALT: &[u8] = b"relay vault invite v1";
/// A record's meta part at most; the server refuses more too.
const MAX_META: usize = 64 << 10;
/// A whole record at most: the server's limit, mirror::MAX_FILE plus 64 KiB.
const MAX_RECORD: u64 = (64 << 20) + (64 << 10);

/// A shared vault's key: 32 random bytes, kept by every member and never sent to the server in the clear.
#[derive(Clone)]
pub struct VaultKey([u8; 32]);
/// Never the bytes, so a key cannot end up in a log.
impl std::fmt::Debug for VaultKey { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("VaultKey(..)") } }
impl VaultKey {
    pub fn generate() -> VaultKey {
        let mut k = [0u8; 32];
        SystemRandom::new().fill(&mut k).expect("system randomness");
        VaultKey(k)
    }
    /// 64 hex chars, any case; anything else is None.
    pub fn from_hex(s: &str) -> Option<VaultKey> { unhex(s.trim())?.try_into().ok().map(VaultKey) }
    pub fn to_hex(&self) -> String { hex(&self.0) }

    /// The sealing key and the naming key, both derived from the vault key.
    fn keys(&self) -> (LessSafeKey, hmac::Key) {
        let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, SALT).extract(&self.0);
        // expand only fails above 255 hash lengths, 32 bytes never does
        let enc = UnboundKey::from(prk.expand(&[b"enc"], &CHACHA20_POLY1305).unwrap());
        (LessSafeKey::new(enc), hmac::Key::from(prk.expand(&[b"name"], hmac::HMAC_SHA256).unwrap()))
    }
    /// The record's name on the server: hex HMAC of the path, the same on every member's Mac.
    pub fn name(&self, path: &str) -> String { name(&self.keys().1, path) }

    /// The record for one file: `u32 BE meta_len || meta || data`, each part `nonce || ciphertext+tag`.
    pub fn record(&self, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String> {
        let (enc, names) = self.keys();
        let n = name(&names, path);
        let meta = json!({"p": path, "h": sync::sha256_hex(data), "s": data.len(), "m": mtime}).to_string();
        let meta = seal(&enc, format!("meta:{n}").as_bytes(), meta.as_bytes())?;
        if meta.len() > MAX_META { return Err("path too long".into()); }
        let mut out = (meta.len() as u32).to_be_bytes().to_vec();
        out.extend(meta);
        out.extend(seal(&enc, format!("data:{n}").as_bytes(), data)?);
        Ok(out)
    }
    /// What a record's meta says about its file (path, plaintext size, mtime, plaintext hash), refused when it was not
    /// sealed under `name` or when `name` is not its path's: a record moved to another name.
    pub fn open_meta(&self, name: &str, meta: &[u8]) -> Result<Entry, String> {
        #[derive(Deserialize)]
        struct Meta { p: String, h: String, s: u64, m: i64 }
        let (enc, names) = self.keys();
        let plain = open(&enc, format!("meta:{name}").as_bytes(), meta).ok_or("meta does not open with this vault's key")?;
        let m: Meta = serde_json::from_slice(&plain).map_err(|e| format!("meta: {e}"))?;
        if self::name(&names, &m.p) != name { return Err("record is filed under another name".into()); }
        Ok(Entry { path: m.p, size: m.s, mtime: m.m, hash: m.h })
    }
    /// A whole record's content.
    pub fn open_data(&self, name: &str, record: &[u8]) -> Result<Vec<u8>, String> {
        let (_, data) = split(record).ok_or("not a record")?;
        open(&self.keys().0, format!("data:{name}").as_bytes(), data).ok_or_else(|| "content does not open with this vault's key".into())
    }
}
fn name(names: &hmac::Key, path: &str) -> String { hex(hmac::sign(names, path.as_bytes()).as_ref()) }
/// A record's (meta, data).
fn split(record: &[u8]) -> Option<(&[u8], &[u8])> {
    let n = u32::from_be_bytes(record.get(..4)?.try_into().ok()?) as usize;
    Some((record.get(4..4 + n)?, record.get(4 + n..)?))
}
/// nonce (12) || ciphertext+tag, a fresh random nonce every time.
fn seal(key: &LessSafeKey, aad: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    SystemRandom::new().fill(&mut nonce).map_err(|_| "no randomness")?;
    let mut buf = plain.to_vec();
    key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(aad), &mut buf).map_err(|_| "seal failed")?;
    let mut out = nonce.to_vec();
    out.extend(buf);
    Ok(out)
}
fn open(key: &LessSafeKey, aad: &[u8], blob: &[u8]) -> Option<Vec<u8>> {
    let (n, c) = (blob.get(..12)?, blob.get(12..)?);
    let mut buf = c.to_vec();
    let plain = key.open_in_place(Nonce::try_assume_unique_for_key(n).ok()?, Aad::from(aad), &mut buf).ok()?;
    Some(plain.to_vec())
}

/// The key an invite link's secret (64 hex) unlocks.
fn invite_key(secret_hex: &str) -> Result<LessSafeKey, String> {
    let secret: [u8; 32] = unhex(secret_hex).and_then(|s| s.try_into().ok()).ok_or("the invite's secret is not 64 hex")?;
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, INVITE_SALT).extract(&secret);
    Ok(LessSafeKey::new(UnboundKey::from(prk.expand(&[b"wrap"], &CHACHA20_POLY1305).unwrap())))
}
/// The vault key sealed for an invite: hex(nonce || ciphertext+tag) under the link's secret, bound to the vault id.
pub fn wrap(key: &VaultKey, secret_hex: &str, vault: &str) -> Result<String, String> {
    Ok(hex(&seal(&invite_key(secret_hex)?, format!("invite:{vault}").as_bytes(), &key.0)?))
}
/// The vault key back from an invite; refused for another secret, another vault or a changed byte.
pub fn unwrap(wrapped_hex: &str, secret_hex: &str, vault: &str) -> Result<VaultKey, String> {
    let blob = unhex(wrapped_hex).ok_or("the wrapped key is not hex")?;
    let key = open(&invite_key(secret_hex)?, format!("invite:{vault}").as_bytes(), &blob).ok_or("the invite does not open with this link")?;
    key.try_into().map(VaultKey).map_err(|_| "the wrapped key is not a vault key".into())
}

/// One request to the server and its answer: the request line, the bytes after it, and at most how many bytes may
/// follow the reply (Client::call_bin). A test plugs in a server in memory.
pub(crate) type Call = Box<dyn Fn(Value, Option<Vec<u8>>, Option<u64>) -> Result<(Value, Vec<u8>), String> + Send + Sync>;

/// What the last manifest said about a path: its record's name and etag, and the plaintext hash sync::run plans with.
#[derive(Clone)]
struct Seen { name: String, etag: String, hash: String }

/// sync::Remote over a shared vault: encrypts on put, decrypts on get, maps the plaintext hashes sync::run plans
/// with to the server's etags (cached from the last manifest).
pub struct SealedRemote { vault: String, key: VaultKey, call: Call, seen: Mutex<HashMap<String, Seen>>, bad: Mutex<Vec<String>> }
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }
impl SealedRemote {
    pub(crate) fn new(vault: &str, key: VaultKey, call: Call) -> SealedRemote {
        SealedRemote { vault: vault.into(), key, call, seen: Default::default(), bad: Default::default() }
    }
    /// The records the last manifest could not open or that sit under another path's name (`name: why`). They stay out
    /// of the sync, so one broken record never stops it; a member with the key wrote them, or the server broke them.
    pub fn bad(&self) -> Vec<String> { lock(&self.bad).clone() }
    /// The etag the server must still have for `path`, for the plaintext hash the plan saw ("" absent): when the last
    /// manifest says otherwise, the plan is already stale and the server is not asked.
    fn etag(&self, path: &str, expect: &str) -> Result<String, String> {
        match lock(&self.seen).get(path) {
            Some(s) if s.hash == expect => Ok(s.etag.clone()),
            None if expect.is_empty() => Ok(String::new()),
            _ => Err("changed meanwhile".into()),
        }
    }
    fn wrote(&self, path: &str, name: String, etag: &str, data: &[u8]) {
        lock(&self.seen).insert(path.into(), Seen { name, etag: etag.into(), hash: sync::sha256_hex(data) });
    }
}
impl sync::Remote for SealedRemote {
    fn manifest(&self) -> Result<Manifest, String> {
        #[derive(Deserialize)]
        struct Blob { name: String, etag: String, meta: String }
        let (v, _) = (self.call)(json!({"op": "vault_manifest", "vault": self.vault}), None, None)?;
        let blobs: Vec<Blob> = serde_json::from_value(v["blobs"].clone()).map_err(|e| format!("blobs: {e}"))?;
        let (mut m, mut seen, mut bad) = (Manifest::new(), HashMap::new(), vec![]);
        for b in blobs {
            match unhex(&b.meta).ok_or_else(|| "meta is not hex".to_string()).and_then(|meta| self.key.open_meta(&b.name, &meta)) {
                Ok(e) => { seen.insert(e.path.clone(), Seen { name: b.name, etag: b.etag, hash: e.hash.clone() }); m.insert(e.path.clone(), e); }
                Err(why) => bad.push(format!("{}: {why}", b.name)),
            }
        }
        *lock(&self.seen) = seen;
        *lock(&self.bad) = bad;
        Ok(m)
    }
    fn get(&self, path: &str) -> Result<Vec<u8>, String> {
        let s = lock(&self.seen).get(path).cloned().ok_or("not in the manifest")?;
        let (_, rec) = (self.call)(json!({"op": "vault_get", "vault": self.vault, "name": s.name}), None, Some(MAX_RECORD))?;
        let d = self.key.open_data(&s.name, &rec)?;
        // a record changed since the manifest, or a meta and a content from two different records
        if sync::sha256_hex(&d) != s.hash { return Err("remote content does not match its manifest".into()); }
        Ok(d)
    }
    fn put(&self, path: &str, data: &[u8], mtime: i64, expect: &str) -> Result<(), String> {
        let (x, rec, name) = (self.etag(path, expect)?, self.key.record(path, data, mtime)?, self.key.name(path));
        let (v, _) = (self.call)(json!({"op": "vault_put", "vault": self.vault, "name": name, "len": rec.len(), "expect": x}), Some(rec), None)?;
        self.wrote(path, name, v["etag"].as_str().ok_or("no etag")?, data);
        Ok(())
    }
    fn put_many(&self, files: &[(String, Vec<u8>, i64, String)]) -> Result<Vec<Option<String>>, String> {
        let mut res: Vec<Option<String>> = vec![None; files.len()];
        let (mut head, mut body, mut sent) = (vec![], vec![], vec![]);
        for (i, (p, d, m, x)) in files.iter().enumerate() {
            match self.etag(p, x).and_then(|x| Ok((x, self.key.record(p, d, *m)?))) {
                Ok((x, rec)) => {
                    let name = self.key.name(p);
                    head.push(json!({"name": name, "len": rec.len(), "expect": x}));
                    body.extend(rec);
                    sent.push((i, name));
                }
                Err(e) => res[i] = Some(e),
            }
        }
        if sent.is_empty() { return Ok(res); }
        let (v, _) = (self.call)(json!({"op": "vault_put_many", "vault": self.vault, "files": head}), Some(body), None)?;
        for (i, name) in sent {
            let (p, d, ..) = &files[i];
            match (v["errors"][&name].as_str(), v["etags"][&name].as_str()) {
                (Some(e), _) => res[i] = Some(e.into()),
                (None, Some(etag)) => self.wrote(p, name, etag, d),
                (None, None) => res[i] = Some("no etag".into()),
            }
        }
        Ok(res)
    }
    fn delete(&self, path: &str, hash: &str) -> Result<(), String> {
        let x = self.etag(path, hash)?;
        let name = self.key.name(path);
        (self.call)(json!({"op": "vault_delete", "vault": self.vault, "name": name, "expect": x}), None, None)?;
        lock(&self.seen).remove(path);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::{conflict_copy, run, Filter, Guard, Mode, Remote, Report, Walker};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    fn s(p: &str) -> String { p.into() }

    #[test]
    fn record_round_trip() {
        let k = VaultKey::generate();
        let r = k.record("Projects/Acme.md", b"# Acme\n", 1_700_000_000).unwrap();
        let n = k.name("Projects/Acme.md");
        let (meta, _) = split(&r).unwrap();
        let e = k.open_meta(&n, meta).unwrap();
        assert_eq!(e, Entry { path: s("Projects/Acme.md"), size: 7, mtime: 1_700_000_000, hash: sync::sha256_hex(b"# Acme\n") });
        assert_eq!(k.open_data(&n, &r).unwrap(), b"# Acme\n");
        let empty = k.record("empty.md", b"", 0).unwrap();
        assert_eq!(k.open_data(&k.name("empty.md"), &empty).unwrap(), b"");
    }
    #[test]
    fn records_are_bound_to_their_name_and_key() {
        let k = VaultKey::generate();
        let (a, b) = (k.record("a.md", b"aaa", 1).unwrap(), k.record("b.md", b"bbb", 1).unwrap());
        let na = k.name("a.md");
        // b's record filed under a's name: neither part opens
        assert!(k.open_meta(&na, split(&b).unwrap().0).is_err());
        assert!(k.open_data(&na, &b).is_err());
        // any byte changed, in the meta or the content
        for i in [4, 4 + 12, split(&a).unwrap().0.len() + 4, a.len() - 1] {
            let mut t = a.clone();
            t[i] ^= 1;
            assert!(k.open_meta(&na, split(&t).unwrap().0).is_err() || k.open_data(&na, &t).is_err(), "byte {i}");
        }
        assert!(k.open_data(&na, &a[..10]).is_err() && k.open_data(&na, &[0, 0, 0, 200, 1]).is_err());
        // another vault's key
        let other = VaultKey::generate();
        assert!(other.open_meta(&na, split(&a).unwrap().0).is_err() && other.open_data(&na, &a).is_err());
    }
    #[test]
    fn a_meta_under_its_own_name_with_another_path_is_refused() {
        // a member with the key could seal a meta for path X under the name of Y: the AEAD passes, the name check not
        let k = VaultKey::generate();
        let (enc, _) = k.keys();
        let ny = k.name("y.md");
        let meta = seal(&enc, format!("meta:{ny}").as_bytes(), json!({"p": "x.md", "h": "", "s": 0, "m": 0}).to_string().as_bytes()).unwrap();
        assert_eq!(k.open_meta(&ny, &meta).unwrap_err(), "record is filed under another name");
    }
    #[test]
    fn two_seals_differ() {
        let k = VaultKey::generate();
        assert_ne!(k.record("a.md", b"x", 1).unwrap(), k.record("a.md", b"x", 1).unwrap());
        assert_ne!(wrap(&k, &"1".repeat(64), "0123456789abcdef").unwrap(), wrap(&k, &"1".repeat(64), "0123456789abcdef").unwrap());
    }
    #[test]
    fn names_are_stable_per_path_and_key() {
        let k = VaultKey::generate();
        let n = k.name("Projects/Acme.md");
        assert_eq!((n.len(), n.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))), (64, true));
        assert_eq!(n, VaultKey::from_hex(&k.to_hex()).unwrap().name("Projects/Acme.md"));
        assert_ne!(n, k.name("Projects/acme.md"));
        assert_ne!(n, VaultKey::generate().name("Projects/Acme.md"));
    }
    #[test]
    fn wrap_round_trip() {
        let (k, secret, vault) = (VaultKey::generate(), crate::tls::random_key(), "0123456789abcdef");
        let w = wrap(&k, &secret, vault).unwrap();
        assert_eq!(unwrap(&w, &secret, vault).unwrap().to_hex(), k.to_hex());
        assert!(unwrap(&w, &crate::tls::random_key(), vault).is_err(), "another secret");
        assert!(unwrap(&w, &secret, "fedcba9876543210").is_err(), "another vault");
        let mut t = unhex(&w).unwrap();
        t[20] ^= 1;
        assert!(unwrap(&hex(&t), &secret, vault).is_err(), "a changed byte");
        assert!(unwrap("zz", &secret, vault).is_err() && wrap(&k, "short", vault).is_err());
    }
    #[test]
    fn from_hex_cases() {
        let k = VaultKey::generate();
        assert_eq!(VaultKey::from_hex(&k.to_hex().to_uppercase()).unwrap().to_hex(), k.to_hex());
        for bad in ["", "abc", &"a".repeat(63), &"a".repeat(66), &"g".repeat(64), &format!("{}é", "a".repeat(62))] {
            assert!(VaultKey::from_hex(bad).is_none(), "{bad}");
        }
        assert_eq!(format!("{k:?}"), "VaultKey(..)");
    }

    // ---------- SealedRemote against a server in memory

    /// What the server keeps: records by name, the etag sha256 of the record, compare-and-swap on every write.
    #[derive(Default)]
    struct Server { blobs: Mutex<BTreeMap<String, Vec<u8>>>, calls: Mutex<Vec<String>> }
    impl Server {
        fn etag(&self, name: &str) -> String { lock(&self.blobs).get(name).map(|r| sync::sha256_hex(r)).unwrap_or_default() }
        fn cas(&self, name: &str, expect: &str, rec: Option<Vec<u8>>) -> Result<String, String> {
            if self.etag(name) != expect { return Err("changed meanwhile".into()); }
            let mut b = lock(&self.blobs);
            match rec { Some(r) => { let t = sync::sha256_hex(&r); b.insert(name.into(), r); Ok(t) } None => { b.remove(name); Ok(String::new()) } }
        }
        fn answer(&self, req: Value, body: Option<Vec<u8>>) -> Result<(Value, Vec<u8>), String> {
            let op = req["op"].as_str().unwrap();
            lock(&self.calls).push(op.into());
            let name = req["name"].as_str().unwrap_or_default();
            let expect = req["expect"].as_str().unwrap_or_default();
            match op {
                "vault_manifest" => {
                    let blobs: Vec<Value> = lock(&self.blobs).iter().map(|(n, r)| {
                        let meta = split(r).map(|(m, _)| hex(m)).unwrap_or_default();
                        json!({"name": n, "etag": sync::sha256_hex(r), "size": r.len(), "meta": meta})
                    }).collect();
                    Ok((json!({"ok": true, "blobs": blobs}), vec![]))
                }
                "vault_get" => {
                    let r = lock(&self.blobs).get(name).cloned().ok_or("no such record")?;
                    Ok((json!({"ok": true, "len": r.len(), "etag": sync::sha256_hex(&r)}), r))
                }
                "vault_put" => Ok((json!({"ok": true, "etag": self.cas(name, expect, body)?}), vec![])),
                "vault_put_many" => {
                    let (body, mut at) = (body.unwrap(), 0);
                    let (mut etags, mut errors) = (serde_json::Map::new(), serde_json::Map::new());
                    for f in req["files"].as_array().unwrap() {
                        let (n, len) = (f["name"].as_str().unwrap(), f["len"].as_u64().unwrap() as usize);
                        match self.cas(n, f["expect"].as_str().unwrap(), Some(body[at..at + len].to_vec())) {
                            Ok(t) => { etags.insert(n.into(), t.into()); }
                            Err(e) => { errors.insert(n.into(), e.into()); }
                        }
                        at += len;
                    }
                    assert_eq!(at, body.len());
                    Ok((json!({"ok": true, "etags": etags, "errors": errors}), vec![]))
                }
                "vault_delete" => { self.cas(name, expect, None)?; Ok((json!({"ok": true}), vec![])) }
                _ => Err("unknown request".into()),
            }
        }
    }
    fn sealed(srv: &Arc<Server>, key: &VaultKey) -> SealedRemote {
        let srv = srv.clone();
        SealedRemote::new("0123456789abcdef", key.clone(), Box::new(move |req, body, _| srv.answer(req, body)))
    }

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            let p = std::env::temp_dir().join(format!("relay-vault-test-{}-{tag}", std::process::id()));
            fs::remove_dir_all(&p).ok();
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn put(&self, p: &str, c: &str) { let f = self.0.join(p); fs::create_dir_all(f.parent().unwrap()).unwrap(); fs::write(f, c).unwrap(); }
        fn read(&self, p: &str) -> Option<String> { fs::read_to_string(self.0.join(p)).ok() }
    }
    impl Drop for Tmp { fn drop(&mut self) { fs::remove_dir_all(&self.0).ok(); } }

    const COPY: &str = "Projects/Acme (conflict mac-b 2026-10-02 1530).md";
    /// One member's Mac: its folder, its base and its walker.
    struct Mac { t: Tmp, base: Manifest, w: Walker, r: SealedRemote }
    impl Mac {
        fn new(tag: &str, srv: &Arc<Server>, key: &VaultKey) -> Mac { Mac { t: Tmp::new(tag), base: Manifest::new(), w: Walker::default(), r: sealed(srv, key) } }
        fn round(&mut self) -> Report {
            let g = Guard { allow_deletes: true, keep: &|_, _| Ok(()) };
            let (base, rep) = run(Mode::TwoWay, &self.t.0, &self.base, &mut self.w, &Filter::vault_default(), &self.r,
                                  &|p| conflict_copy(p, "mac-b", "2026-10-02 1530"), &|_| false, &g, &|_, _| {});
            self.base = base;
            rep
        }
    }

    #[test]
    fn two_macs_sync_through_the_sealed_server() {
        let (srv, key) = (Arc::new(Server::default()), VaultKey::generate());
        let (mut a, mut b) = (Mac::new("a", &srv, &key), Mac::new("b", &srv, &key));
        a.t.put("Projects/Acme.md", "acme");
        a.t.put("notes.md", "n");
        assert_eq!(a.round().pushed, vec!["Projects/Acme.md", "notes.md"]);
        // the server holds neither a path nor a content
        for r in lock(&srv.blobs).values() { assert!(!String::from_utf8_lossy(r).contains("Acme") && !String::from_utf8_lossy(r).contains("acme")); }
        assert_eq!(b.round().pulled, vec!["Projects/Acme.md", "notes.md"]);
        assert_eq!(b.t.read("Projects/Acme.md").as_deref(), Some("acme"));
        assert_eq!((a.round(), b.round()), (Report::default(), Report::default()));

        // an edit on one side reaches the other, a delete too
        b.t.put("notes.md", "n2");
        fs::remove_file(b.t.0.join("Projects/Acme.md")).unwrap();
        let r = b.round();
        assert_eq!((r.pushed, r.deleted_remote, r.errors), (vec![s("notes.md")], vec![s("Projects/Acme.md")], vec![]));
        let r = a.round();
        assert_eq!((r.pulled, r.deleted_local), (vec![s("notes.md")], vec![s("Projects/Acme.md")]));
        assert_eq!(a.t.read("notes.md").as_deref(), Some("n2"));

        // an edit on both sides: both kept, on both Macs
        a.t.put("Projects/Acme.md", "from a");
        a.round();
        b.round();
        a.t.put("Projects/Acme.md", "a again");
        b.t.put("Projects/Acme.md", "b's edit");
        a.round();
        let r = b.round();
        assert_eq!((r.conflicts, r.errors), (vec![s(COPY)], vec![]));
        assert_eq!((b.t.read("Projects/Acme.md").as_deref(), b.t.read(COPY).as_deref()), (Some("b's edit"), Some("a again")));
        a.round();
        assert_eq!((a.t.read("Projects/Acme.md").as_deref(), a.t.read(COPY).as_deref()), (Some("b's edit"), Some("a again")));
        assert_eq!((a.round(), b.round()), (Report::default(), Report::default()));
    }

    #[test]
    fn a_stale_expect_is_refused() {
        let (srv, key) = (Arc::new(Server::default()), VaultKey::generate());
        let (a, b) = (sealed(&srv, &key), sealed(&srv, &key));
        a.put("x.md", b"one", 1, "").unwrap();
        assert_eq!(a.put("x.md", b"again", 1, "").unwrap_err(), "changed meanwhile", "known to exist");
        let (h1, h2) = (sync::sha256_hex(b"one"), sync::sha256_hex(b"two"));
        a.manifest().unwrap();
        b.manifest().unwrap();
        b.put("x.md", b"two", 2, &h1).unwrap();
        // a planned with "one", the server has b's record by now: refused there
        assert_eq!(a.put("x.md", b"mine", 3, &h1).unwrap_err(), "changed meanwhile");
        assert_eq!(a.delete("x.md", &h1).unwrap_err(), "changed meanwhile");
        // a hash its manifest never saw: refused here, the server is not asked
        let before = lock(&srv.calls).len();
        assert_eq!(a.put("x.md", b"mine", 3, &h2).unwrap_err(), "changed meanwhile");
        assert_eq!(a.put_many(&[(s("x.md"), b"mine".to_vec(), 3, h2.clone())]).unwrap(), vec![Some(s("changed meanwhile"))]);
        assert_eq!(lock(&srv.calls).len(), before);
        // after a fresh manifest it goes through, and its own write is known
        assert_eq!(a.manifest().unwrap()["x.md"].hash, h2);
        assert_eq!(a.get("x.md").unwrap(), b"two");
        a.put("x.md", b"mine", 3, &h2).unwrap();
        a.delete("x.md", &sync::sha256_hex(b"mine")).unwrap();
        assert!(lock(&srv.blobs).is_empty());
    }

    #[test]
    fn put_many_is_one_request() {
        let (srv, key) = (Arc::new(Server::default()), VaultKey::generate());
        let r = sealed(&srv, &key);
        r.put("taken.md", b"t", 1, "").unwrap();
        lock(&srv.calls).clear();
        let files = vec![(s("a.md"), b"a".to_vec(), 1, s("")), (s("b.md"), b"bb".to_vec(), 1, s("")), (s("taken.md"), b"x".to_vec(), 1, s(""))];
        assert_eq!(r.put_many(&files).unwrap(), vec![None, None, Some(s("changed meanwhile"))]);
        *lock(&r.seen) = HashMap::new(); // as if another member made taken.md after this manifest
        assert_eq!(r.put_many(&files[2..]).unwrap(), vec![Some(s("changed meanwhile"))]);
        assert_eq!(*lock(&srv.calls), vec!["vault_put_many", "vault_put_many"]);
        let m = r.manifest().unwrap();
        assert_eq!(m.keys().collect::<Vec<_>>(), ["a.md", "b.md", "taken.md"]);
        assert_eq!(r.get("b.md").unwrap(), b"bb");
    }

    #[test]
    fn a_broken_record_is_left_out_and_the_rest_syncs() {
        let (srv, key) = (Arc::new(Server::default()), VaultKey::generate());
        let mut a = Mac::new("bad-a", &srv, &key);
        a.t.put("a.md", "a");
        a.t.put("b.md", "b");
        a.round();
        // garbage, b's record moved under another name, a record of another vault
        let (b_rec, junk) = (lock(&srv.blobs)[&key.name("b.md")].clone(), "e".repeat(64));
        let other = VaultKey::generate();
        lock(&srv.blobs).insert(junk.clone(), b"not a record".to_vec());
        lock(&srv.blobs).insert(key.name("moved.md"), b_rec);
        lock(&srv.blobs).insert(key.name("c.md"), other.record("c.md", b"c", 1).unwrap());
        a.t.put("new.md", "new");
        let r = a.round();
        assert_eq!((r.pushed, r.errors), (vec![s("new.md")], vec![]));
        let mut bad = a.r.bad();
        bad.sort();
        assert_eq!(bad.len(), 3);
        assert!(bad.iter().any(|b| b.starts_with(&junk)));
        let mut b = Mac::new("bad-b", &srv, &key);
        assert_eq!(b.round().pulled, vec!["a.md", "b.md", "new.md"]);
        // a content swapped under a valid meta (the server mixing two records): caught on get, nothing written
        a.t.put("a.md", "a2");
        a.round();
        let a_name = key.name("a.md");
        let swapped = {
            let blobs = lock(&srv.blobs);
            let (meta, _) = split(&blobs[&a_name]).unwrap();
            let fresh = key.record("a.md", b"other", 1).unwrap();
            let mut r = (meta.len() as u32).to_be_bytes().to_vec();
            r.extend(meta);
            r.extend(split(&fresh).unwrap().1);
            r
        };
        let rec = lock(&srv.blobs)[&a_name].clone();
        lock(&srv.blobs).insert(a_name.clone(), swapped);
        let r = b.round();
        assert_eq!((r.pulled.len(), r.errors.len(), b.t.read("a.md").as_deref()), (0, 1, Some("a")));
        lock(&srv.blobs).insert(a_name, rec);
        assert_eq!((b.round().pulled, b.t.read("a.md").as_deref()), (vec![s("a.md")], Some("a2")));
    }
}
