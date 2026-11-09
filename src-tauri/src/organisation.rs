// A server's organisation from this Mac (docs/workspaces.md, Organisation): the Organisation section of a machine
// under Settings › Machines. This Mac's organisation keys per server are org-<server>.key in the app data, in a
// workspace key file's format: its identity, its X25519 key and the organisation list's pins (creator, head).
// Every change is an entry this Mac signs: on the organisation list, or on a workspace's member list.

use crate::shared_vaults::{load_key, save_key, valid_id};
use relay_remote::client::Client;
use relay_remote::org;
use relay_remote::vault::{Keys, VaultKey};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn key_path(data: &Path, server: &str) -> PathBuf { data.join(format!("org-{}.key", server.get(..16).unwrap_or(server))) }
/// This Mac's organisation keys for a server: its file, or new ones (saved by the first step that publishes them).
fn load(data: &Path, server: &str) -> Keys {
    std::fs::read_to_string(key_path(data, server)).ok().and_then(|k| Keys::parse(&k)).unwrap_or_else(|| { let mut k = Keys::from(VaultKey::generate()); k.ensure(); k })
}
fn saver(data: &Path, server: &str) -> impl Fn(&Keys) -> Result<(), String> {
    let p = key_path(data, server);
    move |k: &Keys| {
        use crate::platform::OpenOptionsExt;
        let tmp = p.with_extension("key.tmp");
        std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)
            .and_then(|mut f| std::io::Write::write_all(&mut f, k.format().as_bytes()).and_then(|_| f.sync_all()))
            .and_then(|_| std::fs::rename(&tmp, &p)).map_err(|e| e.to_string())
    }
}

/// The organisation admins made admins of workspace `vault` (this Mac an admin of it, its key here). Nothing when the
/// server has no organisation. How many changed.
pub fn add_admins(data: &Path, c: &Client, vault: &str) -> Result<usize, String> {
    let mut k = load(data, &c.fp);
    let o = org::fetch(c, &mut k, &saver(data, &c.fp))?;
    if o.list.is_none() { return Ok(0); }
    c.sealed(vault, load_key(data, vault)?).add_org(&o.admins(), &|k| save_key(data, vault, k))
}

type St<'a> = tauri::State<'a, crate::App>;
/// A machine's client and the app data folder, for a blocking step.
fn machine(app: &AppHandle, state: &St<'_>, id: &str) -> Result<(Client, PathBuf), String> {
    let m = crate::machines::Machines::find(&state.settings.lock().unwrap(), id).ok_or("no such machine")?;
    Ok((state.machines.client(&m), crate::data_dir(app)))
}
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The organisation of a machine's server as this Mac sees it: {exists, me (an organisation admin), owner (may start
/// it), code (of this Mac's keys, published for an admin to compare), admins: [fp]}.
#[tauri::command]
pub async fn org_status(app: AppHandle, state: St<'_>, machine: String) -> Result<Value, String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    blocking(move || {
        let (mut k, save) = (load(&data, &c.fp), saver(&data, &c.fp));
        let code = org::publish(&c, &mut k, &save)?;
        let o = org::fetch(&c, &mut k, &save)?;
        let sso = o.list.as_ref().and_then(|l| l.sso.clone());
        Ok(json!({"exists": o.list.is_some(), "me": o.me, "owner": o.owner, "code": code, "admins": o.admins().iter().map(|a| a.fp.clone()).collect::<Vec<_>>(), "sso": sso}))
    }).await
}
/// The owner starts the organisation, this Mac its first admin.
#[tauri::command]
pub async fn org_start(app: AppHandle, state: St<'_>, machine: String) -> Result<(), String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    blocking(move || org::start(&c, &mut load(&data, &c.fp), &saver(&data, &c.fp))).await
}

/// The overview (server's org_overview): every workspace with its people and roles, every person across them, the
/// admins, and the devices that may be added (with their keys' code, when they signed what they published). A
/// workspace this Mac is admin of through the organisation gets its keys here first (`org::adopt`), so offboarding can
/// sign its list. `here`: this Mac has the workspace's key.
#[tauri::command]
pub async fn org_overview(app: AppHandle, state: St<'_>, machine: String) -> Result<Value, String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    blocking(move || {
        let mut v = c.call(json!({"op": "org_overview"}))?;
        let k = load(&data, &c.fp);
        for w in v["workspaces"].as_array_mut().into_iter().flatten() {
            let id = w["id"].as_str().unwrap_or_default().to_string();
            if !valid_id(&id) { continue; }
            if w["admin"] == true && load_key(&data, &id).is_err() {
                if let Ok(adopted) = org::adopt(&c, &id, &k) { save_key(&data, &id, &adopted)?; }
            }
            w["here"] = json!(load_key(&data, &id).is_ok());
        }
        for cand in v["candidates"].as_array_mut().into_iter().flatten() {
            let fp = cand["fp"].as_str().unwrap_or_default().to_string();
            cand["code"] = json!(org::proven(&c.fp, &fp, cand).map(|(id, pk)| org::code(&id, &pk)));
        }
        Ok(v)
    }).await
}
/// An organisation admin adds the device `fp` with what it published, once the user compared its code.
#[tauri::command]
pub async fn org_add_admin(app: AppHandle, state: St<'_>, machine: String, fp: String, code: String) -> Result<(), String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    blocking(move || {
        let v = c.call(json!({"op": "org_overview"}))?;
        let cand = v["candidates"].as_array().into_iter().flatten().find(|x| x["fp"] == fp.as_str()).ok_or("that device has not published its organisation keys")?;
        let (id, pk) = org::proven(&c.fp, &fp, cand).ok_or("what that device published is not signed by it")?;
        // the code the user compared: the server swapping the keys meanwhile adds nobody
        if org::code(&id, &pk) != code { return Err("the device's keys changed since you compared the code".into()); }
        org::add(&c, &mut load(&data, &c.fp), &fp, &id, &pk, &saver(&data, &c.fp))
    }).await
}
/// An organisation admin sets the server's SSO (docs/workspaces.md, SSO), or turns it off with none: a signed entry on
/// the organisation list. Domains are taken lower case, without spaces, each once.
#[tauri::command]
pub async fn org_sso(app: AppHandle, state: St<'_>, machine: String, sso: Option<relay_remote::members::Sso>) -> Result<(), String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    let sso = sso.map(|mut s| {
        (s.issuer, s.client) = (s.issuer.trim().trim_end_matches('/').to_string(), s.client.trim().to_string());
        let mut d: Vec<String> = vec![];
        for x in s.domains.iter().map(|x| x.trim().trim_start_matches('@').to_lowercase()).filter(|x| !x.is_empty()) { if !d.contains(&x) { d.push(x); } }
        s.domains = d;
        s
    });
    blocking(move || org::set_sso(&c, &mut load(&data, &c.fp), sso, &saver(&data, &c.fp)).map_err(|e| e.replace("this change: an sso with the wrong fields", "the issuer must be an https address, with a client id and at least one domain"))).await
}
/// An organisation admin takes `fp` off the organisation (this Mac's own: it leaves).
#[tauri::command]
pub async fn org_remove_admin(app: AppHandle, state: St<'_>, machine: String, fp: String) -> Result<(), String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    blocking(move || org::remove(&c, &mut load(&data, &c.fp), &fp, &saver(&data, &c.fp))).await
}

/// Offboarding in one step (docs/workspaces.md, Organisation): the devices `fps` (one person's) off every workspace
/// this Mac is admin of, each a signed entry on its list, the key changed right after; then revoked on the server.
/// {removed: [workspace], skipped: [workspace this Mac is no admin of], failed: [{name, error}], revoked: n,
/// unrevoked: the server's refusal, null when it revoked them}. The server revokes only devices that came in through a
/// workspace: a fully paired one is still off the workspaces, and its refusal shows instead of the count.
#[tauri::command]
pub async fn org_offboard(app: AppHandle, state: St<'_>, machine: String, fps: Vec<String>) -> Result<Value, String> {
    let (c, data) = self::machine(&app, &state, &machine)?;
    if fps.is_empty() { return Err("no device to offboard".into()); }
    let a = app.clone();
    blocking(move || {
        let v = c.call(json!({"op": "org_overview"}))?;
        let k = load(&data, &c.fp);
        let (mut removed, mut skipped, mut failed) = (vec![], vec![], vec![]);
        for w in v["workspaces"].as_array().into_iter().flatten() {
            let (id, name) = (w["id"].as_str().unwrap_or_default().to_string(), w["name"].clone());
            if !valid_id(&id) || !w["members"].as_array().into_iter().flatten().any(|m| fps.iter().any(|f| m["fp"] == f.as_str())) { continue; }
            if w["admin"] != true { skipped.push(name); continue; }
            let res = a.state::<crate::App>().shared.with_vault(&id, || -> Result<(), String> {
                let key = match load_key(&data, &id) { Ok(k) => k, Err(_) => { let x = org::adopt(&c, &id, &k)?; save_key(&data, &id, &x)?; x } };
                let save = |k: &Keys| save_key(&data, &id, k);
                c.sealed(&id, key).remove_devices(&fps, &save)?;
                // the key changes now, not at this workspace's next admin round (when no Mac keeps it, there is none)
                c.sealed(&id, load_key(&data, &id)?).keep_keys(&save).map(|_| ())
            });
            match res { Ok(()) => removed.push(name), Err(e) => failed.push(json!({"name": name, "error": e})) }
        }
        let (revoked, unrevoked) = match c.call(json!({"op": "org_revoke", "fps": fps})) {
            Ok(v) => (v["revoked"].as_array().map_or(0, |r| r.len()), None),
            Err(e) => (0, Some(e)),
        };
        crate::shared_vaults::sync_now();
        Ok(json!({"removed": removed, "skipped": skipped, "failed": failed, "revoked": revoked, "unrevoked": unrevoked}))
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A policy names only providers Relay runs (agents.rs): the composer and the start check compare by these ids.
    #[test]
    fn a_policy_names_only_providers_relay_has() {
        let ids: Vec<&str> = crate::agents::PROVIDERS.iter().map(|p| p.id()).collect();
        assert!(relay_remote::members::POLICY_PROVIDERS.iter().all(|p| ids.contains(p)));
    }
    /// The organisation key file keeps the keys and the pins, 0600, per server.
    #[test]
    fn organisation_keys_are_kept_per_server() {
        let d = std::env::temp_dir().join(format!("relay-org-keys-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let (s1, s2) = ("1".repeat(64), "2".repeat(64));
        let mut k = load(&d, &s1);
        k.head = Some((2, "3".repeat(64)));
        saver(&d, &s1)(&k).unwrap();
        let back = load(&d, &s1);
        assert_eq!((back.identity(), back.head.clone()), (k.identity(), k.head.clone()));
        assert_ne!(load(&d, &s2).identity(), k.identity(), "another server, other keys");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(key_path(&d, &s1)).unwrap().permissions().mode() & 0o777, 0o600);
        std::fs::remove_dir_all(&d).ok();
    }
}
