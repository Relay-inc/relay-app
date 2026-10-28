//! A vault several people share through a relay-server (docs/workspaces.md). The server stores one record per file
//! and never has the key: the path and the content are sealed here with ChaCha20-Poly1305, the record is named by an
//! HMAC of its path, and both seals bind that name, so the server can neither read a record nor pass one off as
//! another. `SealedRemote` puts this behind `sync::Remote`, so `sync::run` syncs a shared vault like the mirror.

use crate::tls::{hex, unhex};
use crate::sync::{self, Entry, Manifest};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use ring::{hkdf, hmac};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, MutexGuard};

const SALT: &[u8] = b"relay shared vault v1";
const INVITE_SALT: &[u8] = b"relay vault invite v1";
const REKEY_SALT: &[u8] = b"relay vault rekey v1";
/// A record's first 4 bytes: its meta part's length in the low 20 bits (MAX_META is 64 KiB), and in the 12 above the
/// epoch of the key it is sealed under: 0 for every record before the first rotation, which is how they always were.
const EPOCH_SHIFT: u32 = 20;
pub const MAX_EPOCH: u32 = (1 << (32 - EPOCH_SHIFT)) - 1;
/// A record's meta part at most, and a whole record at most: the mirror's biggest file (64 MiB) plus that. The server
/// holds records to the same limits.
pub const MAX_META: usize = 64 << 10;
pub const MAX_RECORD: u64 = (64 << 20) + MAX_META as u64;

/// A shared vault's key: 32 random bytes, kept by every member and never sent to the server in the clear. The sealing
/// key and the naming key are derived from it once, not for every record.
#[derive(Clone)]
pub struct VaultKey { raw: [u8; 32], enc: LessSafeKey, names: hmac::Key, auth: hmac::Key }
/// Never the bytes, so a key cannot end up in a log.
impl std::fmt::Debug for VaultKey { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("VaultKey(..)") } }
impl VaultKey {
    fn new(raw: [u8; 32]) -> VaultKey {
        let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, SALT).extract(&raw);
        // expand only fails above 255 hash lengths, 32 bytes never does
        let enc = LessSafeKey::new(UnboundKey::from(prk.expand(&[b"enc"], &CHACHA20_POLY1305).unwrap()));
        VaultKey { raw, enc, names: hmac::Key::from(prk.expand(&[b"name"], hmac::HMAC_SHA256).unwrap()), auth: hmac::Key::from(prk.expand(&[b"auth"], hmac::HMAC_SHA256).unwrap()) }
    }
    pub fn generate() -> VaultKey {
        let mut k = [0u8; 32];
        SystemRandom::new().fill(&mut k).expect("system randomness");
        VaultKey::new(k)
    }
    /// 64 hex chars, any case; anything else is None.
    pub fn from_hex(s: &str) -> Option<VaultKey> { unhex(s.trim())?.try_into().ok().map(VaultKey::new) }
    pub fn to_hex(&self) -> String { hex(&self.raw) }

    /// The record's name on the server: hex HMAC of the path, the same on every member's Mac.
    pub fn name(&self, path: &str) -> String { name(&self.names, path) }

    /// The record for one file: `u32 BE meta_len || meta || data`, each part `nonce || ciphertext+tag`.
    pub fn record(&self, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String> { seal_record(self, self, 0, path, data, mtime) }
    /// What a record's meta says about its file (path, plaintext size, mtime, plaintext hash), refused when it was not
    /// sealed under `name` or when `name` is not its path's: a record moved to another name.
    pub fn open_meta(&self, name: &str, meta: &[u8]) -> Result<Entry, String> { open_meta(self, self, 0, name, meta) }
    /// A whole record's content.
    pub fn open_data(&self, name: &str, record: &[u8]) -> Result<Vec<u8>, String> { open_data(self, 0, name, record) }
    /// A member's X25519 public key (hex) vouched for under this key: only a member who holds it can, so a server
    /// cannot slip its own key in for a member's when a rotated key is sealed to them (`SealedRemote::keep_keys`).
    pub fn pk_mac(&self, vault: &str, fp: &str, pk: &str) -> String { hex(hmac::sign(&self.auth, format!("pk:{vault}:{fp}:{pk}").as_bytes()).as_ref()) }
}
fn aad(part: &str, e: u32, name: &str) -> String { if e == 0 { format!("{part}:{name}") } else { format!("{part}:{e}:{name}") } }
/// A record sealed under `k` at epoch `e`, named by `names` (the epoch-0 key: names never change, see `Keys`).
fn seal_record(k: &VaultKey, names: &VaultKey, e: u32, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String> {
    let n = names.name(path);
    let meta = json!({"p": path, "h": sync::sha256_hex(data), "s": data.len(), "m": mtime}).to_string();
    let meta = seal(&k.enc, aad("meta", e, &n).as_bytes(), meta.as_bytes())?;
    if meta.len() > MAX_META { return Err("path too long".into()); }
    let mut out = ((meta.len() as u32) | (e << EPOCH_SHIFT)).to_be_bytes().to_vec();
    out.extend(meta);
    out.extend(seal(&k.enc, aad("data", e, &n).as_bytes(), data)?);
    Ok(out)
}
fn open_meta(k: &VaultKey, names: &VaultKey, e: u32, name: &str, meta: &[u8]) -> Result<Entry, String> {
    #[derive(Deserialize)]
    struct Meta { p: String, h: String, s: u64, m: i64 }
    let plain = open(&k.enc, aad("meta", e, name).as_bytes(), meta).ok_or("meta does not open with this vault's key")?;
    let m: Meta = serde_json::from_slice(&plain).map_err(|e| format!("meta: {e}"))?;
    if names.name(&m.p) != name { return Err("record is filed under another name".into()); }
    Ok(Entry { path: m.p, size: m.s, mtime: m.m, hash: m.h })
}
fn open_data(k: &VaultKey, e: u32, name: &str, record: &[u8]) -> Result<Vec<u8>, String> {
    let (_, data) = split(record).ok_or("not a record")?;
    open(&k.enc, aad("data", e, name).as_bytes(), data).ok_or_else(|| "content does not open with this vault's key".into())
}
impl VaultKey {
    /// A live frame (channel.rs) sealed for the other members: `nonce || ciphertext+tag`, bound to the vault, the kind,
    /// the document's name, the sending device (the first 16 hex of its fingerprint) and its own counter `n`. The
    /// server can neither read it nor pass it off as another vault's, document's or member's.
    pub fn seal_frame(&self, vault: &str, kind: &str, doc: &str, from: &str, n: u64, plain: &[u8]) -> Result<Vec<u8>, String> {
        seal(&self.enc, frame_aad(0, vault, kind, doc, from, n).as_bytes(), plain)
    }
    pub fn open_frame(&self, vault: &str, kind: &str, doc: &str, from: &str, n: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
        open_frame(self, 0, vault, kind, doc, from, n, sealed)
    }
}
#[allow(clippy::too_many_arguments)]
fn open_frame(k: &VaultKey, e: u32, vault: &str, kind: &str, doc: &str, from: &str, n: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
    open(&k.enc, frame_aad(e, vault, kind, doc, from, n).as_bytes(), sealed).ok_or_else(|| "frame does not open with this vault's key".into())
}
fn frame_aad(e: u32, vault: &str, kind: &str, doc: &str, from: &str, n: u64) -> String {
    if e == 0 { format!("frame:{vault}:{kind}:{doc}:{from}:{n}") } else { format!("frame:{e}:{vault}:{kind}:{doc}:{from}:{n}") }
}

/// A shared vault's keys on one Mac (docs/workspaces.md, Key rotation). `ring`: every epoch's key, 0 the one the vault
/// was made with; a rotation adds the next, and everything new is sealed under the newest. Records keep their names
/// under epoch 0's naming key: renaming every record would rewrite the whole vault, and what a name gives away (that a
/// guessed path exists) a removed member knew already. `secret`: this member's X25519 secret, a rotated key is sealed
/// to its public key. `pins`: the public keys of the other members as this Mac first vouched for them.
#[derive(Clone)]
pub struct Keys { ring: BTreeMap<u32, VaultKey>, pub secret: Option<[u8; 32]>, pub pins: BTreeMap<String, String> }
impl From<VaultKey> for Keys { fn from(k: VaultKey) -> Keys { Keys { ring: BTreeMap::from([(0, k)]), secret: None, pins: BTreeMap::new() } } }
impl std::fmt::Debug for Keys { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "Keys(epoch {})", self.epoch()) } }
impl Keys {
    /// The newest epoch here; everything is sealed under its key.
    pub fn epoch(&self) -> u32 { *self.ring.keys().next_back().unwrap_or(&0) }
    pub fn current(&self) -> &VaultKey { self.ring.values().next_back().unwrap() }
    pub fn get(&self, e: u32) -> Option<&VaultKey> { self.ring.get(&e) }
    pub fn add(&mut self, e: u32, k: VaultKey) { self.ring.insert(e, k); }
    fn first(&self) -> &VaultKey { self.ring.values().next().unwrap() }
    fn at(&self, e: u32) -> Result<&VaultKey, String> { self.get(e).ok_or_else(|| format!("sealed under key {e}, which is not on this Mac yet")) }
    pub fn name(&self, path: &str) -> String { self.first().name(path) }
    pub fn record(&self, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String> { seal_record(self.current(), self.first(), self.epoch(), path, data, mtime) }
    pub fn open_meta(&self, e: u32, name: &str, meta: &[u8]) -> Result<Entry, String> { open_meta(self.at(e)?, self.first(), e, name, meta) }
    pub fn open_data(&self, name: &str, record: &[u8]) -> Result<Vec<u8>, String> { let e = epoch(record).ok_or("not a record")?; open_data(self.at(e)?, e, name, record) }
    /// A frame under the newest key, and that key's epoch (it goes along in the frame).
    pub fn seal_frame(&self, vault: &str, kind: &str, doc: &str, from: &str, n: u64, plain: &[u8]) -> Result<(u32, Vec<u8>), String> {
        let e = self.epoch();
        Ok((e, seal(&self.current().enc, frame_aad(e, vault, kind, doc, from, n).as_bytes(), plain)?))
    }
    #[allow(clippy::too_many_arguments)]
    pub fn open_frame(&self, e: u32, vault: &str, kind: &str, doc: &str, from: &str, n: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
        open_frame(self.at(e)?, e, vault, kind, doc, from, n, sealed)
    }
    /// This member's X25519 public key (hex), its secret made on first use.
    pub fn public(&mut self) -> String {
        let s = *self.secret.get_or_insert_with(random32);
        hex(x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(s)).as_bytes())
    }

    /// The key file (shared-<id>.key, 0600): epoch 0's key in hex on the first line, as the file was before rotation
    /// existed, then a line per later epoch (`<epoch> <hex>`), `secret <hex>` and `pin <fp> <public key>`.
    pub fn parse(s: &str) -> Option<Keys> {
        let mut lines = s.lines();
        let mut k = Keys::from(VaultKey::from_hex(lines.next()?)?);
        for l in lines {
            match l.split_whitespace().collect::<Vec<_>>()[..] {
                ["secret", h] => k.secret = Some(unhex(h)?.try_into().ok()?),
                ["pin", fp, pk] => { k.pins.insert(fp.into(), pk.into()); }
                [e, h] => k.add(e.parse().ok().filter(|e| *e > 0 && *e <= MAX_EPOCH)?, VaultKey::from_hex(h)?),
                [] => {}
                _ => return None,
            }
        }
        Some(k)
    }
    /// What Settings shows as the recovery key: the keys alone, without this member's secret and pins. Before any
    /// rotation that is the one hex line it always was.
    pub fn recovery(&self) -> String { Keys { secret: None, pins: BTreeMap::new(), ..self.clone() }.format().trim_end().to_string() }
    pub fn format(&self) -> String {
        let mut out = self.first().to_hex() + "\n";
        for (e, k) in self.ring.iter().skip(1) { out += &format!("{e} {}\n", k.to_hex()); }
        if let Some(s) = self.secret { out += &format!("secret {}\n", hex(&s)); }
        for (fp, pk) in &self.pins { out += &format!("pin {fp} {pk}\n"); }
        out
    }
}
fn random32() -> [u8; 32] {
    let mut k = [0u8; 32];
    SystemRandom::new().fill(&mut k).expect("system randomness");
    k
}

/// A rotated vault key sealed to one member's X25519 public key: hex(ephemeral public || nonce || ciphertext+tag), the
/// key derived from the shared point with HKDF, the seal bound to the vault, the epoch and the member.
pub fn seal_for(pk_hex: &str, vault: &str, e: u32, fp: &str, key: &VaultKey) -> Result<String, String> {
    let pk: [u8; 32] = unhex(pk_hex).and_then(|p| p.try_into().ok()).ok_or("a member's public key is not 64 hex")?;
    let eph = x25519_dalek::StaticSecret::from(random32());
    let epub = x25519_dalek::PublicKey::from(&eph);
    let k = rekey_key(&eph, &pk, epub.as_bytes())?;
    let mut out = epub.as_bytes().to_vec();
    out.extend(seal(&k, format!("rekey:{vault}:{e}:{fp}").as_bytes(), &key.raw)?);
    Ok(hex(&out))
}
/// The key back with this member's secret; refused for another member, vault or epoch, or a changed byte.
pub fn open_for(secret: &[u8; 32], wrapped_hex: &str, vault: &str, e: u32, fp: &str) -> Result<VaultKey, String> {
    let blob = unhex(wrapped_hex).filter(|b| b.len() > 32).ok_or("the sealed key is not hex")?;
    let me = x25519_dalek::StaticSecret::from(*secret);
    let epub: [u8; 32] = blob[..32].try_into().unwrap();
    let k = rekey_key(&me, &epub, &epub)?;
    let raw = open(&k, format!("rekey:{vault}:{e}:{fp}").as_bytes(), &blob[32..]).ok_or("the sealed key does not open for this member")?;
    raw.try_into().map(VaultKey::new).map_err(|_| "the sealed key is not a vault key".into())
}
fn rekey_key(mine: &x25519_dalek::StaticSecret, theirs: &[u8; 32], epub: &[u8; 32]) -> Result<LessSafeKey, String> {
    let shared = mine.diffie_hellman(&x25519_dalek::PublicKey::from(*theirs));
    // a low-order public key gives every party the same all-zero point
    if !shared.was_contributory() { return Err("not a usable public key".into()); }
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, REKEY_SALT).extract(shared.as_bytes());
    Ok(LessSafeKey::new(UnboundKey::from(prk.expand(&[epub], &CHACHA20_POLY1305).map_err(|_| "hkdf")?)))
}
fn name(names: &hmac::Key, path: &str) -> String { hex(hmac::sign(names, path.as_bytes()).as_ref()) }
/// A record's (meta, data): `u32 BE meta_len || meta || data`. None when it is no record, its meta past MAX_META or
/// past its end. The server lists and checks records with this too.
pub fn split(record: &[u8]) -> Option<(&[u8], &[u8])> {
    let n = (u32::from_be_bytes(record.get(..4)?.try_into().ok()?) & ((1 << EPOCH_SHIFT) - 1)) as usize;
    if n > MAX_META { return None; }
    Some((record.get(4..4 + n)?, record.get(4 + n..)?))
}
/// The epoch of the key a record is sealed under (its header, bound into both seals).
pub fn epoch(record: &[u8]) -> Option<u32> { Some(u32::from_be_bytes(record.get(..4)?.try_into().ok()?) >> EPOCH_SHIFT) }
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
/// The vault's keys sealed for an invite: hex(nonce || ciphertext+tag) under the link's secret, bound to the vault id.
/// Before any rotation that is the one key's 32 bytes, as always (an older Relay can still join); after, every epoch's,
/// `u32 BE epoch || key` each, so a new member reads what was sealed before it came.
pub fn wrap(keys: &Keys, secret_hex: &str, vault: &str) -> Result<String, String> {
    let plain: Vec<u8> = if keys.ring.len() == 1 { keys.first().raw.to_vec() } else { keys.ring.iter().flat_map(|(e, k)| [&e.to_be_bytes()[..], &k.raw[..]].concat()).collect() };
    Ok(hex(&seal(&invite_key(secret_hex)?, format!("invite:{vault}").as_bytes(), &plain)?))
}
/// The vault's keys back from an invite; refused for another secret, another vault or a changed byte.
pub fn unwrap(wrapped_hex: &str, secret_hex: &str, vault: &str) -> Result<Keys, String> {
    let blob = unhex(wrapped_hex).ok_or("the wrapped key is not hex")?;
    let plain = open(&invite_key(secret_hex)?, format!("invite:{vault}").as_bytes(), &blob).ok_or("the invite does not open with this link")?;
    let bad = || "the wrapped key is not a vault key".to_string();
    if plain.len() == 32 { return Ok(Keys::from(VaultKey::new(plain.try_into().unwrap()))); }
    if plain.is_empty() || plain.len() % 36 != 0 { return Err(bad()); }
    let mut ring = BTreeMap::new();
    for c in plain.chunks(36) { ring.insert(u32::from_be_bytes(c[..4].try_into().unwrap()), VaultKey::new(c[4..].try_into().unwrap())); }
    if !ring.contains_key(&0) { return Err(bad()); }
    Ok(Keys { ring, secret: None, pins: BTreeMap::new() })
}

/// One request to the server and its answer: the request line, the bytes after it, and at most how many bytes may
/// follow the reply (Client::call_bin). A test plugs in a server in memory.
pub(crate) type Call = Box<dyn Fn(Value, Option<Vec<u8>>, Option<u64>) -> Result<(Value, Vec<u8>), String> + Send + Sync>;

/// What the last manifest said about a path: its record's name and etag, and the plaintext hash and size sync::run
/// plans with (the size is what the Filter's max_size judged, so get holds the content to it).
#[derive(Clone)]
struct Seen { name: String, etag: String, hash: String, size: u64 }

/// sync::Remote over a shared vault: encrypts on put, decrypts on get, maps the plaintext hashes sync::run plans
/// with to the server's etags (cached from the last manifest).
/// `state`: what the last manifest said besides the records (the vault's key epoch, whether a rotation is due, this
/// member's role and registered public key), for `keep_keys`.
pub struct SealedRemote { vault: String, keys: Mutex<Keys>, call: Call, seen: Mutex<HashMap<String, Seen>>, bad: Mutex<Vec<String>>, known: Mutex<HashMap<String, Entry>>, state: Mutex<Value> }
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }
impl SealedRemote {
    pub(crate) fn new(vault: &str, keys: Keys, call: Call) -> SealedRemote {
        SealedRemote { vault: vault.into(), keys: Mutex::new(keys), call, seen: Default::default(), bad: Default::default(), known: Default::default(), state: Default::default() }
    }
    fn keys(&self) -> Keys { lock(&self.keys).clone() }
    /// The last round's base, so a record that will not open under a known path's name reads as that path unchanged:
    /// left out, it would read as deleted there and be deleted on every member's Mac. A new write over it still goes
    /// through (its etag is the broken record's).
    pub fn know(&self, base: &Manifest) {
        let k = self.keys();
        *lock(&self.known) = base.values().map(|e| (k.name(&e.path), e.clone())).collect();
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
        lock(&self.seen).insert(path.into(), Seen { name, etag: etag.into(), hash: sync::sha256_hex(data), size: data.len() as u64 });
    }
}
/// What `keep_keys` did: `keys` when they changed (to save), `waiting` the members a due rotation waits for.
#[derive(Debug, Default)]
pub struct KeyStep { pub keys: Option<Keys>, pub waiting: Vec<String> }
impl SealedRemote {
    /// After a round, from what its manifest said (docs/workspaces.md, Key rotation):
    /// 1. the keys of epochs rotated since, each sealed to this member's public key, fetched and opened;
    /// 2. this member's public key registered, vouched for under the newest key, again after every rotation;
    /// 3. for an admin when a member left or was removed: a new key, sealed to every member left, made current. It
    ///    waits (`waiting`) while a member has no public key vouched for under the current key, or one that differs
    ///    from what this Mac pinned: a server or a removed member could have slipped its own in.
    ///
    /// The server makes a rotation current in one step, so an interrupted one never half happens; the admin's next
    /// round does it again. A server that knows no rotation (older) answers no epoch, and nothing happens.
    pub fn keep_keys(&self) -> Result<KeyStep, String> {
        let st = lock(&self.state).clone();
        let Some(server) = st["epoch"].as_u64().map(|e| e as u32) else { return Ok(KeyStep::default()) };
        let (mut k, mut changed, mut waiting) = (self.keys(), false, vec![]);
        let me = st["me"]["fp"].as_str().unwrap_or_default().to_string();
        if k.secret.is_none() { k.public(); changed = true; }
        let info = || -> Result<Value, String> { Ok((self.call)(json!({"op": "vault_info", "vault": self.vault}), None, None)?.0["vault"].take()) };
        if server > k.epoch() {
            let secret = k.secret.unwrap();
            for (e, w) in info()?["keys"].as_object().cloned().unwrap_or_default() {
                let Ok(e) = e.parse::<u32>() else { continue };
                if k.get(e).is_none() { k.add(e, open_for(&secret, w.as_str().unwrap_or_default(), &self.vault, e, &me)?); changed = true; }
            }
        }
        if k.epoch() == server {
            let (pk, e) = (k.public(), k.epoch());
            let mac = format!("{e}:{}", k.current().pk_mac(&self.vault, &me, &pk));
            if st["me"]["pk"].as_str() != Some(&pk) || st["me"]["mac"].as_str() != Some(&mac) {
                (self.call)(json!({"op": "vault_pk", "vault": self.vault, "pk": pk, "mac": mac}), None, None)?;
            }
            if st["rekey"].as_bool() == Some(true) && st["role"].as_str() == Some("admin") && e < MAX_EPOCH {
                let (next, mut sealed) = (VaultKey::generate(), serde_json::Map::new());
                for m in info()?["members"].as_array().cloned().unwrap_or_default() {
                    let s = |f: &str| m[f].as_str().unwrap_or_default().to_string();
                    let (fp, pk, mac) = (s("fp"), s("pk"), s("mac"));
                    let vouched = !pk.is_empty() && mac == format!("{e}:{}", k.current().pk_mac(&self.vault, &fp, &pk));
                    let pinned = k.pins.get(&fp).is_none_or(|p| *p == pk);
                    match seal_for(&pk, &self.vault, e + 1, &fp, &next) {
                        Ok(w) if vouched && pinned => { sealed.insert(fp.clone(), w.into()); k.pins.entry(fp).or_insert(pk); }
                        _ => waiting.push(s("name")),
                    }
                }
                if waiting.is_empty() {
                    (self.call)(json!({"op": "vault_rotate", "vault": self.vault, "epoch": e + 1, "keys": sealed}), None, None)?;
                    k.add(e + 1, next);
                }
                // the pins of this attempt stay, also when it waits
                changed = true;
            }
        }
        if changed { *lock(&self.keys) = k.clone(); }
        Ok(KeyStep { keys: changed.then_some(k), waiting })
    }
}
impl sync::Remote for SealedRemote {
    fn manifest(&self) -> Result<Manifest, String> {
        #[derive(Deserialize)]
        struct Blob { name: String, etag: String, meta: String, #[serde(default)] e: u32 }
        let (mut v, _) = (self.call)(json!({"op": "vault_manifest", "vault": self.vault}), None, None)?;
        let blobs: Vec<Blob> = serde_json::from_value(v["blobs"].take()).map_err(|e| format!("blobs: {e}"))?;
        *lock(&self.state) = v;
        let (k, mut m, mut seen, mut bad) = (self.keys(), Manifest::new(), HashMap::new(), vec![]);
        for b in blobs {
            match unhex(&b.meta).ok_or_else(|| "meta is not hex".to_string()).and_then(|meta| k.open_meta(b.e, &b.name, &meta)) {
                Ok(e) => { seen.insert(e.path.clone(), Seen { name: b.name, etag: b.etag, hash: e.hash.clone(), size: e.size }); m.insert(e.path.clone(), e); }
                Err(why) => {
                    if let Some(e) = lock(&self.known).get(&b.name).cloned() {
                        seen.insert(e.path.clone(), Seen { name: b.name.clone(), etag: b.etag.clone(), hash: e.hash.clone(), size: e.size });
                        m.insert(e.path.clone(), e);
                    }
                    bad.push(format!("{}: {why}", b.name));
                }
            }
        }
        *lock(&self.seen) = seen;
        *lock(&self.bad) = bad;
        Ok(m)
    }
    fn get(&self, path: &str) -> Result<Vec<u8>, String> {
        let s = lock(&self.seen).get(path).cloned().ok_or("not in the manifest")?;
        let (_, rec) = (self.call)(json!({"op": "vault_get", "vault": self.vault, "name": s.name}), None, Some(MAX_RECORD))?;
        let d = self.keys().open_data(&s.name, &rec)?;
        // a meta that understates its content, to slip a big file past max_size: the hash alone would let it through
        if d.len() as u64 != s.size { return Err("remote content is not the size its manifest says".into()); }
        // a record changed since the manifest, or a meta and a content from two different records
        if sync::sha256_hex(&d) != s.hash { return Err("remote content does not match its manifest".into()); }
        Ok(d)
    }
    fn put(&self, path: &str, data: &[u8], mtime: i64, expect: &str) -> Result<(), String> {
        let k = self.keys();
        let (x, rec, name) = (self.etag(path, expect)?, k.record(path, data, mtime)?, k.name(path));
        let (v, _) = (self.call)(json!({"op": "vault_put", "vault": self.vault, "name": name, "len": rec.len(), "expect": x}), Some(rec), None)?;
        self.wrote(path, name, v["etag"].as_str().ok_or("no etag")?, data);
        Ok(())
    }
    fn put_many(&self, files: &[(String, Vec<u8>, i64, String)]) -> Result<Vec<Option<String>>, String> {
        let mut res: Vec<Option<String>> = vec![None; files.len()];
        let (k, mut head, mut body, mut sent) = (self.keys(), vec![], vec![], vec![]);
        for (i, (p, d, m, x)) in files.iter().enumerate() {
            match self.etag(p, x).and_then(|x| Ok((x, k.record(p, d, *m)?))) {
                Ok((x, rec)) => {
                    let name = k.name(p);
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
        let name = self.keys().name(path);
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
        let ny = k.name("y.md");
        let meta = seal(&k.enc, format!("meta:{ny}").as_bytes(), json!({"p": "x.md", "h": "", "s": 0, "m": 0}).to_string().as_bytes()).unwrap();
        assert_eq!(k.open_meta(&ny, &meta).unwrap_err(), "record is filed under another name");
    }
    #[test]
    fn two_seals_differ() {
        let k = VaultKey::generate();
        assert_ne!(k.record("a.md", b"x", 1).unwrap(), k.record("a.md", b"x", 1).unwrap());
        let r = Keys::from(k.clone());
        assert_ne!(wrap(&r, &"1".repeat(64), "0123456789abcdef").unwrap(), wrap(&r, &"1".repeat(64), "0123456789abcdef").unwrap());
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
        let (k, secret, vault) = (Keys::from(VaultKey::generate()), crate::tls::random_key(), "0123456789abcdef");
        let w = wrap(&k, &secret, vault).unwrap();
        assert_eq!(unwrap(&w, &secret, vault).unwrap().format(), k.format());
        assert!(unwrap(&w, &crate::tls::random_key(), vault).is_err(), "another secret");
        assert!(unwrap(&w, &secret, "fedcba9876543210").is_err(), "another vault");
        let mut t = unhex(&w).unwrap();
        t[20] ^= 1;
        assert!(unwrap(&hex(&t), &secret, vault).is_err(), "a changed byte");
        assert!(unwrap("zz", &secret, vault).is_err() && wrap(&k, "short", vault).is_err());
    }
    #[test]
    fn a_later_epoch_seals_under_its_own_key_and_keeps_the_names() {
        let k0 = VaultKey::generate();
        let mut keys = Keys::from(k0.clone());
        let old = keys.record("a.md", b"old", 1).unwrap();
        assert_eq!((epoch(&old), keys.epoch()), (Some(0), 0));
        keys.add(1, VaultKey::generate());
        let r = keys.record("a.md", b"new", 2).unwrap();
        let n = keys.name("a.md");
        assert_eq!((epoch(&r), n.clone()), (Some(1), k0.name("a.md")), "the name stays epoch 0's");
        assert_eq!(keys.open_meta(1, &n, split(&r).unwrap().0).unwrap().size, 3);
        assert_eq!((keys.open_data(&n, &r).unwrap(), keys.open_data(&n, &old).unwrap()), (b"new".to_vec(), b"old".to_vec()));
        // epoch 0's key alone: the new record does not open, neither as epoch 0 nor with a header turned back
        let only0 = Keys::from(k0.clone());
        assert!(only0.open_data(&n, &r).unwrap_err().contains("not on this Mac"));
        assert!(only0.open_meta(1, &n, split(&r).unwrap().0).is_err() && k0.open_meta(&n, split(&r).unwrap().0).is_err());
        let mut back = r.clone();
        back[0] &= 0x00;
        back[1] &= 0x0f;
        assert!(keys.open_data(&n, &back).is_err(), "the epoch is bound into the seal");
        // frames too
        let (e, f) = keys.seal_frame("0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, b"hi").unwrap();
        assert_eq!((e, keys.open_frame(1, "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, &f).unwrap()), (1, b"hi".to_vec()));
        assert!(keys.open_frame(0, "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, &f).is_err() && only0.open_frame(1, "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, &f).is_err());
    }
    #[test]
    fn a_rotated_key_opens_only_for_its_member() {
        let (mut a, mut b) = (Keys::from(VaultKey::generate()), Keys::from(VaultKey::generate()));
        let (pa, _) = (a.public(), b.public());
        let next = VaultKey::generate();
        let w = seal_for(&pa, "0123456789abcdef", 1, "fp-a", &next).unwrap();
        assert_eq!(open_for(&a.secret.unwrap(), &w, "0123456789abcdef", 1, "fp-a").unwrap().to_hex(), next.to_hex());
        assert!(open_for(&b.secret.unwrap(), &w, "0123456789abcdef", 1, "fp-a").is_err(), "another member's secret");
        assert!(open_for(&a.secret.unwrap(), &w, "0123456789abcdef", 2, "fp-a").is_err(), "another epoch");
        assert!(open_for(&a.secret.unwrap(), &w, "fedcba9876543210", 1, "fp-a").is_err(), "another vault");
        assert!(open_for(&a.secret.unwrap(), &w, "0123456789abcdef", 1, "fp-b").is_err(), "filed for another member");
        let mut t = unhex(&w).unwrap();
        t[40] ^= 1;
        assert!(open_for(&a.secret.unwrap(), &hex(&t), "0123456789abcdef", 1, "fp-a").is_err(), "a changed byte");
        assert!(seal_for(&"00".repeat(32), "0123456789abcdef", 1, "fp-a", &next).is_err(), "a low-order key");
        // the vouching mac binds the vault, the member and its key
        let k = a.current().clone();
        let m = k.pk_mac("v", "fp-a", &pa);
        assert!(m != k.pk_mac("v", "fp-b", &pa) && m != k.pk_mac("w", "fp-a", &pa) && m != VaultKey::generate().pk_mac("v", "fp-a", &pa));
    }
    #[test]
    fn the_key_file_and_an_invite_carry_every_epoch() {
        let mut keys = Keys::from(VaultKey::generate());
        // before any rotation: the file is the one hex line it always was, the invite the 32 bytes it always was
        assert_eq!(keys.format().lines().count(), 1);
        assert_eq!(Keys::parse(&keys.format()).unwrap().format(), keys.format());
        let (secret, vault) = (crate::tls::random_key(), "0123456789abcdef");
        let plain = open(&invite_key(&secret).unwrap(), format!("invite:{vault}").as_bytes(), &unhex(&wrap(&keys, &secret, vault).unwrap()).unwrap()).unwrap();
        assert_eq!(plain.len(), 32);
        keys.add(1, VaultKey::generate());
        keys.add(2, VaultKey::generate());
        keys.public();
        keys.pins.insert("f".repeat(64), "a".repeat(64));
        let back = Keys::parse(&keys.format()).unwrap();
        assert_eq!((back.format(), back.epoch(), back.secret), (keys.format(), 2, keys.secret));
        let joined = unwrap(&wrap(&keys, &secret, vault).unwrap(), &secret, vault).unwrap();
        assert_eq!((joined.epoch(), joined.get(1).unwrap().to_hex(), joined.name("x.md")), (2, keys.get(1).unwrap().to_hex(), keys.name("x.md")));
        assert!(joined.secret.is_none() && joined.pins.is_empty(), "a joiner makes its own secret, pins nothing yet");
        for bad in ["", "zz", &format!("{}\n0 {}", "a".repeat(64), "b".repeat(64)), &format!("{}\nwhat is this", "a".repeat(64))] { assert!(Keys::parse(bad).is_none(), "{bad}"); }
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
                        json!({"name": n, "etag": sync::sha256_hex(r), "size": r.len(), "meta": meta, "e": epoch(r).unwrap_or(0)})
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
        SealedRemote::new("0123456789abcdef", key.clone().into(), Box::new(move |req, body, _| srv.answer(req, body)))
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
            self.r.know(&self.base);
            let g = Guard { allow_deletes: true, allowed: &[], moved: &[], keep: &|_, _| Ok(()) };
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
    fn a_meta_that_lies_about_the_size_is_refused_on_get() {
        let (srv, key) = (Arc::new(Server::default()), VaultKey::generate());
        let r = sealed(&srv, &key);
        // a member with the key seals a big file with "s": 1, its hash right, so the filter sees one byte
        let (big, n) = (vec![b'x'; 4096], key.name("big.md"));
        let meta = json!({"p": "big.md", "h": sync::sha256_hex(&big), "s": 1, "m": 1}).to_string();
        let meta = seal(&key.enc, format!("meta:{n}").as_bytes(), meta.as_bytes()).unwrap();
        let mut rec = (meta.len() as u32).to_be_bytes().to_vec();
        rec.extend(meta);
        rec.extend(seal(&key.enc, format!("data:{n}").as_bytes(), &big).unwrap());
        lock(&srv.blobs).insert(n, rec);
        assert_eq!(r.manifest().unwrap()["big.md"].size, 1);
        assert_eq!(r.get("big.md").unwrap_err(), "remote content is not the size its manifest says");
        r.put("ok.md", b"fine", 1, "").unwrap();
        r.manifest().unwrap();
        assert_eq!(r.get("ok.md").unwrap(), b"fine");
    }
    #[test]
    fn a_broken_record_of_a_known_file_deletes_nothing() {
        let (srv, key) = (Arc::new(Server::default()), VaultKey::generate());
        let (mut a, mut b) = (Mac::new("known-a", &srv, &key), Mac::new("known-b", &srv, &key));
        a.t.put("a.md", "a");
        a.round();
        b.round();
        // the server breaks a.md's record (it lists it with an empty meta): both Macs keep their copy, nothing is
        // deleted anywhere, round after round
        lock(&srv.blobs).insert(key.name("a.md"), b"not a record".to_vec());
        for _ in 0..2 {
            for m in [&mut a, &mut b] {
                let r = m.round();
                assert_eq!((r.deleted_local.len(), r.deleted_remote.len(), m.r.bad().len()), (0, 0, 1), "{r:?}");
                assert_eq!(m.t.read("a.md").as_deref(), Some("a"));
            }
        }
        assert_eq!(lock(&srv.blobs)[&key.name("a.md")], b"not a record");
        // a new edit goes over the broken record, and the other Mac gets it
        a.t.put("a.md", "a again");
        assert!(a.round().errors.is_empty());
        b.round();
        assert_eq!(b.t.read("a.md").as_deref(), Some("a again"));
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
