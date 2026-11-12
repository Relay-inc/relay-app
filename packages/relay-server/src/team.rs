//! The team role (docs/workspaces.md, Teams): a server a team trusts, with accounts. A server is a team server once
//! `relay-server team <email>` made `team.json` in its data folder, and stays one: the role is set when it is set up.
//!
//! An account is an email address. A device logs in to one with an invite link an admin made for it, or with an ID
//! token of the organisation's provider (oidc.rs). Its certificate then stays the transport identity, and the device a
//! session of that account: a vault-only client here, like a device that joined a shared vault. Turning an account
//! off ends all its sessions.
//!
//! The workspaces are the server's shared vaults (vaults.rs), without a member list: the server is the source of who is
//! in them. It keeps each one's key and gives it to a member (`team_me`), so the records, the sync and the documents
//! are the same as a shared vault's. Each workspace's members in vault.json follow from the accounts here (`apply`):
//! every session of an account that is a member, with its role. A reader's writes are refused (vaults.rs `writing`).
//!
//! Plain data in one file, `team.json` (0600), in the data folder, so `deploy/relay-server/backup.sh` covers it.

use crate::vaults::{hex, Vaults};
use crate::{clients, device_name, now, save_clients, write_private, Client, CLIENTS};
use relay_remote::team::Sso;
use relay_remote::tls;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

/// How long an invite link works, and how many wrong proofs drop it.
const INVITE_SECS: u64 = 7 * 24 * 3600;
const INVITE_TRIES: u32 = 5;
/// The roles in a workspace.
const ROLES: [&str; 3] = ["admin", "member", "reader"];
/// What a device with an account may ask besides a shared vault's ops (lib.rs VAULT_OPS).
pub const OPS: &[&str] = &["team_me", "team_name", "team_create", "team_invite", "team_invite_revoke", "team_member", "team_overview", "team_account", "team_sso", "team_logout"];
/// What a device without a session may ask a team server.
pub const OPEN_OPS: &[&str] = &["team_info", "team_login"];
/// The end-to-end ops of shared vaults on a personal server: a team server answers none of them.
pub const NOT_HERE: &[&str] = &["pair", "pair_device", "vault_create", "vault_invite", "vault_invite_revoke", "vault_join", "vault_remove", "vault_pk", "vault_rotate", "vault_append"];

/// `name`: the organisation's name every Mac shows ("" none: they show the host). `sso`: the provider a device may log
/// in with (none: invite links only).
#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct Team { #[serde(default, skip_serializing_if = "String::is_empty")] pub name: String, #[serde(default)] pub sso: Option<Sso>, #[serde(default)] pub accounts: Vec<Account>, #[serde(default)] pub sessions: Vec<Session>,
    #[serde(default)] pub invites: Vec<Invite>, #[serde(default)] pub workspaces: BTreeMap<String, Space> }
/// `admin`: an organisation admin, who sees and manages every workspace and account here. `off`: turned off. `oid`:
/// the Entra user its first Entra login came from: a sign-in name moved to another user does not log in to it.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Account { pub email: String, #[serde(default)] pub admin: bool, #[serde(default)] pub off: bool, pub added: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")] pub oid: String }
/// A device logged in to an account.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Session { pub fp: String, pub email: String, pub added: u64 }
/// An invite link for one device of `email`: `code` is proven with `tls::proof`, one use.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Invite { pub id: String, code: String, pub email: String, pub expires: u64, #[serde(default)] fails: u32 }
/// A workspace: its key (hex, the server keeps it), without history or not (set when made, for good), and its members
/// by email with their role.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Space { key: String, #[serde(default)] pub nohistory: bool, pub members: BTreeMap<String, String> }

/// Held around every read-modify-write of team.json.
static TEAM: Mutex<()> = Mutex::new(());
pub fn is_team(data: &Path) -> bool { data.join("team.json").is_file() }
pub fn load(data: &Path) -> Team {
    let mut t: Team = std::fs::read_to_string(data.join("team.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let n = now();
    t.invites.retain(|i| i.expires > n && i.fails < INVITE_TRIES);
    t
}
fn save(data: &Path, t: &Team) -> Result<(), String> { write_private(&data.join("team.json"), &serde_json::to_string_pretty(t).unwrap()).map_err(|e| e.to_string()) }
/// For the handshake: a device without a session gets in while it could log in (a provider set, or an invite open).
pub fn open(data: &Path) -> bool { is_team(data) && { let t = load(data); t.sso.is_some() || !t.invites.is_empty() } }

/// The most characters an organisation's name has.
const NAME_MAX: usize = 60;
/// Characters that change how text around them shows without showing themselves: bidi controls (which can turn a
/// name around), zero-width ones and the BOM (which can make two names look the same). A name has none of them.
fn invisible(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}' | '\u{061C}' | '\u{180E}')
}
/// An organisation's name as it is kept: trimmed, one line of visible text, at most NAME_MAX characters. "" takes the
/// name away. Every Mac shows it, so nothing in it may hide or reorder what it says.
fn org_name(s: &str) -> Result<String, String> {
    let n = s.trim();
    if n.chars().any(|c| c.is_control() || invisible(c)) { return Err("a name is one line of visible text".into()); }
    if n.chars().count() > NAME_MAX { return Err(format!("a name has at most {NAME_MAX} characters")); }
    Ok(n.into())
}

/// An address as accounts keep it: trimmed, lower case, one `@`, no spaces.
fn email(s: &str) -> Result<String, String> {
    let e = s.trim().to_lowercase();
    let ok = e.len() <= 254 && e.split('@').count() == 2 && !e.starts_with('@') && !e.ends_with('@') && !e.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok { Ok(e) } else { Err(format!("not an email address: {s:?}")) }
}
impl Team {
    fn account(&self, email: &str) -> Option<&Account> { self.accounts.iter().find(|a| a.email == email) }
    /// The account behind device `fp`, when it is on.
    fn who(&self, fp: &str) -> Result<Account, String> {
        let s = self.sessions.iter().find(|s| s.fp == fp).ok_or("not logged in to this team server")?;
        self.account(&s.email).filter(|a| !a.off).cloned().ok_or_else(|| "this account is turned off".into())
    }
    fn ensure(&mut self, email: &str) {
        if self.account(email).is_none() { self.accounts.push(Account { email: email.into(), admin: false, off: false, added: now(), oid: String::new() }); }
    }
    fn invite(&mut self, email: &str) -> Value {
        let i = Invite { id: tls::random_secret()[..16].into(), code: tls::random_key(), email: email.into(), expires: now() + INVITE_SECS, fails: 0 };
        let out = json!({"invite": i.id, "code": i.code, "email": i.email, "expires": i.expires});
        self.invites.push(i);
        out
    }
    /// Whether `a` manages workspace `id`: an organisation admin, or an admin of it.
    fn manages(&self, a: &Account, id: &str) -> bool { a.admin || self.workspaces.get(id).is_some_and(|w| w.members.get(&a.email).is_some_and(|r| r == "admin")) }
}

/// `relay-server team <email> [--name <name>]`: makes this a team server (on a data folder without paired devices), with
/// `email` an organisation admin, and opens an invite link for one of its devices. `name` names the organisation (again:
/// renames it, none keeps the name). Returns the invite.
pub fn init(data: &Path, owner: &str, name: Option<&str>) -> Result<Value, String> {
    let owner = email(owner)?;
    let name = name.map(org_name).transpose()?;
    let _t = TEAM.lock().unwrap_or_else(|e| e.into_inner());
    if !is_team(data) && clients(data).iter().any(|c| !c.vaults_only) { return Err("this server has paired devices: a team server starts on a data folder of its own".into()); }
    if !is_team(data) && !crate::vaults::all(data).is_empty() { return Err("this server has shared vaults: a team server starts on a data folder of its own".into()); }
    let mut t = load(data);
    if let Some(n) = name { t.name = n; }
    t.ensure(&owner);
    t.accounts.iter_mut().filter(|a| a.email == owner).for_each(|a| { a.admin = true; a.off = false; });
    let out = t.invite(&owner);
    save(data, &t)?;
    Ok(out)
}

/// One team op from device `fp` (OPS, OPEN_OPS). `server`: this server's fingerprint, which a proof and a nonce bind.
pub fn op(vaults: &Vaults, server: &str, fp: &str, op: &str, req: &Value) -> Result<Value, String> {
    let data = vaults.data();
    let s = |k: &str| req[k].as_str().unwrap_or("");
    // the name too, so a Mac that pastes an invite says whose it is before it logs in
    if op == "team_info" { let t = load(data); return Ok(json!({"team": true, "name": t.name, "sso": t.sso})); }
    let _t = TEAM.lock().unwrap_or_else(|e| e.into_inner());
    let mut t = load(data);
    if op == "team_login" { return login(vaults, &mut t, server, fp, req); }
    let me = t.who(fp)?;
    let out = match op {
        "team_me" => {
            let names: BTreeMap<String, String> = crate::vaults::all(data).into_iter().map(|v| (v.id, v.name)).collect();
            let ws: Vec<Value> = t.workspaces.iter().filter_map(|(id, w)| {
                let role = w.members.get(&me.email)?;
                Some(json!({"id": id, "name": names.get(id)?, "role": role, "nohistory": w.nohistory, "key": w.key}))
            }).collect();
            return Ok(json!({"email": me.email, "admin": me.admin, "name": t.name, "workspaces": ws}));
        }
        // the organisation's name, set or changed ("" takes it away) by an organisation admin. Every Mac gets it with
        // its next team_me
        "team_name" => {
            if !me.admin { return Err("only an organisation admin names the organisation".into()); }
            t.name = org_name(s("name"))?;
            json!({"name": t.name})
        }
        "team_create" => {
            let made = vaults.create(fp, &me.email, s("name"))?;
            let id = made["vault"]["id"].as_str().unwrap_or_default().to_string();
            let key = tls::random_key();
            t.workspaces.insert(id.clone(), Space { key: key.clone(), nohistory: req["nohistory"] == true, members: BTreeMap::from([(me.email.clone(), "admin".into())]) });
            json!({"id": id, "name": made["vault"]["name"], "key": key, "nohistory": req["nohistory"] == true, "role": "admin"})
        }
        // an account (made when there is none) and a link for one of its devices; with `vault` and `role` also a
        // member there. An organisation admin may invite anyone, also as organisation admin. A workspace admin only
        // into that workspace, and gets a link only for an account it made now: one that is there already logs in on
        // its own devices, a link would let the admin in as that person
        "team_invite" => {
            let who = email(s("email"))?;
            let (vault, role) = (s("vault"), s("role"));
            if vault.is_empty() && !me.admin { return Err("only an organisation admin invites without a workspace".into()); }
            if !vault.is_empty() {
                if !t.workspaces.contains_key(vault) || !t.manages(&me, vault) { return Err("only an admin of this workspace invites to it".into()); }
                if !ROLES.contains(&role) { return Err("role is admin, member or reader".into()); }
            }
            let new = t.account(&who).is_none();
            t.ensure(&who);
            if req["admin"] == true {
                if !me.admin { return Err("only an organisation admin makes one".into()); }
                t.accounts.iter_mut().filter(|a| a.email == who).for_each(|a| a.admin = true);
            }
            if let Some(w) = t.workspaces.get_mut(vault) { w.members.insert(who.clone(), role.into()); }
            if me.admin || new { t.invite(&who) } else { json!({"email": who, "added": true}) }
        }
        "team_invite_revoke" => {
            if !me.admin { return Err("only an organisation admin withdraws an invite".into()); }
            t.invites.retain(|i| i.id != s("invite"));
            json!({})
        }
        // `role` "" takes `email` out: a workspace's admin, an organisation admin, or the member itself (leaving, no
        // `email` is the caller's own)
        "team_member" => {
            let who = if s("email").is_empty() { me.email.clone() } else { email(s("email"))? };
            let (vault, role) = (s("vault"), s("role"));
            let w = t.workspaces.get(vault).ok_or("no such vault")?;
            let leaving = who == me.email && role.is_empty();
            if !leaving && !t.manages(&me, vault) { return Err("only an admin of this workspace changes its members".into()); }
            if !role.is_empty() && !ROLES.contains(&role) { return Err("role is admin, member or reader".into()); }
            if !role.is_empty() && t.account(&who).is_none() { return Err("no account for that address: invite it first".into()); }
            let mut members = w.members.clone();
            if role.is_empty() { members.remove(&who); } else { members.insert(who, role.into()); }
            if !members.is_empty() && !members.values().any(|r| r == "admin") { return Err("that would leave the workspace without an admin".into()); }
            t.workspaces.get_mut(vault).unwrap().members = members;
            json!({})
        }
        "team_overview" => {
            if !me.admin { return Err("only an organisation admin sees the whole server".into()); }
            let names: BTreeMap<String, String> = crate::vaults::all(data).into_iter().map(|v| (v.id, v.name)).collect();
            let accounts: Vec<Value> = t.accounts.iter().map(|a| json!({"email": a.email, "admin": a.admin, "off": a.off,
                "devices": t.sessions.iter().filter(|s| s.email == a.email).count()})).collect();
            let ws: Vec<Value> = t.workspaces.iter().map(|(id, w)| json!({"id": id, "name": names.get(id), "nohistory": w.nohistory, "members": w.members})).collect();
            let invites: Vec<Value> = t.invites.iter().map(|i| json!({"id": i.id, "email": i.email, "expires": i.expires})).collect();
            return Ok(json!({"accounts": accounts, "workspaces": ws, "invites": invites, "sso": t.sso}));
        }
        // an organisation admin turns an account off or on, or makes it an organisation admin or not. Never the last
        // organisation admin out
        "team_account" => {
            if !me.admin { return Err("only an organisation admin changes an account".into()); }
            let who = email(s("email"))?;
            let a = t.accounts.iter_mut().find(|a| a.email == who).ok_or("no such account")?;
            if let Some(on) = req["admin"].as_bool() { a.admin = on; }
            if let Some(off) = req["off"].as_bool() { a.off = off; }
            if !t.accounts.iter().any(|a| a.admin && !a.off) { return Err("that would leave the server without an organisation admin".into()); }
            if req["off"] == true { drop_sessions(vaults, &mut t, |s| s.email == who)?; }
            json!({})
        }
        "team_sso" => {
            if !me.admin { return Err("only an organisation admin sets the sign-in".into()); }
            t.sso = if req["sso"].is_null() { None } else {
                let sso: Sso = serde_json::from_value(req["sso"].clone()).map_err(|e| e.to_string())?;
                if !sso.valid() { return Err("sign-in: an https issuer, a client id, and for Google the email domains".into()); }
                Some(sso)
            };
            json!({})
        }
        "team_logout" => { drop_sessions(vaults, &mut t, |s| s.fp == fp)?; json!({}) }
        _ => return Err(format!("unknown request {op:?}")),
    };
    save(data, &t)?;
    apply(vaults, &t)?;
    Ok(out)
}

/// A device logs in: with an invite (`invite`, `proof` of its code over both certificates) or an ID token (`id_token`,
/// `salt`, checked against the provider set here). The account must be there and on. The device becomes a session of
/// it, and a vault-only client here.
fn login(vaults: &Vaults, t: &mut Team, server: &str, fp: &str, req: &Value) -> Result<Value, String> {
    let data = vaults.data();
    let who = if let Some(id) = req["invite"].as_str() {
        if !hex(id, 16) { return Err("bad invite".into()); }
        let i = t.invites.iter().position(|i| i.id == id).ok_or("this invite is used, expired or withdrawn")?;
        if !tls::verify_proof(&t.invites[i].code, fp, server, req["proof"].as_str().unwrap_or("")) {
            t.invites[i].fails += 1;
            save(data, t).ok();
            return Err("wrong invite code".into());
        }
        t.invites.remove(i).email
    } else {
        let sso = t.sso.clone().ok_or("this server takes invite links only")?;
        let signed = crate::oidc::check(&sso, server, fp, req["id_token"].as_str().unwrap_or(""), req["salt"].as_str().unwrap_or(""))?;
        // Entra: the sign-in name is the address, the user is `oid`, bound to the account at its first Entra login
        if !signed.oid.is_empty() {
            let a = t.accounts.iter_mut().find(|a| a.email == signed.email).ok_or_else(|| format!("{} has no account on this server: ask an admin to invite you", signed.email))?;
            if a.oid.is_empty() { a.oid = signed.oid.clone(); }
            if a.oid != signed.oid { return Err("this sign-in name belongs to another Microsoft account now: ask an admin".into()); }
        }
        signed.email
    };
    let a = t.account(&who).cloned().ok_or_else(|| format!("{who} has no account on this server: ask an admin to invite you"))?;
    if a.off { save(data, t).ok(); return Err("this account is turned off".into()); }
    {
        let _c = CLIENTS.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = clients(data);
        if !list.iter().any(|c| c.fp == fp) {
            let name = device_name(&list, req["name"].as_str().unwrap_or(""), fp);
            list.push(Client { name, fp: fp.into(), added: now(), parent: None, vaults_only: true });
            save_clients(data, &list).map_err(|e| e.to_string())?;
        }
    }
    t.sessions.retain(|s| s.fp != fp);
    t.sessions.push(Session { fp: fp.into(), email: who.clone(), added: now() });
    save(data, t)?;
    apply(vaults, t)?;
    Ok(json!({"email": who, "admin": a.admin, "name": t.name}))
}

/// The sessions `gone` says, out: their devices unpaired here and out of every workspace.
fn drop_sessions(vaults: &Vaults, t: &mut Team, gone: impl Fn(&Session) -> bool) -> Result<(), String> {
    let fps: Vec<String> = t.sessions.iter().filter(|s| gone(s)).map(|s| s.fp.clone()).collect();
    t.sessions.retain(|s| !fps.contains(&s.fp));
    let _c = CLIENTS.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = clients(vaults.data());
    list.retain(|c| !fps.contains(&c.fp));
    save_clients(vaults.data(), &list).map_err(|e| e.to_string())
}

/// Every workspace's members in vault.json as `t` says: each session (of a device still paired) of an account that
/// is on and a member, with its role, named by its email. Who is out loses its open stream now.
pub fn apply(vaults: &Vaults, t: &Team) -> Result<(), String> {
    let paired: Vec<String> = clients(vaults.data()).into_iter().map(|c| c.fp).collect();
    for (id, w) in &t.workspaces {
        let list: Vec<(String, String, String)> = t.sessions.iter().filter(|s| paired.contains(&s.fp))
            .filter_map(|s| { let role = w.members.get(&s.email)?; t.account(&s.email).filter(|a| !a.off)?; Some((s.fp.clone(), s.email.clone(), role.clone())) }).collect();
        for fp in vaults.set_members(id, &list)? { vaults.rooms.kick(id, &fp); }
    }
    Ok(())
}

/// What `vault_info` adds for a team workspace: `team`, `nohistory`, `docs` (always on), the members by email with
/// their role (`accounts`), and no key epoch (there is no member list to check).
pub fn annotate(data: &Path, v: &mut Value) {
    let Some(w) = v["id"].as_str().and_then(|id| load(data).workspaces.get(id).cloned()) else { return };
    if let Some(o) = v.as_object_mut() { o.remove("epoch"); o.remove("keys"); }
    v["team"] = json!(true);
    v["docs"] = json!(true);
    v["nohistory"] = json!(w.nohistory);
    v["accounts"] = json!(w.members.iter().map(|(e, r)| json!({"email": e, "role": r})).collect::<Vec<_>>());
    // without history: no device list, so nothing here ties a device (the author of a document's update) to an account
    if w.nohistory { v["members"] = json!([]); }
}

/// Whether device `fp` is an organisation admin here: it keeps the server (lib.rs KEEPER_OPS).
pub fn keeps(data: &Path, fp: &str) -> bool { load(data).who(fp).is_ok_and(|a| a.admin) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oidc::tests::{entra, entra_claims, sso, Idp, TENANT};
    const SERVER: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    /// A login with the provider: the token must be for this device, its address must have an account that is on, and
    /// an Entra login binds the account to the user it came from.
    #[test]
    fn a_login_with_the_provider_takes_an_account_that_is_there_and_on() {
        let d = std::env::temp_dir().join(format!("relay-team-sso-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        let v = Vaults::new(&d, SERVER);
        init(&d, "owner@example.com", None).unwrap();
        let (dev, salt) = ("b".repeat(64), "5".repeat(64));
        let login = |issuer: &Idp, email: &str, edit: &dyn Fn(&mut Value)| {
            let token = issuer.token(email, &relay_remote::team::sso_nonce(SERVER, &dev, &salt), now(), edit);
            op(&v, SERVER, &dev, "team_login", &json!({"id_token": token, "salt": salt}))
        };
        let set = |sso: Sso, f: &dyn Fn(&mut Team)| { let mut t = load(&d); t.sso = Some(sso); f(&mut t); save(&d, &t).unwrap(); };
        let google = Idp::new("https://idp.team.test");
        google.publish();
        // no provider set: invite links only
        assert!(login(&google, "ann@example.com", &|_| {}).unwrap_err().contains("invite links only"));
        set(sso(&google.issuer), &|_| {});
        assert!(login(&google, "ann@example.com", &|_| {}).unwrap_err().contains("no account"));
        set(sso(&google.issuer), &|t| t.ensure("ann@example.com"));
        assert_eq!(login(&google, "Ann@Example.com", &|_| {}).unwrap()["email"], "ann@example.com");
        assert!(clients(&d).iter().any(|c| c.fp == dev && c.vaults_only), "a session is a vault-only device");
        set(sso(&google.issuer), &|t| t.accounts.iter_mut().filter(|a| a.email == "ann@example.com").for_each(|a| a.off = true));
        assert!(login(&google, "ann@example.com", &|_| {}).unwrap_err().contains("turned off"));
        // Entra: the sign-in name is the address, the first login binds the account to its user
        let ms = Idp::new(&entra(TENANT));
        ms.publish();
        set(Sso { issuer: ms.issuer.clone(), client: crate::oidc::tests::CLIENT.into(), domains: vec![] }, &|t| t.ensure("ann@example.com"));
        set(Sso { issuer: ms.issuer.clone(), client: crate::oidc::tests::CLIENT.into(), domains: vec![] }, &|t| t.accounts.iter_mut().for_each(|a| a.off = false));
        assert!(login(&ms, "", &|c| entra_claims(c, TENANT)).is_ok());
        let other = |c: &mut Value| { entra_claims(c, TENANT); c["oid"] = json!("ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee"); };
        assert!(login(&ms, "", &other).unwrap_err().contains("another Microsoft account"));
        std::fs::remove_dir_all(&d).ok();
    }
    /// The organisation's name: set by `relay-server team --name`, changed by an organisation admin and by nobody else,
    /// given to every account with team_me and to a device before it logs in with team_info. A team.json from before
    /// the name loads without one.
    #[test]
    fn an_organisation_admin_names_the_organisation_and_a_member_cannot() {
        let d = std::env::temp_dir().join(format!("relay-team-name-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        // a team.json written before there was a name
        std::fs::write(d.join("team.json"), r#"{"accounts":[{"email":"owner@example.com","admin":true,"added":1}],"sessions":[],"invites":[],"workspaces":{}}"#).unwrap();
        assert_eq!(load(&d).name, "");
        assert_eq!(load(&d).accounts.len(), 1, "the rest still loads");
        init(&d, "owner@example.com", Some("  Bluebird Studio ")).unwrap();
        assert_eq!(load(&d).name, "Bluebird Studio");
        init(&d, "owner@example.com", None).unwrap();
        assert_eq!(load(&d).name, "Bluebird Studio", "again without --name keeps it");
        assert!(init(&d, "owner@example.com", Some("two\nlines")).is_err());
        // bidi controls, zero-width characters and the BOM: refused, by --name and by team_name
        for bad in ["Blue\u{202E}oiduts", "Blue\u{2066}bird", "Blue\u{200B}bird", "\u{FEFF}Bluebird", "Blue\u{200D}bird"] {
            assert!(init(&d, "owner@example.com", Some(bad)).is_err(), "{bad:?}");
        }
        assert_eq!(load(&d).name, "Bluebird Studio");
        let v = Vaults::new(&d, SERVER);
        let (admin, member) = ("a".repeat(64), "b".repeat(64));
        let mut t = load(&d);
        t.ensure("ann@example.com");
        t.sessions = vec![Session { fp: admin.clone(), email: "owner@example.com".into(), added: 1 }, Session { fp: member.clone(), email: "ann@example.com".into(), added: 1 }];
        save(&d, &t).unwrap();
        let name = |fp: &str, n: &str| op(&v, SERVER, fp, "team_name", &json!({"name": n}));
        assert!(name(&member, "Ann's").unwrap_err().contains("only an organisation admin"));
        assert_eq!(name(&admin, " Northwind ").unwrap()["name"], "Northwind");
        assert_eq!(op(&v, SERVER, &member, "team_me", &json!({})).unwrap()["name"], "Northwind", "a member gets it");
        assert_eq!(op(&v, SERVER, "", "team_info", &json!({})).unwrap()["name"], "Northwind");
        assert!(name(&admin, &"x".repeat(NAME_MAX + 1)).is_err());
        assert!(name(&admin, "North\u{202E}dniw").is_err());
        assert_eq!(name(&admin, &"é".repeat(NAME_MAX)).unwrap()["name"].as_str().unwrap().chars().count(), NAME_MAX, "characters, not bytes");
        name(&admin, "Northwind").unwrap();
        assert_eq!(load(&d).name, "Northwind", "a refused name changes nothing");
        name(&admin, "").unwrap();
        assert!(!std::fs::read_to_string(d.join("team.json")).unwrap().contains("\"name\""), "no name: not written");
        std::fs::remove_dir_all(&d).ok();
    }
    #[test]
    fn an_email_is_one_address_in_lower_case() {
        assert_eq!(email(" Ann@Example.com ").unwrap(), "ann@example.com");
        for bad in ["ann", "@example.com", "ann@", "a b@example.com", "a@b@c"] { assert!(email(bad).is_err(), "{bad}"); }
    }
}
