//! The organisation of a server (docs/workspaces.md, Organisation): who its organisation admins are, as a signed list
//! (relay_remote::members, `check_org`) in `org.json` (0600). The owner (the first full device paired here) starts it,
//! an organisation admin adds or removes others. Each Mac checks the list itself and pins its creator: the server keeps
//! it, appends only what still checks, and can only hold back the newest entries, never write one.
//!
//! What an organisation admin may ask here besides: the overview (each workspace with what its member list already
//! says: people, devices, roles, never a record) and the revoke of a person's devices after an offboarding. Everything
//! that changes a workspace is an entry its Mac signed on that workspace's member list.

use crate::vaults::{self, Vaults};
use crate::{clients, now, write_private};
use relay_remote::members::{self, Entry, List};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

/// Held around every read-modify-write of org.json in this process.
static ORG: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize, serde::Deserialize, Default)]
/// `keys`: per full device, the organisation keys it published (`org_pk`) for an admin to add it, opaque here.
struct Org { #[serde(default)] log: Vec<Entry>, #[serde(default)] keys: BTreeMap<String, Value> }
fn save(data: &Path, o: &Org) -> Result<(), String> { write_private(&data.join("org.json"), &serde_json::to_string_pretty(o).unwrap()).map_err(|e| e.to_string()) }
fn load(data: &Path) -> Org { fs::read_to_string(data.join("org.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default() }

/// The organisation list as it stands, checked; none when there is none (or it no longer checks).
pub(crate) fn list(data: &Path, server: &str) -> Option<List> { members::check_org(server, &load(data).log, None).ok().map(|(l, _)| l) }
/// Whether `fp` is an organisation admin here.
pub(crate) fn is_admin(data: &Path, server: &str, fp: &str) -> bool { list(data, server).is_some_and(|l| l.members.contains_key(fp)) }
/// The owner: the first full device paired here (not one that only shares vaults, not a phone).
fn owner(data: &Path) -> Option<String> {
    clients(data).into_iter().filter(|c| c.parent.is_none() && !c.vaults_only).min_by_key(|c| c.added).map(|c| c.fp)
}

/// The list from entry `from` on, its length, and who the owner is (so a Mac knows whether it may start one).
pub fn log(data: &Path, fp: &str, from: u64) -> Value {
    let o = load(data);
    json!({"entries": o.log.get(from as usize..).unwrap_or_default(), "len": o.log.len(), "owner": owner(data).is_some_and(|f| f == fp)})
}

/// An entry `fp` signed, appended only when the whole list then still checks. `create` only by the owner on an empty
/// list, `add` only of a full device paired here.
pub fn append(data: &Path, server: &str, fp: &str, entry: &Value) -> Result<(), String> {
    let e: Entry = serde_json::from_value(entry.clone()).map_err(|_| "bad organisation list entry")?;
    if e.by != fp { return Err("an entry signed by someone else".into()); }
    let _o = ORG.lock().unwrap_or_else(|e| e.into_inner());
    let mut o = load(data);
    match e.kind.as_str() {
        "create" if !o.log.is_empty() => return Err("this server has an organisation already".into()),
        "create" if owner(data).as_deref() != Some(fp) => return Err("only the server's owner (the first device paired) starts its organisation".into()),
        "add" if !clients(data).iter().any(|c| c.fp == e.fp && c.parent.is_none() && !c.vaults_only) => return Err("an organisation admin is a device paired with this server".into()),
        _ => {}
    }
    o.log.push(e);
    members::check_org(server, &o.log, None)?;
    save(data, &o)
}
/// A full device publishes its organisation keys (relay_remote::org::publication), checked for shape only: the admin
/// who adds it checks the signature and compares the code with the device's own screen.
pub fn publish(data: &Path, fp: &str, p: &Value) -> Result<(), String> {
    let s = |f: &str| p[f].as_str().unwrap_or_default().to_string();
    if !vaults::hex(&s("id"), 64) || !vaults::hex(&s("pk"), 64) || !vaults::hex(&s("sig"), 128) { return Err("bad organisation key".into()); }
    let _o = ORG.lock().unwrap_or_else(|e| e.into_inner());
    let mut o = load(data);
    o.keys.insert(fp.into(), json!({"id": s("id"), "pk": s("pk"), "sig": s("sig")}));
    save(data, &o)
}

/// For an organisation admin: every workspace here with what its member list says (people, devices, roles), whether
/// every organisation admin is an admin of it (`managed`), and every person across them, grouped by a device or an
/// email they share. Nothing a record holds.
pub fn overview(v: &Vaults, server: &str, fp: &str) -> Result<Value, String> {
    let Some(org) = list(v.data(), server).filter(|l| l.members.contains_key(fp)) else { return Err("only an organisation admin sees this".into()) };
    let names: BTreeMap<String, String> = clients(v.data()).into_iter().map(|c| (c.fp, c.name)).collect();
    let mut spaces = vec![];
    // per device: the workspaces it is in, with role and person there
    let mut people = Groups::default();
    for w in vaults::all(v.data()) {
        let l = w.list();
        let role = |m: &str| match &l {
            Some(l) if l.admin(m) => "admin", Some(l) if l.reader(m) => "reader", Some(l) if l.members.contains_key(m) => "member",
            _ => w.members.iter().find(|x| x.fp == m).map_or("", |x| x.role.as_str()),
        };
        let members: Vec<Value> = w.members.iter().map(|m| {
            let person = l.as_ref().map_or("", |l| l.person(&m.fp));
            json!({"fp": m.fp, "name": names.get(&m.fp).unwrap_or(&m.name), "role": role(&m.fp), "person": person, "listed": l.as_ref().is_some_and(|l| l.members.contains_key(&m.fp))})
        }).collect();
        let persons = l.as_ref().map(|l| l.persons()).unwrap_or_default();
        for m in &w.members {
            let p = persons.iter().find(|p| p.devices.contains(&m.fp));
            let (who, name, email) = p.map_or((String::new(), String::new(), String::new()), |p| (p.who.clone(), p.name.clone(), p.email.clone()));
            // an email joins people only when an admin set it, or when this device's SSO login here proved it: one a
            // device signed for itself is its own word, anyone could claim another's address
            let sso = m.sso.as_ref().and_then(|s| s["email"].as_str()).is_some_and(|e| e.eq_ignore_ascii_case(&email));
            let verified = !email.is_empty() && (sso || l.as_ref().is_some_and(|l| !l.self_named.contains(&who)));
            people.add(&m.fp, names.get(&m.fp).unwrap_or(&m.name), &name, &email, verified, json!({"id": w.id, "name": w.name, "role": role(&m.fp), "who": who}));
        }
        let managed = l.as_ref().is_some_and(|l| org.members.keys().all(|a| l.admin(a)));
        spaces.push(json!({"id": w.id, "name": w.name, "list": l.is_some(), "managed": managed, "admin": l.as_ref().is_some_and(|l| l.admin(fp)),
            "nohistory": l.as_ref().is_some_and(|l| l.nohistory), "members": members, "people": persons}));
    }
    let admins: Vec<Value> = org.members.keys().map(|a| json!({"fp": a, "name": names.get(a).cloned().unwrap_or_default()})).collect();
    // full devices that published organisation keys and are not on the list: who an admin may add
    let published = load(v.data()).keys;
    let candidates: Vec<Value> = clients(v.data()).into_iter().filter(|c| c.parent.is_none() && !c.vaults_only && !org.members.contains_key(&c.fp))
        .filter_map(|c| published.get(&c.fp).map(|k| json!({"fp": c.fp, "name": c.name, "id": k["id"], "pk": k["pk"], "sig": k["sig"]}))).collect();
    Ok(json!({"workspaces": spaces, "people": people.out(), "admins": admins, "candidates": candidates}))
}

/// People across workspaces: devices joined when one person holds both in some workspace (the persons of each list),
/// or when two persons share a verified email (`verified`: set by an admin or proven by SSO). A device under no person
/// stays one of its own, an unverified email shows marked and joins nobody.
#[derive(Default)]
struct Groups { devices: Vec<Dev> }
/// A device with its person's name and email (the first list that names it, a verified email before one that is not),
/// and the workspaces it is in.
struct Dev { fp: String, device: String, name: String, email: String, verified: bool, ws: Vec<Value> }
impl Groups {
    fn add(&mut self, fp: &str, device: &str, name: &str, email: &str, verified: bool, ws: Value) {
        match self.devices.iter_mut().find(|d| d.fp == fp) {
            Some(d) => {
                if d.name.is_empty() || (verified && !d.verified) { (d.name, d.email, d.verified) = (name.into(), email.into(), verified); }
                d.ws.push(ws);
            }
            None => self.devices.push(Dev { fp: fp.into(), device: device.into(), name: name.into(), email: email.into(), verified, ws: vec![ws] }),
        }
    }
    fn out(&self) -> Vec<Value> {
        // union-find over devices: same person id in one workspace, or the same email
        let n = self.devices.len();
        let mut up: Vec<usize> = (0..n).collect();
        fn root(up: &mut [usize], i: usize) -> usize { let mut i = i; while up[i] != i { up[i] = up[up[i]]; i = up[i]; } i }
        let key = |d: &Dev| -> Vec<String> {
            let mut k: Vec<String> = d.ws.iter().filter(|w| w["who"] != "").map(|w| format!("{}:{}", w["id"].as_str().unwrap_or(""), w["who"].as_str().unwrap_or(""))).collect();
            if d.verified { k.push(format!("@{}", d.email.to_lowercase())); }
            k
        };
        for i in 0..n { for j in 0..i {
            let (ki, kj) = (key(&self.devices[i]), key(&self.devices[j]));
            if ki.iter().any(|k| kj.contains(k)) { let (a, b) = (root(&mut up, i), root(&mut up, j)); up[a] = b; }
        } }
        let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for i in 0..n { let r = root(&mut up, i); groups.entry(r).or_default().push(i); }
        let mut out: Vec<Value> = groups.values().map(|ix| {
            let named = ix.iter().map(|i| &self.devices[*i]).find(|d| !d.name.is_empty());
            let mut ws: Vec<Value> = vec![];
            for i in ix { for w in &self.devices[*i].ws {
                // one row per workspace: the highest role of the person's devices there
                let rank = |r: &Value| match r.as_str() { Some("admin") => 3, Some("member") => 2, Some("reader") => 1, _ => 0 };
                match ws.iter_mut().find(|x| x["id"] == w["id"]) {
                    Some(x) => if rank(&w["role"]) > rank(&x["role"]) { x["role"] = w["role"].clone(); },
                    None => ws.push(json!({"id": w["id"], "name": w["name"], "role": w["role"]})),
                }
            } }
            json!({"name": named.map_or(self.devices[ix[0]].device.clone(), |d| d.name.clone()), "email": named.map_or(String::new(), |d| d.email.clone()),
                "unverified": named.is_some_and(|d| !d.email.is_empty() && !d.verified),
                "devices": ix.iter().map(|i| json!({"fp": self.devices[*i].fp, "name": self.devices[*i].device})).collect::<Vec<_>>(), "workspaces": ws})
        }).collect();
        out.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
        out
    }
}

/// An organisation admin revokes devices after an offboarding: they cannot connect any more, with the devices linked to
/// them (crate::revoke). Never an organisation admin (take it off the organisation list first). The devices revoked.
pub fn revoke(data: &Path, server: &str, fp: &str, fps: &[String]) -> Result<Value, String> {
    let Some(org) = list(data, server).filter(|l| l.members.contains_key(fp)) else { return Err("only an organisation admin revokes devices".into()) };
    if fps.iter().any(|f| !vaults::hex(f, 64)) { return Err("a device is its full fingerprint".into()); }
    if fps.iter().any(|f| org.members.contains_key(f)) { return Err("an organisation admin: take it off the organisation first".into()); }
    let mut gone = vec![];
    for f in fps { for c in crate::revoke(data, f).map_err(|e| e.to_string())? { gone.push(json!({"fp": c.fp, "name": c.name})); } }
    eprintln!("relay-server: an organisation admin revoked {} device(s) at {}", gone.len(), now());
    Ok(json!({"revoked": gone}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{save_clients, Client};
    use relay_remote::members::{org_name, sign};
    use relay_remote::tls::hex;
    use ring::signature::KeyPair;

    const SERVER: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    struct Dev { fp: String, seed: [u8; 32] }
    impl Dev {
        fn new(c: char) -> Dev { Dev { fp: c.to_string().repeat(64), seed: [c as u8; 32] } }
        fn id(&self) -> String { hex(ring::signature::Ed25519KeyPair::from_seed_unchecked(&self.seed).unwrap().public_key().as_ref()) }
        fn entry(&self, data: &Path, e: Entry) -> Value {
            let l = members::check_org(SERVER, &load(data).log, None).map(|(l, _)| l).unwrap_or_default();
            serde_json::to_value(sign(&org_name(SERVER), &l, &self.fp, &self.seed, e)).unwrap()
        }
    }
    fn dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("relay-org-{tag}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn client(fp: &str, added: u64, vaults_only: bool) -> Client { Client { name: format!("dev-{}", &fp[..1]), fp: fp.into(), added, parent: None, vaults_only } }

    #[test]
    fn only_the_owner_starts_it_and_only_paired_devices_are_added() {
        let d = dir("start");
        let (a, b, c) = (Dev::new('a'), Dev::new('b'), Dev::new('e'));
        // a vault-only device paired first is no owner: the first full device is
        save_clients(&d, &[client(&c.fp, 1, true), client(&b.fp, 3, false), client(&a.fp, 2, false)]).unwrap();
        let create = |dev: &Dev| dev.entry(&d, Entry { kind: "create".into(), fp: dev.fp.clone(), id: dev.id(), pk: "1".repeat(64), role: "admin".into(), mac: relay_remote::sync::sha256_hex(org_name(SERVER).as_bytes()), ..Default::default() });
        assert!(append(&d, SERVER, &b.fp, &create(&b)).unwrap_err().contains("owner"));
        assert!(append(&d, SERVER, &c.fp, &create(&c)).unwrap_err().contains("owner"));
        assert!(append(&d, SERVER, &b.fp, &create(&a)).unwrap_err().contains("signed by someone else"));
        assert_eq!(log(&d, &a.fp, 0)["owner"], true);
        append(&d, SERVER, &a.fp, &create(&a)).unwrap();
        assert!(append(&d, SERVER, &a.fp, &create(&a)).unwrap_err().contains("already"));
        let add = |dev: &Dev| a.entry(&d, Entry { kind: "add".into(), fp: dev.fp.clone(), id: dev.id(), pk: "2".repeat(64), role: "admin".into(), ..Default::default() });
        // a vault-only device, or one not paired here
        assert!(append(&d, SERVER, &a.fp, &add(&c)).unwrap_err().contains("paired"));
        assert!(append(&d, SERVER, &a.fp, &add(&Dev::new('f'))).unwrap_err().contains("paired"));
        append(&d, SERVER, &a.fp, &add(&b)).unwrap();
        assert!(is_admin(&d, SERVER, &b.fp) && !is_admin(&d, SERVER, &c.fp));
        // what does not check stays out: an entry by who is not on it
        let x = c.entry(&d, Entry { kind: "remove".into(), fp: a.fp.clone(), ..Default::default() });
        assert!(append(&d, SERVER, &c.fp, &x).unwrap_err().contains("no member"));
        assert_eq!(log(&d, &b.fp, 1)["entries"].as_array().unwrap().len(), 1);
        assert_eq!(log(&d, &b.fp, 0)["owner"], false);
        // a device publishes its keys: a candidate for the admins until it is on the list
        assert!(publish(&d, &c.fp, &json!({"id": "x", "pk": "2".repeat(64), "sig": "3".repeat(128)})).is_err());
        let f = Dev::new('f');
        save_clients(&d, &[clients(&d), vec![client(&f.fp, 9, false)]].concat()).unwrap();
        publish(&d, &f.fp, &json!({"id": f.id(), "pk": "2".repeat(64), "sig": "3".repeat(128)})).unwrap();
        publish(&d, &b.fp, &json!({"id": b.id(), "pk": "2".repeat(64), "sig": "3".repeat(128)})).unwrap();
        let cands = overview(&Vaults::new(&d, SERVER), SERVER, &a.fp).unwrap()["candidates"].clone();
        assert_eq!(cands.as_array().unwrap().iter().map(|c| c["fp"].as_str().unwrap()).collect::<Vec<_>>(), [f.fp.as_str()], "not one on the list");
        // the overview and a revoke: an organisation admin only, and never of one
        let v = Vaults::new(&d, SERVER);
        assert!(overview(&v, SERVER, &c.fp).is_err() && overview(&v, SERVER, &b.fp).is_ok());
        assert!(revoke(&d, SERVER, &c.fp, &[b.fp.clone()]).is_err());
        assert!(revoke(&d, SERVER, &b.fp, &[a.fp.clone()]).unwrap_err().contains("organisation admin"));
        assert_eq!(revoke(&d, SERVER, &b.fp, &[c.fp.clone()]).unwrap()["revoked"].as_array().unwrap().len(), 1);
        assert!(!clients(&d).iter().any(|x| x.fp == c.fp));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn people_across_workspaces_are_grouped_by_device_and_email() {
        let mut g = Groups::default();
        let w = |id: &str, role: &str, who: &str| json!({"id": id, "name": id, "role": role, "who": who});
        // Ann: laptop and phone under one person in A, the laptop alone in B; Bo by email in two lists; a lone device
        g.add("l", "laptop", "Ann", "", false, w("A", "member", "p1"));
        g.add("p", "phone", "Ann", "", false, w("A", "reader", "p1"));
        g.add("l", "laptop", "", "", false, w("B", "admin", ""));
        g.add("x", "bo-mac", "Bo", "bo@example.com", true, w("A", "member", "p2"));
        g.add("y", "bo-pc", "Bo B.", "Bo@Example.com", true, w("B", "member", "p9"));
        g.add("z", "kiosk", "", "", false, w("B", "reader", ""));
        // a device that names itself with Bo's address: its own row, marked, not one of Bo's
        g.add("m", "other-mac", "Mallory", "bo@example.com", false, w("C", "member", "p7"));
        let out = g.out();
        let row = |n: &str| out.iter().find(|p| p["name"] == n).unwrap().clone();
        assert_eq!(out.len(), 4, "{out:?}");
        assert_eq!((row("Mallory")["devices"].as_array().unwrap().len(), row("Mallory")["unverified"].clone()), (1, json!(true)));
        assert_eq!(row("Bo")["unverified"], false);
        assert_eq!(row("Ann")["devices"].as_array().unwrap().len(), 2);
        assert_eq!(row("Ann")["workspaces"], json!([{"id": "A", "name": "A", "role": "member"}, {"id": "B", "name": "B", "role": "admin"}]));
        assert_eq!(row("Bo")["devices"].as_array().unwrap().len(), 2);
        assert_eq!(row("kiosk")["devices"][0]["fp"], "z");
    }
}
