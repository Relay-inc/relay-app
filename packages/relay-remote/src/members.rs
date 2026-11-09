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
/// key's sha256 `h`), `device` (the member `fp` set up Relay again: new `id` and `pk`), or `docs-on` / `docs-off` (an
/// admin turns the making of the workspace's notes into documents on or off; no other field), or `nohistory` (the
/// workspace keeps no record of who wrote what, docs/workspaces.md, Without history: only as the entry right after
/// `create`, by its creator, no other field, and no entry undoes it). `fp`: the member it is about;
/// `id`, `pk`: its Ed25519 identity and X25519 key (create, add, device). `role`: admin, member or reader (create: admin,
/// add, and `role`, which an admin signs to give the member `fp` that role). `at`:
/// epoch seconds; `by`: the signer's fingerprint; `sig`: its signature over `msg`.
/// `mac` (create only): the creator's identity vouched for under the vault's epoch-0 key, which the server never has:
/// a Mac that knows no creator takes a first list only with it.
/// A reader (docs/workspaces.md, Roles) reads the workspace and signs nothing but its own `leave`, and the server refuses
/// its writes (`READ_ONLY`).
/// People (docs/workspaces.md, People): `person` names the person `who` (`name`, optional `email`, made or renamed) and,
/// with `fp`, puts that device under it. `person-remove` takes the person `who` out with every device under it. An
/// `add` with `who` adds a device under that person. Members stay devices: a device without a person is as before.
/// Policy (docs/workspaces.md, Policy): `policy`, by an admin, sets the agent `providers` allowed in the workspace (from
/// `POLICY_PROVIDERS`, at least one) and whether `capture` is on. A newer one replaces the older.
/// SSO (docs/workspaces.md, SSO): `sso`, on the organisation list only, sets the OIDC provider a device signs in with
/// to join a workspace on the server: its `issuer` (https), the `client` id, the email `domains` allowed and whether
/// signing in is `required`. One with every field empty turns it off. A newer one replaces the older.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Entry {
    pub seq: u64, pub prev: String, pub kind: String, pub fp: String, pub id: String, pub pk: String, pub role: String,
    pub epoch: u32, pub h: String, pub at: u64, pub by: String, pub sig: String, pub mac: String,
    pub who: String, pub name: String, pub email: String,
    #[serde(skip_serializing_if = "Vec::is_empty")] pub providers: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub capture: bool,
    #[serde(skip_serializing_if = "String::is_empty")] pub issuer: String,
    #[serde(skip_serializing_if = "String::is_empty")] pub client: String,
    #[serde(skip_serializing_if = "Vec::is_empty")] pub domains: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub required: bool,
}
/// The agent providers a workspace policy may allow: the ones Relay fences inside a workspace.
pub const POLICY_PROVIDERS: [&str; 2] = ["claude", "codex"];
/// A workspace's policy as the list says: the providers allowed, and capture on or off.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Policy { pub providers: Vec<String>, pub capture: bool }
/// A server's SSO as its organisation list says: the OIDC provider (`issuer`, `client` id), the email domains allowed,
/// and whether a device must sign in to join a workspace there.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Sso { pub issuer: String, pub client: String, pub domains: Vec<String>, pub required: bool }
impl Entry {
    fn has_sso(&self) -> bool { !self.issuer.is_empty() || !self.client.is_empty() || !self.domains.is_empty() || self.required }
}
/// An SSO entry's fields: all empty (off), or an https issuer, a client id and one to `MAX_DOMAINS` domains, each once.
fn good_sso(e: &Entry) -> bool {
    if !e.has_sso() { return true; }
    let plain = |s: &str, n: usize| !s.is_empty() && s.len() <= n && s.bytes().all(|b| b.is_ascii_graphic());
    let domain = |d: &str| d.len() <= 253 && d.contains('.') && d.split('.').all(|p| !p.is_empty() && !p.starts_with('-') && !p.ends_with('-') && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
    plain(&e.issuer, 200) && e.issuer.starts_with("https://") && !e.issuer.ends_with('/') && !e.issuer.contains(['?', '#'])
        && plain(&e.client, 200) && (1..=MAX_DOMAINS).contains(&e.domains.len()) && e.domains.iter().all(|d| domain(d))
        && e.domains.iter().enumerate().all(|(n, d)| !e.domains[..n].contains(d))
}
/// The most email domains an SSO entry allows.
pub const MAX_DOMAINS: usize = 20;
/// The server's answer to any write by a reader, and what a reader's Relay says instead of trying.
pub const READ_ONLY: &str = "read only: a reader of this workspace cannot change it";
/// The longest list a server keeps or a Mac takes.
pub const MAX_ENTRIES: u64 = 10_000;
impl Entry {
    /// What the signature covers: every field but the signature, and the vault.
    /// The person fields only when set, so every entry from before people signs as it did: as JSON, a name holds any
    /// character without two entries reading the same.
    pub fn msg(&self, vault: &str) -> String {
        let base = format!("member-log:{vault}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}", self.seq, self.prev, self.kind, self.fp, self.id, self.pk, self.role, self.epoch, self.h, self.at, self.by);
        let base = if self.who.is_empty() && self.name.is_empty() && self.email.is_empty() { base } else { format!("{base}:{}:{}", self.who, serde_json::json!([self.name, self.email])) };
        // the policy fields only on a policy entry (or one that carries them anyway, which the check refuses)
        let base = if self.kind != "policy" && self.providers.is_empty() && !self.capture { base } else { format!("{base}:policy:{}", serde_json::json!([self.providers, self.capture])) };
        // the SSO fields only on an SSO entry (or one that carries them anyway, which the check refuses)
        if self.kind != "sso" && !self.has_sso() { return base; }
        format!("{base}:sso:{}", serde_json::json!([self.issuer, self.client, self.domains, self.required]))
    }
    /// The entry's hash, which the next one names as `prev`: of what is signed and the signature.
    pub fn hash(&self, vault: &str) -> String { sha256_hex(format!("{}:{}", self.msg(vault), self.sig).as_bytes()) }
}

/// A member as the list says: a device, and `person` the person it is under ("" none). `reader`: it only reads.
#[derive(Clone, Debug, PartialEq)]
pub struct Member { pub id: String, pub pk: String, pub admin: bool, pub person: String, pub reader: bool }
/// A person as the list says, with the devices under it (fingerprints), for the settings.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Person { pub who: String, pub name: String, pub email: String, pub devices: Vec<String> }
/// A person's name at most, and an email address, in characters.
pub const MAX_PERSON_NAME: usize = 100;
const MAX_EMAIL: usize = 254;
fn good_name(s: &str) -> bool { !s.is_empty() && s.trim() == s && s.chars().count() <= MAX_PERSON_NAME && !s.chars().any(char::is_control) }
fn good_email(s: &str) -> bool { s.is_empty() || (s.chars().count() <= MAX_EMAIL && s.contains('@') && !s.chars().any(|c| c.is_whitespace() || c.is_control())) }
/// The list, checked. `epochs`: per epoch after 0, the sha256 of its key and who it was made for. `pending`: when a
/// member was removed or left and no new key followed yet (epoch seconds of that entry). `head`: the last entry's hash.
#[derive(Clone, Debug, Default)]
pub struct List {
    pub members: BTreeMap<String, Member>, pub epoch: u32, pub epochs: BTreeMap<u32, (String, Vec<String>)>,
    pub pending: Option<u64>, pub len: u64, pub head: String, pub creator: String,
    /// The workspace's notes are made documents (`docs-on`, by an admin).
    pub docs: bool,
    /// The workspace was made without history (`nohistory`, right after `create`): for good.
    pub nohistory: bool,
    /// Per person (`who`): its name and email.
    pub people: BTreeMap<String, (String, String)>,
    /// The newest `policy` entry's, none before one.
    pub policy: Option<Policy>,
    /// The newest `sso` entry's (organisation list only), none before one or once one turned it off.
    pub sso: Option<Sso>,
}
impl List {
    pub fn admin(&self, fp: &str) -> bool { self.members.get(fp).is_some_and(|m| m.admin) }
    pub fn reader(&self, fp: &str) -> bool { self.members.get(fp).is_some_and(|m| m.reader) }
    /// The hash of entry `seq`, from a check that kept them (`check` fills `hashes`).
    pub fn has(&self, hashes: &[String], seq: u64, hash: &str) -> bool { hashes.get(seq as usize).is_some_and(|h| h == hash) }
    /// The person device `fp` is under, "" none.
    pub fn person(&self, fp: &str) -> &str { self.members.get(fp).map_or("", |m| m.person.as_str()) }
    /// Every person with its devices.
    pub fn persons(&self) -> Vec<Person> {
        self.people.iter().map(|(who, (name, email))| Person {
            who: who.clone(), name: name.clone(), email: email.clone(),
            devices: self.members.iter().filter(|(_, m)| m.person == *who).map(|(fp, _)| fp.clone()).collect(),
        }).collect()
    }
}

pub fn hex64(s: &str) -> bool { lowhex(s, 64) }
fn lowhex(s: &str, n: usize) -> bool { s.len() == n && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
/// Whether `sig` is the Ed25519 identity `id`'s signature over `msg` (all hex).
pub fn signed(id: &str, msg: &str, sig: &str) -> bool {
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
                && (role == ["admin", "member", "reader"].contains(&e.role.as_str())) && (role || e.role.is_empty())
                && (rekey == (e.epoch > 0 && hex64(&e.h))) && (rekey || (e.epoch == 0 && e.h.is_empty())) && (mac == hex64(&e.mac)) && (mac || e.mac.is_empty())
        };
        // the person fields: `who` on the person kinds and optionally on an add, a name (and email) only on `person`
        let person = |who: bool, name: bool| (if who { hex64(&e.who) } else { e.who.is_empty() || (e.kind == "add" && hex64(&e.who)) })
            && (if name { good_name(&e.name) && good_email(&e.email) } else { e.name.is_empty() && e.email.is_empty() });
        // the policy fields: known providers, each once, at least one; on a policy entry only
        let policy = e.providers.iter().all(|p| POLICY_PROVIDERS.contains(&p.as_str())) && !e.providers.is_empty()
            && e.providers.iter().enumerate().all(|(n, p)| !e.providers[..n].contains(p));
        if e.kind != "policy" && (!e.providers.is_empty() || e.capture) { return bad(&format!("a {} with the wrong fields", e.kind)); }
        if e.kind != "sso" && e.has_sso() { return bad(&format!("a {} with the wrong fields", e.kind)); }
        let shape = match e.kind.as_str() {
            "create" => uses(true, true, true, false, true) && person(false, false),
            "add" => uses(true, true, true, false, false) && person(false, false),
            "remove" | "leave" | "promote" | "demote" => uses(true, false, false, false, false) && person(false, false),
            "role" => uses(true, false, true, false, false) && person(false, false),
            "rekey" => uses(false, false, false, true, false) && person(false, false),
            "device" => uses(true, true, false, false, false) && person(false, false),
            "docs-on" | "docs-off" | "nohistory" => uses(false, false, false, false, false) && person(false, false),
            // the device is optional: without one a person is only named or renamed
            "person" => uses(hex64(&e.fp), false, false, false, false) && person(true, true),
            "person-remove" => uses(false, false, false, false, false) && person(true, false),
            "policy" => uses(false, false, false, false, false) && person(false, false) && policy,
            // an organisation list's only (`org_name`): a workspace's never takes one
            "sso" => vault.starts_with("org:") && uses(false, false, false, false, false) && person(false, false) && good_sso(e),
            _ => false,
        };
        if !shape { return bad(&format!("a {} with the wrong fields", e.kind)); }
        if i == 0 {
            if e.kind != "create" || e.by != e.fp || e.role != "admin" { return bad("not a creation"); }
            if creator.is_some_and(|c| c != e.id) { return bad("not made by the vault's creator"); }
            if !signed(&e.id, &e.msg(vault), &e.sig) { return bad("not signed by its creator"); }
            l.creator = e.id.clone();
            l.members.insert(e.fp.clone(), Member { id: e.id.clone(), pk: e.pk.clone(), admin: true, person: String::new(), reader: false });
        } else {
            // signed by its signer as the list stood before it: an admin, or the member itself for `leave`
            let Some(by) = l.members.get(&e.by).cloned() else { return bad("signed by someone who is no member") };
            if !signed(&by.id, &e.msg(vault), &e.sig) { return bad("not signed by who it names") };
            let member = l.members.contains_key(&e.fp);
            // the signer is a device of the person the entry is about
            let own = !by.person.is_empty() && by.person == e.who;
            let known = l.people.contains_key(&e.who);
            match e.kind.as_str() {
                "leave" if e.by == e.fp && member => { l.members.remove(&e.fp); l.pending = Some(e.at); }
                // a reader signs nothing else, also not for its own person
                _ if by.reader => return bad("a reader only leaves"),
                // what a person's own device may do without an admin: add a device for that person (never an admin),
                // name itself as a new person, take that person out
                "add" if !by.admin && own && !member && e.role == "member" => { l.members.insert(e.fp.clone(), Member { id: e.id.clone(), pk: e.pk.clone(), admin: false, person: e.who.clone(), reader: false }); }
                "person" if !by.admin && e.fp == e.by && by.person.is_empty() && !known => {
                    l.people.insert(e.who.clone(), (e.name.clone(), e.email.clone()));
                    l.members.get_mut(&e.fp).unwrap().person = e.who.clone();
                }
                "person-remove" if !by.admin && own => drop_person(&mut l, &e.who, e.at),
                _ if !by.admin => return bad("not signed by an admin"),
                "add" if !member && (e.who.is_empty() || known) => { l.members.insert(e.fp.clone(), Member { id: e.id.clone(), pk: e.pk.clone(), admin: e.role == "admin", person: e.who.clone(), reader: e.role == "reader" }); }
                "person" if e.fp.is_empty() || member => {
                    l.people.insert(e.who.clone(), (e.name.clone(), e.email.clone()));
                    if member { l.members.get_mut(&e.fp).unwrap().person = e.who.clone(); }
                }
                "person-remove" if known => drop_person(&mut l, &e.who, e.at),
                "remove" if member => { l.members.remove(&e.fp); l.pending = Some(e.at); }
                "promote" if member => { let m = l.members.get_mut(&e.fp).unwrap(); (m.admin, m.reader) = (true, false); }
                "demote" if member => l.members.get_mut(&e.fp).unwrap().admin = false,
                "role" if member => { let m = l.members.get_mut(&e.fp).unwrap(); (m.admin, m.reader) = (e.role == "admin", e.role == "reader"); }
                "docs-on" | "docs-off" => l.docs = e.kind == "docs-on",
                "policy" => l.policy = Some(Policy { providers: e.providers.clone(), capture: e.capture }),
                "sso" => l.sso = e.has_sso().then(|| Sso { issuer: e.issuer.clone(), client: e.client.clone(), domains: e.domains.clone(), required: e.required }),
                // never later: a workspace that had a history would keep it, and every member saw it as one with history
                "nohistory" if i == 1 => l.nohistory = true,
                "nohistory" => return bad("without history only right after the creation"),
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

/// The organisation list of a server (docs/workspaces.md, Organisation) is checked under this name: its server's
/// certificate fingerprint, so a list of one server never checks as another's.
pub fn org_name(server: &str) -> String { format!("org:{server}") }
/// The organisation list: the member list's rules (hash chain, Ed25519, an admin signs), with only these entries:
/// `create` by its owner (its `mac` the sha256 of `org_name`, as no vault key exists here), `add` of an organisation
/// admin (role admin, no person), `remove`, `leave` and `sso` (the server's SSO, signed by an organisation admin so the
/// server can never turn it on, off or wider itself). Everyone on it is an admin: who is not on it signs nothing.
/// `creator`: the identity it must start with, once this Mac pinned it.
pub fn check_org(server: &str, entries: &[Entry], creator: Option<&str>) -> Result<(List, Vec<String>), String> {
    extend_org(server, List::default(), vec![], entries, creator)
}
pub fn extend_org(server: &str, l: List, hashes: Vec<String>, entries: &[Entry], creator: Option<&str>) -> Result<(List, Vec<String>), String> {
    let name = org_name(server);
    for (n, e) in entries.iter().enumerate() {
        let ok = match e.kind.as_str() {
            "create" => e.mac == sha256_hex(name.as_bytes()),
            "add" => e.role == "admin" && e.who.is_empty(),
            "remove" | "leave" | "sso" => true,
            _ => false,
        };
        if !ok { return Err(format!("organisation list entry {}: no {} here", l.len + n as u64, e.kind)); }
    }
    extend(&name, l, hashes, entries, creator).map_err(|e| e.replace("member list", "organisation list"))
}

/// The person `who` out, with every device under it: a removal then waits for a new key, as for one device.
fn drop_person(l: &mut List, who: &str, at: u64) {
    let before = l.members.len();
    l.members.retain(|_, m| m.person != who);
    if l.members.len() != before { l.pending = Some(at); }
    l.people.remove(who);
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

    /// The person `who` (named `n`), as the admin `a` makes it, with device `fp` under it.
    fn named(who: char, n: &str, fp: &str) -> Entry { Entry { kind: "person".into(), who: who.to_string().repeat(64), name: n.into(), fp: fp.into(), ..Default::default() } }
    fn who(c: char) -> String { c.to_string().repeat(64) }
    #[test]
    fn people_group_devices_and_entries_from_before_sign_as_they_did() {
        let (mut l, a, b, c) = team();
        // an entry without person fields signs exactly what it did before people
        assert!(l[1].msg(V).ends_with(&format!(":{}", a.fp)));
        add(&mut l, &a, named('1', "Ann", &a.fp));
        add(&mut l, &a, Entry { email: "bo@example.com".into(), ..named('2', "Bo", &b.fp) });
        // an admin adds a device straight under a person
        let d = Dev::new('d');
        add(&mut l, &a, Entry { kind: "add".into(), fp: d.fp.clone(), id: d.id(), pk: "4".repeat(64), role: "member".into(), who: who('2'), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        let p = list.persons();
        assert_eq!(p.iter().map(|p| (p.name.as_str(), p.email.as_str(), p.devices.len())).collect::<Vec<_>>(), [("Ann", "", 1), ("Bo", "bo@example.com", 2)]);
        assert_eq!((list.person(&d.fp), list.person(&c.fp)), (who('2').as_str(), ""), "a device without a person stays as it was");
        // renamed by an admin, without touching its devices
        add(&mut l, &a, Entry { kind: "person".into(), who: who('2'), name: "Bo B.".into(), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        assert_eq!((list.people[&who('2')].0.as_str(), list.persons()[1].devices.len()), ("Bo B.", 2));
        // a name or email changed after signing
        let mut forged = l.last().unwrap().clone();
        forged.name = "Mallory".into();
        assert!(check(V, &[l[..l.len() - 1].to_vec(), vec![forged]].concat(), None).unwrap_err().contains("not signed by who it names"));
        // a person unknown to the list gets no device from an admin either
        let e = Dev::new('e');
        let list = check(V, &l, None).unwrap().0;
        let x = sign(V, &list, &a.fp, &a.seed, Entry { kind: "add".into(), fp: e.fp.clone(), id: e.id(), pk: "5".repeat(64), role: "member".into(), who: who('9'), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("breaks the rules"));
    }
    #[test]
    fn a_device_adds_only_to_its_own_person_and_never_an_admin() {
        let (mut l, a, b, c) = team();
        add(&mut l, &a, named('1', "Ann", &a.fp));
        add(&mut l, &a, named('2', "Bo", &b.fp));
        let list = check(V, &l, None).unwrap().0;
        let d = Dev::new('d');
        let device = |who: String, role: &str| Entry { kind: "add".into(), fp: d.fp.clone(), id: d.id(), pk: "4".repeat(64), role: role.into(), who, ..Default::default() };
        let by_b = |e: Entry| check(V, &[l.clone(), vec![sign(V, &list, &b.fp, &b.seed, e)]].concat(), None);
        // a device that claims another person
        assert!(by_b(device(who('1'), "member")).unwrap_err().contains("not signed by an admin"));
        // a person that makes itself admin through its own device
        assert!(by_b(device(who('2'), "admin")).unwrap_err().contains("not signed by an admin"));
        // a device without a person adds nobody
        let x = sign(V, &list, &c.fp, &c.seed, device(String::new(), "member"));
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("not signed by an admin"));
        // its own person, as member: taken
        let after = by_b(device(who('2'), "member")).unwrap().0;
        assert_eq!((after.person(&d.fp), after.admin(&d.fp)), (who('2').as_str(), false));
        // and the new device makes itself admin: refused as ever
        add(&mut l, &b, device(who('2'), "member"));
        let list = check(V, &l, None).unwrap().0;
        let up = sign(V, &list, &d.fp, &d.seed, Entry { kind: "promote".into(), fp: d.fp.clone(), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![up]].concat(), None).unwrap_err().contains("not signed by an admin"));
    }
    #[test]
    fn a_device_names_itself_once_and_claims_nobody_else() {
        let (mut l, a, b, c) = team();
        add(&mut l, &a, named('1', "Ann", &a.fp));
        let list = check(V, &l, None).unwrap().0;
        let by = |d: &Dev, e: Entry| check(V, &[l.clone(), vec![sign(V, &list, &d.fp, &d.seed, e)]].concat(), None);
        // a new person for itself: taken
        assert_eq!(by(&c, named('3', "Cy", &c.fp)).unwrap().0.person(&c.fp), who('3'));
        // under a person that exists, for another device, or with no device: refused
        assert!(by(&c, named('1', "Ann", &c.fp)).unwrap_err().contains("not signed by an admin"), "claims another person");
        assert!(by(&c, named('3', "Cy", &b.fp)).is_err(), "names another device");
        assert!(by(&c, Entry { kind: "person".into(), who: who('3'), name: "Cy".into(), ..Default::default() }).is_err());
        // a person renames itself only through an admin
        add(&mut l, &c, named('3', "Cy", &c.fp));
        let list = check(V, &l, None).unwrap().0;
        let x = sign(V, &list, &c.fp, &c.seed, named('3', "Cyrus", ""));
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("not signed by an admin"));
        // once under a person, a device names no new one
        let x = sign(V, &list, &c.fp, &c.seed, named('4', "Other", &c.fp));
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("not signed by an admin"));
    }
    #[test]
    fn a_person_goes_with_all_its_devices_and_the_list_keeps_an_admin() {
        let (mut l, a, b, c) = team();
        let d = Dev::new('d');
        add(&mut l, &a, named('1', "Ann", &a.fp));
        add(&mut l, &a, named('2', "Bo", &b.fp));
        add(&mut l, &a, Entry { kind: "add".into(), fp: d.fp.clone(), id: d.id(), pk: "4".repeat(64), role: "member".into(), who: who('2'), ..Default::default() });
        add(&mut l, &a, Entry { kind: "promote".into(), fp: d.fp.clone(), ..Default::default() });
        add(&mut l, &a, named('3', "Cy", &c.fp));
        let list = check(V, &l, None).unwrap().0;
        let gone = Entry { kind: "person-remove".into(), who: who('2'), ..Default::default() };
        // another person's device takes nobody out
        let x = sign(V, &list, &c.fp, &c.seed, gone.clone());
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("not signed by an admin"));
        // the person itself, through one of its devices (even a member one): both devices go, a new key is due
        let by_self = check(V, &[l.clone(), vec![sign(V, &list, &b.fp, &b.seed, gone.clone())]].concat(), None).unwrap().0;
        assert!(by_self.pending.is_some() && !by_self.members.contains_key(&b.fp) && !by_self.members.contains_key(&d.fp) && !by_self.people.contains_key(&who('2')));
        // an admin: the same
        add(&mut l, &a, gone);
        let list = check(V, &l, None).unwrap().0;
        assert_eq!((list.members.len(), list.persons().len()), (2, 2));
        // the removed admin device signs nothing any more
        let late = sign(V, &list, &d.fp, &d.seed, Entry { kind: "rekey".into(), epoch: 1, h: "5".repeat(64), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![late]].concat(), None).unwrap_err().contains("no member"));
        // the only admin's person: refused, as for the last admin leaving
        let x = sign(V, &list, &a.fp, &a.seed, Entry { kind: "person-remove".into(), who: who('1'), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("no admin left"));
        // a person that does not exist
        let x = sign(V, &list, &a.fp, &a.seed, Entry { kind: "person-remove".into(), who: who('2'), ..Default::default() });
        assert!(check(V, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("breaks the rules"));
    }
    #[test]
    fn person_fields_are_checked() {
        let (l, a, b, _) = team();
        let list = check(V, &l, None).unwrap().0;
        let with = |e: Entry| check(V, &[l.clone(), vec![sign(V, &list, &a.fp, &a.seed, e)]].concat(), None);
        for (n, email) in [("", ""), (" Ann", ""), ("A\nnn", ""), (&"x".repeat(MAX_PERSON_NAME + 1)[..], ""), ("Ann", "ann"), ("Ann", "a nn@example.com")] {
            assert!(with(Entry { email: email.into(), ..named('1', n, &b.fp) }).unwrap_err().contains("wrong fields"), "{n:?} {email:?}");
        }
        assert!(with(named('1', "Ann", &b.fp)).is_ok());
        assert!(with(Entry { kind: "person".into(), who: "A".repeat(64), name: "Ann".into(), ..Default::default() }).is_err(), "upper-case who");
        // a person field where none goes
        assert!(with(Entry { kind: "remove".into(), fp: b.fp.clone(), who: who('1'), ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(with(Entry { kind: "promote".into(), fp: b.fp.clone(), name: "Ann".into(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(with(Entry { kind: "person-remove".into(), who: who('1'), name: "Ann".into(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        let d = Dev::new('d');
        assert!(with(Entry { kind: "add".into(), fp: d.fp.clone(), id: d.id(), pk: "4".repeat(64), role: "member".into(), who: who('1'), email: "x@y".into(), ..Default::default() }).unwrap_err().contains("wrong fields"));
    }
    #[test]
    fn a_person_entry_on_another_history_does_not_follow() {
        let (l, a, b, _) = team();
        let list = check(V, &l, None).unwrap().0;
        // two entries signed on the same head: a fork, the second never follows the first
        let x1 = sign(V, &list, &a.fp, &a.seed, named('1', "Ann", &a.fp));
        let x2 = sign(V, &list, &a.fp, &a.seed, named('2', "Bo", &b.fp));
        let (one, hashes) = check(V, &[l.clone(), vec![x1]].concat(), None).unwrap();
        assert!(extend(V, one.clone(), hashes.clone(), &[x2.clone()], None).unwrap_err().contains("out of order"));
        // a Mac that saw the first knows the other history's head is not its own
        let other = check(V, &[l.clone(), vec![x2]].concat(), None).unwrap().0;
        assert!(!one.has(&hashes, other.len - 1, &other.head));
    }
    #[test]
    fn a_workspace_without_history_says_so_right_after_its_creation_and_for_good() {
        let (team, a, b, c) = team();
        assert!(!check(V, &team, None).unwrap().0.nohistory);
        let mut l = team[..1].to_vec();
        add(&mut l, &a, Entry { kind: "nohistory".into(), ..Default::default() });
        add(&mut l, &a, Entry { kind: "add".into(), fp: b.fp.clone(), id: b.id(), pk: "2".repeat(64), role: "member".into(), ..Default::default() });
        add(&mut l, &a, Entry { kind: "add".into(), fp: c.fp.clone(), id: c.id(), pk: "3".repeat(64), role: "reader".into(), ..Default::default() });
        let (list, hashes) = check(V, &l, Some(&a.id())).unwrap();
        assert!(list.nohistory && list.members.len() == 3);
        let by = |dev: &Dev, x: Entry| check(V, &[l.clone(), vec![sign(V, &list, &dev.fp, &dev.seed, x)]].concat(), None);
        let flag = || Entry { kind: "nohistory".into(), ..Default::default() };
        // later in the list, or a second one: refused, by an admin too
        assert!(by(&a, flag()).unwrap_err().contains("only right after the creation"), "a second one");
        let list0 = check(V, &team, None).unwrap().0;
        let late = sign(V, &list0, &a.fp, &a.seed, flag());
        assert!(check(V, &[team.clone(), vec![late]].concat(), None).unwrap_err().contains("only right after the creation"), "later");
        // by a member or a reader
        assert!(by(&b, flag()).unwrap_err().contains("not signed by an admin"));
        assert!(by(&c, flag()).unwrap_err().contains("a reader only leaves"));
        // shared documents on it, as anywhere (their authors are sessions there, docs.rs)
        assert!(by(&a, Entry { kind: "docs-on".into(), ..Default::default() }).unwrap().0.docs);
        // with a field, or an entry that would undo it: no such entry
        assert!(by(&a, Entry { kind: "nohistory".into(), fp: b.fp.clone(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        for undo in ["history", "nohistory-off", "history-on"] {
            assert!(by(&a, Entry { kind: undo.into(), ..Default::default() }).unwrap_err().contains("wrong fields"), "{undo}");
        }
        // the list without it: entry 1 dropped, what follows no longer follows. And a list the creator made again
        // without it is not the one a member saw (vault.rs refuses that as a fork)
        let dropped: Vec<Entry> = [&l[..1], &l[2..]].concat();
        assert!(check(V, &dropped, None).is_err());
        let again = check(V, &team, None).unwrap().0;
        assert!(!list.has(&hashes, again.len - 1, &again.head));
    }
    #[test]
    fn an_admin_adds_and_changes_a_reader_who_signs_nothing_but_its_leave() {
        let (mut l, a, b, _) = team();
        let d = Dev::new('d');
        add(&mut l, &a, named('1', "Ann", &a.fp));
        add(&mut l, &a, named('2', "Bo", &b.fp));
        // a reader on a device without a person, and one under a person
        let reader = |dev: &Dev, pk: char, who: String| Entry { kind: "add".into(), fp: dev.fp.clone(), id: dev.id(), pk: pk.to_string().repeat(64), role: "reader".into(), who, ..Default::default() };
        add(&mut l, &a, reader(&d, '4', String::new()));
        let e = Dev::new('e');
        add(&mut l, &a, reader(&e, '5', who('2')));
        let list = check(V, &l, None).unwrap().0;
        assert_eq!((list.reader(&d.fp), list.admin(&d.fp), list.reader(&e.fp), list.person(&e.fp), list.reader(&b.fp)), (true, false, true, who('2').as_str(), false));
        // what a reader signs: refused, also for itself and for its own person
        let by = |dev: &Dev, x: Entry| { let list = check(V, &l, None).unwrap().0; check(V, &[l.clone(), vec![sign(V, &list, &dev.fp, &dev.seed, x)]].concat(), None) };
        let f = Dev::new('f');
        assert!(by(&e, Entry { kind: "add".into(), fp: f.fp.clone(), id: f.id(), pk: "6".repeat(64), role: "member".into(), who: who('2'), ..Default::default() }).unwrap_err().contains("a reader only leaves"), "a device for its person");
        assert!(by(&d, Entry { kind: "promote".into(), fp: d.fp.clone(), ..Default::default() }).unwrap_err().contains("a reader only leaves"));
        assert!(by(&d, Entry { kind: "role".into(), fp: d.fp.clone(), role: "member".into(), ..Default::default() }).unwrap_err().contains("a reader only leaves"));
        assert!(by(&d, named('9', "Dee", &d.fp)).unwrap_err().contains("a reader only leaves"), "names itself");
        assert!(by(&e, Entry { kind: "person-remove".into(), who: who('2'), ..Default::default() }).unwrap_err().contains("a reader only leaves"));
        // a member gives nobody the reader role, also not its own new device
        assert!(by(&b, reader(&f, '6', who('2'))).unwrap_err().contains("not signed by an admin"));
        assert!(by(&b, Entry { kind: "role".into(), fp: d.fp.clone(), role: "member".into(), ..Default::default() }).unwrap_err().contains("not signed by an admin"));
        // its leave: taken, and a removal waits for a new key as for anyone
        let left = by(&d, Entry { kind: "leave".into(), fp: d.fp.clone(), ..Default::default() }).unwrap().0;
        assert!(left.pending.is_some() && !left.members.contains_key(&d.fp));
        // an admin makes it a member, an admin, and a reader again, and a promote of a reader makes an admin
        add(&mut l, &a, Entry { kind: "role".into(), fp: d.fp.clone(), role: "member".into(), ..Default::default() });
        assert!(!check(V, &l, None).unwrap().0.reader(&d.fp));
        add(&mut l, &a, Entry { kind: "role".into(), fp: d.fp.clone(), role: "admin".into(), ..Default::default() });
        assert!(check(V, &l, None).unwrap().0.admin(&d.fp));
        add(&mut l, &a, Entry { kind: "role".into(), fp: d.fp.clone(), role: "reader".into(), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        assert_eq!((list.admin(&d.fp), list.reader(&d.fp)), (false, true));
        add(&mut l, &a, Entry { kind: "promote".into(), fp: e.fp.clone(), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        assert_eq!((list.admin(&e.fp), list.reader(&e.fp)), (true, false));
        // a demote of a reader leaves it a reader
        add(&mut l, &a, Entry { kind: "demote".into(), fp: d.fp.clone(), ..Default::default() });
        assert!(check(V, &l, None).unwrap().0.reader(&d.fp));
        // an admin makes itself a reader while another admin is left, the last admin cannot
        let list = check(V, &l, None).unwrap().0;
        let with = |x: Entry| check(V, &[l.clone(), vec![sign(V, &list, &a.fp, &a.seed, x)]].concat(), None);
        assert!(with(Entry { kind: "role".into(), fp: a.fp.clone(), role: "reader".into(), ..Default::default() }).is_ok());
        add(&mut l, &a, Entry { kind: "demote".into(), fp: e.fp.clone(), ..Default::default() });
        let list = check(V, &l, None).unwrap().0;
        let with = |x: Entry| check(V, &[l.clone(), vec![sign(V, &list, &a.fp, &a.seed, x)]].concat(), None);
        assert!(with(Entry { kind: "role".into(), fp: a.fp.clone(), role: "reader".into(), ..Default::default() }).unwrap_err().contains("no admin left"));
        // a role entry's fields: a known role, a member, nothing else
        assert!(with(Entry { kind: "role".into(), fp: d.fp.clone(), role: "owner".into(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(with(Entry { kind: "role".into(), fp: d.fp.clone(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(with(Entry { kind: "role".into(), fp: f.fp.clone(), role: "member".into(), ..Default::default() }).unwrap_err().contains("breaks the rules"), "not a member");
        assert!(with(Entry { kind: "role".into(), fp: d.fp.clone(), role: "member".into(), who: who('1'), ..Default::default() }).unwrap_err().contains("wrong fields"));
    }
    #[test]
    fn an_admin_signs_the_policy_and_a_newer_one_replaces_it() {
        let (mut l, a, b, _) = team();
        let d = Dev::new('d');
        add(&mut l, &a, Entry { kind: "add".into(), fp: d.fp.clone(), id: d.id(), pk: "4".repeat(64), role: "reader".into(), ..Default::default() });
        let pol = |p: &[&str], capture: bool| Entry { kind: "policy".into(), providers: p.iter().map(|x| x.to_string()).collect(), capture, ..Default::default() };
        assert_eq!(check(V, &l, None).unwrap().0.policy, None, "no policy before one");
        add(&mut l, &a, pol(&["claude", "codex"], true));
        add(&mut l, &a, pol(&["codex"], false));
        let list = check(V, &l, None).unwrap().0;
        assert_eq!(list.policy, Some(Policy { providers: vec!["codex".into()], capture: false }), "the newer one");
        let by = |dev: &Dev, x: Entry| check(V, &[l.clone(), vec![sign(V, &list, &dev.fp, &dev.seed, x)]].concat(), None);
        // by a member or a reader
        assert!(by(&b, pol(&["claude"], false)).unwrap_err().contains("not signed by an admin"));
        assert!(by(&d, pol(&["claude"], false)).unwrap_err().contains("a reader only leaves"));
        // an unknown provider, none, one twice, or the fields on another entry
        for bad in [pol(&["opencode"], false), pol(&[], true), pol(&[], false), pol(&["claude", "claude"], false), pol(&["Claude"], false)] {
            assert!(by(&a, bad.clone()).unwrap_err().contains("wrong fields"), "{bad:?}");
        }
        assert!(by(&a, Entry { kind: "docs-on".into(), providers: vec!["claude".into()], ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(by(&a, Entry { kind: "docs-on".into(), capture: true, ..Default::default() }).unwrap_err().contains("wrong fields"));
        assert!(by(&a, Entry { fp: b.fp.clone(), ..pol(&["claude"], false) }).unwrap_err().contains("wrong fields"));
        // the providers or capture changed after signing
        let mut forged = sign(V, &list, &a.fp, &a.seed, pol(&["codex"], false));
        forged.capture = true;
        assert!(check(V, &[l.clone(), vec![forged]].concat(), None).unwrap_err().contains("not signed by who it names"));
        let mut forged = sign(V, &list, &a.fp, &a.seed, pol(&["codex"], false));
        forged.providers = vec!["claude".into()];
        assert!(check(V, &[l.clone(), vec![forged]].concat(), None).unwrap_err().contains("not signed by who it names"));
        // an entry without policy fields serialises as it did before policies
        assert!(!serde_json::to_string(&l[1]).unwrap().contains("providers") && !serde_json::to_string(&l[1]).unwrap().contains("capture"));
    }

    const S: &str = "5555555555555555555555555555555555555555555555555555555555555555";
    fn org_create(a: &Dev) -> Entry {
        sign(&org_name(S), &List::default(), &a.fp, &a.seed, Entry { kind: "create".into(), fp: a.fp.clone(), id: a.id(), pk: "1".repeat(64), role: "admin".into(), mac: sha256_hex(org_name(S).as_bytes()), ..Default::default() })
    }
    fn org_add(l: &mut Vec<Entry>, by: &Dev, e: Entry) {
        let list = check_org(S, l, None).unwrap().0;
        l.push(sign(&org_name(S), &list, &by.fp, &by.seed, e));
    }
    fn admin_of(d: &Dev, pk: char) -> Entry { Entry { kind: "add".into(), fp: d.fp.clone(), id: d.id(), pk: pk.to_string().repeat(64), role: "admin".into(), ..Default::default() } }
    #[test]
    fn the_organisation_list_starts_with_its_owner_who_adds_and_removes_admins() {
        let (a, b, c) = (Dev::new('a'), Dev::new('b'), Dev::new('c'));
        let mut l = vec![org_create(&a)];
        org_add(&mut l, &a, admin_of(&b, '2'));
        let (list, _) = check_org(S, &l, Some(&a.id())).unwrap();
        assert!(list.admin(&a.fp) && list.admin(&b.fp) && list.members.len() == 2);
        // another creator pinned, or the list of another server
        assert!(check_org(S, &l, Some(&b.id())).unwrap_err().contains("creator"));
        assert!(check_org(&"6".repeat(64), &l, None).is_err(), "another server's list");
        // a workspace's member list is no organisation list, nor the other way round
        assert!(check(&org_name(S), &l, None).is_ok() && check(V, &l, None).is_err());
        // the second admin adds a third and removes the owner, the last one cannot go
        org_add(&mut l, &b, admin_of(&c, '3'));
        org_add(&mut l, &b, Entry { kind: "remove".into(), fp: a.fp.clone(), ..Default::default() });
        let list = check_org(S, &l, None).unwrap().0;
        assert_eq!(list.members.keys().cloned().collect::<Vec<_>>(), [b.fp.clone(), c.fp.clone()]);
        org_add(&mut l, &c, Entry { kind: "leave".into(), fp: c.fp.clone(), ..Default::default() });
        let list = check_org(S, &l, None).unwrap().0;
        let x = sign(&org_name(S), &list, &b.fp, &b.seed, Entry { kind: "leave".into(), fp: b.fp.clone(), ..Default::default() });
        assert!(check_org(S, &[l.clone(), vec![x]].concat(), None).unwrap_err().contains("nobody left"));
    }
    #[test]
    fn the_organisation_list_takes_only_its_own_entries_from_its_admins() {
        let (a, b, d) = (Dev::new('a'), Dev::new('b'), Dev::new('d'));
        let mut l = vec![org_create(&a)];
        org_add(&mut l, &a, admin_of(&b, '2'));
        let list = check_org(S, &l, None).unwrap().0;
        let with = |by: &Dev, x: Entry| check_org(S, &[l.clone(), vec![sign(&org_name(S), &list, &by.fp, &by.seed, x)]].concat(), None);
        // who is not on it signs nothing: no admin of the organisation
        assert!(with(&d, admin_of(&d, '4')).unwrap_err().contains("no member"));
        // a member, a reader, a person, a policy, docs: no such entries here
        for x in [Entry { role: "member".into(), ..admin_of(&d, '4') }, Entry { role: "reader".into(), ..admin_of(&d, '4') },
            Entry { kind: "person".into(), who: "7".repeat(64), name: "Ann".into(), ..Default::default() },
            Entry { kind: "policy".into(), providers: vec!["claude".into()], ..Default::default() },
            Entry { kind: "docs-on".into(), ..Default::default() }, Entry { kind: "promote".into(), fp: b.fp.clone(), ..Default::default() }] {
            assert!(with(&a, x.clone()).unwrap_err().contains("no "), "{x:?}");
        }
        assert!(with(&a, Entry { who: "7".repeat(64), ..admin_of(&d, '4') }).is_err(), "an admin under a person");
        // a creation without the organisation's mac, or by someone else than it names
        let mut bad = org_create(&a);
        bad.mac = "6".repeat(64);
        assert!(check_org(S, &[bad], None).is_err());
        // a forged entry: another key than the signer's (the server, which has none)
        let forged = sign(&org_name(S), &list, &a.fp, &d.seed, admin_of(&d, '4'));
        assert!(check_org(S, &[l.clone(), vec![forged]].concat(), None).unwrap_err().contains("not signed by who it names"));
        // a fork: two entries on the same head, the second never follows the first
        let x1 = sign(&org_name(S), &list, &a.fp, &a.seed, admin_of(&d, '4'));
        let x2 = sign(&org_name(S), &list, &a.fp, &a.seed, Entry { kind: "remove".into(), fp: b.fp.clone(), ..Default::default() });
        let (one, hashes) = check_org(S, &[l.clone(), vec![x1]].concat(), None).unwrap();
        assert!(extend_org(S, one.clone(), hashes.clone(), &[x2.clone()], None).unwrap_err().contains("out of order"));
        let other = check_org(S, &[l.clone(), vec![x2]].concat(), None).unwrap().0;
        assert!(!one.has(&hashes, other.len - 1, &other.head));
    }
    fn google(required: bool) -> Entry {
        Entry { kind: "sso".into(), issuer: "https://accounts.google.com".into(), client: "123-abc.apps.googleusercontent.com".into(), domains: vec!["example.com".into()], required, ..Default::default() }
    }
    #[test]
    fn the_organisation_signs_its_sso_and_a_workspace_list_takes_none() {
        let (a, b, d) = (Dev::new('a'), Dev::new('b'), Dev::new('d'));
        let mut l = vec![org_create(&a)];
        org_add(&mut l, &a, admin_of(&b, '2'));
        assert_eq!(check_org(S, &l, None).unwrap().0.sso, None);
        org_add(&mut l, &b, google(true));
        let list = check_org(S, &l, None).unwrap().0;
        assert_eq!(list.sso, Some(Sso { issuer: "https://accounts.google.com".into(), client: "123-abc.apps.googleusercontent.com".into(), domains: vec!["example.com".into()], required: true }));
        // the server cannot loosen it: a domain added or required dropped after signing breaks the signature
        for f in [|e: &mut Entry| e.domains.push("evil.example".into()), |e: &mut Entry| e.required = false, |e: &mut Entry| e.client = "other".into()] {
            let mut x = l.last().unwrap().clone();
            f(&mut x);
            assert!(check_org(S, &[l[..l.len() - 1].to_vec(), vec![x]].concat(), None).unwrap_err().contains("not signed by who it names"));
        }
        let list = check_org(S, &l, None).unwrap().0;
        let with = |by: &Dev, x: Entry| check_org(S, &[l.clone(), vec![sign(&org_name(S), &list, &by.fp, &by.seed, x)]].concat(), None);
        // by who is not an organisation admin
        assert!(with(&d, google(false)).unwrap_err().contains("no member"));
        // bad fields: plain http, a trailing slash, no client, no domain, an upper-case or doubled domain, a person on it
        for x in [Entry { issuer: "http://accounts.google.com".into(), ..google(true) }, Entry { issuer: "https://accounts.google.com/".into(), ..google(true) },
            Entry { client: String::new(), ..google(true) }, Entry { domains: vec![], ..google(true) }, Entry { domains: vec!["Example.com".into()], ..google(true) },
            Entry { domains: vec!["example.com".into(), "example.com".into()], ..google(true) }, Entry { domains: vec!["localhost".into()], ..google(true) },
            Entry { required: true, issuer: String::new(), client: String::new(), domains: vec![], ..google(true) },
            Entry { who: "7".repeat(64), ..google(true) }, Entry { fp: b.fp.clone(), ..google(true) }] {
            assert!(with(&a, x.clone()).unwrap_err().contains("wrong fields"), "{x:?}");
        }
        // SSO fields on another kind
        assert!(with(&a, Entry { kind: "remove".into(), fp: b.fp.clone(), issuer: "https://x.example".into(), ..Default::default() }).unwrap_err().contains("wrong fields"));
        // turned off: an entry with every field empty
        assert_eq!(with(&a, Entry { kind: "sso".into(), ..Default::default() }).unwrap().0.sso, None);
        // a workspace's member list never takes one
        let (wl, wa, _, _) = team();
        let wlist = check(V, &wl, None).unwrap().0;
        assert!(check(V, &[wl.clone(), vec![sign(V, &wlist, &wa.fp, &wa.seed, google(true))]].concat(), None).unwrap_err().contains("wrong fields"));
        // an entry without SSO fields serialises and signs as it did before
        assert!(!serde_json::to_string(&l[1]).unwrap().contains("issuer") && !l[1].msg("x").contains(":sso:"));
    }
}
