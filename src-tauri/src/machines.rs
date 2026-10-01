// Work machines: another computer in the LAN running relay-server (packages/relay-server), where a project's
// conversations run so they keep going while this Mac is closed. settings.machines holds each paired machine (its
// address, the fingerprint its certificate must have, and folders: vault project -> folder on that machine); this
// Mac's own certificate is remote-identity.*.der in the app data folder.
//
// A conversation is bound to a machine at its first spawn, when its project has a folder there and it has no session
// on this Mac yet, and stays bound (its transcript lives there): remote.json, conversation key -> {machine, cwd}.
// Only Claude Code runs there, and never a conversation about a mail: the mail tools are answered by this app.

use relay_remote::client::Client;
use relay_remote::proto::Info;
use relay_remote::tls::Identity;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Bind { pub machine: String, pub cwd: String }

/// What the poller last heard from a machine.
#[derive(Default, Clone)]
pub struct Seen { pub info: Option<Info>, pub pending: Vec<Value>, pub error: Option<String>, pub info_at: Option<Instant> }

pub struct Machines {
    pub id: Identity,
    file: PathBuf,
    pub binds: Mutex<HashMap<String, Bind>>,
    pub seen: Mutex<HashMap<String, Seen>>,
}

/// A machine from settings.machines that is complete: id, address, 64-hex fingerprint.
pub fn valid(m: &Value) -> bool {
    let s = |k: &str| m[k].as_str().unwrap_or("");
    let hex = |v: &str, n: usize| v.len() == n && v.chars().all(|c| c.is_ascii_hexdigit());
    hex(s("id"), 12) && hex(s("fp"), 64) && !s("host").is_empty() && s("host").len() <= 253
        && s("host").chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c)) && m["port"].as_u64().is_some_and(|p| (1..=65535).contains(&p))
        && s("name").chars().count() <= 60 && m["folders"].as_object().is_some_and(|f| f.len() <= 200 && f.iter().all(|(p, d)| folder_ok(p, d)))
}
/// A vault project and an absolute folder on the machine.
pub fn folder_ok(project: &str, dir: &Value) -> bool {
    let d = dir.as_str().unwrap_or("");
    !project.is_empty() && project.len() <= 120 && d.starts_with('/') && d.len() <= 500 && !d.contains(['\n', '\0'])
}

impl Machines {
    pub fn load(data: &Path) -> std::io::Result<Machines> {
        let id = Identity::load_or_create(data, "remote-identity")?;
        let file = data.join("remote.json");
        let binds = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Ok(Machines { id, file, binds: Mutex::new(binds), seen: Default::default() })
    }
    fn save(&self, b: &HashMap<String, Bind>) { std::fs::write(&self.file, serde_json::to_string(b).unwrap_or_default()).ok(); }

    pub fn client(&self, m: &Value) -> Client {
        Client::new(m["host"].as_str().unwrap_or(""), m["port"].as_u64().unwrap_or(0) as u16, m["fp"].as_str().unwrap_or(""), self.id.clone())
    }
    /// The machine with this id in the settings.
    pub fn find(settings: &Value, id: &str) -> Option<Value> {
        settings["machines"].as_array()?.iter().find(|m| m["id"] == id).cloned()
    }

    pub fn bind_of(&self, key: &str) -> Option<Bind> { self.binds.lock().unwrap().get(key).cloned() }
    /// The conversation's machine: its bind, or a new one when its project has a folder on a machine and the
    /// conversation has no session on this Mac yet.
    pub fn bind_for(&self, settings: &Value, key: &str, project: Option<&str>, local_session: bool) -> Option<(Value, Bind)> {
        if let Some(b) = self.bind_of(key) { return Some((Self::find(settings, &b.machine)?, b)); }
        if local_session { return None; }
        let project = project?;
        let m = settings["machines"].as_array()?.iter().find(|m| m["folders"][project].is_string())?.clone();
        Some((m.clone(), Bind { machine: m["id"].as_str()?.into(), cwd: m["folders"][project].as_str()?.into() }))
    }
    pub fn set_bind(&self, key: &str, b: Bind) { let mut m = self.binds.lock().unwrap(); m.insert(key.into(), b); self.save(&m); }
    pub fn unbind(&self, key: &str) { let mut m = self.binds.lock().unwrap(); if m.remove(key).is_some() { self.save(&m); } }
    pub fn rebind(&self, from: &str, to: &str) { let mut m = self.binds.lock().unwrap(); if let Some(b) = m.remove(from) { m.insert(to.into(), b); self.save(&m); } }

    /// The machine's Info: the poller's, else asked now.
    pub fn info(&self, m: &Value) -> Result<Info, String> {
        let id = m["id"].as_str().unwrap_or("").to_string();
        if let Some(i) = self.seen.lock().unwrap().get(&id).and_then(|s| s.info.clone()) { return Ok(i); }
        let i = self.client(m).info()?;
        self.seen.lock().unwrap().entry(id).or_default().info = Some(i.clone());
        Ok(i)
    }
    /// Every machine's open cards, as the poller last saw them.
    pub fn pending(&self) -> Vec<Value> { self.seen.lock().unwrap().values().flat_map(|s| s.pending.clone()).collect() }
    /// The machine that holds a card.
    pub fn pending_owner(&self, id: &str) -> Option<String> {
        self.seen.lock().unwrap().iter().find(|(_, s)| s.pending.iter().any(|p| p["id"] == id)).map(|(m, _)| m.clone())
    }
    pub fn forget(&self, id: &str) {
        self.seen.lock().unwrap().remove(id);
        let mut b = self.binds.lock().unwrap();
        b.retain(|_, x| x.machine != id);
        self.save(&b);
    }
    /// Conversation key -> machine name and folder, for the label in the composer.
    pub fn chat_machines(&self, settings: &Value) -> Value {
        let b = self.binds.lock().unwrap();
        json!(b.iter().filter_map(|(k, x)| Some((k.clone(), json!({"machine": Self::find(settings, &x.machine)?["name"], "cwd": x.cwd})))).collect::<serde_json::Map<_, _>>())
    }

    /// One round of the poller: each machine's cards every time, its Info when there is none or it is a minute old.
    pub fn poll(&self, settings: &Value) {
        let list = settings["machines"].as_array().cloned().unwrap_or_default();
        let ids: Vec<String> = list.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect();
        self.seen.lock().unwrap().retain(|k, _| ids.contains(k));
        for m in list {
            let (id, c) = (m["id"].as_str().unwrap_or("").to_string(), self.client(&m));
            let stale = self.seen.lock().unwrap().get(&id).is_none_or(|s| s.info_at.is_none_or(|t| t.elapsed() > Duration::from_secs(60)));
            let info = if stale { Some(c.info()) } else { None };
            let pending = c.pending();
            let mut seen = self.seen.lock().unwrap();
            let s = seen.entry(id).or_default();
            match info { Some(Ok(i)) => { s.info = Some(i); s.info_at = Some(Instant::now()); } Some(Err(e)) => { s.error = Some(e); s.info_at = None; } None => {} }
            match pending { Ok(p) => { s.pending = p; s.error = None; } Err(e) => { s.pending.clear(); s.error = Some(e); } }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn machines_validate_and_bind() {
        let m = json!({"id": "0123456789ab", "name": "LServer", "host": "192.168.1.2", "port": 47800, "fp": "a".repeat(64), "folders": {"Weemaes": "/home/l/weemaes"}});
        assert!(valid(&m));
        for bad in [json!({"folders": {"Weemaes": "relative"}}), json!({"host": "a b"}), json!({"port": 0}), json!({"fp": "xyz"})] {
            let mut b = m.clone();
            for (k, v) in bad.as_object().unwrap() { b[k] = v.clone(); }
            assert!(!valid(&b), "{bad}");
        }
        let d = std::env::temp_dir().join(format!("relay-machines-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let ms = Machines::load(&d).unwrap();
        let s = json!({"machines": [m]});
        // a project with a folder there and no session here: bound; with a session here: stays on this Mac
        assert_eq!(ms.bind_for(&s, "c:1", Some("Weemaes"), false).unwrap().1, Bind { machine: "0123456789ab".into(), cwd: "/home/l/weemaes".into() });
        assert!(ms.bind_for(&s, "c:2", Some("Weemaes"), true).is_none());
        assert!(ms.bind_for(&s, "c:3", Some("Other"), false).is_none());
        ms.set_bind("c:1", Bind { machine: "0123456789ab".into(), cwd: "/x".into() });
        // once bound, the folder in the bind wins, also after a reload
        assert_eq!(Machines::load(&d).unwrap().bind_for(&s, "c:1", None, true).unwrap().1.cwd, "/x");
        ms.rebind("c:1", "c:9");
        assert!(ms.bind_of("c:1").is_none() && ms.bind_of("c:9").is_some());
        assert_eq!(ms.chat_machines(&s)["c:9"]["machine"], "LServer");
        ms.forget("0123456789ab");
        assert!(ms.bind_of("c:9").is_none());
        std::fs::remove_dir_all(d).ok();
    }
}
