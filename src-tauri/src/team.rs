// Team servers (docs/workspaces.md, Teams): a server a team trusts, with accounts. This Mac logs in to one with an
// invite link or the organisation's provider (sso.rs), and its certificate becomes a session of that account there.
// The settings keep each team server (`teams`: host, port, fp, email, admin, name, the organisation's name as the server
// last said it, "" none); only this module writes that list,
// set_settings keeps what is there. A team workspace is a shared vault (shared_vaults.rs) with `team` set: its key
// comes from the server, its rounds, documents and fence are a shared vault's.

use crate::shared_vaults::{self, Shared};
use relay_remote::client::Client;
use relay_remote::team::Link;
use relay_remote::vault::{Keys, VaultKey};
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Manager};

type St<'a> = tauri::State<'a, crate::App>;

/// The team ops Settings may ask through `team_call`: every other one has a command of its own.
const PASSED: [&str; 7] = ["team_name", "team_invite", "team_invite_revoke", "team_member", "team_overview", "team_account", "team_sso"];

/// The team servers in the settings.
pub fn list(s: &Value) -> Vec<Value> { s["teams"].as_array().cloned().unwrap_or_default() }
fn find(s: &Value, fp: &str) -> Result<Link, String> {
    let t = list(s).into_iter().find(|t| t["fp"] == fp).ok_or("not logged in to that team server")?;
    Ok(Link { host: t["host"].as_str().unwrap_or("").into(), port: t["port"].as_u64().unwrap_or(0) as u16, fp: fp.into(), invite: None })
}
fn client(l: &Link, state: &crate::App) -> Client { Client::new(&l.host, l.port, &l.fp, state.machines.id.clone()) }
/// A call to team server `fp`, off the async worker.
async fn call(state: &St<'_>, fp: &str, req: Value) -> Result<Value, String> {
    let c = client(&find(&state.settings.lock().unwrap(), fp)?, state);
    tauri::async_runtime::spawn_blocking(move || c.call(req)).await.map_err(|e| e.to_string())?
}
/// The team servers changed and saved under the settings lock.
fn change(app: &AppHandle, state: &crate::App, f: impl FnOnce(&mut Vec<Value>)) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    let mut all = list(&s);
    f(&mut all);
    let mut next = s.clone();
    next["teams"] = Value::Array(all);
    crate::save_settings(app, &next)?;
    *s = next;
    Ok(())
}

/// Log in to the team server of `link`: with the invite in it, or else in the browser with the server's provider.
/// The server is kept in the settings. {email, admin}.
#[tauri::command]
pub async fn team_login(app: AppHandle, state: St<'_>, link: String) -> Result<Value, String> {
    let l = Link::parse(&link).ok_or("not a team server's link")?;
    let (c, me, name) = (client(&l, &state), state.machines.id.fingerprint(), crate::sys_name());
    let l2 = l.clone();
    let who = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let req = match &l2.invite {
            Some((id, code)) => json!({"op": "team_login", "invite": id, "proof": relay_remote::tls::proof(code, &me, &l2.fp), "name": name}),
            None => {
                let info = c.call(json!({"op": "team_info"}))?;
                let sso = serde_json::from_value(info["sso"].clone()).map_err(|_| "this team server takes invite links only: ask an admin for one")?;
                let (token, salt) = crate::sso::sign_in(&l2, &me, &sso)?;
                json!({"op": "team_login", "id_token": token, "salt": salt, "name": name})
            }
        };
        c.call(req)
    }).await.map_err(|e| e.to_string())??;
    change(&app, &state, |all| {
        all.retain(|t| t["fp"] != l.fp.as_str());
        all.push(json!({"host": l.host, "port": l.port, "fp": l.fp, "email": who["email"], "admin": who["admin"], "name": who["name"].as_str().unwrap_or("")}));
    })?;
    Ok(who)
}

/// Who this Mac is on team server `fp` and its workspaces there, each with `here` (its folder on this Mac, or null).
#[tauri::command]
pub async fn team_me(app: AppHandle, state: St<'_>, fp: String) -> Result<Value, String> {
    let mut me = call(&state, &fp, json!({"op": "team_me"})).await?;
    let here = shared_vaults::list(&state.settings.lock().unwrap());
    for w in me["workspaces"].as_array_mut().into_iter().flatten() {
        let v = here.iter().find(|v| w["id"] == v.id.as_str()).map(|v| v.folder.clone());
        w.as_object_mut().map(|o| o.remove("key"));
        w["here"] = json!(v);
    }
    // an organisation admin made or unmade meanwhile, the organisation renamed (an older server sends no name)
    let (admin, name) = (me["admin"].clone(), me["name"].as_str().unwrap_or("").to_string());
    change(&app, &state, |all| for t in all.iter_mut().filter(|t| t["fp"] == fp.as_str()) { t["admin"] = admin.clone(); t["name"] = json!(name); })?;
    Ok(me)
}

/// Sync team workspace `id` of server `fp` into `folder` (empty): its key from the server, then the usual rounds.
#[tauri::command]
pub async fn team_open(app: AppHandle, state: St<'_>, fp: String, id: String, folder: String) -> Result<(), String> {
    if shared_vaults::find(&state.settings.lock().unwrap(), &id).is_ok() { return Err("this Mac syncs that workspace already".into()); }
    let me = call(&state, &fp, json!({"op": "team_me"})).await?;
    let w = me["workspaces"].as_array().into_iter().flatten().find(|w| w["id"] == id.as_str()).cloned().ok_or("not a workspace of this account")?;
    let folder = shared_vaults::new_folder(&app, &state, &folder, true)?;
    let _adding = crate::policy::may_add_vault(&app)?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    // `.claude -> System` as in a vault Relay makes, before the first round: the rules load from the synced System/
    crate::platform::dir_link("System", Path::new(&folder).join(".claude")).ok();
    open(&app, &state, &fp, &w, folder)
}

/// A new team workspace on server `fp` from `folder`: an empty one starts as Relay's team starter, one with notes is
/// uploaded as it is. `nohistory`: without history, for good.
#[tauri::command]
pub async fn team_create(app: AppHandle, state: St<'_>, fp: String, name: String, folder: String, nohistory: bool) -> Result<(), String> {
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(60).collect();
    if name.is_empty() { return Err("give the workspace a name".into()); }
    let folder = shared_vaults::new_folder(&app, &state, &folder, false)?;
    let _adding = crate::policy::may_add_vault(&app)?;
    let template = app.path().resolve("default-vault", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let overlay = app.path().resolve("team-vault", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let at = folder.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let empty = !std::fs::read_dir(&at).is_ok_and(|mut d| d.any(|e| e.is_ok_and(|e| e.file_name() != ".DS_Store")));
        if empty {
            crate::vault::create_team(&template, &overlay, Path::new(&at))?;
            // without history: the starter asks for no member's name in what it keeps
            if nohistory { crate::vault::without_names(Path::new(&at))?; }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())??;
    let w = call(&state, &fp, json!({"op": "team_create", "name": name, "nohistory": nohistory})).await?;
    open(&app, &state, &fp, &w, folder)
}

/// A team workspace `w` ({id, name, role, nohistory, key}) into the settings with its key: its rounds start.
fn open(app: &AppHandle, state: &crate::App, fp: &str, w: &Value, folder: String) -> Result<(), String> {
    let s = |k: &str| w[k].as_str().unwrap_or_default().to_string();
    let id = s("id");
    if !shared_vaults::valid_id(&id) { return Err(format!("not a workspace id: {id:?}")); }
    let key = VaultKey::from_hex(&s("key")).ok_or("the server sent no key for this workspace")?;
    let mut k = Keys::from(key);
    k.ensure();
    shared_vaults::save_key(&crate::data_dir(app), &id, &k)?;
    let l = find(&state.settings.lock().unwrap(), fp)?;
    let v = Shared { id, name: s("name"), host: l.host, port: l.port, fp: l.fp, folder, role: s("role"), team: true, nohistory: w["nohistory"] == true };
    shared_vaults::add(app, state, &v)
}

/// What the server of team link `link` says before this Mac logs in: the organisation's name ("" none) and its sign-in.
#[tauri::command]
pub async fn team_peek(state: St<'_>, link: String) -> Result<Value, String> {
    let c = client(&Link::parse(&link).ok_or("not a team server's link")?, &state);
    tauri::async_runtime::spawn_blocking(move || c.call(json!({"op": "team_info"}))).await.map_err(|e| e.to_string())?
}

/// One of the admin ops (PASSED) on team server `fp`: an invite comes back with its `link`, a new name is kept here.
#[tauri::command]
pub async fn team_call(app: AppHandle, state: St<'_>, fp: String, req: Value) -> Result<Value, String> {
    let op = req["op"].as_str().unwrap_or_default();
    if !PASSED.contains(&op) { return Err(format!("{op:?} is not asked from Settings")); }
    let mut out = call(&state, &fp, req.clone()).await?;
    if let (Some(i), Some(c)) = (out["invite"].as_str(), out["code"].as_str()) {
        let l = Link { invite: Some((i.into(), c.into())), ..find(&state.settings.lock().unwrap(), &fp)? };
        out["link"] = json!(l.format());
    }
    // a role changed: the rounds take it at once
    if op == "team_member" { shared_vaults::sync_now(); }
    if op == "team_name" {
        let name = out["name"].clone();
        change(&app, &state, |all| for t in all.iter_mut().filter(|t| t["fp"] == fp.as_str()) { t["name"] = name.clone(); })?;
    }
    Ok(out)
}

/// The link that names team server `fp`, without an invite: who has an account there logs in with it and the provider.
#[tauri::command]
pub fn team_link(state: St<'_>, fp: String) -> Result<String, String> { Ok(find(&state.settings.lock().unwrap(), &fp)?.format()) }

/// Log out of team server `fp`: the session ends there, its workspaces stop syncing here (their folders stay).
#[tauri::command]
pub async fn team_logout(app: AppHandle, state: St<'_>, fp: String) -> Result<(), String> {
    // a server out of reach or that ended the session already: the Mac lets go all the same
    call(&state, &fp, json!({"op": "team_logout"})).await.ok();
    let gone: Vec<String> = shared_vaults::list(&state.settings.lock().unwrap()).into_iter().filter(|v| v.team && v.fp == fp).map(|v| v.id).collect();
    for id in gone { shared_vaults::forget_here(&app, &state, &id).await?; }
    change(&app, &state, |all| all.retain(|t| t["fp"] != fp.as_str()))
}

/// A team workspace's leave: the server takes this account out of it.
pub fn leave(c: &Client, v: &Shared) -> Result<(), String> { c.call(json!({"op": "team_member", "vault": v.id, "role": ""})).map(|_| ()) }
