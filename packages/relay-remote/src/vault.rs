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
    pub fn record(&self, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String> { seal_record(self, self, 0, path, data, mtime, "") }
    /// What a record's meta says about its file (path, plaintext size, mtime, plaintext hash), refused when it was not
    /// sealed under `name` or when `name` is not its path's: a record moved to another name.
    pub fn open_meta(&self, name: &str, meta: &[u8]) -> Result<Entry, String> { open_meta(self, self, 0, name, meta).map(|(e, _)| e) }
    /// A whole record's content.
    pub fn open_data(&self, name: &str, record: &[u8]) -> Result<Vec<u8>, String> { open_data(self, 0, name, record) }
    /// `msg` vouched for under this key (hex HMAC with its `auth` key): only a member holding it can.
    pub fn vouch(&self, msg: &str) -> String { hex(hmac::sign(&self.auth, msg.as_bytes()).as_ref()) }
    fn vouched(&self, msg: &str, mac_hex: &str) -> bool { unhex(mac_hex).is_some_and(|m| hmac::verify(&self.auth, msg.as_bytes(), &m).is_ok()) }
}
fn aad(part: &str, e: u32, name: &str) -> String { if e == 0 { format!("{part}:{name}") } else { format!("{part}:{e}:{name}") } }
/// A record sealed under `k` at epoch `e`, named by `names` (the epoch-0 key: names never change, see `Keys`).
/// `seen`: the member list's head its writer had seen (`l` in the meta, left out when empty).
fn seal_record(k: &VaultKey, names: &VaultKey, e: u32, path: &str, data: &[u8], mtime: i64, seen: &str) -> Result<Vec<u8>, String> {
    let n = names.name(path);
    let mut meta = json!({"p": path, "h": sync::sha256_hex(data), "s": data.len(), "m": mtime});
    if !seen.is_empty() { meta["l"] = json!(seen); }
    let meta = meta.to_string();
    let meta = seal(&k.enc, aad("meta", e, &n).as_bytes(), meta.as_bytes())?;
    if meta.len() > MAX_META { return Err("path too long".into()); }
    let mut out = ((meta.len() as u32) | (e << EPOCH_SHIFT)).to_be_bytes().to_vec();
    out.extend(meta);
    out.extend(seal(&k.enc, aad("data", e, &n).as_bytes(), data)?);
    Ok(out)
}
fn open_meta(k: &VaultKey, names: &VaultKey, e: u32, name: &str, meta: &[u8]) -> Result<(Entry, String), String> {
    #[derive(Deserialize)]
    struct Meta { p: String, h: String, s: u64, m: i64, #[serde(default)] l: String }
    let plain = open(&k.enc, aad("meta", e, name).as_bytes(), meta).ok_or("meta does not open with this vault's key")?;
    let m: Meta = serde_json::from_slice(&plain).map_err(|e| format!("meta: {e}"))?;
    if names.name(&m.p) != name { return Err("record is filed under another name".into()); }
    Ok((Entry { path: m.p, size: m.s, mtime: m.m, hash: m.h }, m.l))
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
        seal(&self.enc, frame_aad(0, "", vault, kind, doc, from, n).as_bytes(), plain)
    }
    pub fn open_frame(&self, vault: &str, kind: &str, doc: &str, from: &str, n: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
        open_frame(self, 0, "", vault, kind, doc, from, n, sealed)
    }
}
#[allow(clippy::too_many_arguments)]
fn open_frame(k: &VaultKey, e: u32, l: &str, vault: &str, kind: &str, doc: &str, from: &str, n: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
    open(&k.enc, frame_aad(e, l, vault, kind, doc, from, n).as_bytes(), sealed).ok_or_else(|| "frame does not open with this vault's key".into())
}
/// `l`: the sender's member list head, bound in when it has one.
fn frame_aad(e: u32, l: &str, vault: &str, kind: &str, doc: &str, from: &str, n: u64) -> String {
    let base = if e == 0 { format!("frame:{vault}:{kind}:{doc}:{from}:{n}") } else { format!("frame:{e}:{vault}:{kind}:{doc}:{from}:{n}") };
    if l.is_empty() { base } else { format!("{base}:list:{l}") }
}

/// A shared vault's keys on one Mac (docs/workspaces.md, Key rotation). `ring`: every epoch's key, 0 the one the vault
/// was made with; a rotation adds the next, and everything new is sealed under the newest. Records keep their names
/// under epoch 0's naming key: renaming every record would rewrite the whole vault, and what a name gives away (that a
/// guessed path exists) a removed member knew already. `secret`: this member's X25519 secret (a rotated key is sealed
/// to its public half). `sign`: its Ed25519 identity seed. `creator`: the identity the member list must start with.
/// `head`: the member list as this Mac last checked it (length, last hash); the server may only add to it. `expect`:
/// the head an invite link named, until the list is checked once. `joined`: the link's secret, until an admin added
/// this Mac to the list. `invites`: the invites this Mac made (id, secret, role, epoch), until their joiner is added.
#[derive(Clone)]
pub struct Keys {
    ring: BTreeMap<u32, VaultKey>, pub secret: Option<[u8; 32]>, pub sign: Option<[u8; 32]>, pub creator: Option<String>,
    pub head: Option<(u64, String)>, pub expect: Option<String>, pub joined: Option<String>, pub invites: Vec<Invited>,
}
/// An invite this Mac made: its id, the link's secret, the role and the epoch it carried keys up to.
#[derive(Clone, Debug, PartialEq)]
pub struct Invited { pub id: String, pub secret: String, pub role: String, pub epoch: u32 }
impl From<VaultKey> for Keys {
    fn from(k: VaultKey) -> Keys { Keys { ring: BTreeMap::from([(0, k)]), secret: None, sign: None, creator: None, head: None, expect: None, joined: None, invites: vec![] } }
}
impl std::fmt::Debug for Keys { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "Keys(epoch {})", self.epoch()) } }
impl Keys {
    /// The newest epoch here; everything is sealed under its key.
    pub fn epoch(&self) -> u32 { *self.ring.keys().next_back().unwrap_or(&0) }
    pub fn current(&self) -> &VaultKey { self.ring.values().next_back().unwrap() }
    pub fn get(&self, e: u32) -> Option<&VaultKey> { self.ring.get(&e) }
    pub fn add(&mut self, e: u32, k: VaultKey) { self.ring.insert(e, k); }
    fn first(&self) -> &VaultKey { self.ring.values().next().unwrap() }
    fn at(&self, e: u32) -> Result<&VaultKey, String> { self.get(e).ok_or_else(|| format!("sealed under key {e}, which is not on this Mac yet")) }
    /// The member list's head as this Mac saw it, `<length>:<hash>` ("" before it saw one): it goes into every record
    /// and frame, so another member notices a server that holds the newest entries back from it.
    pub fn seen(&self) -> String { self.head.as_ref().map(|(n, h)| format!("{n}:{h}")).unwrap_or_default() }
    pub fn name(&self, path: &str) -> String { self.first().name(path) }
    pub fn record(&self, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String> { seal_record(self.current(), self.first(), self.epoch(), path, data, mtime, &self.seen()) }
    pub fn open_meta(&self, e: u32, name: &str, meta: &[u8]) -> Result<Entry, String> { self.open_meta_seen(e, name, meta).map(|(e, _)| e) }
    /// The meta, and the member list's head its writer had seen.
    pub fn open_meta_seen(&self, e: u32, name: &str, meta: &[u8]) -> Result<(Entry, String), String> { open_meta(self.at(e)?, self.first(), e, name, meta) }
    pub fn open_data(&self, name: &str, record: &[u8]) -> Result<Vec<u8>, String> { let e = epoch(record).ok_or("not a record")?; open_data(self.at(e)?, e, name, record) }
    /// A frame under the newest key, and that key's epoch and this Mac's list head (both go along in the frame).
    pub fn seal_frame(&self, vault: &str, kind: &str, doc: &str, from: &str, n: u64, plain: &[u8]) -> Result<(u32, String, Vec<u8>), String> {
        let (e, l) = (self.epoch(), self.seen());
        Ok((e, l.clone(), seal(&self.current().enc, frame_aad(e, &l, vault, kind, doc, from, n).as_bytes(), plain)?))
    }
    /// A frame, only under the newest key: one under an older key could come from a removed member.
    #[allow(clippy::too_many_arguments)]
    pub fn open_frame(&self, e: u32, l: &str, vault: &str, kind: &str, doc: &str, from: &str, n: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
        if e != self.epoch() { return Err("a frame under another key than the newest".into()); }
        open_frame(self.at(e)?, e, l, vault, kind, doc, from, n, sealed)
    }
    /// Make this member's secrets where they are missing: true when it made any (save them before a server hears of them).
    pub fn ensure(&mut self) -> bool {
        let made = self.secret.is_none() || self.sign.is_none();
        self.secret.get_or_insert_with(random32);
        self.sign.get_or_insert_with(random32);
        made
    }
    /// This member's X25519 public key (hex). Panics without `ensure` first.
    pub fn public(&self) -> String { hex(x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(self.secret.expect("ensure first"))).as_bytes()) }
    /// This member's identity, its Ed25519 public key (hex). Panics without `ensure` first.
    pub fn identity(&self) -> String { use ring::signature::KeyPair; hex(self.signer().public_key().as_ref()) }
    fn signer(&self) -> ring::signature::Ed25519KeyPair { ring::signature::Ed25519KeyPair::from_seed_unchecked(&self.sign.expect("ensure first")).expect("a 32-byte seed") }
    /// What `vault_pk` sends for this member: both public keys signed by its identity, vouched for under the newest key
    /// (`mac`, `<epoch>:<hex>`), and while it waits to be added, proven with its invite link's secret (`imac`).
    pub fn publication(&self, vault: &str, fp: &str) -> Value {
        let (pk, id) = (self.public(), self.identity());
        let msg = pub_msg(vault, fp, &pk, &id);
        let imac = self.joined.as_deref().and_then(|s| invite_mac(s, &msg)).unwrap_or_default();
        json!({"pk": pk, "id": id, "sig": hex(self.signer().sign(msg.as_bytes()).as_ref()), "mac": format!("{}:{}", self.epoch(), self.current().vouch(&msg)), "imac": imac})
    }
    /// A member's publication (`{fp, pk, id, sig, mac, imac}`) as (identity, public key) when it is its own (signed by
    /// the identity it names) and proven: with `secret`, the invite link it joined with (`imac`); without, vouched for
    /// under the newest key here (`mac`, only while a list is first made). None otherwise.
    pub fn proven(&self, vault: &str, m: &Value, secret: Option<&str>) -> Option<(String, String)> {
        let s = |f: &str| m[f].as_str().unwrap_or_default();
        if !hex64(s("pk")) || !hex64(s("id")) { return None; }
        let msg = pub_msg(vault, s("fp"), s("pk"), s("id"));
        if !signed(s("id"), &msg, s("sig")) { return None; }
        let ok = match secret {
            Some(sec) => invite_mac(sec, &msg).is_some_and(|x| x == s("imac")),
            None => s("mac").split_once(':').is_some_and(|(e, mac)| e == self.epoch().to_string() && self.current().vouched(&msg, mac)),
        };
        ok.then(|| (s("id").into(), s("pk").into()))
    }
    /// A member list entry signed by this member.
    pub fn sign_entry(&self, vault: &str, list: &crate::members::List, me: &str, e: crate::members::Entry) -> crate::members::Entry {
        crate::members::sign(vault, list, me, &self.sign.expect("ensure first"), e)
    }

    /// The key file (shared-<id>.key, 0600): epoch 0's key in hex on the first line, as the file was before rotation
    /// existed, then a line per later epoch (`<epoch> <hex>`) and, once each, `secret <hex>`, `sign <hex>`,
    /// `creator <hex>`, `head <length> <hex>`, `expect <hex>`, `joined <hex>`, and `invite <id> <secret> <role> <epoch>`
    /// per open invite. Every value is checked: a line that is not one of these makes the whole file unreadable.
    pub fn parse(s: &str) -> Option<Keys> {
        let mut lines = s.lines();
        let mut k = Keys::from(VaultKey::from_hex(lines.next()?)?);
        let b32 = |h: &str| hex64(h).then(|| unhex(h).and_then(|b| b.try_into().ok())).flatten();
        let once = |slot: bool| (!slot).then_some(());
        for l in lines {
            match l.split(' ').collect::<Vec<_>>()[..] {
                ["secret", h] => { once(k.secret.is_some())?; k.secret = Some(b32(h)?) }
                ["sign", h] => { once(k.sign.is_some())?; k.sign = Some(b32(h)?) }
                ["creator", h] if hex64(h) => { once(k.creator.is_some())?; k.creator = Some(h.into()) }
                ["head", n, h] if hex64(h) => { once(k.head.is_some())?; k.head = Some((n.parse().ok()?, h.into())) }
                ["expect", h] if hex64(h) => { once(k.expect.is_some())?; k.expect = Some(h.into()) }
                ["joined", h] if hex64(h) => { once(k.joined.is_some())?; k.joined = Some(h.into()) }
                ["invite", id, sec, role, e] if id.len() == 16 && unhex(id).is_some() && hex64(sec) && (role == "admin" || role == "member") => {
                    k.invites.push(Invited { id: id.into(), secret: sec.into(), role: role.into(), epoch: e.parse().ok()? });
                }
                [e, h] => {
                    let e = e.parse().ok().filter(|e| *e > 0 && *e <= MAX_EPOCH)?;
                    once(k.ring.contains_key(&e))?;
                    k.add(e, VaultKey::from_hex(h).filter(|_| hex64(h))?);
                }
                [""] => {}
                _ => return None,
            }
        }
        Some(k)
    }
    pub fn format(&self) -> String {
        let mut out = self.first().to_hex() + "\n";
        for (e, k) in self.ring.iter().skip(1) { out += &format!("{e} {}\n", k.to_hex()); }
        if let Some(s) = self.secret { out += &format!("secret {}\n", hex(&s)); }
        if let Some(s) = self.sign { out += &format!("sign {}\n", hex(&s)); }
        if let Some(c) = &self.creator { out += &format!("creator {c}\n"); }
        if let Some((n, h)) = &self.head { out += &format!("head {n} {h}\n"); }
        if let Some(h) = &self.expect { out += &format!("expect {h}\n"); }
        if let Some(h) = &self.joined { out += &format!("joined {h}\n"); }
        for i in &self.invites { out += &format!("invite {} {} {} {}\n", i.id, i.secret, i.role, i.epoch); }
        out
    }
    /// What Settings shows as the recovery key: the keys alone. Before any rotation the one hex line it always was.
    pub fn recovery(&self) -> String {
        Keys { secret: None, sign: None, creator: None, head: None, expect: None, joined: None, invites: vec![], ..self.clone() }.format().trim_end().to_string()
    }
}
use crate::members::hex64;
fn pub_msg(vault: &str, fp: &str, pk: &str, id: &str) -> String { format!("pub:{vault}:{fp}:{pk}:{id}") }
/// A publication proven with an invite link's secret (HKDF info `join`): only the link's holder has it.
fn invite_mac(secret_hex: &str, msg: &str) -> Option<String> {
    let secret = unhex(secret_hex).filter(|s| s.len() == 32)?;
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, INVITE_SALT).extract(&secret);
    let k = hmac::Key::from(prk.expand(&[b"join"], hmac::HMAC_SHA256).ok()?);
    Some(hex(hmac::sign(&k, msg.as_bytes()).as_ref()))
}
fn signed(id_hex: &str, msg: &str, sig_hex: &str) -> bool {
    let (Some(id), Some(sig)) = (unhex(id_hex), unhex(sig_hex)) else { return false };
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, id).verify(msg.as_bytes(), &sig).is_ok()
}
fn random32() -> [u8; 32] {
    let mut k = [0u8; 32];
    SystemRandom::new().fill(&mut k).expect("system randomness");
    k
}
/// The key of epoch `e` sealed to `me`, taken only when its sha256 is the one the checked member list's `rekey` entry
/// names (signed by an admin of the list then) and `me` was a member then.
pub fn take_rotation(keys: &Keys, sealed: &str, vault: &str, e: u32, me: &str, list: &crate::members::List) -> Result<VaultKey, String> {
    let (h, _) = list.epochs.get(&e).ok_or("no such key in the member list")?;
    let raw = open_for(&keys.secret.ok_or("no secret")?, sealed, vault, e, me)?;
    if raw.len() != 32 || sync::sha256_hex(&raw) != *h { return Err("not the key the member list names".into()); }
    Ok(VaultKey::new(raw.try_into().unwrap()))
}

/// Bytes sealed to one member's X25519 public key: hex(ephemeral public || nonce || ciphertext+tag), the key derived
/// from the shared point with HKDF, the seal bound to the vault, the epoch and the member.
pub fn seal_for(pk_hex: &str, vault: &str, e: u32, fp: &str, plain: &[u8]) -> Result<String, String> {
    let pk: [u8; 32] = unhex(pk_hex).and_then(|p| p.try_into().ok()).ok_or("a member's public key is not 64 hex")?;
    let eph = x25519_dalek::StaticSecret::from(random32());
    let epub = x25519_dalek::PublicKey::from(&eph);
    let k = rekey_key(&eph, &pk, epub.as_bytes())?;
    let mut out = epub.as_bytes().to_vec();
    out.extend(seal(&k, format!("rekey:{vault}:{e}:{fp}").as_bytes(), plain)?);
    Ok(hex(&out))
}
/// The bytes back with this member's secret; refused for another member, vault or epoch, or a changed byte.
pub fn open_for(secret: &[u8; 32], wrapped_hex: &str, vault: &str, e: u32, fp: &str) -> Result<Vec<u8>, String> {
    let blob = unhex(wrapped_hex).filter(|b| b.len() > 32).ok_or("the sealed key is not hex")?;
    let me = x25519_dalek::StaticSecret::from(*secret);
    let epub: [u8; 32] = blob[..32].try_into().unwrap();
    let k = rekey_key(&me, &epub, &epub)?;
    open(&k, format!("rekey:{vault}:{e}:{fp}").as_bytes(), &blob[32..]).ok_or_else(|| "the sealed key does not open for this member".into())
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
/// The plaintext is JSON with every epoch's key, so a new member reads what was sealed before it came. Who the members
/// are it learns from the member list, checked from the creator the link names.
pub fn wrap(keys: &Keys, secret_hex: &str, vault: &str) -> Result<String, String> {
    let ring: serde_json::Map<String, Value> = keys.ring.iter().map(|(e, k)| (e.to_string(), json!(k.to_hex()))).collect();
    Ok(hex(&seal(&invite_key(secret_hex)?, format!("invite:{vault}").as_bytes(), json!({"keys": ring}).to_string().as_bytes())?))
}
/// The vault's keys back from an invite; refused for another secret, another vault or a changed byte. An invite of an
/// older Relay is the one key's 32 bytes.
pub fn unwrap(wrapped_hex: &str, secret_hex: &str, vault: &str) -> Result<Keys, String> {
    let blob = unhex(wrapped_hex).ok_or("the wrapped key is not hex")?;
    let plain = open(&invite_key(secret_hex)?, format!("invite:{vault}").as_bytes(), &blob).ok_or("the invite does not open with this link")?;
    let bad = || "the wrapped key is not a vault key".to_string();
    if plain.len() == 32 { return Ok(Keys::from(VaultKey::new(plain.try_into().unwrap()))); }
    let v: Value = serde_json::from_slice(&plain).map_err(|_| bad())?;
    let mut ring = BTreeMap::new();
    for (e, k) in v["keys"].as_object().ok_or_else(bad)? {
        let e: u32 = e.parse().ok().filter(|e| *e <= MAX_EPOCH).ok_or_else(bad)?;
        ring.insert(e, VaultKey::from_hex(k.as_str().unwrap_or_default()).ok_or_else(bad)?);
    }
    let mut k = Keys::from(ring.remove(&0).ok_or_else(bad)?);
    for (e, key) in ring { k.add(e, key); }
    Ok(k)
}

/// One request to the server and its answer: the request line, the bytes after it, and at most how many bytes may
/// follow the reply (Client::call_bin). A test plugs in a server in memory.
pub(crate) type Call = Box<dyn Fn(Value, Option<Vec<u8>>, Option<u64>) -> Result<(Value, Vec<u8>), String> + Send + Sync>;

/// What the last manifest said about a path: its record's name and etag, and the plaintext hash and size sync::run
/// plans with (the size is what the Filter's max_size judged, so get holds the content to it).
/// `e`: the epoch its record is sealed under, `mtime` its file's (to seal it again under the newest key, `reseal`).
#[derive(Clone)]
struct Seen { name: String, etag: String, hash: String, size: u64, e: u32, mtime: i64 }

/// sync::Remote over a shared vault: encrypts on put, decrypts on get, maps the plaintext hashes sync::run plans
/// with to the server's etags (cached from the last manifest).
/// `state`: what the last manifest said besides the records: the vault's key epoch (a write under an older one here is
/// refused before it goes out).
/// `heads`: the member list heads the last manifest's records were written with, and `checked` the list as `keep_keys`
/// last checked it (with every entry's hash), for `list_warnings`.
pub struct SealedRemote { vault: String, keys: Mutex<Keys>, call: Call, seen: Mutex<HashMap<String, Seen>>, bad: Mutex<Vec<String>>, known: Mutex<HashMap<String, Entry>>, state: Mutex<Value>,
    heads: Mutex<BTreeMap<u64, String>>, checked: Mutex<Option<(crate::members::List, Vec<String>)>> }
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }
impl SealedRemote {
    pub(crate) fn new(vault: &str, keys: Keys, call: Call) -> SealedRemote {
        SealedRemote { vault: vault.into(), keys: Mutex::new(keys), call, seen: Default::default(), bad: Default::default(), known: Default::default(), state: Default::default(), heads: Default::default(), checked: Default::default() }
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
        let e = lock(&self.keys).epoch();
        lock(&self.seen).insert(path.into(), Seen { name, etag: etag.into(), hash: sync::sha256_hex(data), size: data.len() as u64, e, mtime: 0 });
    }
}
/// What `keep_keys` did: `keys` when they changed (saved already), `warnings` for the user (a member list the server
/// cannot be trusted on, a removal that waits too long for a new key), `changed` the members (fp, name) who publish
/// other keys than the list has (they set up Relay again; an admin can trust them), and `errors`.
#[derive(Debug, Default)]
pub struct KeyStep { pub keys: Option<Keys>, pub warnings: Vec<String>, pub changed: Vec<(String, String)>, pub errors: Vec<String> }
use crate::members::{self, List};
impl SealedRemote {
    fn info(&self) -> Result<Value, String> { Ok((self.call)(json!({"op": "vault_info", "vault": self.vault}), None, None)?.0["vault"].take()) }
    fn entries(&self) -> Result<Vec<members::Entry>, String> {
        let (v, _) = (self.call)(json!({"op": "vault_log", "vault": self.vault}), None, None)?;
        serde_json::from_value(v["entries"].clone()).map_err(|e| format!("member list: {e}"))
    }
    /// The member list from the server, checked from the creator this Mac knows, and refused when it is not an
    /// extension of what this Mac saw before (a fork, or older: the server holding entries back) or does not hold the
    /// head an invite link named.
    fn list(&self, k: &Keys) -> Result<Option<(List, Vec<String>)>, String> {
        let entries = self.entries()?;
        if entries.is_empty() { return Ok(None); }
        let (list, hashes) = members::check(&self.vault, &entries, k.creator.as_deref())?;
        if let Some((n, h)) = &k.head { if *n == 0 || !list.has(&hashes, n - 1, h) { return Err("The server's member list is not the one this Mac saw before: a fork, or entries held back. Nothing changes here until it is.".into()); } }
        if let Some(x) = &k.expect { if !hashes.contains(x) { return Err("The server's member list does not hold the one the invite named.".into()); } }
        Ok(Some((list, hashes)))
    }
    fn append(&self, entry: &members::Entry, keys: Value) -> Result<(), String> {
        (self.call)(json!({"op": "vault_append", "vault": self.vault, "entry": entry, "keys": keys}), None, None).map(|_| ())
    }
    /// Before a round (docs/workspaces.md, Members and Key rotation), with `vault_info` and the member list:
    /// 1. this member's secrets made where missing, and saved before the server hears of them;
    /// 2. the member list checked from its creator, an extension of what this Mac saw; its head saved;
    /// 3. the keys of epochs rotated since, each taken only when its hash is the one the list names;
    /// 4. this member's publication sent again when the server's differs;
    /// 5. for an admin of the list: a joiner proven with an invite this Mac made added (with the keys since that
    ///    invite), and after a removal or leave a new key made for exactly the members the list has.
    ///
    /// A server that knows no member list (older) answers no epoch, and nothing past 1 happens. A vault with no list
    /// yet gets one from its first admin on this version (trust on upgrade).
    pub fn keep_keys(&self, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<KeyStep, String> {
        let mut k = self.keys();
        let mut step = KeyStep::default();
        let keep = |k: &Keys, step: &mut KeyStep| -> Result<(), String> { save(k)?; *lock(&self.keys) = k.clone(); step.keys = Some(k.clone()); Ok(()) };
        if k.ensure() { keep(&k, &mut step)?; }
        let v = self.info()?;
        if v["epoch"].as_u64().is_none() { return Ok(step); }
        let me = v["me"].as_str().unwrap_or_default().to_string();
        let (list, hashes) = match self.list(&k) {
            Ok(Some(l)) => l,
            Ok(None) => {
                // no list yet: the first admin on this version starts it with itself
                if v["role"] == "admin" && k.creator.is_none() {
                    let e = k.sign_entry(&self.vault, &List::default(), &me, members::Entry { kind: "create".into(), fp: me.clone(), id: k.identity(), pk: k.public(), role: "admin".into(), ..Default::default() });
                    k.creator = Some(k.identity());
                    keep(&k, &mut step)?;
                    self.append(&e, json!({}))?;
                }
                return Ok(step);
            }
            Err(why) => { step.warnings.push(why); return Ok(step); }
        };
        if k.creator.as_deref() != Some(list.creator.as_str()) || k.head.as_ref().map(|(n, _)| *n) != Some(list.len) || k.expect.is_some() {
            (k.creator, k.head, k.expect) = (Some(list.creator.clone()), Some((list.len, list.head.clone())), None);
            keep(&k, &mut step)?;
        }
        *lock(&self.checked) = Some((list.clone(), hashes.clone()));
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        if list.pending.is_some_and(|at| now.saturating_sub(at) > 3600) { step.warnings.push("Someone left over an hour ago, and the key has not changed since.".into()); }
        while k.epoch() < list.epoch {
            let e = k.epoch() + 1;
            match take_rotation(&k, v["keys"][e.to_string()]["sealed"].as_str().unwrap_or_default(), &self.vault, e, &me, &list) {
                Ok(n) => { k.add(e, n); keep(&k, &mut step)?; }
                // the later ones wait for this one
                Err(why) => { step.errors.push(format!("key {e}: {why}")); break; }
            }
        }
        if k.joined.is_some() && list.members.contains_key(&me) { k.joined = None; keep(&k, &mut step)?; }
        for m in v["members"].as_array().into_iter().flatten() {
            let fp = m["fp"].as_str().unwrap_or_default();
            let Some(l) = list.members.get(fp) else { continue };
            if k.proven(&self.vault, m, None).is_some_and(|(id, pk)| id != l.id || pk != l.pk) { step.changed.push((fp.into(), m["name"].as_str().unwrap_or_default().into())); }
        }
        let mine = k.publication(&self.vault, &me);
        let empty = json!({});
        let on_server = v["members"].as_array().into_iter().flatten().find(|m| m["fp"] == me.as_str()).unwrap_or(&empty);
        if ["pk", "id", "mac", "imac"].iter().any(|f| on_server[f] != mine[f]) {
            let mut req = mine.clone();
            req["op"] = json!("vault_pk");
            req["vault"] = json!(self.vault);
            (self.call)(req, None, None)?;
        }
        if !list.admin(&me) || k.epoch() != list.epoch { return Ok(step); }
        // a joiner, proven with an invite this Mac made; while the list has seen no removal or new key yet, also a
        // member the server lists that is vouched for under the key (a vault from before the list: trust on upgrade)
        let first = list.epoch == 0 && list.pending.is_none() && !hashes.is_empty() && list.members.len() as u64 == list.len;
        for m in v["members"].as_array().into_iter().flatten() {
            let fp = m["fp"].as_str().unwrap_or_default();
            if list.members.contains_key(fp) { continue; }
            let inv = k.invites.iter().find(|i| m["via"].as_str() == Some(i.id.as_str())).cloned();
            let proven = match &inv { Some(i) => k.proven(&self.vault, m, Some(&i.secret)), None if first => k.proven(&self.vault, m, None), None => None };
            let Some((id, pk)) = proven else { continue };
            let role = inv.as_ref().map_or_else(|| m["role"].as_str().unwrap_or("member").to_string(), |i| i.role.clone());
            let since = inv.as_ref().map_or(0, |i| i.epoch);
            let mut keys = serde_json::Map::new();
            for e in since + 1..=k.epoch() { keys.insert(e.to_string(), json!(seal_for(&pk, &self.vault, e, fp, &k.get(e).unwrap().raw)?)); }
            let e = k.sign_entry(&self.vault, &list, &me, members::Entry { kind: "add".into(), fp: fp.into(), id, pk, role, ..Default::default() });
            self.append(&e, json!(keys))?;
            k.invites.retain(|i| Some(&i.id) != inv.as_ref().map(|x| &x.id));
            keep(&k, &mut step)?;
            // one entry a round: the next one follows the list as it is now
            return Ok(step);
        }
        if list.pending.is_some() && list.epoch < MAX_EPOCH {
            let (next, e) = (VaultKey::generate(), list.epoch + 1);
            let entry = k.sign_entry(&self.vault, &list, &me, members::Entry { kind: "rekey".into(), epoch: e, h: sync::sha256_hex(&next.raw), ..Default::default() });
            let mut sealed = serde_json::Map::new();
            for (fp, m) in &list.members { sealed.insert(fp.clone(), json!(seal_for(&m.pk, &self.vault, e, fp, &next.raw)?)); }
            match (self.call)(json!({"op": "vault_rotate", "vault": self.vault, "epoch": e, "keys": sealed, "entry": entry}), None, None) {
                Ok(_) => { k.add(e, next); k.head = Some((list.len + 1, entry.hash(&self.vault))); keep(&k, &mut step)?; }
                // another admin was first, or the answer was lost: the next round takes the key from the list
                Err(why) => step.errors.push(format!("rotate: {why}")),
            }
        }
        Ok(step)
    }
    /// After the round's manifest: a record written with a member list head this Mac's list does not hold. Newer than
    /// its list: the server holds entries back from this Mac; at a length it has, with another hash: a fork.
    pub fn list_warnings(&self) -> Vec<String> {
        let Some((list, hashes)) = lock(&self.checked).clone() else { return vec![] };
        let mut out = vec![];
        for (n, h) in lock(&self.heads).iter() {
            if *n > list.len { out.push("Another member has seen a newer member list than the server gives this Mac.".into()); }
            else if *n > 0 && !list.has(&hashes, n - 1, h) { out.push("Another member has seen another member list than this Mac: the server shows them different ones.".into()); }
        }
        out.dedup();
        out
    }
    /// Take `fp` out of the member list (`leave` for this Mac itself), signed by this Mac; the server removes it too.
    /// A vault without a list (an older server, or not upgraded yet) only has the server's removal.
    pub fn remove(&self, fp: &str) -> Result<(), String> {
        let k = self.keys();
        let v = self.info()?;
        let me = v["me"].as_str().unwrap_or_default().to_string();
        let Some((list, _)) = (if v["epoch"].is_null() { None } else { self.list(&k)? }) else {
            return (self.call)(json!({"op": "vault_remove", "vault": self.vault, "fp": fp}), None, None).map(|_| ());
        };
        let kind = if fp == me { "leave" } else { "remove" };
        let e = k.sign_entry(&self.vault, &list, &me, members::Entry { kind: kind.into(), fp: fp.into(), ..Default::default() });
        self.append(&e, json!({}))
    }
    /// An admin trusts a member's new keys (it set up Relay again): a `device` entry with what the member publishes now,
    /// signed by its new identity and vouched for under the newest key. Refused while a removal waits for a new key: the
    /// new keys could be the removed member's.
    pub fn trust(&self, fp: &str, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<(), String> {
        let k = self.keys();
        let v = self.info()?;
        let me = v["me"].as_str().unwrap_or_default().to_string();
        let (list, _) = self.list(&k)?.ok_or("this workspace has no member list yet")?;
        if !list.admin(&me) { return Err("only an admin can trust a member's new key".into()); }
        if list.pending.is_some() { return Err("someone left and the key has not changed yet: trust a new key after that".into()); }
        let m = v["members"].as_array().into_iter().flatten().find(|m| m["fp"] == fp).ok_or("not a member of this workspace")?;
        let (id, pk) = k.proven(&self.vault, m, None).ok_or("its new key is not signed by it, or not vouched for by a member")?;
        let e = k.sign_entry(&self.vault, &list, &me, members::Entry { kind: "device".into(), fp: fp.into(), id, pk, ..Default::default() });
        self.append(&e, json!({}))?;
        save(&k)
    }
    /// Seal again under the newest key, at most `max` files of the last manifest still under an older one (each read
    /// and checked as any get). Old records then die out, and a new member's Relay never has to take one. The count.
    pub fn reseal(&self, max: usize) -> usize {
        let cur = lock(&self.keys).epoch();
        let old: Vec<(String, Seen)> = lock(&self.seen).iter().filter(|(_, s)| s.e < cur).take(max).map(|(p, s)| (p.clone(), s.clone())).collect();
        use sync::Remote;
        old.into_iter().filter(|(p, s)| self.get(p).and_then(|d: Vec<u8>| self.put(p, &d, s.mtime, &s.hash)).is_ok()).count()
    }
    /// The vault's key epoch is past this Mac's: nothing goes out under the old key.
    fn behind(&self) -> Result<(), String> {
        let server = lock(&self.state)["epoch"].as_u64().unwrap_or(0);
        if server > lock(&self.keys).epoch() as u64 { Err("key changed".into()) } else { Ok(()) }
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
        let known = lock(&self.known).clone();
        for b in blobs {
            let opened = unhex(&b.meta).ok_or_else(|| "meta is not hex".to_string()).and_then(|meta| k.open_meta_seen(b.e, &b.name, &meta))
                .map(|(e, l)| {
                    if let Some((n, h)) = l.split_once(':').and_then(|(n, h)| Some((n.parse::<u64>().ok()?, h))).filter(|(_, h)| hex64(h)) { lock(&self.heads).insert(n, h.into()); }
                    e
                })
                // under an older key than the newest only as this Mac had it: a removed member still holds that key
                .and_then(|e| if b.e >= k.epoch() || known.get(&b.name).is_some_and(|x| x.hash == e.hash) { Ok(e) } else { Err("sealed under an old key, and not as this Mac had it".into()) });
            match opened {
                Ok(e) => { seen.insert(e.path.clone(), Seen { name: b.name, etag: b.etag, hash: e.hash.clone(), size: e.size, e: b.e, mtime: e.mtime }); m.insert(e.path.clone(), e); }
                Err(why) => {
                    if let Some(e) = lock(&self.known).get(&b.name).cloned() {
                        seen.insert(e.path.clone(), Seen { name: b.name.clone(), etag: b.etag.clone(), hash: e.hash.clone(), size: e.size, e: b.e, mtime: e.mtime });
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
        self.behind()?;
        let k = self.keys();
        let (x, rec, name) = (self.etag(path, expect)?, k.record(path, data, mtime)?, k.name(path));
        let (v, _) = (self.call)(json!({"op": "vault_put", "vault": self.vault, "name": name, "len": rec.len(), "expect": x}), Some(rec), None)?;
        self.wrote(path, name, v["etag"].as_str().ok_or("no etag")?, data);
        Ok(())
    }
    fn put_many(&self, files: &[(String, Vec<u8>, i64, String)]) -> Result<Vec<Option<String>>, String> {
        self.behind()?;
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
        keys.head = Some((3, "c".repeat(64)));
        let (e, l, f) = keys.seal_frame("0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, b"hi").unwrap();
        assert_eq!((e, l.as_str(), keys.open_frame(1, &l, "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, &f).unwrap()), (1, format!("3:{}", "c".repeat(64)).as_str(), b"hi".to_vec()));
        assert!(keys.open_frame(1, "4:x", "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, &f).is_err(), "the list head is bound in");
        assert!(only0.open_frame(1, &l, "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 1, &f).is_err());
        let (_, l0, old) = only0.seal_frame("0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 2, b"old").unwrap();
        assert!(keys.open_frame(0, &l0, "0123456789abcdef", "update", &n, "aaaaaaaaaaaaaaaa", 2, &old).is_err(), "a frame under an older key: a removed member holds it");
    }
    #[test]
    fn a_sealed_key_opens_only_for_its_member() {
        let (mut a, mut b) = (Keys::from(VaultKey::generate()), Keys::from(VaultKey::generate()));
        a.ensure();
        b.ensure();
        let w = seal_for(&a.public(), "0123456789abcdef", 1, "fp-a", b"payload").unwrap();
        assert_eq!(open_for(&a.secret.unwrap(), &w, "0123456789abcdef", 1, "fp-a").unwrap(), b"payload");
        assert!(open_for(&b.secret.unwrap(), &w, "0123456789abcdef", 1, "fp-a").is_err(), "another member's secret");
        assert!(open_for(&a.secret.unwrap(), &w, "0123456789abcdef", 2, "fp-a").is_err(), "another epoch");
        assert!(open_for(&a.secret.unwrap(), &w, "fedcba9876543210", 1, "fp-a").is_err(), "another vault");
        assert!(open_for(&a.secret.unwrap(), &w, "0123456789abcdef", 1, "fp-b").is_err(), "filed for another member");
        let mut t = unhex(&w).unwrap();
        t[40] ^= 1;
        assert!(open_for(&a.secret.unwrap(), &hex(&t), "0123456789abcdef", 1, "fp-a").is_err(), "a changed byte");
        assert!(seal_for(&"00".repeat(32), "0123456789abcdef", 1, "fp-a", b"x").is_err(), "a low-order key");
    }
    /// A key is taken only as the checked member list names it: a key the server seals to a member of its own has
    /// another hash, and a member the list did not hold then gets none.
    #[test]
    fn a_rotated_key_is_taken_only_as_the_member_list_names_it() {
        use crate::members::{self, Entry as E, List};
        let v = "0123456789abcdef";
        let (mut a, mut b) = (Keys::from(VaultKey::generate()), Keys::from(VaultKey::generate()));
        a.ensure();
        b.ensure();
        let (fa, fb) = ("a".repeat(64), "b".repeat(64));
        let mut log = vec![a.sign_entry(v, &List::default(), &fa, E { kind: "create".into(), fp: fa.clone(), id: a.identity(), pk: a.public(), role: "admin".into(), ..Default::default() })];
        let at = |log: &Vec<E>| members::check(v, log, None).unwrap().0;
        log.push(a.sign_entry(v, &at(&log), &fa, E { kind: "add".into(), fp: fb.clone(), id: b.identity(), pk: b.public(), role: "member".into(), ..Default::default() }));
        let next = VaultKey::generate();
        log.push(a.sign_entry(v, &at(&log), &fa, E { kind: "rekey".into(), epoch: 1, h: sync::sha256_hex(&next.raw), ..Default::default() }));
        let list = at(&log);
        let to_b = |k: &VaultKey| seal_for(&b.public(), v, 1, &fb, &k.raw).unwrap();
        assert_eq!(take_rotation(&b, &to_b(&next), v, 1, &fb, &list).unwrap().to_hex(), next.to_hex());
        assert_eq!(take_rotation(&b, &to_b(&VaultKey::generate()), v, 1, &fb, &list).unwrap_err(), "not the key the member list names", "the server's own key");
        assert!(take_rotation(&b, &to_b(&next), v, 2, &fb, &list).is_err(), "an epoch the list does not have");
    }
    #[test]
    fn a_publication_is_its_own_and_proven() {
        let (v, secret) = ("0123456789abcdef", "7".repeat(64));
        let mut a = Keys::from(VaultKey::generate());
        a.ensure();
        a.joined = Some(secret.clone());
        let mut p = a.publication(v, "fp-a");
        p["fp"] = json!("fp-a");
        assert_eq!(a.proven(v, &p, Some(&secret)), Some((a.identity(), a.public())), "with its invite link");
        assert_eq!(a.proven(v, &p, None), Some((a.identity(), a.public())), "vouched for under the key");
        assert!(a.proven(v, &p, Some(&"8".repeat(64))).is_none(), "another link");
        let mut other = Keys::from(VaultKey::generate());
        other.ensure();
        let mut swapped = p.clone();
        swapped["pk"] = json!(other.public());
        assert!(a.proven(v, &swapped, None).is_none() && a.proven(v, &swapped, Some(&secret)).is_none(), "a key swapped in");
        assert!(other.proven(v, &p, None).is_none(), "vouched for under another key");
    }
    #[test]
    fn the_key_file_takes_only_what_it_wrote() {
        let mut keys = Keys::from(VaultKey::generate());
        assert_eq!(keys.format().lines().count(), 1, "before any rotation the file is the one hex line it always was");
        keys.add(1, VaultKey::generate());
        keys.ensure();
        (keys.creator, keys.head, keys.joined) = (Some("c".repeat(64)), Some((4, "d".repeat(64))), Some("e".repeat(64)));
        keys.invites.push(Invited { id: "0123456789abcdef".into(), secret: "f".repeat(64), role: "member".into(), epoch: 1 });
        let back = Keys::parse(&keys.format()).unwrap();
        assert_eq!((back.format(), back.head.clone(), back.invites.len()), (keys.format(), keys.head.clone(), 1));
        assert_eq!(keys.recovery().lines().count(), 2, "the keys alone");
        let f = keys.format();
        let first = f.lines().next().unwrap();
        for bad in [
            format!("{f}secret {}\n", "1".repeat(64)),                 // a second secret
            format!("{first}\ncreator {} extra\n", "c".repeat(64)),    // a field too many
            format!("{first}\ncreator {}\n", "C".repeat(64)),          // not lowercase hex
            format!("{first}\nhead x {}\n", "d".repeat(64)),           // not a length
            format!("{first}\ninvite 0123 {} member 0\n", "f".repeat(64)),
            format!("{first}\ninvite 0123456789abcdef {} owner 0\n", "f".repeat(64)),
            format!("{first}\n1 {}\n1 {}\n", "a".repeat(64), "b".repeat(64)), // one epoch twice
            format!("{first}\npin {} {} {} 1\n", "a".repeat(64), "b".repeat(64), "c".repeat(64)),
        ] { assert!(Keys::parse(&bad).is_none(), "{bad}"); }
        let (secret, vault) = (crate::tls::random_key(), "0123456789abcdef");
        let joined = unwrap(&wrap(&keys, &secret, vault).unwrap(), &secret, vault).unwrap();
        assert_eq!((joined.epoch(), joined.get(1).unwrap().to_hex(), joined.name("x.md")), (1, keys.get(1).unwrap().to_hex(), keys.name("x.md")));
        assert!(joined.secret.is_none() && joined.creator.is_none(), "a joiner makes its own secrets; the link names the creator");
        let legacy = hex(&seal(&invite_key(&secret).unwrap(), format!("invite:{vault}").as_bytes(), &keys.get(0).unwrap().raw).unwrap());
        assert_eq!(unwrap(&legacy, &secret, vault).unwrap().epoch(), 0);
        let big = hex(&seal(&invite_key(&secret).unwrap(), format!("invite:{vault}").as_bytes(), json!({"keys": {"0": keys.get(0).unwrap().to_hex(), "99999": keys.get(1).unwrap().to_hex()}}).to_string().as_bytes()).unwrap());
        assert!(unwrap(&big, &secret, vault).is_err(), "an epoch past MAX_EPOCH");
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
