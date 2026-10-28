// Conversations on this Mac that its phone may continue (`/share-phone` in the composer), through a work machine
// both are paired with. This Mac never listens: it keeps a `share` connection open to each machine it paired a phone
// on, offering the shared conversations, and gets a connection of its own back for each request of the phone. The
// phone reaches only the conversations shared at that moment, and only with lines it signed; the checks are
// relay_remote::share's.
//
// phone-share.json in the app data (0600): the shared conversations (key -> title for the phone's list), and per
// machine the phones this Mac trusts there (their pinned public keys, and the links of Add phone pairings not used yet).

use crate::{agents, data_dir, env_of, machines, orch, session, trc, trc_v, App};
use relay_remote::broker::{self, Conn};
use relay_remote::share::{self, Local, Phones};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::BufRead;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct File { #[serde(default)] shared: BTreeMap<String, String>, #[serde(default)] phones: BTreeMap<String, Phones> }

// the file, read once; every change goes through `update`
static FILE: Mutex<Option<File>> = Mutex::new(None);
fn with<T>(app: &AppHandle, f: impl FnOnce(&mut File) -> T) -> T {
    let mut g = FILE.lock().unwrap();
    let file = g.get_or_insert_with(|| std::fs::read_to_string(path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
    f(file)
}
fn update<T>(app: &AppHandle, f: impl FnOnce(&mut File) -> T) -> T {
    with(app, |file| {
        let out = f(file);
        use std::os::unix::fs::OpenOptionsExt;
        let (p, tmp) = (path(app), path(app).with_extension("tmp"));
        let ok = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)
            .and_then(|mut w| std::io::Write::write_all(&mut w, serde_json::to_string_pretty(file).unwrap_or_default().as_bytes()))
            .and_then(|_| std::fs::rename(&tmp, &p));
        if let Err(e) = ok { eprintln!("relay: phone-share.json: {e}"); }
        out
    })
}
fn path(app: &AppHandle) -> std::path::PathBuf { data_dir(app).join("phone-share.json") }

/// Add phone (machine_pair_phone): the link its QR carries, until that phone proves its key with it.
/// The last few only: a QR shown and never scanned leaves its link behind.
pub fn add_link(app: &AppHandle, machine: &str, link: &str) {
    update(app, |f| {
        let links = &mut f.phones.entry(machine.into()).or_default().links;
        links.push(link.into());
        if links.len() > 3 { links.remove(0); }
    });
}
/// Forget a machine: the phones trusted there go with it.
pub fn forget(app: &AppHandle, machine: &str) { update(app, |f| f.phones.remove(machine)); }
/// A conversation moved to another key (move_chat): its share goes along.
pub fn rekey(app: &AppHandle, from: &str, to: &str) {
    if with(app, |f| f.shared.contains_key(from)) { update(app, |f| if let Some(t) = f.shared.remove(from) { f.shared.insert(to.into(), t); }); }
}

/// Whether the conversation `key` is shared with the phone.
pub fn is_shared(app: &AppHandle, key: &str) -> bool { with(app, |f| f.shared.contains_key(key)) }

/// What may be reached from the phone now: shared, on this Mac (one on a machine the phone sees there), not the
/// orchestrator's, and not holding mail text (the same rule as moving to a machine: the server would see it).
fn reachable(app: &AppHandle, key: &str) -> bool {
    let st = app.state::<App>();
    with(app, |f| f.shared.contains_key(key)) && !orch::is_orch(key) && st.machines.bind_of(key).is_none()
        && !st.procs.lock().unwrap().get(key).is_some_and(|x| x.tainted)
}

/// `/share-phone` and `/unshare-phone` in the composer: the conversation `key` (with its title for the phone's list) is
/// shared with this Mac's phones, or not any more. `mail`: the conversation started from a mail.
#[tauri::command]
pub fn phone_share(app: AppHandle, key: String, on: bool, title: Option<String>, mail: Option<bool>) -> Result<(), String> {
    if on {
        let st = app.state::<App>();
        if mail == Some(true) || st.procs.lock().unwrap().get(&key).is_some_and(|x| x.tainted) { return Err(trc("err.share_mail")); }
        if orch::is_orch(&key) || agents::term_key(&key).is_some() { return Err(trc("err.share_orch")); }
        if let Some(b) = st.machines.bind_of(&key) {
            let name = machines::Machines::find(&st.settings.lock().unwrap(), &b.machine).and_then(|m| m["name"].as_str().map(String::from)).unwrap_or(b.machine);
            return Err(trc_v("err.share_machine", &name));
        }
        if with(&app, |f| f.phones.values().all(Phones::is_empty)) { return Err(trc("err.share_no_phone")); }
    }
    let title: String = title.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
    update(&app, |f| if on { f.shared.insert(key, title); } else { f.shared.remove(&key); });
    Ok(())
}
/// The conversations shared with the phone, for the composer's mark.
#[tauri::command]
pub fn phone_shared(app: AppHandle) -> Vec<String> { with(&app, |f| f.shared.keys().cloned().collect()) }

/// Every few seconds: each machine with a phone of this Mac gets its own thread offering the shared conversations.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let held: Arc<Mutex<HashSet<String>>> = Default::default();
        loop {
            let ids: Vec<String> = with(&app, |f| f.phones.iter().filter(|(_, p)| !p.is_empty()).map(|(id, _)| id.clone()).collect());
            for id in ids {
                if !held.lock().unwrap().insert(id.clone()) { continue; }
                let (app, held) = (app.clone(), held.clone());
                std::thread::spawn(move || { hold(&app, &id); held.lock().unwrap().remove(&id); });
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

/// What is offered: [{key, title, provider}], each reachable one.
fn offered(app: &AppHandle) -> Value {
    let st = app.state::<App>();
    let shared = with(app, |f| f.shared.clone());
    json!(shared.into_iter().filter(|(k, _)| reachable(app, k)).map(|(k, title)| {
        let provider = st.sids.lock().unwrap().get(&k).map(|s| s.provider.clone()).unwrap_or_else(|| "claude".into());
        json!({"key": k, "title": title, "provider": provider})
    }).collect::<Vec<_>>())
}

/// One machine: offer what is shared now, again every minute (so a connection that died quietly is replaced) and at
/// once when that changes; nothing while nothing is. Each `open` the server writes is a request of the phone: a
/// connection back for it, served by share::serve.
fn hold(app: &AppHandle, id: &str) {
    loop {
        let st = app.state::<App>();
        let Some(m) = machines::Machines::find(&st.settings.lock().unwrap(), id) else { return };
        if with(app, |f| f.phones.get(id).is_none_or(Phones::is_empty)) { return; }
        let convs = offered(app);
        if convs.as_array().is_none_or(|c| c.is_empty()) { std::thread::sleep(Duration::from_secs(2)); continue; }
        let c = st.machines.client(&m);
        let Ok((r, w)) = c.share(&convs) else { std::thread::sleep(Duration::from_secs(10)); continue };
        let (app2, id2) = (app.clone(), id.to_string());
        let reader = std::thread::spawn(move || for l in r.lines().map_while(Result::ok) {
            let Some(token) = serde_json::from_str::<Value>(&l).ok().and_then(|v| v["open"].as_str().map(String::from)) else { continue };
            let (c, mac) = (c.clone(), Arc::new(Mac { app: app2.clone(), machine: id2.clone() }));
            std::thread::spawn(move || { if let Ok((r, w)) = c.share_open(&token) { share::serve(r, w, mac).ok(); } });
        });
        let since = Instant::now();
        while !reader.is_finished() && since.elapsed() < Duration::from_secs(60) && offered(app) == convs { std::thread::sleep(Duration::from_secs(1)); }
        w.shutdown();
        reader.join().ok();
    }
}

/// This Mac, as a phone's requests through `machine` see it.
struct Mac { app: AppHandle, machine: String }
impl Local for Mac {
    fn shared(&self, key: &str) -> bool { reachable(&self.app, key) }
    fn attach(&self, key: &str) -> Result<Conn, String> {
        session::ensure_local(&self.app, key)?;
        broker::follow(key, "phone").ok_or_else(|| "the conversation's agent ended".into())
    }
    fn kill(&self, key: &str, pid: u32) -> Result<(), String> {
        let st = self.app.state::<App>();
        if !st.procs.lock().unwrap().get(key).is_some_and(|x| x.child.id() == pid) { return Err("not that conversation's agent".into()); }
        session::stop(&self.app, &st, key);
        Ok(())
    }
    fn history(&self, key: &str) -> Result<Value, String> {
        let st = self.app.state::<App>();
        let Some(s) = st.sids.lock().unwrap().get(key).cloned() else { return Ok(json!({"items": [], "next": 0})) };
        let p = agents::get_or_first(Some(&s.provider));
        let (items, next) = p.history(&crate::in_vault(env_of(&self.app, &st, p), s.vault.clone()).env(), &s.sid, 0);
        Ok(json!({"items": items, "next": next}))
    }
    fn admit(&self, pk: &str, proof: &str) -> bool { update(&self.app, |f| f.phones.get_mut(&self.machine).is_some_and(|p| p.admit(pk, proof))) }
}
