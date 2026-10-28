//! A shared vault's member list (docs/workspaces.md, Members): an append-only, hash-chained log of entries, each signed
//! by a member's Ed25519 identity. The first (`create`) is signed by the vault's creator; every later one by an admin
//! of the list as it stood just before (`leave` by the member itself). The server keeps the log and hands it out but
//! cannot write an entry; it can only hold back the newest ones, which a member notices from another member's records.
//! Who is a member, who is an admin, which key is current and whether a removal still waits for a new key: all of it
//! comes from here, never from the server's own list.

use crate::sync::sha256_hex;
use crate::tls::{hex, unhex};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One entry. `kind`: `create`, `add`, `remove`, `leave`, `promote`, `demote`, `rekey` (epoch `epoch` is current, its
/// key's sha256 `h`) or `device` (the member `fp` set up Relay again: new `id` and `pk`). `fp`: the member it is about;
/// `id`, `pk`: its Ed25519 identity and X25519 key (create, add, device); `role`: admin or member (create, add); `at`:
/// epoch seconds; `by`: the signer's fingerprint; `sig`: its signature over `msg`.
/// `mac` (create only): the creator's identity vouched for under the vault's epoch-0 key, which the server never has:
/// a Mac that knows no creator takes a first list only with it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Entry {
    pub seq: u64, pub prev: String, pub kind: String, pub fp: String, pub id: String, pub pk: String, pub role: String,
    pub epoch: u32, pub h: String, pub at: u64, pub by: String, pub sig: String, pub mac: String,
}
/// The longest list a server keeps or a Mac takes.
pub const MAX_ENTRIES: u64 = 10_000;
impl Entry {
    /// What the signature covers: every field but the signature, and the vault.
    pub fn msg(&self, vault: &str) -> String {
        format!("member-log:{vault}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}", self.seq, self.prev, self.kind, self.fp, self.id, self.pk, self.role, self.epoch, self.h, self.at, self.by)
    }
    /// The entry's hash, which the next one names as `prev`: of what is signed and the signature.
    pub fn hash(&self, vault: &str) -> String { sha256_hex(format!("{}:{}", self.msg(vault), self.sig).as_bytes()) }
}

/// A member as the list says.
#[derive(Clone, Debug, PartialEq)]
pub struct Member { pub id: String, pub pk: String, pub admin: bool }
/// The list, checked. `epochs`: per epoch after 0, the sha256 of its key and who it was made for. `pending`: when a
/// member was removed or left and no new key followed yet (epoch seconds of that entry). `head`: the last entry's hash.
#[derive(Clone, Debug, Default)]
pub struct List {
    pub members: BTreeMap<String, Member>, pub epoch: u32, pub epochs: BTreeMap<u32, (String, Vec<String>)>,
    pub pending: Option<u64>, pub len: u64, pub head: String, pub creator: String,
}
impl List {
    pub fn admin(&self, fp: &str) -> bool { self.members.get(fp).is_some_and(|m| m.admin) }
    /// The hash of entry `seq`, from a check that kept them (`check` fills `hashes`).
    pub fn has(&self, hashes: &[String], seq: u64, hash: &str) -> bool { hashes.get(seq as usize).is_some_and(|h| h == hash) }
}

pub fn hex64(s: &str) -> bool { lowhex(s, 64) }
fn lowhex(s: &str, n: usize) -> bool { s.len() == n && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
fn signed(id: &str, msg: &str, sig: &str) -> bool {
    let (Some(id), Some(sig)) = (unhex(id), unhex(sig)) else { return false };
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, id).verify(msg.as_bytes(), &sig).is_ok()
}

/// The list from its entries, every rule checked; refused at the first entry that breaks one. `creator`: the identity
/// the first entry must be signed by, when this Mac knows it (an invite link carries it). Also every entry's hash.
pub fn check(vault: &str, entries: &[Entry], creator: Option<&str>) -> Result<(List, Vec<String>), String> {
    extend(vault, List::default(), vec![], entries, creator)
}
/// `list` (with its entries' `hashes`) checked further with the entries after it: a Mac checks only what is new.
pub fn extend(vault: &str, mut l: List, mut hashes: Vec<String>, entries: &[Entry], creator: Option<&str>) -> Result<(List, Vec<String>), String> {
    if l.len + entries.len() as u64 > MAX_ENTRIES { return Err(format!("a member list longer than {MAX_ENTRIES} entries")); }
    for e in entries {
        let i = l.len;
        let bad = |why: &str| Err(format!("member list entry {i}: {why}"));
        if e.seq != i { return bad("out of order"); }
        if e.prev != hashes.last().cloned().unwrap_or_default() { return bad("does not follow the one before"); }
        if !hex64(&e.by) || !lowhex(&e.sig, 128) { return bad("not a fingerprint or not a signature"); }
        // every field a kind does not use is empty: nothing rides along unchecked
        let uses = |fp: bool, keys: bool, role: bool, rekey: bool, mac: bool| {
            (fp == hex64(&e.fp)) && (fp || e.fp.is_empty()) && (keys == (hex64(&e.id) && hex64(&e.pk))) && (keys || (e.id.is_empty() && e.pk.is_empty()))
                && (role == (e.role == "admin" || e.role == "member")) && (role || e.role.is_empty())
                && (rekey == (e.epoch > 0 && hex64(&e.h))) && (rekey || (e.epoch == 0 && e.h.is_empty())) && (mac == hex64(&e.mac)) && (mac || e.mac.is_empty())
        };
        let shape = match e.kind.as_str() {
            "create" => uses(true, true, true, false, true),
            "add" => uses(true, true, true, false, false),
            "remove" | "leave" | "promote" | "demote" => uses(true, false, false, false, false),
            "rekey" => uses(false, false, false, true, false),
            "device" => uses(true, true, false, false, false),
            _ => false,
        };
        if !shape { return bad(&format!("a {} with the wrong fields", e.kind)); }
        if i == 0 {
            if e.kind != "create" || e.by != e.fp || e.role != "admin" { return bad("not a creation"); }
            if creator.is_some_and(|c| c != e.id) { return bad("not made by the vault's creator"); }
            if !signed(&e.id, &e.msg(vault), &e.sig) { return bad("not signed by its creator"); }
            l.creator = e.id.clone();
            l.members.insert(e.fp.clone(), Member { id: e.id.clone(), pk: e.pk.clone(), admin: true });
        } else {
            // signed by its signer as the list stood before it: an admin, or the member itself for `leave`
            let Some(by) = l.members.get(&e.by).cloned() else { return bad("signed by someone who is no member") };
            if !signed(&by.id, &e.msg(vault), &e.sig) { return bad("not signed by who it names") };
            let member = l.members.contains_key(&e.fp);
            match e.kind.as_str() {
                "leave" if e.by == e.fp && member => { l.members.remove(&e.fp); l.pending = Some(e.at); }
                _ if !by.admin => return bad("not signed by an admin"),
                "add" if !member => { l.members.insert(e.fp.clone(), Member { id: e.id.clone(), pk: e.pk.clone(), admin: e.role == "admin" }); }
                "remove" if member => { l.members.remove(&e.fp); l.pending = Some(e.at); }
                "promote" | "demote" if member => { l.members.get_mut(&e.fp).unwrap().admin = e.kind == "promote"; }
                "rekey" if e.epoch == l.epoch + 1 => {
                    l.epoch = e.epoch;
                    l.epochs.insert(e.epoch, (e.h.clone(), l.members.keys().cloned().collect()));
                    l.pending = None;
                }
                // a member's new keys only once no removal waits: during one they could be the removed member's
                "device" if member && l.pending.is_none() => {
                    let m = l.members.get_mut(&e.fp).unwrap();
                    (m.id, m.pk) = (e.id.clone(), e.pk.clone());
                }
                _ => return bad(&format!("a {} that breaks the rules", e.kind)),
            }
            if l.members.is_empty() { return bad("nobody left"); }
            if !l.members.values().any(|m| m.admin) { return bad("no admin left"); }
        }
        let h = e.hash(vault);
        hashes.push(h.clone());
        (l.len, l.head) = (i + 1, h);
    }
    Ok((l, hashes))
}

/// A new entry after `list`, signed with `seed` (this member's Ed25519 seed) as `me`.
pub fn sign(vault: &str, list: &List, me: &str, seed: &[u8; 32], mut e: Entry) -> Entry {
    e.seq = list.len;
    e.prev = list.head.clone();
    e.by = me.into();
    e.at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let kp = ring::signature::Ed25519KeyPair::from_seed_unchecked(seed).expect("a 32-byte seed");
    e.sig = hex(kp.sign(e.msg(vault).as_bytes()).as_ref());
    e
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::KeyPair;

    struct Dev { fp: String, seed: [u8; 32] }
    impl Dev {
        fn new(c: char) -> Dev { Dev { fp: c.to_string().repeat(64), seed: [c as u8; 32] } }
        fn id(&self) -> String { hex(ring::signature::Ed25519KeyPair::from_seed_unchecked(&self.seed).unwrap().public_key().as_ref()) }
    }
    const V: &str = "0123456789abcdef";
    fn add(l: &mut Vec<Entry>, by: &Dev, e: Entry) {
        let list = check(V, l, None).unwrap().0;
        l.push(sign(V, &list, &by.fp, &by.seed, e));
    }
    fn team() -> (Vec<Entry>, Dev, Dev, Dev) {
        let (a, b, c) = (Dev::new('a'), Dev::new('b'), Dev::new('c'));
        let mut l = vec![sign(V, &List::default(), &a.fp, &a.seed, Entry { kind: "create".into(), fp: a.fp.clone(), id: a.id(), pk: "1".repeat(64), role: "admin".into(), mac: "6".repeat(64), ..Default::default() })];
        add(&mut l, &a, Entry { kind: "add".into(), fp: b.fp.clone(), id: b.id(), pk: "2".repeat(64), role: "member".into(), ..Default::default() });
        add(&mut l, &a, Entry { kind: "add".into(), fp: c.fp.clone(), id: c.id(), pk: "3".repeat(64), role: "member".into(), ..Default::default() });
        (l, a, b, c)
    }

    #[test]
    fn a_list_checks_from_its_creator() {
        let (l, a, b, _) = team();
        let (list, hashes) = check(V, &l, Some(&a.id())).unwrap();
        assert_eq!((list.members.len(), list.admin(&a.fp), list.admin(&b.fp), hashes.len()), (3, true, false, 3));
        assert!(check(V, &l, Some(&b.id())).unwrap_err().contains("creator"), "another creator");
        assert!(check("fedcba9876543210", &l, None).is_err(), "another vault");
    }
    #[test]
    fn a_forged_or_reordered_entry_is_refused() {
        let (mut l, a, b, c) = team();
        // a member (not an admin) adds, removes or promotes: refused
        let list = check(V, &l, None).unwrap().0;
        let promote = sign(V, &list, &b.fp, &b.seed, Entry { kind: "promote".into(), fp: b.fp.clone(), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![promote]].concat(), None).unwrap_err().contains("not signed by an admin"));
        // a signature by another key than the signer's (the server, which has none)
        let mut forged = sign(V, &list, &a.fp, &c.seed, Entry { kind: "promote".into(), fp: c.fp.clone(), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![forged.clone()]].concat(), None).unwrap_err().contains("not signed by who it names"));
        forged = sign(V, &list, &a.fp, &a.seed, Entry { kind: "promote".into(), fp: c.fp.clone(), ..Default::default() });
        forged.fp = b.fp.clone();
        assert!(check(V, &[l.clone(), vec![forged]].concat(), None).is_err(), "a field changed after signing");
        // out of order, or not following
        l.swap(1, 2);
        assert!(check(V, &l, None).is_err());
    }
    #[test]
    fn a_removal_waits_for_a_new_key_and_blocks_a_device_change() {
        let (mut l, a, b, c) = team();
        add(&mut l, &a, Entry { kind: "remove".into(), fp: c.fp.clone(), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        assert!(list.pending.is_some() && !list.members.contains_key(&c.fp));
        // a new device for b while c's removal is unfinished: refused
        let dev = sign(V, &list, &a.fp, &a.seed, Entry { kind: "device".into(), fp: b.fp.clone(), id: Dev::new('d').id(), pk: "4".repeat(64), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![dev]].concat(), None).unwrap_err().contains("breaks the rules"));
        // the removed member signs nothing any more
        let late = sign(V, &list, &c.fp, &c.seed, Entry { kind: "rekey".into(), epoch: 1, h: "5".repeat(64), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![late]].concat(), None).unwrap_err().contains("no member"));
        add(&mut l, &a, Entry { kind: "rekey".into(), epoch: 1, h: "5".repeat(64), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        assert_eq!((list.pending, list.epoch, list.epochs[&1].1.len()), (None, 1, 2), "made for the two left");
        add(&mut l, &a, Entry { kind: "device".into(), fp: b.fp.clone(), id: Dev::new('d').id(), pk: "4".repeat(64), ..Default::default() });
        assert_eq!(check(V, &l, None).unwrap().0.members[&b.fp].pk, "4".repeat(64));
        // a leave is signed by the member itself
        let list = check(V, &l, None).unwrap().0;
        l.push(sign(V, &list, &b.fp, &Dev::new('d').seed, Entry { kind: "leave".into(), fp: b.fp.clone(), ..Default::default() }));
        assert!(check(V, &l, None).unwrap().0.pending.is_some());
    }
    #[test]
    fn every_field_is_checked_and_the_list_keeps_an_admin() {
        let (l, a, b, _) = team();
        let list = check(V, &l, None).unwrap().0;
        let with = |e: Entry| check(V, &[l.clone(), vec![sign(V, &list, &a.fp, &a.seed, e)]].concat(), None);
        // a field the kind does not use, or a role where none goes
        assert!(with(Entry { kind: "remove".into(), fp: b.fp.clone(), role: "admin".into(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(with(Entry { kind: "promote".into(), fp: b.fp.clone(), pk: "1".repeat(64), ..Default::default() }).is_err());
        assert!(with(Entry { kind: "rekey".into(), fp: b.fp.clone(), epoch: 1, h: "5".repeat(64), ..Default::default() }).is_err());
        assert!(with(Entry { kind: "add".into(), fp: "d".repeat(64), id: "D".repeat(64), pk: "4".repeat(64), role: "member".into(), ..Default::default() }).is_err(), "upper-case hex");
        // a signature in upper case
        let mut up = sign(V, &list, &a.fp, &a.seed, Entry { kind: "promote".into(), fp: b.fp.clone(), ..Default::default() });
        up.sig = up.sig.to_uppercase();
        assert!(check(V, &[l.clone(), vec![up]].concat(), None).is_err());
        // the only admin leaves, or is demoted: refused
        assert!(with(Entry { kind: "demote".into(), fp: a.fp.clone(), ..Default::default() }).unwrap_err().contains("no admin left"));
        // checked further from what was checked before, the same as from scratch
        let (head, hashes) = check(V, &l[..2], None).unwrap();
        assert_eq!(extend(V, head, hashes, &l[2..], None).unwrap().0.head, list.head);
    }
}
