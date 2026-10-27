// Work machines: another computer in the LAN running relay-server (packages/relay-server), where a project's
// conversations run so they keep going while this Mac is closed. settings.machines holds each paired machine (its
// address and the fingerprint its certificate must have); this
// Mac's own certificate is remote-identity.*.der in the app data folder.
//
// A conversation is bound to a machine at its first spawn and stays bound (its transcript lives there): remote.json,
// conversation key -> {machine, cwd}. Where it runs is picked in the composer before the first message ("" for this
// Mac, or a machine id); without a pick, where Settings › Machines says new conversations run. Between two turns it can
// move (move_conversation in lib.rs): its transcript goes along, with `rewrite` for the vault's paths. There it runs
// in the vault's mirror.
// A machine paired for shared vaults only (`sharedOnly`) gets no mirror and runs no conversation: it only keeps the
// shared vaults made on it (shared_vaults.rs), so this Mac's vault never goes there.
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
        && s("name").chars().count() <= 60
        && crate::mirror::valid(m)
}

/// A machine paired for shared vaults only: no mirror, no conversations.
pub fn shared_only(m: &Value) -> bool { m["sharedOnly"] == true }
/// The machines that get this Mac's mirror and may run its conversations: every one but those for shared vaults only.
pub fn runners(settings: &Value) -> impl Iterator<Item = &Value> {
    settings["machines"].as_array().into_iter().flatten().filter(|m| !shared_only(m))
}

/// Where a conversation runs on a machine: its bind's folder (one bound before the mirror kept its own), else the
/// vault's mirror there.
pub fn cwd_or_vault(cwd: String, info: &Info) -> String {
    if cwd.is_empty() { format!("{}/vault", info.work) } else { cwd }
}
/// The vault's folder and its memory's on a machine: its mirror.
pub fn roots_on(info: &Info) -> [String; 2] {
    [format!("{}/vault", info.work), format!("{}/memory", info.work)]
}
/// A transcript moving to another place: each `from` folder becomes its `to`, so the paths in the history point at
/// files that exist where the conversation goes on. Whole folders only: not where a name goes on (`Vault2`, `Vault.bak`),
/// anywhere else, also inside a tool's output quoted twice (`\"/Users/me/Vault\"`).
pub fn rewrite(t: &str, from: &[String; 2], to: &[String; 2]) -> String {
    let mut s = t.to_string();
    for (a, b) in from.iter().zip(to) {
        if a.is_empty() || a == b { continue; }
        let (mut out, mut rest) = (String::with_capacity(s.len()), s.as_str());
        while let Some(i) = rest.find(a.as_str()) {
            let after = &rest[i + a.len()..];
            let whole = !after.chars().next().is_some_and(|c| c.is_alphanumeric() || "-_.".contains(c));
            out.push_str(&rest[..i]);
            out.push_str(if whole { b } else { a });
            rest = after;
        }
        out.push_str(rest);
        s = out;
    }
    s
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
    /// The machine a conversation runs on without a pick: the one chosen in Settings › Machines as where new
    /// conversations run (`machines_default`, "" this Mac).
    pub fn default_for(settings: &Value) -> Option<Value> {
        runners(settings).find(|m| m["id"] == settings["machines_default"] && m["id"] != "").cloned()
    }
    /// The conversation's machine: its bind, or a new one for a conversation without a session on this Mac yet, on the
    /// machine picked (`choice`: Some("") this Mac, Some(id) a machine) or else the default. cwd "" means the vault's
    /// mirror there, which the caller knows from its Info.
    pub fn bind_for(&self, settings: &Value, key: &str, local_session: bool, choice: Option<&str>) -> Option<(Value, Bind)> {
        if let Some(b) = self.bind_of(key) { return Some((Self::find(settings, &b.machine)?, b)); }
        if local_session { return None; }
        let m = match choice { Some("") => return None, Some(id) => runners(settings).find(|m| m["id"] == id)?.clone(), None => Self::default_for(settings)? };
        Some((m.clone(), Bind { machine: m["id"].as_str()?.into(), cwd: String::new() }))
    }
    /// Every machine that runs conversations with what the poller last heard: {id, name, online, default: whether a
    /// conversation runs there without a pick}, for the composer's pick. No network.
    pub fn status_list(&self, settings: &Value) -> Value {
        let seen = self.seen.lock().unwrap();
        let def = Self::default_for(settings).and_then(|m| m["id"].as_str().map(String::from));
        json!(runners(settings).map(|m| {
            let id = m["id"].as_str().unwrap_or("");
            let s = seen.get(id);
            json!({"id": id, "name": m["name"], "online": s.is_some_and(|s| s.info.is_some() && s.error.is_none()),
                "default": def.as_deref() == Some(id)})
        }).collect::<Vec<_>>())
    }
    pub fn set_bind(&self, key: &str, b: Bind) { let mut m = self.binds.lock().unwrap(); m.insert(key.into(), b); self.save(&m); }
    pub fn unbind(&self, key: &str) { let mut m = self.binds.lock().unwrap(); if m.remove(key).is_some() { self.save(&m); } }
    pub fn rebind(&self, from: &str, to: &str) { let mut m = self.binds.lock().unwrap(); if let Some(b) = m.remove(from) { m.insert(to.into(), b); self.save(&m); } }

    /// The machine's Info: the poller's, else asked now.
    pub fn info(&self, m: &Value) -> Result<Info, String> {
        let id = m["id"].as_str().unwrap_or("").to_string();
        if let Some(s) = self.seen.lock().unwrap().get(&id) {
            // the poller asked a moment ago and got nothing: say so now, rather than after a connect timeout
            if let Some(e) = &s.error { return Err(e.clone()); }
            if let Some(i) = &s.info { return Ok(i.clone()); }
        }
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
    /// The conversations bound to a machine.
    pub fn keys_on(&self, id: &str) -> Vec<String> { self.binds.lock().unwrap().iter().filter(|(_, b)| b.machine == id).map(|(k, _)| k.clone()).collect() }
    pub fn forget(&self, id: &str) {
        self.seen.lock().unwrap().remove(id);
        let mut b = self.binds.lock().unwrap();
        b.retain(|_, x| x.machine != id);
        self.save(&b);
    }
    /// Conversation key -> machine name, id and folder, for the composer's pick.
    pub fn chat_machines(&self, settings: &Value) -> Value {
        let b = self.binds.lock().unwrap();
        json!(b.iter().filter_map(|(k, x)| Some((k.clone(), json!({"machine": Self::find(settings, &x.machine)?["name"], "id": x.machine, "cwd": x.cwd})))).collect::<serde_json::Map<_, _>>())
    }

    /// One round of the poller: each machine's cards every time, its Info when there is none or it is a minute old. One
    /// for shared vaults only runs no conversation, so has no cards: its Info alone says whether it answers (a vault
    /// admin may not ask a server for cards).
    pub fn poll(&self, settings: &Value) {
        let list = settings["machines"].as_array().cloned().unwrap_or_default();
        let ids: Vec<String> = list.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect();
        self.seen.lock().unwrap().retain(|k, _| ids.contains(k));
        for m in list {
            let (id, c) = (m["id"].as_str().unwrap_or("").to_string(), self.client(&m));
            let stale = self.seen.lock().unwrap().get(&id).is_none_or(|s| s.info_at.is_none_or(|t| t.elapsed() > Duration::from_secs(60)));
            let info = if stale { Some(c.info()) } else { None };
            let pending = if shared_only(&m) { None } else { Some(c.pending()) };
            let mut seen = self.seen.lock().unwrap();
            let s = seen.entry(id).or_default();
            match info { Some(Ok(i)) => { s.info = Some(i); s.info_at = Some(Instant::now()); s.error = None; } Some(Err(e)) => { s.error = Some(e); s.info_at = None; } None => {} }
            match pending { Some(Ok(p)) => { s.pending = p; s.error = None; } Some(Err(e)) => { s.pending.clear(); s.error = Some(e); } None => {} }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rewrite_moves_whole_paths_only() {
        let mac = ["/Users/me/Vault".to_string(), "/Users/me/.claude/projects/-Users-me-Vault/memory".to_string()];
        let srv = ["/w/ab/vault".to_string(), "/w/ab/memory".to_string()];
        let t = r#"{"cwd":"/Users/me/Vault","input":{"file_path":"/Users/me/Vault/Notes/a.md"},"x":"/Users/me/Vault2/b /Users/me/Vault.bak","out":"{\"cwd\": \"/Users/me/Vault\"} in /Users/me/Vault","m":"/Users/me/.claude/projects/-Users-me-Vault/memory/MEMORY.md"}"#;
        let out = rewrite(t, &mac, &srv);
        assert!(out.contains(r#""cwd":"/w/ab/vault""#) && out.contains("/w/ab/vault/Notes/a.md") && out.contains("/w/ab/memory/MEMORY.md"));
        assert!(out.contains(r#"\"/w/ab/vault\""#) && out.ends_with(r#"in /w/ab/vault","m":"/w/ab/memory/MEMORY.md"}"#), "quoted twice, and at a string's end");
        assert!(out.contains("/Users/me/Vault2/b /Users/me/Vault.bak"), "a longer name that only starts the same stays");
        assert_eq!(rewrite(&out, &srv, &mac), t, "and back again");
    }
    #[test]
    fn machines_validate_and_bind() {
        // an older settings file still has project folders: ignored
        let m = json!({"id": "0123456789ab", "name": "LServer", "host": "192.168.1.2", "port": 47800, "fp": "a".repeat(64), "folders": {"Weemaes": "/home/l/weemaes"}});
        assert!(valid(&m));
        for bad in [json!({"host": "a b"}), json!({"port": 0}), json!({"fp": "xyz"})] {
            let mut b = m.clone();
            for (k, v) in bad.as_object().unwrap() { b[k] = v.clone(); }
            assert!(!valid(&b), "{bad}");
        }
        let d = std::env::temp_dir().join(format!("relay-machines-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let ms = Machines::load(&d).unwrap();
        let s = json!({"machines": [m]});
        // without a pick or a default: this Mac, also for a project that had a folder there
        assert!(ms.bind_for(&s, "c:1", false, None).is_none());
        // picked in the composer: that machine, in its vault mirror (cwd "" until its Info is known); this Mac wins too
        assert_eq!(ms.bind_for(&s, "c:5", false, Some("0123456789ab")).unwrap().1, Bind { machine: "0123456789ab".into(), cwd: String::new() });
        assert!(ms.bind_for(&s, "c:4", false, Some("")).is_none());
        assert!(ms.bind_for(&s, "c:8", false, Some("ffffffffffff")).is_none(), "an unknown machine runs nowhere");
        assert_eq!(ms.status_list(&s)[0]["online"], false);
        // where new conversations run by default: a conversation goes there, unless it has a session here or picks this Mac
        let mut g = s.clone();
        g["machines_default"] = json!("0123456789ab");
        assert_eq!(ms.bind_for(&g, "c:9", false, None).unwrap().1.machine, "0123456789ab");
        assert!(ms.bind_for(&g, "c:2", true, None).is_none());
        assert!(ms.bind_for(&g, "c:10", false, Some("")).is_none());
        assert_eq!(ms.status_list(&g)[0]["default"], true);
        assert_eq!(ms.status_list(&s)[0]["default"], false);
        // one for shared vaults only: no mirror round, not offered, never the default, a pick of it runs nowhere there
        let mut o = g.clone();
        o["machines"][0]["sharedOnly"] = json!(true);
        assert!(valid(&o["machines"][0]) && shared_only(&o["machines"][0]) && !shared_only(&g["machines"][0]));
        assert_eq!(runners(&o).count(), 0);
        assert_eq!(runners(&g).count(), 1);
        assert!(ms.bind_for(&o, "c:11", false, None).is_none() && ms.bind_for(&o, "c:11", false, Some("0123456789ab")).is_none());
        assert_eq!(ms.status_list(&o), json!([]));
        ms.set_bind("c:1", Bind { machine: "0123456789ab".into(), cwd: "/x".into() });
        // once bound, the folder in the bind wins, also after a reload
        assert_eq!(Machines::load(&d).unwrap().bind_for(&s, "c:1", true, None).unwrap().1.cwd, "/x");
        ms.rebind("c:1", "c:9");
        assert!(ms.bind_of("c:1").is_none() && ms.bind_of("c:9").is_some());
        assert_eq!(ms.chat_machines(&s)["c:9"]["machine"], "LServer");
        ms.forget("0123456789ab");
        assert!(ms.bind_of("c:9").is_none());
        std::fs::remove_dir_all(d).ok();
    }
}
