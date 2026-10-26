// Shared vaults on a relay-server (docs/shared-vaults.md): a vault several people share, synced both ways into a plain
// folder here. The server keeps only ciphertext; the vault key is shared-<id>.key in the app data and never goes there.
// The folder is one of the extra vaults (lib.rs `extra_vaults`), so a conversation in it stays in it (lib.rs `fence`).
// The settings keep the list (`sharedVaults`); only this module writes it, set_settings keeps what is there.

use relay_remote::client::Client;
use relay_remote::sync::{self, Filter, Guard, Manifest, Mode, Walker};
use relay_remote::tls::Identity;
use relay_remote::vault::VaultKey;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// A shared vault as the settings keep it: the server it lives on (pinned by its fingerprint), its folder here and this
/// device's role there ("admin" or "member").
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Shared { pub id: String, pub name: String, pub host: String, pub port: u16, pub fp: String, pub folder: String, #[serde(default)] pub role: String }

/// The shared vaults in the settings; an entry that does not read, or whose id is not one, is left out.
pub fn list(s: &Value) -> Vec<Shared> {
    s["sharedVaults"].as_array().into_iter().flatten().filter_map(|v| serde_json::from_value::<Shared>(v.clone()).ok()).filter(|v| valid_id(&v.id)).collect()
}
/// A vault id as the server makes them: 16 lowercase hex. It names files here (the key, the base), so nothing else
/// a server answers ever reaches a path.
pub fn valid_id(id: &str) -> bool { id.len() == 16 && id.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) }
pub fn find(s: &Value, id: &str) -> Result<Shared, String> { list(s).into_iter().find(|v| v.id == id).ok_or_else(|| format!("no shared vault {id}")) }

/// What the last round of a vault did, for Settings: counts since the app started, the conflict copies made, and the
/// deletes held for the user (sync::Guard). `bad`: blobs there that did not open with the key (left alone).
#[derive(Default, Clone, serde::Serialize)]
pub struct Status { pub at: i64, pub pushed: usize, pub pulled: usize, pub conflicts: Vec<String>, pub errors: Vec<String>, pub held: Vec<String>, pub bad: usize }

#[derive(Default)]
pub struct Hub { walkers: Mutex<HashMap<String, Walker>>, pub status: Mutex<HashMap<String, Status>>, busy: Mutex<HashSet<String>>, allow: Mutex<HashMap<String, Vec<String>>> }

/// Run the rounds now, without waiting for the interval: a vault was just made or joined.
static NOW: AtomicBool = AtomicBool::new(false);
pub fn sync_now() { NOW.store(true, Ordering::Relaxed); }
/// Taken by the loop in lib.rs: whether a round was asked for since it last looked.
pub fn asked() -> bool { NOW.swap(false, Ordering::Relaxed) }

fn key_path(data: &Path, id: &str) -> PathBuf { data.join(format!("shared-{id}.key")) }
pub fn save_key(data: &Path, id: &str, key: &VaultKey) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(key_path(data, id))
        .and_then(|mut f| std::io::Write::write_all(&mut f, key.to_hex().as_bytes())).map_err(|e| e.to_string())
}
pub fn load_key(data: &Path, id: &str) -> Result<VaultKey, String> {
    std::fs::read_to_string(key_path(data, id)).ok().and_then(|k| VaultKey::from_hex(k.trim())).ok_or_else(|| format!("the key of shared vault {id} is missing on this Mac"))
}
/// Where a round keeps what it deletes or mostly empties here: <data>/shared-trash/<id>/<round's minute>/<path>.
fn trash(data: &Path, id: &str) -> PathBuf { data.join("shared-trash").join(id) }
const TRASH_DAYS: i64 = 30;
fn base_path(data: &Path, id: &str) -> PathBuf { data.join("shared-base").join(format!("{id}.json")) }

/// The server of a vault, reached with this Mac's own certificate.
pub fn client(v: &Shared, me: &Identity) -> Client { Client::new(&v.host, v.port, &v.fp, me.clone()) }

/// What a shared vault syncs. Claude Code runs what lies in a project's config folder (settings, hooks, and the
/// scripts, skills and agents those point at) as plain code, so a member's file there would run on every other
/// member's Mac, outside the fence. Of that folder only what the agent reads as notes goes: rules, reference, index,
/// archive and reminders. `.claude` itself never goes (a link to System/ would send every file twice, and drift on a
/// Mac where it is a real folder). The config folder is System/ as in a vault Relay makes, and where `.claude` links to
/// when that is another folder in the vault; System/ also before the link resolves, on a join's first round. No round
/// follows a symlink: one the user made in the folder would otherwise take a member's writes out of it.
pub fn filter(folder: &Path) -> Filter {
    let mut f = Filter::vault_default();
    f.names.push(".claude".into());
    f.no_links = true;
    let target = std::fs::read_link(folder.join(".claude")).ok().and_then(|t| {
        let full = if t.is_absolute() { t } else { folder.join(t) };
        let (real, root) = (std::fs::canonicalize(full).ok()?, std::fs::canonicalize(folder).ok()?);
        real.strip_prefix(&root).ok().map(|r| r.to_string_lossy().into_owned())
    });
    f.guarded = std::iter::once("System".to_string()).chain(target.filter(|t| !t.is_empty())).collect();
    f.only = f.guarded.iter().flat_map(|g| ["rules", "reference", "index", "archive", "reminders.md"].map(|x| format!("{g}/{x}"))).collect();
    f
}

/// A folder by its real path, also one that does not exist yet: the nearest folder that does, resolved (links, `..`),
/// with the rest put back. A rest with `.` or `..` is refused, it could climb out of the folder checked.
pub fn real_path(p: &str) -> Result<String, String> {
    let path = Path::new(p.trim());
    if !path.is_absolute() { return Err("pick a folder for the vault".into()); }
    let (mut at, mut rest) = (path, vec![]);
    loop {
        if let Ok(mut real) = std::fs::canonicalize(at) {
            for r in rest.iter().rev() { real.push(r); }
            return Ok(real.to_string_lossy().into_owned());
        }
        rest.push(at.file_name().ok_or_else(|| format!("{p}: use a folder path without . or .."))?.to_os_string());
        at = at.parent().ok_or("pick a folder for the vault")?;
    }
}

/// A folder a vault may be made or joined in: empty or not there yet (joining), and not inside another vault or
/// holding one, so the fence around one never covers the other.
pub fn check_folder(folder: &str, others: &[String], must_be_empty: bool) -> Result<(), String> {
    if folder.is_empty() || !folder.starts_with('/') { return Err("pick a folder for the vault".into()); }
    if let Some(o) = others.iter().find(|o| crate::nested(folder, o)) { return Err(format!("{folder} lies inside {o} or holds it: pick a folder of its own")); }
    let full = std::fs::read_dir(folder).is_ok_and(|mut d| d.any(|e| e.is_ok_and(|e| e.file_name() != ".DS_Store")));
    if must_be_empty && full { return Err(format!("{folder} is not empty: a joined vault starts in an empty folder")); }
    Ok(())
}

impl Hub {
    /// One round for a vault: the folder here against the server, both ways. A file changed on both sides keeps both,
    /// the server's as "Name (conflict <this Mac> <date>).md"; more deletes than the brake allows wait for the user.
    pub fn round(&self, data: &Path, v: &Shared, me: &Identity, name: &str) -> Status {
        if !self.busy.lock().unwrap().insert(v.id.clone()) { return self.status.lock().unwrap().get(&v.id).cloned().unwrap_or_default(); }
        let mut st = Status { at: chrono::Utc::now().timestamp(), ..Default::default() };
        // the walkers' lock before the key and the base are read: a leave (forget) either comes first, and the key is
        // gone, or waits until this round's base is written, and removes it after
        let mut walkers = self.walkers.lock().unwrap();
        match load_key(data, &v.id) {
            Err(e) => st.errors.push(e),
            Ok(key) => {
                let stamp = chrono::Local::now().format("%Y-%m-%d %H%M").to_string();
                let cutoff = (chrono::Local::now() - chrono::Duration::days(TRASH_DAYS)).format("%Y-%m-%d").to_string();
                for e in std::fs::read_dir(trash(data, &v.id)).into_iter().flatten().flatten() {
                    if e.file_name().to_string_lossy().as_ref() < cutoff.as_str() { std::fs::remove_dir_all(e.path()).ok(); }
                }
                std::fs::create_dir_all(&v.folder).ok();
                let base: Manifest = std::fs::read_to_string(base_path(data, &v.id)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
                let allowed = self.allow.lock().unwrap().remove(&v.id).unwrap_or_default();
                let copy = |p: &str| sync::conflict_copy(p, name, &stamp);
                let to = trash(data, &v.id).join(&stamp);
                let keep = |p: &str, d: &[u8]| sync::write_atomic(&to.join(p), d, None);
                let guard = Guard { allow_deletes: false, allowed: &allowed, keep: &keep };
                let remote = client(v, me).sealed(&v.id, key);
                let w = walkers.entry(v.id.clone()).or_default();
                let (next, r) = sync::run(Mode::TwoWay, Path::new(&v.folder), &base, w, &filter(Path::new(&v.folder)), &remote, &copy, &|_| false, &guard, &|_, _| {});
                let p = base_path(data, &v.id);
                if let Some(d) = p.parent() { std::fs::create_dir_all(d).ok(); }
                std::fs::write(p, serde_json::to_string(&next).unwrap_or_default()).ok();
                st.pushed = r.pushed.len() + r.deleted_remote.len();
                st.pulled = r.pulled.len() + r.deleted_local.len();
                st.conflicts = r.conflicts;
                st.errors = r.errors;
                st.held = r.held;
                st.bad = remote.bad().len();
            }
        }
        drop(walkers);
        self.busy.lock().unwrap().remove(&v.id);
        let mut all = self.status.lock().unwrap();
        let prev = all.remove(&v.id).unwrap_or_default();
        let mut conflicts = prev.conflicts;
        for c in st.conflicts.drain(..) { if !conflicts.contains(&c) { conflicts.push(c); } }
        let st = Status { pushed: prev.pushed + st.pushed, pulled: prev.pulled + st.pulled, conflicts, ..st };
        all.insert(v.id.clone(), st.clone());
        st
    }

    /// The held deletes the user saw go through in the next round; any others the brake still holds. Another member
    /// can delete more meanwhile, so it is the list shown, not "everything held next time".
    pub fn allow_deletes(&self, id: &str, seen: Vec<String>) { self.allow.lock().unwrap().insert(id.into(), seen); }
    /// The held deletes the user saw are undone instead: out of the base, so the next round copies each file back from
    /// the side that still has it.
    pub fn restore_held(&self, data: &Path, id: &str, seen: &[String]) {
        let held: Vec<String> = { let mut all = self.status.lock().unwrap(); let Some(s) = all.get_mut(id) else { return }; s.held.retain(|h| !seen.contains(h)); seen.to_vec() };
        // under the walkers' lock, as a round writes the base: a round running now would overwrite the restore, a leave
        // would see it write a base back after removing it
        let _walkers = self.walkers.lock().unwrap();
        let p = base_path(data, id);
        let Some(mut base) = std::fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str::<Manifest>(&s).ok()) else { return };
        for h in &held { base.remove(h); }
        std::fs::write(p, serde_json::to_string(&base).unwrap_or_default()).ok();
    }
    /// This Mac leaves a vault: its key, base, trash and status go; the folder stays as it is.
    pub fn forget(&self, data: &Path, id: &str) {
        // the walkers' lock first: a round still running writes its base under it, so the base goes after that round
        let mut walkers = self.walkers.lock().unwrap();
        walkers.remove(id);
        std::fs::remove_file(key_path(data, id)).ok();
        std::fs::remove_file(base_path(data, id)).ok();
        std::fs::remove_dir_all(trash(data, id)).ok();
        self.status.lock().unwrap().remove(id);
        self.allow.lock().unwrap().remove(id);
    }
}

// ---------- commands for Settings › General › Shared vaults

type St<'a> = tauri::State<'a, crate::App>;

/// The folders a new vault must stay clear of: the main vault and the other extra ones.
fn taken(s: &Value) -> Vec<String> {
    std::iter::once(s["vault"].as_str().unwrap_or("").to_string()).filter(|v| !v.is_empty()).chain(crate::extra_vaults(s)).collect()
}
/// A vault added to the settings (or replaced, by id), saved and told to both windows; its first round runs at once.
fn add(app: &tauri::AppHandle, state: &crate::App, v: &Shared) -> Result<(), String> {
    let s = {
        let mut s = state.settings.lock().unwrap();
        let mut all: Vec<Value> = s["sharedVaults"].as_array().cloned().unwrap_or_default();
        all.retain(|x| x["id"] != v.id.as_str());
        all.push(serde_json::to_value(v).map_err(|e| e.to_string())?);
        s["sharedVaults"] = Value::Array(all);
        s.clone()
    };
    crate::save_settings(app, &s)?;
    sync_now();
    Ok(())
}

/// An invite link that opened Relay (lib.rs on_open_url), until Settings takes it: a settings window that is only
/// starting would miss the event.
static INVITE: Mutex<Option<String>> = Mutex::new(None);
pub fn invite_opened(link: String) { *INVITE.lock().unwrap() = Some(link); }
#[tauri::command]
pub fn shared_vault_pending_invite() -> Option<String> { INVITE.lock().unwrap().take() }

/// The shared vaults' last rounds: {id: Status}.
#[tauri::command]
pub fn shared_vaults_status(state: St) -> Value { serde_json::to_value(&*state.shared.status.lock().unwrap()).unwrap_or_default() }

/// Make a shared vault on a paired machine: the server keeps it, this Mac makes the key. A folder that is not there
/// or empty starts as Relay's starter vault; one with notes is uploaded as it is. Returns {id, recovery}: the key as
/// hex, shown once to keep somewhere safe (without it and without a member's Mac the vault cannot be read).
#[tauri::command]
pub async fn shared_vault_create(app: tauri::AppHandle, state: St<'_>, machine: String, name: String, folder: String) -> Result<Value, String> {
    use tauri::Manager;
    let s = state.settings.lock().unwrap().clone();
    let m = crate::machines::Machines::find(&s, &machine).ok_or("pick a paired machine for the vault")?;
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(60).collect();
    if name.is_empty() { return Err("give the vault a name".into()); }
    let folder = real_path(&folder)?;
    check_folder(&folder, &taken(&s), false)?;
    let template = app.path().resolve("default-vault", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let (c, at) = (state.machines.client(&m), folder.clone());
    let made = tauri::async_runtime::spawn_blocking(move || -> Result<(relay_remote::client::VaultRef, VaultKey), String> {
        // the folder first: a vault that could not get its notes is not made on the server at all
        if !Path::new(&folder).join("System/rules/core/work-state.md").is_file() && check_folder(&folder, &[], true).is_ok() {
            crate::vault::create_default(&template, Path::new(&folder))?;
        }
        Ok((c.vault_create(&name)?, VaultKey::generate()))
    }).await.map_err(|e| e.to_string())??;
    let (r, key) = made;
    if !valid_id(&r.id) { return Err(format!("the server answered an invalid vault id {:?}", r.id)); }
    let data = crate::data_dir(&app);
    save_key(&data, &r.id, &key)?;
    let v = Shared { id: r.id.clone(), name: r.name, host: m["host"].as_str().unwrap_or("").into(), port: m["port"].as_u64().unwrap_or(0) as u16,
        fp: m["fp"].as_str().unwrap_or("").into(), folder: at, role: "admin".into() };
    add(&app, &state, &v)?;
    Ok(serde_json::json!({"id": r.id, "recovery": key.to_hex()}))
}

/// Join a shared vault with an invite link: this Mac pairs with the server as a vault-only device (when it is not
/// paired yet), gets the key out of the link and syncs the vault into `folder`, which must be empty.
#[tauri::command]
pub async fn shared_vault_join(app: tauri::AppHandle, state: St<'_>, link: String, folder: String) -> Result<Value, String> {
    let s = state.settings.lock().unwrap().clone();
    let folder = real_path(&folder)?;
    check_folder(&folder, &taken(&s), true)?;
    // a vault this Mac is in already: joining again would wipe its key, base and trash below and leave its folder unsynced
    if let Some(had) = relay_remote::proto::PairLine::parse(&link).and_then(|l| l.vault).and_then(|id| find(&s, &id.to_ascii_lowercase()).ok()) {
        return Err(format!("this Mac is in {} already, at {}", had.name, had.folder));
    }
    let (me, name) = (state.machines.id.clone(), crate::sys_name());
    let (line, joined, key) = tauri::async_runtime::spawn_blocking(move || relay_remote::client::vault_join(&link, &me, &name)).await.map_err(|e| e.to_string())??;
    if !valid_id(&joined.id) { return Err(format!("not a vault id: {:?}", joined.id)); }
    // a vault this Mac had before: its old base would make the new, empty folder look like a mass delete
    let (a, vid) = (app.clone(), joined.id.clone());
    tauri::async_runtime::spawn_blocking(move || tauri::Manager::state::<crate::App>(&a).shared.forget(&crate::data_dir(&a), &vid)).await.map_err(|e| e.to_string())?;
    save_key(&crate::data_dir(&app), &joined.id, &key)?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    // `.claude -> System` as in a vault Relay makes, before the first round: the rules and skills load from the synced
    // System/, and filter() keeps whatever settings or hooks are on the server out of it from the start
    std::os::unix::fs::symlink("System", Path::new(&folder).join(".claude")).ok();
    let v = Shared { id: joined.id.clone(), name: joined.name.clone(), host: line.host, port: line.port, fp: line.fp, folder, role: joined.role };
    add(&app, &state, &v)?;
    Ok(serde_json::json!({"id": joined.id, "name": joined.name}))
}

/// An invite link for a vault (admins): single use, 24 h. {link, invite: {id, role, expires}}.
#[tauri::command]
pub async fn shared_vault_invite(app: tauri::AppHandle, state: St<'_>, id: String, role: String) -> Result<Value, String> {
    let v = find(&state.settings.lock().unwrap(), &id)?;
    let (c, key) = (client(&v, &state.machines.id), load_key(&crate::data_dir(&app), &id)?);
    let role = if role == "admin" { "admin" } else { "member" };
    let (link, invite) = tauri::async_runtime::spawn_blocking(move || c.vault_invite(&v.id, role, &key, &v.host, v.port)).await.map_err(|e| e.to_string())??;
    Ok(serde_json::json!({"link": link, "invite": invite}))
}

/// The members and open invites of a vault, and this Mac's fingerprint so the list can mark it: {vault, me}.
#[tauri::command]
pub async fn shared_vault_info(state: St<'_>, id: String) -> Result<Value, String> {
    let v = find(&state.settings.lock().unwrap(), &id)?;
    let (c, me) = (client(&v, &state.machines.id), state.machines.id.fingerprint());
    let info = tauri::async_runtime::spawn_blocking(move || c.vault_info(&v.id)).await.map_err(|e| e.to_string())??;
    Ok(serde_json::json!({"vault": info, "me": me}))
}

/// Withdraw an invite that was not used yet (admins).
#[tauri::command]
pub async fn shared_vault_invite_revoke(state: St<'_>, id: String, invite: String) -> Result<(), String> {
    let v = find(&state.settings.lock().unwrap(), &id)?;
    let c = client(&v, &state.machines.id);
    tauri::async_runtime::spawn_blocking(move || c.vault_invite_revoke(&v.id, &invite)).await.map_err(|e| e.to_string())?
}

/// Remove a member (admins), or leave the vault when `fp` is this Mac's: then the vault goes from the settings, with
/// its key and sync state; the folder stays as it is.
#[tauri::command]
pub async fn shared_vault_remove(app: tauri::AppHandle, state: St<'_>, id: String, fp: String) -> Result<(), String> {
    let v = find(&state.settings.lock().unwrap(), &id)?;
    let (c, me) = (client(&v, &state.machines.id), state.machines.id.fingerprint());
    let (vid, who) = (v.id.clone(), fp.clone());
    tauri::async_runtime::spawn_blocking(move || c.vault_remove(&vid, &who)).await.map_err(|e| e.to_string())??;
    if fp != me { return Ok(()); }
    // forget waits for a running round of this vault (the walkers' lock): not on an async worker
    let (a, vid) = (app.clone(), id.clone());
    tauri::async_runtime::spawn_blocking(move || tauri::Manager::state::<crate::App>(&a).shared.forget(&crate::data_dir(&a), &vid)).await.map_err(|e| e.to_string())?;
    let s = {
        let mut s = state.settings.lock().unwrap();
        if let Some(a) = s["sharedVaults"].as_array_mut() { a.retain(|x| x["id"] != id.as_str()); }
        s.clone()
    };
    crate::save_settings(&app, &s)
}

/// The held deletes of a vault the user saw (`paths`): let them through in its next round, or put the files back.
#[tauri::command]
pub async fn shared_vault_held(app: tauri::AppHandle, state: St<'_>, id: String, allow: bool, paths: Vec<String>) -> Result<(), String> {
    if allow { state.shared.allow_deletes(&id, paths); } else {
        // restore waits for a running round of this vault (the walkers' lock): not on the main thread
        let a = app.clone();
        tauri::async_runtime::spawn_blocking(move || tauri::Manager::state::<crate::App>(&a).shared.restore_held(&crate::data_dir(&a), &id, &paths)).await.map_err(|e| e.to_string())?;
    }
    sync_now();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn the_settings_list_skips_what_does_not_read() {
        let s = json!({"sharedVaults": [{"id": "0123456789abcdef", "name": "Team", "host": "192.168.1.2", "port": 47800, "fp": "ab", "folder": "/Users/me/Team"}, {"id": 3},
            {"id": "../../x", "name": "Bad", "host": "h", "port": 1, "fp": "ab", "folder": "/tmp/x"}]});
        let l = list(&s);
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].role.as_str(), l[0].port), ("", 47800));
        assert!(find(&s, "nope").is_err());
        assert!(list(&json!({})).is_empty());
        assert!(valid_id("0123456789abcdef") && !valid_id("0123456789ABCDEF") && !valid_id("../../etc/passwd") && !valid_id("0123456789abcde"));
    }
    #[test]
    fn a_members_settings_and_hooks_never_sync() {
        let tmp = std::env::temp_dir().join(format!("relay-shared-filter-{}", std::process::id()));
        std::fs::remove_dir_all(&tmp).ok();
        std::fs::create_dir_all(tmp.join("System/hooks")).unwrap();
        std::os::unix::fs::symlink("System", tmp.join(".claude")).unwrap();
        let f = filter(&tmp);
        for p in ["System/settings.json", "System/settings.local.json", "System/hooks/check.sh", ".claude/rules/x.md", "System/scripts/build-index.py",
            "System/skills/a/SKILL.md", "System/agents/a.md", "system/Hooks/check.sh", "System/Settings.json"] { assert!(f.skips(p, false), "{p}"); }
        for p in ["System/rules/core/work-state.md", "System/reminders.md", "Notes/settings.json"] { assert!(!f.skips(p, false), "{p}"); }
        // a join's first round: the link points at a System/ that is not there yet, and System/ is still held back
        let fresh = tmp.join("fresh");
        std::fs::create_dir_all(&fresh).unwrap();
        std::os::unix::fs::symlink("System", fresh.join(".claude")).unwrap();
        assert!(filter(&fresh).skips("System/hooks/check.sh", false) && filter(&fresh).skips("System/settings.json", false));
        // without a link: .claude still never goes, nor System/'s settings
        std::fs::remove_file(tmp.join(".claude")).unwrap();
        assert!(filter(&tmp).skips(".claude/settings.json", false) && filter(&tmp).skips("System/settings.json", false));
        std::fs::remove_dir_all(&tmp).ok();
    }
    #[test]
    fn a_new_folder_by_its_real_path() {
        let tmp = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("relay-shared-real-{}", std::process::id()));
        std::fs::remove_dir_all(&tmp).ok();
        std::fs::create_dir_all(tmp.join("vault")).unwrap();
        std::os::unix::fs::symlink(tmp.join("vault"), tmp.join("link")).unwrap();
        let t = tmp.to_string_lossy();
        // through a link, or a `..` in a part that exists: the real place, so the nesting check sees it
        assert_eq!(real_path(&format!("{t}/link/Team/Sub")).unwrap(), format!("{t}/vault/Team/Sub"));
        assert_eq!(real_path(&format!("{t}/vault/../vault/Team")).unwrap(), format!("{t}/vault/Team"));
        // a `..` in a part that does not exist yet is refused
        assert!(real_path(&format!("{t}/nope/../vault/Team")).is_err());
        assert!(real_path("relative/Team").is_err());
        std::fs::remove_dir_all(&tmp).ok();
    }
    #[test]
    fn a_vault_folder_stands_alone() {
        let tmp = std::env::temp_dir().join(format!("relay-shared-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let (t, others) = (tmp.to_string_lossy().into_owned(), vec!["/Users/me/Vault".to_string()]);
        assert!(check_folder(&t, &others, true).is_ok(), "an empty folder");
        std::fs::write(tmp.join("note.md"), "x").unwrap();
        assert!(check_folder(&t, &others, true).is_err(), "a joined vault starts empty");
        assert!(check_folder(&t, &others, false).is_ok(), "a made one may start from what is there");
        assert!(check_folder("/Users/me/Vault/Team", &others, false).is_err());
        assert!(check_folder("relative", &others, false).is_err());
        std::fs::remove_dir_all(&tmp).ok();
    }
}
