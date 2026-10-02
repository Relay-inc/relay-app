//! The mirror: per paired device, copies of folders the app keeps in sync (its global Claude context, its plugins, its
//! vault and the vault's memory), so an agent here can read and write them while the laptop is closed.
//!
//! On disk only ciphertext: each file is one blob in data/mirror/<device>/<root>/, named by an HMAC of its path,
//! holding ChaCha20-Poly1305 over (path, content). The key belongs to the laptop: it sends it with `unlock` and the
//! server keeps it in memory only. Unlocked, the blobs are unpacked into a working copy (RELAY_SERVER_WORKDIR, meant
//! to be a RAM disk) where the agents work; what they change is sealed back every few seconds. After a restart the
//! mirror is locked until the laptop connects again: conversations in the vault wait for it, the rest runs.

use relay_remote::sync::{self, Filter, Manifest, Walker};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::hmac;
use ring::rand::{SecureRandom, SystemRandom};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::{fs, thread};

/// The folders a device may mirror. Anything else is refused.
pub const ROOTS: [&str; 4] = ["context", "plugins", "vault", "memory"];
/// How often what the agents wrote is sealed back to disk.
const FLUSH: Duration = Duration::from_secs(5);
/// One file at most; the app skips bigger ones already (20 MB in the vault).
pub const MAX_FILE: u64 = 64 << 20;
const CHECK: &[u8] = b"relay mirror key check v1";

struct Open {
    key: LessSafeKey,
    names: hmac::Key,
    // root -> path -> hash, of what is sealed on disk
    sealed: HashMap<String, HashMap<String, String>>,
    walkers: HashMap<String, Walker>,
}

pub struct Mirror { data: PathBuf, work: PathBuf, pub in_ram: bool, open: Mutex<HashMap<String, Open>> }

/// Whether `dir` is on a tmpfs or ramfs (Linux, from /proc/mounts); false elsewhere.
fn on_ram(dir: &Path) -> bool {
    let Ok(m) = fs::read_to_string("/proc/mounts") else { return false };
    let d = dir.to_string_lossy();
    m.lines().filter_map(|l| { let f: Vec<&str> = l.split(' ').collect(); (f.len() > 2).then(|| (f[1], f[2])) })
        .filter(|(mnt, _)| d == *mnt || d.starts_with(&format!("{}/", mnt.trim_end_matches('/'))))
        .max_by_key(|(mnt, _)| mnt.len()).is_some_and(|(_, ty)| ty == "tmpfs" || ty == "ramfs")
}

impl Mirror {
    pub fn new(data: &Path) -> Arc<Mirror> {
        let work = std::env::var_os("RELAY_SERVER_WORKDIR").map(PathBuf::from).unwrap_or_else(|| data.join("work"));
        fs::create_dir_all(&work).ok();
        let in_ram = on_ram(&work);
        if !in_ram { eprintln!("relay-server: the mirror's working copy {} is not on a RAM disk, plaintext lands on disk (set RELAY_SERVER_WORKDIR to a tmpfs)", work.display()); }
        let m = Arc::new(Mirror { data: data.into(), work, in_ram, open: Mutex::new(HashMap::new()) });
        let m2 = m.clone();
        thread::spawn(move || loop { thread::sleep(FLUSH); m2.flush_all(); });
        m
    }
    fn store(&self, ns: &str) -> PathBuf { self.data.join("mirror").join(ns) }
    /// The working copy of a device, where its agents run (`<work>/<root>`).
    pub fn work_of(&self, ns: &str) -> PathBuf { self.work.join(ns) }
    pub fn is_open(&self, ns: &str) -> bool { self.open.lock().unwrap().contains_key(ns) }

    /// Take the device's key (64 hex), check it against the store, unpack every root into the working copy.
    pub fn unlock(&self, ns: &str, key_hex: &str) -> Result<(), String> {
        if self.is_open(ns) { return Ok(()); }
        let raw: Vec<u8> = (0..key_hex.len()).step_by(2).filter_map(|i| key_hex.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok())).collect();
        if raw.len() != 32 { return Err("bad mirror key".into()); }
        let key = LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, &raw).map_err(|_| "bad mirror key")?);
        let names = hmac::Key::new(hmac::HMAC_SHA256, &raw);
        let store = self.store(ns);
        fs::create_dir_all(&store).map_err(|e| e.to_string())?;
        let check = store.join("check");
        match fs::read(&check) {
            Ok(c) => if open(&key, b"check", &c).as_deref() != Some(CHECK) { return Err("this mirror was made with another key: wipe it from Relay first".into()) },
            Err(_) => fs::write(&check, seal(&key, b"check", CHECK)?).map_err(|e| e.to_string())?,
        }
        let mut o = Open { key, names, sealed: HashMap::new(), walkers: HashMap::new() };
        for root in ROOTS {
            let (dir, work) = (store.join(root), self.work_of(ns).join(root));
            fs::create_dir_all(&dir).ok();
            fs::create_dir_all(&work).ok();
            let mut sealed = HashMap::new();
            for blob in fs::read_dir(&dir).into_iter().flatten().flatten() {
                let Ok(bytes) = fs::read(blob.path()) else { continue };
                let Some(plain) = open(&o.key, root.as_bytes(), &bytes) else { eprintln!("relay-server: unreadable blob {}", blob.path().display()); continue };
                let Some((path, content)) = unpack(&plain) else { continue };
                if !sync::safe_rel(&path) { continue; }
                let target = work.join(&path);
                // a working copy that survived (no RAM disk, or only the server process restarted) keeps newer edits
                if !target.exists() { sync::write_atomic(&target, content, None).map_err(|e| e.to_string())?; }
                sealed.insert(path, sync::sha256_hex(content));
            }
            o.sealed.insert(root.into(), sealed);
            o.walkers.insert(root.into(), Walker::default());
        }
        self.open.lock().unwrap().insert(ns.into(), o);
        self.flush(ns); // what the working copy had that the store did not
        Ok(())
    }

    /// The manifest of a root's working copy, as the app compares it.
    pub fn manifest(&self, ns: &str, root: &str) -> Result<Manifest, String> {
        let mut open = self.open.lock().unwrap();
        let o = open.get_mut(ns).ok_or("mirror locked")?;
        let w = o.walkers.get_mut(root).ok_or("unknown root")?;
        w.scan(&self.work_of(ns).join(root), &Filter::default()).map(|(m, _)| m).map_err(|e| e.to_string())
    }
    pub fn get(&self, ns: &str, root: &str, rel: &str) -> Result<Vec<u8>, String> {
        self.check(ns, root, rel)?;
        fs::read(self.work_of(ns).join(root).join(rel)).map_err(|e| e.to_string())
    }
    /// Write a file from the app: the working copy, and sealed at once so it survives a restart.
    pub fn put(&self, ns: &str, root: &str, rel: &str, data: &[u8], mtime: i64) -> Result<(), String> {
        self.check(ns, root, rel)?;
        sync::write_atomic(&self.work_of(ns).join(root).join(rel), data, Some(mtime)).map_err(|e| e.to_string())?;
        let mut open = self.open.lock().unwrap();
        let o = open.get_mut(ns).ok_or("mirror locked")?;
        self.seal_file(o, ns, root, rel, data)
    }
    /// Delete a file, only while it still has `hash`.
    pub fn delete(&self, ns: &str, root: &str, rel: &str, hash: &str) -> Result<(), String> {
        self.check(ns, root, rel)?;
        let p = self.work_of(ns).join(root).join(rel);
        match fs::read(&p) {
            Ok(b) if sync::sha256_hex(&b) != hash => return Err("changed meanwhile".into()),
            Ok(_) => { fs::remove_file(&p).map_err(|e| e.to_string())?; }
            Err(_) => {} // already gone
        }
        let mut open = self.open.lock().unwrap();
        let o = open.get_mut(ns).ok_or("mirror locked")?;
        fs::remove_file(self.blob(o, ns, root, rel)).ok();
        if let Some(s) = o.sealed.get_mut(root) { s.remove(rel); }
        Ok(())
    }
    /// Forget everything of a device here: store, working copy, key.
    pub fn wipe(&self, ns: &str) {
        self.open.lock().unwrap().remove(ns);
        fs::remove_dir_all(self.store(ns)).ok();
        fs::remove_dir_all(self.work_of(ns)).ok();
    }

    /// A device that is no longer paired: its key and working copy go (the CLI's revoke removed the store).
    pub fn drop_unknown(&self, known: &[String]) {
        let gone: Vec<String> = self.open.lock().unwrap().keys().filter(|ns| !known.contains(ns)).cloned().collect();
        for ns in gone { self.wipe(&ns); }
    }
    fn check(&self, ns: &str, root: &str, rel: &str) -> Result<(), String> {
        if !ROOTS.contains(&root) { return Err("unknown root".into()); }
        if !sync::safe_rel(rel) { return Err("bad path".into()); }
        if !self.is_open(ns) { return Err("mirror locked".into()); }
        Ok(())
    }
    fn blob(&self, o: &Open, ns: &str, root: &str, rel: &str) -> PathBuf {
        let tag = hmac::sign(&o.names, format!("{root}\0{rel}").as_bytes());
        self.store(ns).join(root).join(tag.as_ref().iter().map(|b| format!("{b:02x}")).collect::<String>())
    }
    fn seal_file(&self, o: &mut Open, ns: &str, root: &str, rel: &str, data: &[u8]) -> Result<(), String> {
        let blob = seal(&o.key, root.as_bytes(), &pack(rel, data))?;
        sync::write_atomic(&self.blob(o, ns, root, rel), &blob, None).map_err(|e| e.to_string())?;
        o.sealed.entry(root.into()).or_default().insert(rel.into(), sync::sha256_hex(data));
        Ok(())
    }

    /// Seal what the agents changed in a device's working copy since the last time, and drop what they deleted.
    pub fn flush(&self, ns: &str) {
        let mut open = self.open.lock().unwrap();
        let Some(o) = open.get_mut(ns) else { return };
        for root in ROOTS {
            let dir = self.work_of(ns).join(root);
            let Ok((now, _)) = o.walkers.get_mut(root).unwrap().scan(&dir, &Filter::default()) else { continue };
            let sealed = o.sealed.get(root).cloned().unwrap_or_default();
            for (path, e) in &now {
                if sealed.get(path) == Some(&e.hash) || e.size > MAX_FILE { continue; }
                if let Ok(b) = fs::read(dir.join(path)) { self.seal_file(o, ns, root, path, &b).ok(); }
            }
            for path in sealed.keys().filter(|p| !now.contains_key(*p)) {
                fs::remove_file(self.blob(o, ns, root, path)).ok();
                o.sealed.get_mut(root).unwrap().remove(path);
            }
        }
    }
    fn flush_all(&self) {
        let open: Vec<String> = self.open.lock().unwrap().keys().cloned().collect();
        for ns in open { self.flush(&ns); }
    }
}

fn pack(path: &str, data: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(4 + path.len() + data.len());
    v.extend_from_slice(&(path.len() as u32).to_be_bytes());
    v.extend_from_slice(path.as_bytes());
    v.extend_from_slice(data);
    v
}
fn unpack(v: &[u8]) -> Option<(String, &[u8])> {
    let n = u32::from_be_bytes(v.get(..4)?.try_into().ok()?) as usize;
    Some((String::from_utf8(v.get(4..4 + n)?.to_vec()).ok()?, v.get(4 + n..)?))
}
/// nonce (12) || ciphertext+tag, the root as associated data so a blob cannot be moved to another root.
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
