// Shared vaults on a relay-server (docs/shared-vaults.md): a vault several people share, synced both ways into a plain
// folder here. The server keeps only ciphertext; the vault key is shared-<id>.key in the app data and never goes there.
// The folder is one of the extra vaults (lib.rs `extra_vaults`), so a conversation in it stays in it (lib.rs `fence`).
// The settings keep the list (`sharedVaults`); only this module writes it, set_settings keeps what is there.

use relay_remote::client::Client;
use relay_remote::sync::{self, Filter, Guard, Manifest, Mode, Walker};
use relay_remote::tls::Identity;
use relay_remote::vault::VaultKey;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

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
/// follows a symlink: one the user made in the folder would otherwise take a member's writes out of it. A link to a
/// folder with a name `fold` cannot match as APFS does (not plain ASCII) is refused: a member's `MÉTA/settings.json`
/// would otherwise pass for another file than `Méta/settings.json` and land in it.
pub fn filter(folder: &Path) -> Result<Filter, String> {
    let mut f = Filter::vault_default();
    f.names.push(".claude".into());
    f.no_links = true;
    let link = std::fs::read_link(folder.join(".claude")).ok();
    let target = link.clone().and_then(|t| {
        let full = if t.is_absolute() { t } else { folder.join(t) };
        let (real, root) = (std::fs::canonicalize(full).ok()?, std::fs::canonicalize(folder).ok()?);
        real.strip_prefix(&root).ok().map(|r| r.to_string_lossy().into_owned())
    });
    // a link that does not resolve guards nothing it points at: only `System` (a join's first round) is guarded anyway
    if let (Some(l), None) = (&link, &target) {
        if l.as_os_str() != "System" { return Err(format!(".claude links to {:?}, which is not in the vault: fix the link to sync this vault", l)); }
    }
    if let Some(t) = target.as_deref().filter(|t| !t.chars().all(|c| c.is_ascii_alphanumeric() || " ._-/".contains(c))) {
        return Err(format!(".claude links to {t:?}: give that folder a name of plain letters and digits to sync this vault"));
    }
    // a link to the vault itself would guard nothing: its settings, hooks and skills would sync like notes
    if target.as_deref() == Some("") { return Err(".claude links to the vault folder itself: link it to a folder inside it (System) to sync this vault".into()); }
    f.guarded = std::iter::once("System".to_string()).chain(target).collect();
    f.only = f.guarded.iter().flat_map(|g| ["rules", "reference", "archive", "reminders.md", CONFLICTS].map(|x| format!("{g}/{x}"))).collect();
    // generated from the project cards on each Mac (index_shared): every session rewrites them, and repos.json holds
    // this Mac's paths, so synced they would only clash. System/index stays out as it is not in `only`
    f.prefixes = f.guarded.iter().map(|g| format!("{g}/rules/core/work-state.md")).collect();
    Ok(f)
}
/// Where a conflict copy of a rule goes: out of `rules/`, whose every file loads into each conversation of the vault.
const CONFLICTS: &str = "conflicts";
fn conflict_copy(f: &Filter, p: &str, machine: &str, stamp: &str) -> String {
    let copy = sync::conflict_copy(p, machine, stamp);
    let segs: Vec<&str> = copy.split('/').collect();
    for g in &f.guarded {
        // by segment, folded: `system/Rules` and `Sy\u{FB06}em/rules` are that folder on the Mac's disk too
        let gs: Vec<&str> = g.split('/').collect();
        let n = gs.len();
        let under = segs.len() > n + 1 && segs[..n].iter().zip(&gs).all(|(a, b)| sync::fold(a) == sync::fold(b)) && sync::fold(segs[n]) == "rules";
        if under { return format!("{g}/{CONFLICTS}/rules/{}", segs[n + 1..].join("/")); }
    }
    copy
}

/// The project index of a shared vault (work-state.md, System/index/repos.json), rebuilt here from its cards with the
/// app's own build-index.py, which also goes into the vault's System/scripts for its conversations. Relay never runs a
/// script from the vault: a conversation there may write one, and Relay runs outside its fence. A vault with a script
/// of its own (other card fields than the starter's) is left alone: the app's copy would find no cards and empty its
/// index, and that script runs only where the vault's conversations run it.
pub fn index_shared(app: &AppHandle, folder: &str) {
    let Ok(script) = app.path().resolve("default-vault/System/scripts/build-index.py", tauri::path::BaseDirectory::Resource) else { return };
    let own = Path::new(folder).join("System/scripts/build-index.py");
    if crate::index_script(own.clone(), Some(script.clone())).is_some_and(|s| s == own) { return; }
    let Ok(code) = std::fs::read(&script) else { return };
    if std::fs::read(&own).ok().as_deref() != Some(&code[..]) { let _ = sync::write_atomic(&own, &code, None); }
    let path = app.state::<crate::App>().path.clone();
    match std::process::Command::new("python3").arg(&script).env("VAULT", folder).env("PATH", path).output() {
        Ok(o) if o.status.success() => {}
        Ok(o) => eprintln!("build-index {folder}: {}", String::from_utf8_lossy(&o.stderr).trim()),
        Err(e) => eprintln!("build-index {folder}: {e}"),
    }
}

/// A folder by its real path, also one that does not exist yet: the nearest folder that does, resolved (links, `..`),
/// with the rest put back. A rest with `.` or `..` is refused, it could climb out of the folder checked.
pub fn real_path(p: &str) -> Result<String, String> {
    let path = Path::new(p.trim());
    if !path.is_absolute() { return Err(crate::trc("err.vault_pick")); }
    let (mut at, mut rest) = (path, vec![]);
    loop {
        if let Ok(mut real) = std::fs::canonicalize(at) {
            for r in rest.iter().rev() { real.push(r); }
            return Ok(real.to_string_lossy().into_owned());
        }
        rest.push(at.file_name().ok_or_else(|| format!("{p}: use a folder path without . or .."))?.to_os_string());
        at = at.parent().ok_or_else(|| crate::trc("err.vault_pick"))?;
    }
}

/// One vault's sync state: its walker and the held deletes the user let through. Each vault has its own lock, held for
/// its whole round: a slow server holds up only that vault (each round runs on a thread of its own, lib.rs), and a
/// leave of it waits for the round to end.
#[derive(Default)]
struct One { walker: Walker, allowed: Vec<String> }
#[derive(Default)]
pub struct Hub { vaults: Mutex<HashMap<String, Arc<Mutex<One>>>>, pub status: Mutex<HashMap<String, Status>> }

impl Hub {
    fn one(&self, id: &str) -> Arc<Mutex<One>> { self.vaults.lock().unwrap().entry(id.into()).or_default().clone() }

    /// One round for a vault: the folder here against the server, both ways. A file changed on both sides keeps both,
    /// the server's as "Name (conflict <this Mac> <date>).md"; more deletes than the brake allows wait for the user.
    /// Returns this round's status; Settings gets the counts since the app started. None: the vault's last round is
    /// still running, or `listed` says the user left it meanwhile (the caller's settings are a copy).
    pub fn round(&self, data: &Path, v: &Shared, me: &Identity, name: &str, listed: &dyn Fn() -> bool) -> Option<Status> {
        let one = self.one(&v.id);
        let Ok(mut one) = one.try_lock() else { return None };
        if !listed() { return None; }
        let mut st = Status { at: chrono::Utc::now().timestamp(), ..Default::default() };
        match load_key(data, &v.id).and_then(|k| Ok((k, filter(Path::new(&v.folder))?))) {
            Err(e) => st.errors.push(e),
            Ok((key, f)) => {
                let stamp = chrono::Local::now().format("%Y-%m-%d %H%M").to_string();
                let cutoff = (chrono::Local::now() - chrono::Duration::days(TRASH_DAYS)).format("%Y-%m-%d").to_string();
                for e in std::fs::read_dir(trash(data, &v.id)).into_iter().flatten().flatten() {
                    if e.file_name().to_string_lossy().as_ref() < cutoff.as_str() { std::fs::remove_dir_all(e.path()).ok(); }
                }
                std::fs::create_dir_all(&v.folder).ok();
                let base: Manifest = std::fs::read_to_string(base_path(data, &v.id)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
                let allowed = std::mem::take(&mut one.allowed);
                let copy = |p: &str| conflict_copy(&f, p, name, &stamp);
                let to = trash(data, &v.id).join(&stamp);
                let keep = |p: &str, d: &[u8]| sync::write_atomic(&to.join(p), d, None);
                let guard = Guard { allow_deletes: false, allowed: &allowed, keep: &keep };
                let remote = client(v, me).sealed(&v.id, key);
                remote.know(&base);
                let (next, r) = sync::run(Mode::TwoWay, Path::new(&v.folder), &base, &mut one.walker, &f, &remote, &copy, &|_| false, &guard, &|_, _| {});
                // a round that failed (the server out of reach) keeps what the user let through for the next one
                if !r.errors.is_empty() { one.allowed = allowed.clone(); }
                // the next round plans against this base: one not written is an error, not a quiet success
                if next != base { if let Err(e) = write_base(data, &v.id, &next) { st.errors.push(format!("base: {e}")); } }
                st = Status { pushed: r.pushed.len() + r.deleted_remote.len(), pulled: r.pulled.len() + r.deleted_local.len(),
                    conflicts: r.conflicts, errors: [st.errors, r.errors].concat(), held: r.held, bad: remote.bad().len(), ..st };
            }
        }
        // still under the vault's lock: a leave waiting for this round removes the status after it
        let mut all = self.status.lock().unwrap();
        let prev = all.remove(&v.id).unwrap_or_default();
        let mut conflicts = prev.conflicts;
        for c in &st.conflicts { if !conflicts.contains(c) { conflicts.push(c.clone()); } }
        all.insert(v.id.clone(), Status { pushed: prev.pushed + st.pushed, pulled: prev.pulled + st.pulled, conflicts, ..st.clone() });
        Some(st)
    }

    /// The held deletes the user saw go through in the next round; any others the brake still holds. Another member
    /// can delete more meanwhile, so it is the list shown, not "everything held next time".
    pub fn allow_deletes(&self, id: &str, seen: Vec<String>) { self.one(id).lock().unwrap().allowed = seen; }
    /// The held deletes the user saw are undone instead: out of the base (under the vault's lock, as a round writes
    /// it), so the next round copies each file back from the side that still has it.
    pub fn restore_held(&self, data: &Path, id: &str, seen: &[String]) -> Result<(), String> {
        let one = self.one(id);
        let _one = one.lock().unwrap();
        if let Some(s) = self.status.lock().unwrap().get_mut(id) { s.held.retain(|h| !seen.contains(h)); }
        let Some(mut base) = std::fs::read_to_string(base_path(data, id)).ok().and_then(|s| serde_json::from_str::<Manifest>(&s).ok()) else { return Ok(()) };
        for h in seen { base.remove(h); }
        write_base(data, id, &base)
    }
    /// This Mac leaves a vault: its key, base, trash and status go, after a running round of it; the folder stays.
    pub fn forget(&self, data: &Path, id: &str) {
        let one = self.one(id);
        let _one = one.lock().unwrap();
        std::fs::remove_file(key_path(data, id)).ok();
        std::fs::remove_file(base_path(data, id)).ok();
        std::fs::remove_dir_all(trash(data, id)).ok();
        self.status.lock().unwrap().remove(id);
        self.vaults.lock().unwrap().remove(id);
    }
}
fn write_base(data: &Path, id: &str, base: &Manifest) -> Result<(), String> {
    let b = serde_json::to_vec(base).map_err(|e| e.to_string())?;
    sync::write_atomic(&base_path(data, id), &b, None).map_err(|e| e.to_string())
}

// ---------- commands for Settings › General › Shared vaults

type St<'a> = tauri::State<'a, crate::App>;

/// A call to a shared vault's server, off the async worker: the vault from the settings, this Mac's client to it.
async fn on_server<T: Send + 'static>(state: &St<'_>, id: &str, call: impl FnOnce(Shared, Client) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let v = find(&state.settings.lock().unwrap(), id)?;
    let c = client(&v, &state.machines.id);
    tauri::async_runtime::spawn_blocking(move || call(v, c)).await.map_err(|e| e.to_string())?
}
/// Work on the Hub off the async worker: it waits for a running round of that vault.
async fn on_hub<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&Hub, &Path) -> T + Send + 'static) -> Result<T, String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || f(&a.state::<crate::App>().shared, &crate::data_dir(&a))).await.map_err(|e| e.to_string())
}
/// Where a new vault may go: its real path, checked against the other vaults and the folders no vault may touch.
fn new_folder(app: &AppHandle, state: &St<'_>, folder: &str, empty: bool) -> Result<String, String> {
    let folder = real_path(folder)?;
    let s = state.settings.lock().unwrap().clone();
    let protected = agents_claude(app, state).map(|eb| crate::policy::protected(app, &eb)).unwrap_or_default();
    crate::policy::check_folder(&folder, &crate::all_vaults(&s), &protected, empty)?;
    Ok(folder)
}
fn agents_claude(app: &AppHandle, state: &St<'_>) -> Option<crate::EnvBuf> { crate::agents::get("claude").ok().map(|p| crate::env_of(app, state, p)) }

/// A vault added to the settings (or replaced, by id): the agents here stop under the vault lock and the change is
/// written before it is let go (policy::hold_for_vault), then saved and told to both windows; its first round runs.
fn add(app: &AppHandle, state: &crate::App, v: &Shared) -> Result<(), String> {
    let entry = serde_json::to_value(v).map_err(|e| e.to_string())?;
    {
        let _gate = crate::policy::hold_for_vault(app);
        change(app, state, |all| { all.retain(|x| x["id"] != v.id.as_str()); all.push(entry); true })?;
    }
    sync_now();
    Ok(())
}
/// The shared vaults changed and saved under the settings lock: two changes at once cannot save the older list last.
/// `f` says whether it changed anything.
fn change(app: &AppHandle, state: &crate::App, f: impl FnOnce(&mut Vec<Value>) -> bool) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    let mut all: Vec<Value> = s["sharedVaults"].as_array().cloned().unwrap_or_default();
    if !f(&mut all) { return Ok(()); }
    // saved first: the app follows only a change that is on disk
    let mut next = s.clone();
    next["sharedVaults"] = Value::Array(all);
    crate::save_settings(app, &next)?;
    *s = next;
    Ok(())
}

/// An invite link that opened Relay (lib.rs on_open_url), until Settings takes it on the `vault-invite` ping or when
/// it opens: the one place the link is kept.
static INVITE: Mutex<Option<String>> = Mutex::new(None);
pub fn invite_opened(link: String) { *INVITE.lock().unwrap() = Some(link); }
#[tauri::command]
pub fn shared_vault_pending_invite() -> Option<String> { INVITE.lock().unwrap().take() }

/// The shared vaults' rounds so far: {id: Status}.
#[tauri::command]
pub fn shared_vaults_status(state: St) -> Value { serde_json::to_value(&*state.shared.status.lock().unwrap()).unwrap_or_default() }

/// Make a shared vault on a paired machine: the server keeps it, this Mac makes the key. A folder that is not there
/// or empty starts as Relay's starter vault; one with notes is uploaded as it is. Returns {id, recovery}.
#[tauri::command]
pub async fn shared_vault_create(app: AppHandle, state: St<'_>, machine: String, name: String, folder: String) -> Result<Value, String> {
    let s = state.settings.lock().unwrap().clone();
    let m = crate::machines::Machines::find(&s, &machine).ok_or("pick a paired machine for the vault")?;
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(60).collect();
    if name.is_empty() { return Err("give the vault a name".into()); }
    let folder = new_folder(&app, &state, &folder, false)?;
    // asked before anything is made: adding the vault restarts every conversation, none may be in a turn
    let _adding = crate::policy::may_add_vault(&app)?;
    let template = app.path().resolve("default-vault", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let (c, at) = (state.machines.client(&m), folder.clone());
    let (r, key) = tauri::async_runtime::spawn_blocking(move || -> Result<(relay_remote::client::VaultRef, VaultKey), String> {
        // the folder first: a vault that could not get its notes is not made on the server at all
        let empty = !std::fs::read_dir(&folder).is_ok_and(|mut d| d.any(|e| e.is_ok_and(|e| e.file_name() != ".DS_Store")));
        if empty { crate::vault::create_default(&template, Path::new(&folder))?; }
        Ok((c.vault_create(&name)?, VaultKey::generate()))
    }).await.map_err(|e| e.to_string())??;
    if !valid_id(&r.id) { return Err(format!("the server answered an invalid vault id {:?}", r.id)); }
    // keys, bases and trash go by id alone: an id this Mac is in already would overwrite that vault's key
    if list(&state.settings.lock().unwrap()).iter().any(|x| x.id == r.id) { return Err(format!("this Mac is in a vault with id {} already", r.id)); }
    save_key(&crate::data_dir(&app), &r.id, &key)?;
    let v = Shared { id: r.id.clone(), name: r.name, host: m["host"].as_str().unwrap_or("").into(), port: m["port"].as_u64().unwrap_or(0) as u16,
        fp: m["fp"].as_str().unwrap_or("").into(), folder: at, role: "admin".into() };
    add(&app, &state, &v)?;
    Ok(serde_json::json!({"id": r.id, "recovery": key.to_hex()}))
}

/// Join a shared vault with an invite link: this Mac pairs with the server as a vault-only device (when it is not
/// paired yet), gets the key out of the link and syncs the vault into `folder`, which must be empty.
#[tauri::command]
pub async fn shared_vault_join(app: AppHandle, state: St<'_>, link: String, folder: String) -> Result<Value, String> {
    let s = state.settings.lock().unwrap().clone();
    let folder = new_folder(&app, &state, &folder, true)?;
    // a vault this Mac is in already: joining again would wipe its key, base and trash and leave its folder unsynced
    if let Some(had) = relay_remote::proto::PairLine::parse(&link).and_then(|l| l.vault).and_then(|id| find(&s, &id.to_ascii_lowercase()).ok()) {
        return Err(format!("this Mac is in {} already, at {}", had.name, had.folder));
    }
    let _adding = crate::policy::may_add_vault(&app)?;
    // the folder before the single-use invite is spent: one that cannot be made fails here, with the link still good
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let (me, name) = (state.machines.id.clone(), crate::sys_name());
    let (line, joined, key) = tauri::async_runtime::spawn_blocking(move || relay_remote::client::vault_join(&link, &me, &name)).await.map_err(|e| e.to_string())??;
    if !valid_id(&joined.id) { return Err(format!("not a vault id: {:?}", joined.id)); }
    // a vault this Mac had before: its old base would make the new, empty folder look like a mass delete
    let vid = joined.id.clone();
    on_hub(&app, move |hub, data| hub.forget(data, &vid)).await?;
    save_key(&crate::data_dir(&app), &joined.id, &key)?;
    // `.claude -> System` as in a vault Relay makes, before the first round: the rules load from the synced System/
    std::os::unix::fs::symlink("System", Path::new(&folder).join(".claude")).ok();
    let v = Shared { id: joined.id.clone(), name: joined.name.clone(), host: line.host, port: line.port, fp: line.fp, folder, role: joined.role };
    add(&app, &state, &v)?;
    Ok(serde_json::json!({"id": joined.id, "name": joined.name}))
}

/// An invite link for a vault (admins): single use, 24 h. {link, invite: {id, role, expires}}.
#[tauri::command]
pub async fn shared_vault_invite(app: AppHandle, state: St<'_>, id: String, role: String) -> Result<Value, String> {
    let key = load_key(&crate::data_dir(&app), &id)?;
    let role = if role == "admin" { "admin" } else { "member" };
    let (link, invite) = on_server(&state, &id, move |v, c| c.vault_invite(&v.id, role, &key, &v.host, v.port)).await?;
    Ok(serde_json::json!({"link": link, "invite": invite}))
}

/// The members and open invites of a vault, and this Mac's fingerprint so the list can mark it: {vault, me}.
#[tauri::command]
pub async fn shared_vault_info(app: AppHandle, state: St<'_>, id: String) -> Result<Value, String> {
    let me = state.machines.id.fingerprint();
    let info = on_server(&state, &id, |v, c| c.vault_info(&v.id)).await?;
    // the server's role for this Mac counts: an admin removed makes the oldest member admin there
    change(&app, &state, |all| {
        let stale = all.iter_mut().find(|x| x["id"] == id.as_str()).filter(|x| !info.role.is_empty() && x["role"] != info.role.as_str());
        stale.map(|x| x["role"] = Value::from(info.role.clone())).is_some()
    })?;
    Ok(serde_json::json!({"vault": info, "me": me}))
}

/// Withdraw an invite that was not used yet (admins).
#[tauri::command]
pub async fn shared_vault_invite_revoke(state: St<'_>, id: String, invite: String) -> Result<(), String> {
    on_server(&state, &id, move |v, c| c.vault_invite_revoke(&v.id, &invite)).await
}

/// Remove a member (admins), or leave the vault when `fp` is this Mac's or "" (a removed member cannot ask the server
/// who it is): the vault goes from the settings with its key and sync state, the folder stays as it is.
#[tauri::command]
pub async fn shared_vault_remove(app: AppHandle, state: St<'_>, id: String, fp: String) -> Result<(), String> {
    let me = state.machines.id.fingerprint();
    let fp = if fp.is_empty() { me.clone() } else { fp };
    let who = fp.clone();
    let gone = on_server(&state, &id, move |v, c| c.vault_remove(&v.id, &who)).await;
    if fp != me { return gone; }
    // leaving: what the server says when this Mac is out already does not keep the vault here
    if let Err(e) = gone { if !left_already(&e) { return Err(e); } }
    // out of the settings first: a round that starts now sees it gone (Hub::round's `listed`), one running ends first
    change(&app, &state, |all| { all.retain(|x| x["id"] != id.as_str()); true })?;
    on_hub(&app, move |hub, data| hub.forget(data, &id)).await
}
/// Whether a server error means this Mac is no member any more: removed, the vault gone, or the device unpaired.
fn left_already(e: &str) -> bool { ["no such vault", "not paired", "not a member", "CertificateUnknown", "certificate unknown"].iter().any(|x| e.contains(x)) }

/// A vault's key as hex, to show it again (Settings): it is on this Mac in shared-<id>.key anyway, the recovery key.
#[tauri::command]
pub fn shared_vault_recovery(app: AppHandle, id: String) -> Result<String, String> {
    if !valid_id(&id) { return Err("not a vault id".into()); }
    load_key(&crate::data_dir(&app), &id).map(|k| k.to_hex())
}

/// The held deletes of a vault the user saw (`paths`): let them through in its next round, or put the files back.
#[tauri::command]
pub async fn shared_vault_held(app: AppHandle, id: String, allow: bool, paths: Vec<String>) -> Result<(), String> {
    on_hub(&app, move |hub, data| if allow { hub.allow_deletes(&id, paths); Ok(()) } else { hub.restore_held(data, &id, &paths) }).await??;
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
        let f = filter(&tmp).unwrap();
        for p in ["System/settings.json", "System/settings.local.json", "System/hooks/check.sh", ".claude/rules/x.md", "System/scripts/build-index.py",
            "System/skills/a/SKILL.md", "System/agents/a.md", "system/Hooks/check.sh", "System/Settings.json"] { assert!(f.skips(p, false), "{p}"); }
        for p in ["System/rules/core/memory.md", "System/reminders.md", "Notes/settings.json", "System/conflicts/rules/core/memory (conflict m s).md"] { assert!(!f.skips(p, false), "{p}"); }
        // generated on each Mac from the cards, never synced
        for p in ["System/rules/core/work-state.md", "System/index/repos.json"] { assert!(f.skips(p, false), "{p}"); }
        // a rule's conflict copy goes out of rules/, which loads into every conversation; a note's stays beside it
        assert_eq!(conflict_copy(&f, "System/rules/core/memory.md", "m", "s"), "System/conflicts/rules/core/memory (conflict m s).md");
        assert_eq!(conflict_copy(&f, "Notes/a.md", "m", "s"), "Notes/a (conflict m s).md");
        // the same folder on a Mac's disk, by case or by a ligature: out of rules/ too
        assert_eq!(conflict_copy(&f, "system/Rules/core/memory.md", "m", "s"), "System/conflicts/rules/core/memory (conflict m s).md");
        assert_eq!(conflict_copy(&f, "Sy\u{FB06}em/rules/a.md", "m", "s"), "System/conflicts/rules/a (conflict m s).md");
        // a .claude link that does not resolve guards nothing it points at: refused, except System on a join's first round
        let dangling = std::env::temp_dir().join(format!("relay-dangling-{}", std::process::id()));
        std::fs::create_dir_all(&dangling).unwrap();
        std::os::unix::fs::symlink("Meta", dangling.join(".claude")).unwrap();
        assert!(filter(&dangling).is_err());
        std::fs::remove_file(dangling.join(".claude")).unwrap();
        std::os::unix::fs::symlink("System", dangling.join(".claude")).unwrap();
        assert!(filter(&dangling).is_ok());
        std::fs::remove_dir_all(&dangling).ok();
        // a join's first round: the link points at a System/ that is not there yet, and System/ is still held back
        let fresh = tmp.join("fresh");
        std::fs::create_dir_all(&fresh).unwrap();
        std::os::unix::fs::symlink("System", fresh.join(".claude")).unwrap();
        assert!(filter(&fresh).unwrap().skips("System/hooks/check.sh", false) && filter(&fresh).unwrap().skips("System/settings.json", false));
        // a link to the vault itself: refused, it would guard nothing
        std::fs::remove_file(fresh.join(".claude")).unwrap();
        std::os::unix::fs::symlink(".", fresh.join(".claude")).unwrap();
        assert!(filter(&fresh).is_err());
        std::fs::remove_file(fresh.join(".claude")).unwrap();
        std::os::unix::fs::symlink("System", fresh.join(".claude")).unwrap();
        // a link to a name fold cannot match as APFS does: refused rather than guessed
        std::fs::create_dir_all(fresh.join("M\u{e9}ta")).unwrap();
        std::fs::remove_file(fresh.join(".claude")).unwrap();
        std::os::unix::fs::symlink("M\u{e9}ta", fresh.join(".claude")).unwrap();
        assert!(filter(&fresh).is_err());
        // without a link: .claude still never goes, nor System/'s settings
        std::fs::remove_file(tmp.join(".claude")).unwrap();
        let f = filter(&tmp).unwrap();
        assert!(f.skips(".claude/settings.json", false) && f.skips("System/settings.json", false));
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
        use crate::policy::check_folder;
        let tmp = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("relay-shared-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let (t, others, none) = (tmp.to_string_lossy().into_owned(), vec!["/Users/me/Vault".to_string()], Vec::<String>::new());
        assert!(check_folder(&t, &others, &none, true).is_ok(), "an empty folder");
        std::fs::write(tmp.join("note.md"), "x").unwrap();
        assert!(check_folder(&t, &others, &none, true).is_err(), "a joined vault starts empty");
        assert!(check_folder(&t, &others, &none, false).is_ok(), "a made one may start from what is there");
        assert!(check_folder("/Users/me/Vault/Team", &others, &none, false).is_err());
        assert!(check_folder("relative", &others, &none, false).is_err());
        // Relay's data or a Claude folder inside, or the vault inside one of them: refused, all of it would sync
        let data = vec!["/Users/me/Library/Application Support/relay".to_string()];
        assert!(check_folder("/Users/me/Library", &others, &data, false).is_err());
        assert!(check_folder("/Users/me/Library/Application Support/relay/x", &others, &data, false).is_err());
        let home = crate::home();
        assert!(check_folder(&home, &none, &none, false).is_err(), "the home folder itself");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
