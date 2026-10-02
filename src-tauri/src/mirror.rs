// The mirror of a work machine (relay-server mirror.rs): what this Mac keeps in sync there, so an agent on the
// machine knows what Claude Code here knows. Opt-in per machine (machine.mirror.on). Four roots:
//   context  ~/.claude/CLAUDE.md, skills, agents, commands      this Mac -> machine, an exact copy
//   plugins  the switched-on plugins (installed_plugins.json)   this Mac -> machine, an exact copy
//   vault    the vault, minus .obsidian, .git and the excludes  both ways, a conflict copy when both changed
//   memory   the vault's auto memory                            both ways, MEMORY.md merged line by line
// The machine keeps them sealed with this Mac's key (mirror-<id>.key here, never stored there) and unpacks them on
// a RAM disk while unlocked. Hooks, transcripts, MCP servers and repos never go: a repo's Claude files belong in git.

use relay_remote::client::Client;
use relay_remote::proto::Info;
use relay_remote::sync::{self, Filter, Manifest, Mode, Report, Walker};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const ROOTS: [(&str, Mode); 4] = [("context", Mode::Replica), ("plugins", Mode::Replica), ("vault", Mode::TwoWay), ("memory", Mode::TwoWay)];

/// What the last rounds did, per machine, for Settings › Machines.
#[derive(Default, Clone, serde::Serialize)]
pub struct Status { pub at: i64, pub pushed: usize, pub pulled: usize, pub conflicts: Vec<String>, pub skipped: Vec<String>, pub errors: Vec<String>, pub locked: bool, pub in_ram: bool }

/// Where a running round is, per machine: root `step` of 4, `done` of `total` files (total 0: still comparing).
#[derive(Clone, serde::Serialize)]
pub struct Progress { pub root: &'static str, pub step: usize, pub done: usize, pub total: usize }

#[derive(Default)]
pub struct Mirrors { walkers: Mutex<HashMap<String, Walker>>, pub status: Mutex<HashMap<String, Status>>, pub progress: Mutex<HashMap<String, Progress>>, busy: Mutex<std::collections::HashSet<String>> }

pub fn on(m: &Value) -> bool { m["mirror"]["on"] == true }
/// The machine's excluded vault folders (relative paths).
pub fn excludes(m: &Value) -> Vec<String> {
    m["mirror"]["exclude"].as_array().into_iter().flatten().filter_map(|x| x.as_str()).map(|x| x.trim_matches('/').to_string()).filter(|x| sync::safe_rel(x)).collect()
}
pub fn valid(m: &Value) -> bool {
    let x = &m["mirror"];
    x.is_null() || (x["on"].is_boolean() && (x["exclude"].is_null() || x["exclude"].as_array().is_some_and(|a| a.len() <= 100 && a.iter().all(|e| e.as_str().is_some_and(|s| s.len() <= 300 && sync::safe_rel(s.trim_matches('/')))))))
}

fn home() -> String { std::env::var("HOME").unwrap_or_default() }
/// This Mac's key for a machine's mirror, made the first time.
pub fn key(data: &Path, id: &str) -> Result<String, String> {
    let p = data.join(format!("mirror-{id}.key"));
    if let Ok(k) = std::fs::read_to_string(&p) { if k.trim().len() == 64 { return Ok(k.trim().into()); } }
    let k = relay_remote::tls::random_key();
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&p).and_then(|mut f| std::io::Write::write_all(&mut f, k.as_bytes())).map_err(|e| e.to_string())?;
    Ok(k)
}

/// The switched-on plugins and where they are installed, from ~/.claude: [(name@marketplace, install path)].
pub fn plugins() -> Vec<(String, PathBuf)> {
    let read = |p: String| std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).unwrap_or(Value::Null);
    let settings = read(format!("{}/.claude/settings.json", home()));
    let installed = read(format!("{}/.claude/plugins/installed_plugins.json", home()));
    let on: Vec<String> = match &settings["enabledPlugins"] {
        Value::Object(m) => m.iter().filter(|(_, v)| v.as_bool().unwrap_or(false)).map(|(k, _)| k.clone()).collect(),
        Value::Array(a) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        _ => vec![],
    };
    on.into_iter().filter_map(|name| {
        let at = installed["plugins"][&name].as_array()?.iter().find(|i| i["scope"] == "user").or_else(|| installed["plugins"][&name].as_array()?.first())?;
        let path = PathBuf::from(at["installPath"].as_str()?);
        path.is_dir().then_some((name, path))
    }).collect()
}
/// The permission rules here (allow, deny, ask from ~/.claude/settings.json), for the machine's sessions.
pub fn permissions() -> Value {
    let s: Value = std::fs::read_to_string(format!("{}/.claude/settings.json", home())).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let p = &s["permissions"];
    json!({"allow": p["allow"].as_array().cloned().unwrap_or_default(), "deny": p["deny"].as_array().cloned().unwrap_or_default(), "ask": p["ask"].as_array().cloned().unwrap_or_default()})
}

/// The local side of a root. Context and plugins are assembled as a folder of symlinks in the app data (the walker
/// follows a linked folder), so the sync sees one root.
fn source(data: &Path, id: &str, root: &str, vault: &str) -> Option<PathBuf> {
    let link = |stage: &Path, name: &str, to: &Path| {
        let at = stage.join(name);
        if std::fs::read_link(&at).ok().as_deref() != Some(to) { std::fs::remove_file(&at).ok(); std::os::unix::fs::symlink(to, &at).ok(); }
    };
    match root {
        "context" => {
            let stage = data.join("mirror-stage").join(id).join("context");
            std::fs::create_dir_all(&stage).ok()?;
            let claude = PathBuf::from(home()).join(".claude");
            for name in ["CLAUDE.md", "skills", "agents", "commands"] {
                if claude.join(name).exists() { link(&stage, name, &claude.join(name)); } else { std::fs::remove_file(stage.join(name)).ok(); }
            }
            Some(stage)
        }
        "plugins" => {
            let stage = data.join("mirror-stage").join(id).join("plugins");
            std::fs::remove_dir_all(&stage).ok(); // the set of switched-on plugins may have changed
            std::fs::create_dir_all(&stage).ok()?;
            for (name, path) in plugins() { link(&stage, &name, &path); }
            Some(stage)
        }
        "vault" => (!vault.is_empty()).then(|| PathBuf::from(vault)),
        "memory" => (!vault.is_empty()).then(|| PathBuf::from(format!("{}/.claude/projects/{}/memory", home(), agent_claude::slug(vault)))),
        _ => None,
    }
}
fn filter(root: &str, m: &Value) -> Filter {
    match root {
        "vault" => { let mut f = Filter::vault_default(); f.prefixes = excludes(m); f }
        // a plugin can ship its node_modules or a git checkout: the plugin itself is enough
        _ => Filter { names: vec![".git".into(), "node_modules".into(), ".DS_Store".into()], prefixes: vec![], max_size: 20 << 20 },
    }
}

impl Mirrors {
    fn base_path(data: &Path, id: &str, root: &str) -> PathBuf { data.join("mirror-base").join(id).join(format!("{root}.json")) }
    fn load_base(data: &Path, id: &str, root: &str) -> Manifest {
        std::fs::read_to_string(Self::base_path(data, id, root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    fn save_base(data: &Path, id: &str, root: &str, b: &Manifest) {
        let p = Self::base_path(data, id, root);
        if let Some(d) = p.parent() { std::fs::create_dir_all(d).ok(); }
        std::fs::write(p, serde_json::to_string(b).unwrap_or_default()).ok();
    }

    /// One round for a machine that answers: unlock its mirror when it is locked, then sync every root.
    pub fn round(&self, data: &Path, m: &Value, client: &Client, info: &Info, vault: &str) -> Status {
        let id = m["id"].as_str().unwrap_or("").to_string();
        if !self.busy.lock().unwrap().insert(id.clone()) { return self.status.lock().unwrap().get(&id).cloned().unwrap_or_default(); }
        let mut st = Status { at: chrono::Utc::now().timestamp(), in_ram: info.in_ram, ..Default::default() };
        // every round, not only when the poller saw it locked: a restarted server is locked before the poller knows
        let unlocked = key(data, &id).and_then(|k| client.unlock(&k)).map_err(|e| st.errors.push(format!("unlock: {e}"))).is_ok();
        st.locked = !unlocked;
        if unlocked {
            let name = m["name"].as_str().unwrap_or("machine").to_string();
            let stamp = chrono::Local::now().format("%Y-%m-%d %H%M").to_string();
            let copy = |p: &str| sync::conflict_copy(p, &name, &stamp);
            let mergeable = |p: &str| p.rsplit('/').next() == Some("MEMORY.md");
            for (step, (root, mode)) in ROOTS.into_iter().enumerate() {
                let Some(src) = source(data, &id, root, vault) else { continue };
                if mode == Mode::TwoWay { std::fs::create_dir_all(&src).ok(); }
                let base = Self::load_base(data, &id, root);
                // a round with nothing to send stays quiet; only a first round shows its (long) comparing
                let first = base.is_empty();
                let progress = |done, total| { if total > 0 || first { self.progress.lock().unwrap().insert(id.clone(), Progress { root, step: step + 1, done, total }); } };
                let mut walkers = self.walkers.lock().unwrap();
                let w = walkers.entry(format!("{id}/{root}")).or_default();
                let (next, r): (Manifest, Report) = sync::run(mode, &src, &base, w, &filter(root, m), &client.root(root), &copy, &mergeable, &progress);
                drop(walkers);
                Self::save_base(data, &id, root, &next);
                st.pushed += r.pushed.len() + r.deleted_remote.len();
                st.pulled += r.pulled.len() + r.deleted_local.len() + r.merged.len();
                st.conflicts.extend(r.conflicts.into_iter().map(|c| format!("{root}/{c}")));
                st.skipped.extend(r.skipped.into_iter().map(|c| format!("{root}/{c}")));
                st.errors.extend(r.errors.into_iter().map(|c| format!("{root}: {c}")));
            }
        }
        self.progress.lock().unwrap().remove(&id);
        self.busy.lock().unwrap().remove(&id);
        let mut all = self.status.lock().unwrap();
        // the counts add up over the rounds since the app started, conflicts stay listed
        let prev = all.remove(&id).unwrap_or_default();
        let mut conflicts = prev.conflicts;
        for c in st.conflicts.drain(..) { if !conflicts.contains(&c) { conflicts.push(c); } }
        let st = Status { pushed: prev.pushed + st.pushed, pulled: prev.pulled + st.pulled, conflicts, ..st };
        all.insert(id, st.clone());
        st
    }

    /// Forget this Mac's side of a machine's mirror: the bases (so a new mirror starts from nothing) and the stage.
    pub fn forget(&self, data: &Path, id: &str) {
        std::fs::remove_dir_all(data.join("mirror-base").join(id)).ok();
        std::fs::remove_dir_all(data.join("mirror-stage").join(id)).ok();
        self.status.lock().unwrap().remove(id);
        self.walkers.lock().unwrap().retain(|k, _| !k.starts_with(&format!("{id}/")));
    }
}

/// The flags a session on a machine with a mirror gets: the context folder (its CLAUDE.md, skills, agents, commands),
/// each plugin, the permissions here, and the vault's memory when it runs in the vault. `cwd` is the session's folder there.
pub fn session_args(info: &Info, cwd: &str) -> (Vec<String>, Vec<(String, String)>) {
    let work = PathBuf::from(&info.work);
    let mut args = vec!["--add-dir".to_string(), work.join("context").to_string_lossy().into_owned()];
    for (name, _) in plugins() { args.extend(["--plugin-dir".into(), work.join("plugins").join(name).to_string_lossy().into_owned()]); }
    let mut settings = json!({"permissions": permissions()});
    if Path::new(cwd).starts_with(work.join("vault")) { settings["autoMemoryDirectory"] = json!(work.join("memory").to_string_lossy()); }
    args.extend(["--settings".into(), settings.to_string()]);
    (args, vec![("CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD".into(), "1".into())])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_validate_and_flags() {
        assert!(valid(&json!({})) && valid(&json!({"mirror": {"on": true, "exclude": ["Communication/transcripts", "/Archive/"]}})));
        assert!(!valid(&json!({"mirror": {"on": "yes"}})) && !valid(&json!({"mirror": {"on": true, "exclude": ["../x"]}})));
        assert_eq!(excludes(&json!({"mirror": {"on": true, "exclude": ["/Archive/", "a/../b"]}})), vec!["Archive".to_string()]);
        let info = Info { work: "/w/dev".into(), ..Default::default() };
        let (args, env) = session_args(&info, "/w/dev/vault");
        assert_eq!(&args[..2], ["--add-dir", "/w/dev/context"]);
        let s: Value = serde_json::from_str(args.last().unwrap()).unwrap();
        assert_eq!(s["autoMemoryDirectory"], "/w/dev/memory");
        assert!(s["permissions"]["allow"].is_array());
        assert_eq!(env[0].0, "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD");
        let (args, _) = session_args(&info, "/home/relay/repos/x");
        assert!(serde_json::from_str::<Value>(args.last().unwrap()).unwrap()["autoMemoryDirectory"].is_null(), "memory only for the vault");
    }
}
