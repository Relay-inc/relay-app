// Which vault a project and a conversation belong to, and what a conversation may touch: one place for the identity of
// vaults and projects, the fence around a conversation, and the one transition through which a vault is added while
// agents run. lib.rs, session/mod.rs, actions.rs, pty.rs and shared_vaults.rs ask here.

use super::{data_dir, home, need_vault, pty, shared_vaults, trc, trc_v, App, EnvBuf};
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// The separator in a project key of another vault than the main one: `name \u{1f} vault id`. No project name has it,
/// so such a key never equals a main-vault name.
const SEP: char = '\u{1f}';

/// The extra vaults: the folders the user added (Other vault folders) and those of the shared vaults on a server.
pub fn extra_vaults(s: &Value) -> Vec<String> {
    let mut all = own_extra(s);
    for v in shared_vaults::list(s) { if !all.contains(&v.folder) { all.push(v.folder); } }
    all
}
/// The extra vault folders the user added in Settings, without the shared ones.
pub fn own_extra(s: &Value) -> Vec<String> {
    s["extraVaults"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}
/// The main vault and the extra ones, the main one first.
pub fn all_vaults(s: &Value) -> Vec<String> {
    std::iter::once(s["vault"].as_str().unwrap_or("").to_string()).filter(|v| !v.is_empty()).chain(extra_vaults(s)).collect()
}

/// A vault's lasting id: a shared vault's id on its server, else (a folder of the user's own) a hash of its path.
pub fn vault_id(s: &Value, vault: &str) -> String {
    shared_vaults::list(s).into_iter().find(|v| v.folder == vault).map(|v| v.id)
        .unwrap_or_else(|| relay_remote::sync::sha256_hex(vault.trim_end_matches('/').as_bytes())[..16].to_string())
}
/// The key a project goes by everywhere (conversations, settings, icons): its name in the main vault, else its name
/// and its vault's id. It never changes when another vault gets or loses a project of that name; `label` shows it.
pub fn project_key(s: &Value, vault: &str, name: &str) -> String {
    if s["vault"].as_str() == Some(vault) { name.to_string() } else { format!("{name}{SEP}{}", vault_id(s, vault)) }
}
/// What the sidebar shows for a project: its name, with its vault's folder when another vault has that name too.
pub fn label(name: &str, vault: &str, clash: bool) -> String {
    if !clash { return name.to_string(); }
    let folder = Path::new(vault).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| vault.to_string());
    format!("{name} ({folder})")
}
/// Where a project lives as the last snapshot found it: (its vault, its name there). A key the snapshot never saw is
/// read from its own shape: no separator is the main vault's.
pub fn project_home(st: &App, project: &str) -> Result<(String, String), String> {
    let main = need_vault(st)?;
    let all = all_vaults(&st.settings.lock().unwrap());
    if let Some(found) = st.proj_vault.lock().unwrap().get(project).filter(|(v, _)| all.contains(v)) { return Ok(found.clone()); }
    match project.split_once(SEP) {
        // a vault this Mac has no more: refused rather than read as the main vault's
        Some(_) => Err(format!("{} is in a vault that is not here any more", project.split(SEP).next().unwrap_or(project))),
        None => Ok((main, project.to_string())),
    }
}

/// What a conversation in `dir` may not touch, as Claude Code permission rules (`//` is an absolute path, Edit covers
/// Write and the other editing tools): Read and Edit on every other vault and on its transcripts in each config folder.
/// `data`, for a shared vault: also Relay's data folder, each Claude config folder whole with its `.claude.json` (prompts,
/// MCP servers, settings, hooks, plugins: what runs for the next conversations), and its own `.claude` for Edit.
pub fn fence(dir: &str, vaults: &[String], configs: &[String], data: Option<&str>) -> Vec<String> {
    let rule = |p: &str| ["Read", "Edit"].map(|t| format!("{t}(/{}/**)", p.trim_end_matches('/')));
    let file = |p: &str| ["Read", "Edit"].map(|t| format!("{t}(/{p})"));
    let mut out = vec![];
    for v in vaults.iter().filter(|v| v.trim_end_matches('/') != dir.trim_end_matches('/')) {
        out.extend(rule(v));
        for c in configs { out.extend(rule(&format!("{}/projects/{}", c.trim_end_matches('/'), agent_claude::slug(v.trim_end_matches('/'))))); }
    }
    if let Some(d) = data {
        out.extend(rule(d));
        for c in configs {
            out.extend(rule(c));
            out.extend(file(&format!("{}.json", c.trim_end_matches('/'))));
        }
        out.extend(file(&format!("{}/.claude.json", home())));
        let dir = dir.trim_end_matches('/');
        out.push(format!("Edit(/{dir}/.claude/**)"));
        // and the folder that `.claude` links to (System/ in a vault Relay makes): what Claude Code runs from there
        if let Some(t) = std::fs::canonicalize(format!("{dir}/.claude")).ok().filter(|t| t.starts_with(dir) && t != Path::new(dir)) {
            let t = t.to_string_lossy();
            for x in ["settings.json", "settings.local.json"] { out.push(format!("Edit(/{t}/{x})")); }
            for x in ["hooks", "skills", "agents", "commands"] { out.push(format!("Edit(/{t}/{x}/**)")); }
        }
    }
    out
}
/// What Relay's data folder keeps of the shared vaults in plaintext or as keys: their trash, bases and keys. A
/// main-vault conversation may not read those either.
pub fn shared_copies(data: &str) -> Vec<String> {
    let d = data.trim_end_matches('/');
    ["shared-trash/**", "shared-base/**", "shared-*.key"].iter().flat_map(|x| ["Read", "Edit"].map(|t| format!("{t}(/{d}/{x})"))).collect()
}
/// Whether a folder can be fenced: a permission rule reads `[`, `*`, `?` and `\` in a path as a pattern.
pub fn fenceable(p: &str) -> bool { !p.contains(['[', ']', '*', '?', '\\']) }
/// Whether one vault folder is the other or lies inside it: a fence around one would then cover the other too.
pub fn nested(a: &str, b: &str) -> bool {
    let (a, b) = (Path::new(a), Path::new(b));
    a.starts_with(b) || b.starts_with(a)
}

/// A conversation in `eb.vault` fenced in, in its provider's opts: `deny` gets the fence's rules, and another vault
/// than the main one `fenced` (agent-claude: no own MCP servers or connectors, no hooks, no auto memory, auto mode).
pub fn fence_in(app: &AppHandle, st: &App, eb: &mut EnvBuf) {
    let s = st.settings.lock().unwrap().clone();
    let all = all_vaults(&s);
    let shared = all.first().is_some_and(|main| *main != eb.vault);
    let configs = agent_claude::config_dirs(&eb.env());
    let data = data_dir(app).to_string_lossy().into_owned();
    let mut rules = fence(&eb.vault, &all, &configs, shared.then_some(data.as_str()));
    if !shared && all.len() > 1 { rules.extend(shared_copies(&data)); }
    if !rules.is_empty() {
        let mut deny = eb.opts["deny"].as_array().cloned().unwrap_or_default();
        deny.extend(rules.into_iter().map(Value::from));
        eb.opts["deny"] = json!(deny);
    }
    if shared { eb.opts["fenced"] = json!(true); }
}

/// Whether a conversation runs in another vault than the main one: what it reads of the user's own mail, reminders and
/// calendar could end up in that vault. Its session records the vault at init, before any tool runs.
pub fn in_shared_vault(st: &App, key: &str) -> bool { st.sids.lock().unwrap().get(key).is_some_and(|s| !s.vault.is_empty()) }
/// What such a conversation gets instead of a read of the user's own data.
pub const SHARED_NO_READ: &str = "In a shared vault, reading the user's own mail, reminders and calendar is off: what a note there asks for could end up in the team's vault. Writing to the user (a reminder, a mail draft) still works.";

/// A vault added while agents run here (made, joined, or a folder of the user's own): every agent was fenced without
/// it. Asked first (`may_add_vault`, nothing stopped), then `add_vault` stops them and writes the change under the one
/// lock spawn holds while it fences and starts an agent, so none starts in between with the old fence.
pub fn may_add_vault(app: &AppHandle) -> Result<(), String> {
    let st = app.state::<App>();
    if st.procs.lock().unwrap().values().any(|p| !p.remote && p.turns.busy()) { return Err(trc("err.refence_busy")); }
    let open = app.state::<pty::Ptys>().agents();
    if open > 0 { return Err(trc_v("err.refence_terminals", &open.to_string())); }
    Ok(())
}
/// Take the vault lock and stop every agent here and its terminal tab: their next message starts them again with the
/// fence of the change the caller writes before it drops the lock. Agents on a work machine see the main vault's mirror.
pub fn hold_for_vault(app: &AppHandle) -> std::sync::MutexGuard<'_, ()> {
    let st: &App = app.state::<App>().inner();
    let gate = st.vault_gate.lock().unwrap();
    {
        let mut procs = st.procs.lock().unwrap();
        let keys: Vec<String> = procs.iter().filter(|(_, p)| !p.remote).map(|(k, _)| k.clone()).collect();
        for k in keys { if let Some(mut p) = procs.remove(&k) { p.child.kill().ok(); } }
    }
    app.state::<pty::Ptys>().stop_agents();
    gate
}

/// A folder a vault may be made, joined or added in: by its real path, fenceable, not inside another vault or holding
/// one, and not holding Relay's data, the home folder or a Claude config folder (all of it would sync to the team).
/// `empty`: a joined vault starts in an empty folder.
pub fn check_folder(folder: &str, others: &[String], protected: &[String], empty: bool) -> Result<(), String> {
    let home = home();
    if folder.is_empty() || !folder.starts_with('/') { return Err(trc("err.vault_pick")); }
    if !fenceable(folder) { return Err(trc_v("err.unfenceable_vault", folder)); }
    if let Some(o) = others.iter().find(|o| nested(folder, o)) { return Err(trc_v("err.nested_vault", &format!("{folder}, {o}"))); }
    if let Some(p) = protected.iter().find(|p| Path::new(p).starts_with(folder) || Path::new(folder).starts_with(p)) { return Err(trc_v("err.vault_protected", &format!("{folder}, {p}"))); }
    // the home folder may hold vaults, it may not be one or lie inside one
    if Path::new(&home).starts_with(folder) { return Err(trc_v("err.vault_protected", &format!("{folder}, {home}"))); }
    let full = std::fs::read_dir(folder).is_ok_and(|mut d| d.any(|e| e.is_ok_and(|e| e.file_name() != ".DS_Store")));
    if empty && full { return Err(trc_v("err.vault_not_empty", folder)); }
    Ok(())
}
/// The folders no vault may hold or sit in: Relay's data and the Claude config folders (the home folder: check_folder).
pub fn protected(app: &AppHandle, eb: &EnvBuf) -> Vec<String> {
    let mut p = vec![data_dir(app).to_string_lossy().into_owned()];
    p.extend(agent_claude::config_dirs(&eb.env()));
    p.iter().map(|x| crate::vault::canon(x)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_projects_key_never_moves() {
        let s = json!({"vault": "/me/vault", "sharedVaults": [{"id": "0123456789abcdef", "name": "Team", "host": "h", "port": 1, "fp": "ab", "folder": "/teams/a/shared"}]});
        assert_eq!(project_key(&s, "/me/vault", "Alpha"), "Alpha");
        assert_eq!(project_key(&s, "/teams/a/shared", "Alpha"), "Alpha\u{1f}0123456789abcdef");
        // a folder of the user's own: by its path, so another folder with the same name is another key
        let (a, b) = (project_key(&s, "/teams/b/shared", "Alpha"), project_key(&s, "/teams/c/shared", "Alpha"));
        assert!(a != b && a.starts_with("Alpha\u{1f}"));
        // a main-vault project named like a label is no other project's key
        assert_ne!(project_key(&s, "/me/vault", "Alpha (shared)"), project_key(&s, "/teams/a/shared", "Alpha"));
        assert_eq!((label("Alpha", "/teams/a/shared", false), label("Alpha", "/teams/a/shared", true)), ("Alpha".to_string(), "Alpha (shared)".to_string()));
    }
    #[test]
    fn a_conversation_may_not_read_or_edit_another_vault() {
        let all = ["/me/vault".to_string(), "/team/shared/".to_string()];
        let configs = ["/me/.claude".to_string()];
        let slug = |v: &str| agent_claude::slug(v);
        assert_eq!(fence("/me/vault", &all, &configs, None), [
            "Read(//team/shared/**)".to_string(), "Edit(//team/shared/**)".into(),
            format!("Read(//me/.claude/projects/{}/**)", slug("/team/shared")), format!("Edit(//me/.claude/projects/{}/**)", slug("/team/shared"))]);
        // in a shared vault: the main vault, Relay's data, each config folder whole with its .claude.json, its own .claude
        let shared = fence("/team/shared/", &all, &configs, Some("/me/Library/Application Support/relay"));
        for r in ["Read(//me/vault/**)", "Read(//me/Library/Application Support/relay/**)", "Read(//me/.claude/**)", "Edit(//me/.claude/**)",
                  "Read(//me/.claude.json)", "Edit(//me/.claude.json)", "Edit(//team/shared/.claude/**)"] {
            assert!(shared.contains(&r.to_string()), "{r}");
        }
        assert!(fence("/me/vault", &all[..1], &configs, None).is_empty(), "one vault, nothing to fence");
        let copies = shared_copies("/me/Library/Application Support/relay/");
        assert!(copies.contains(&"Read(//me/Library/Application Support/relay/shared-trash/**)".to_string()));
        assert!(nested("/me/vault/team", "/me/vault") && nested("/me/vault", "/me/vault/team") && !nested("/me/vault", "/me/vault2"));
        assert!(fenceable("/me/Team vault") && !fenceable("/me/Team [x]") && !fenceable("/me/a*b"));
    }
}
