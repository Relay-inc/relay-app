//! A server's organisation on this Mac (docs/workspaces.md, Organisation): its admins' list, checked here and pinned
//! (its creator and the head this Mac last saw, kept in the organisation key file as a workspace's are), and this
//! Mac's own organisation keys: an Ed25519 identity that signs the organisation list and a workspace's member list
//! where it was added as organisation admin, and an X25519 key a workspace key is sealed to for it.
//!
//! An organisation admin is added by another one on what the device publishes (`org_pk`). The server could swap that
//! publication for its own, so both Macs show the keys' `code` and the admin adds only when the two match.

use crate::client::Client;
use crate::members::{self, List};
use crate::tls::hex;
use crate::vault::Keys;
use serde_json::{json, Value};

/// An organisation admin as the list says: its device, identity and X25519 key.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Admin { pub fp: String, pub id: String, pub pk: String }
/// The organisation as this Mac checked it. `list`: none while there is none. `owner`: this Mac is the device that may
/// start it. `me`: this Mac is an organisation admin.
#[derive(Debug, Default)]
pub struct Org { pub list: Option<List>, pub owner: bool, pub me: bool }
impl Org {
    pub fn admins(&self) -> Vec<Admin> {
        self.list.iter().flat_map(|l| l.members.iter().map(|(fp, m)| Admin { fp: fp.clone(), id: m.id.clone(), pk: m.pk.clone() })).collect()
    }
}

/// What both Macs show for a device's organisation keys, to compare before one adds the other: 12 hex of their sha256.
pub fn code(id: &str, pk: &str) -> String {
    let h = crate::sync::sha256_hex(format!("{id}:{pk}").as_bytes());
    format!("{}-{}-{}", &h[..4], &h[4..8], &h[8..12])
}
fn pub_msg(server: &str, fp: &str, id: &str, pk: &str) -> String { format!("org-pub:{server}:{fp}:{id}:{pk}") }
/// What this Mac publishes for an organisation admin to add it: both public keys signed by its identity.
pub fn publication(k: &Keys, server: &str, fp: &str) -> Value {
    let (id, pk) = (k.identity(), k.public());
    let sig = k.sign_text(&pub_msg(server, fp, &id, &pk));
    json!({"id": id, "pk": pk, "sig": sig})
}
/// A device's publication as (identity, key) when its identity signed it.
pub fn proven(server: &str, fp: &str, p: &Value) -> Option<(String, String)> {
    let s = |f: &str| p[f].as_str().unwrap_or_default().to_string();
    let (id, pk) = (s("id"), s("pk"));
    if !members::hex64(&id) || !members::hex64(&pk) { return None; }
    members::signed(&id, &pub_msg(server, fp, &id, &pk), &s("sig")).then_some((id, pk))
}

/// The organisation list from the server, checked from the creator this Mac pinned and as an extension of what it saw
/// (else a fork or held back: refused, nothing is added to a workspace for it). Pins it in `k` (saved by `save`).
pub fn fetch(c: &Client, k: &mut Keys, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<Org, String> {
    let v = c.call(json!({"op": "org_log", "from": 0}))?;
    let entries: Vec<members::Entry> = serde_json::from_value(v["entries"].clone()).map_err(|e| format!("organisation list: {e}"))?;
    let owner = v["owner"] == true;
    let held = "The server's organisation list is shorter than the one this Mac saw: it is held back. Nothing is added to a workspace until it is whole.";
    if entries.is_empty() {
        if k.head.is_some() { return Err(held.into()); }
        return Ok(Org { list: None, owner, me: false });
    }
    let (list, hashes) = members::check_org(&c.fp, &entries, k.creator.as_deref())?;
    if let Some((n, h)) = &k.head {
        if *n > list.len { return Err(held.into()); }
        if *n == 0 || !list.has(&hashes, n - 1, h) { return Err("The server's organisation list is not the one this Mac saw before: a fork. Nothing is added to a workspace until it is.".into()); }
    }
    if k.creator.as_deref() != Some(list.creator.as_str()) || k.head.as_ref() != Some(&(list.len, list.head.clone())) {
        (k.creator, k.head) = (Some(list.creator.clone()), Some((list.len, list.head.clone())));
        save(k)?;
    }
    let me = list.members.get(&c.me()).is_some_and(|m| m.id == k.identity());
    Ok(Org { list: Some(list), owner, me })
}
fn append(c: &Client, k: &mut Keys, list: &List, e: members::Entry, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<(), String> {
    let e = members::sign(&members::org_name(&c.fp), list, &c.me(), &k.sign.expect("ensure first"), e);
    members::extend_org(&c.fp, list.clone(), vec![list.head.clone()], std::slice::from_ref(&e), None).map_err(|x| x.replace("organisation list entry", "this change"))?;
    c.call(json!({"op": "org_append", "entry": e}))?;
    k.head = Some((list.len + 1, e.hash(&members::org_name(&c.fp))));
    if e.kind == "create" { k.creator = Some(e.id.clone()); }
    save(k)
}
/// The owner starts the organisation: its first entry, this Mac its first admin.
pub fn start(c: &Client, k: &mut Keys, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<(), String> {
    if fetch(c, k, save)?.list.is_some() { return Err("this server has an organisation already".into()); }
    let mac = crate::sync::sha256_hex(members::org_name(&c.fp).as_bytes());
    let e = members::Entry { kind: "create".into(), fp: c.me(), id: k.identity(), pk: k.public(), role: "admin".into(), mac, ..Default::default() };
    append(c, k, &List::default(), e, save)
}
/// An organisation admin adds the device `fp` with the keys it published (`id`, `pk`, whose code the user compared).
pub fn add(c: &Client, k: &mut Keys, fp: &str, id: &str, pk: &str, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<(), String> {
    let list = fetch(c, k, save)?.list.ok_or("this server has no organisation yet")?;
    if list.members.contains_key(fp) { return Ok(()); }
    append(c, k, &list, members::Entry { kind: "add".into(), fp: fp.into(), id: id.into(), pk: pk.into(), role: "admin".into(), ..Default::default() }, save)
}
/// An organisation admin takes `fp` off (this Mac's own: it leaves). The last one stays.
pub fn remove(c: &Client, k: &mut Keys, fp: &str, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<(), String> {
    let list = fetch(c, k, save)?.list.ok_or("this server has no organisation yet")?;
    let kind = if fp == c.me() { "leave" } else { "remove" };
    append(c, k, &list, members::Entry { kind: kind.into(), fp: fp.into(), ..Default::default() }, save)
}
/// An organisation admin sets the server's SSO (docs/workspaces.md, SSO), or turns it off with `None`: an `sso` entry
/// signed by this Mac, which the server enforces at a join and every Mac checks like any other.
pub fn set_sso(c: &Client, k: &mut Keys, sso: Option<members::Sso>, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<(), String> {
    let list = fetch(c, k, save)?.list.ok_or("this server has no organisation yet")?;
    if list.sso == sso { return Ok(()); }
    let s = sso.unwrap_or_default();
    append(c, k, &list, members::Entry { kind: "sso".into(), issuer: s.issuer, client: s.client, domains: s.domains, required: s.required, ..Default::default() }, save)
}
/// The OIDC `nonce` a device asks its ID token with to join on `server`: bound to both certificates by a fresh `salt`,
/// so a token one device got never joins another, and the server recomputes it from the TLS session.
pub fn sso_nonce(server: &str, device: &str, salt: &str) -> String { crate::sync::sha256_hex(format!("relay-sso:{server}:{device}:{salt}").as_bytes()) }

/// This Mac's organisation keys, made where missing (saved before the server hears of them), and published.
pub fn publish(c: &Client, k: &mut Keys, save: &dyn Fn(&Keys) -> Result<(), String>) -> Result<String, String> {
    if k.ensure() { save(k)?; }
    let mut req = publication(k, &c.fp, &c.me());
    req["op"] = json!("org_pk");
    c.call(req)?;
    Ok(code(&k.identity(), &k.public()))
}

/// The keys of a workspace this Mac was added to as organisation admin: its organisation identity and X25519 key, and
/// epoch 0's key as it was sealed to that key on the `add` (later epochs come with the rounds, `keep_keys`).
pub fn adopt(c: &Client, vault: &str, org: &Keys) -> Result<Keys, String> {
    let v = c.call(json!({"op": "vault_info", "vault": vault}))?;
    let sealed = v["vault"]["keys"]["0"]["sealed"].as_str().ok_or("no key of this workspace was sealed to this Mac's organisation key")?;
    let raw = crate::vault::open_for(&org.secret.ok_or("no organisation keys on this Mac")?, sealed, vault, 0, &c.me())?;
    let key = crate::vault::VaultKey::from_hex(&hex(&raw)).ok_or("not a workspace key")?;
    let mut k = Keys::from(key);
    (k.secret, k.sign) = (org.secret, org.sign);
    Ok(k)
}
