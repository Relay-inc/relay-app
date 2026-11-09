// Which vault a project and a conversation belong to, and what a conversation may touch: one place for the identity of
// vaults and projects, the fence around a conversation, and the one transition through which a vault is added while
// agents run. lib.rs, session/mod.rs, actions.rs, pty.rs and shared_vaults.rs ask here.

use super::{data_dir, home, need_vault, pty, shared_vaults, trc, trc_v, App, EnvBuf};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
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

/// The vault picked for a new general conversation, checked against the vaults here: `None` for the main vault (none
/// picked, or the main one picked), an error for anything else. The webview never names a folder of its own.
pub fn picked_vault(s: &Value, asked: Option<&str>) -> Result<Option<String>, String> {
    let Some(v) = asked.filter(|v| !v.is_empty()) else { return Ok(None) };
    let all = all_vaults(s);
    if !all.iter().any(|x| x == v) { return Err(trc_v("err.vault_unknown", v)); }
    Ok((all.first().map(String::as_str) != Some(v)).then(|| v.to_string()))
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

/// The Claude config folders here: the accounts in Settings, and one removed from the list since that a conversation
/// still runs on (as env_of has it), its transcripts are still there.
fn config_dirs(st: &App, eb: &EnvBuf) -> Vec<String> {
    let mut c = agent_claude::config_dirs(&eb.env());
    c.extend(st.sids.lock().unwrap().values().filter(|x| x.provider == "claude" && !x.account.is_empty()).map(|x| x.account.clone()));
    c.sort();
    c.dedup();
    c
}

/// The fence's rules for a conversation in `eb.vault`, and whether that is another vault than the main one.
fn rules_for(app: &AppHandle, st: &App, eb: &EnvBuf) -> (Vec<String>, bool) {
    let s = st.settings.lock().unwrap().clone();
    let all = all_vaults(&s);
    let shared = all.first().is_some_and(|main| *main != eb.vault);
    let configs = config_dirs(st, eb);
    let data = data_dir(app).to_string_lossy().into_owned();
    let mut rules = fence(&eb.vault, &all, &configs, shared.then_some(data.as_str()));
    if !shared && all.len() > 1 { rules.extend(shared_copies(&data)); }
    (rules, shared)
}

/// A conversation in `eb.vault` fenced in, in its grants: `deny` gets the fence's rules, and another vault
/// than the main one `fenced` (agent-claude: no own MCP servers or connectors, no hooks, no auto memory, auto mode.
/// agent-codex: its sandbox kept and its approvals to the user, so they reach `guard`).
pub fn fence_in(app: &AppHandle, st: &App, eb: &mut EnvBuf) {
    let (rules, shared) = rules_for(app, st, eb);
    if !rules.is_empty() {
        eb.grants.deny.extend(rules);
    }
    if shared { eb.grants.fenced = true; }
}

/// The agents a conversation in a workspace or another vault folder may run with: Claude Code applies the fence's
/// rules itself, Relay guards Codex (`guard`). OpenCode and Pi get no fence, they run in the main vault only.
pub const FENCED_AGENTS: [&str; 2] = ["claude", "codex"];
/// The agents whose CLI does not read the fence's rules: Relay checks each permission request they raise.
const GUARDED: [&str; 1] = ["codex"];
/// What a guarded agent may name outside a workspace without a deny: the system's programs and devices (Codex asks
/// for `/bin/zsh -lc '…'`).
const SYSTEM: [&str; 5] = ["/bin/", "/sbin/", "/usr/", "/opt/homebrew/", "/dev/"];

/// Relay's fence for an agent whose CLI does not read the rules: the same rules `fence` makes, and in another vault
/// than the main one that vault, outside which nothing may be asked for. A guard, not a sandbox: it sees only what the
/// agent asks permission for, so what its own sandbox lets it do unasked (reading anywhere, writing in the vault) and a
/// path a command builds at run time get past it.
pub struct Guard { rules: Vec<String>, dir: String, shared: bool, home: String }

/// The guard for a conversation of `p` in `vault`, for an agent in GUARDED.
pub fn guard(app: &AppHandle, st: &App, p: &dyn agent_core::AgentProvider, vault: &str) -> Option<Guard> {
    if !GUARDED.contains(&p.id()) { return None; }
    let mut eb = super::env_of(app, st, p);
    eb.vault = vault.into();
    let (rules, shared) = rules_for(app, st, &eb);
    Some(Guard { rules, dir: vault.trim_end_matches('/').into(), shared, home: home() })
}

/// The answer to a request the guard blocks, in the provider's protocol: a deny, given before it becomes a card.
pub fn screen(g: &Guard, p: &dyn agent_core::AgentProvider, r: &agent_core::pending::Request) -> Option<String> {
    let path = blocked(g, r)?;
    p.respond(r, &json!({"behavior": "deny", "message": format!("{path} is outside this conversation's fence")}))
}

/// The first path a request names that the guard keeps the agent from: a file it changes, or of a command its folder
/// and every word that reads as a path (absolute, `~`, `$HOME`, or with `..`, against the command's folder).
fn blocked(g: &Guard, r: &agent_core::pending::Request) -> Option<String> {
    let cwd = r.input["cwd"].as_str().filter(|c| c.starts_with('/')).unwrap_or(&g.dir);
    let at = |t: &str| -> Option<String> {
        let t = t.strip_prefix("${HOME}").or_else(|| t.strip_prefix("$HOME")).map(|x| format!("{}{x}", g.home))
            .or_else(|| (t == "~" || t.starts_with("~/")).then(|| format!("{}{}", g.home, &t[1..]))).unwrap_or_else(|| t.to_string());
        if t.starts_with('/') { Some(lexical(Path::new(&t))) } else if t.contains("..") { Some(lexical(&Path::new(cwd).join(t))) } else { None }
    };
    let mut paths = vec![lexical(Path::new(cwd))];
    if r.tool_name == "Bash" {
        let cmd = r.input["command"].as_str().unwrap_or("");
        paths.extend(cmd.split(|c: char| c.is_whitespace() || "'\"`=;|&<>()".contains(c)).filter_map(at));
    } else {
        let named = r.input["paths"].as_array().into_iter().flatten().chain(std::iter::once(&r.input["file_path"]));
        paths.extend(named.filter_map(|p| p.as_str()).filter_map(|p| if p.starts_with('/') { at(p) } else { Some(lexical(&Path::new(cwd).join(p))) }));
    }
    let inside = |p: &str| p == g.dir || p.starts_with(&format!("{}/", g.dir)) || SYSTEM.iter().any(|s| p.starts_with(s));
    paths.into_iter().find(|p| (g.shared && !inside(p)) || g.rules.iter().any(|r| hits(r, p)))
}
/// A path with its `.` and `..` worked out, without asking the disk.
fn lexical(p: &Path) -> String {
    let mut out = std::path::PathBuf::from("/");
    for c in p.components() {
        match c { std::path::Component::ParentDir => { out.pop(); } std::path::Component::Normal(x) => out.push(x), _ => {} }
    }
    out.to_string_lossy().into_owned()
}
/// Whether a rule of `fence` or `shared_copies` (`Read(//a/b/**)`, `Edit(//a/x.json)`, `Read(//d/shared-*.key)`)
/// covers a path, whatever its tool: a guarded agent's command may read or write.
// ponytail: only the shapes those two functions make (a `/**` end, one `*` in a file name), a full glob if they grow
fn hits(rule: &str, path: &str) -> bool {
    let Some(pat) = rule.split_once('(').and_then(|(_, r)| r.strip_suffix(')')).and_then(|r| r.strip_prefix('/')) else { return false };
    if let Some(dir) = pat.strip_suffix("/**") { return path == dir || path.starts_with(&format!("{dir}/")); }
    match pat.split_once('*') {
        Some((a, b)) => path.len() >= a.len() + b.len() && path.starts_with(a) && path.ends_with(b) && !path[a.len()..path.len() - b.len()].contains('/'),
        None => path == pat,
    }
}

/// Whether a conversation runs in another vault than the main one: what it reads of the user's own mail, reminders and
/// calendar could end up in that vault. Its session records the vault at init, before any tool runs.
pub fn in_shared_vault(st: &App, key: &str) -> bool { st.sids.lock().unwrap().get(key).is_some_and(|s| !s.vault.is_empty()) }
/// What such a conversation gets instead of a read of the user's own data.
pub const SHARED_NO_READ: &str = "In a workspace or another vault folder, reading the user's own mail, reminders and calendar is off: what a note there asks for could end up in a folder the team shares. Writing to the user (a reminder, a mail draft) still works.";

/// A vault added while agents run here (made, joined, or a folder of the user's own): every agent was fenced without
/// it. Asked first (`may_add_vault`, nothing stopped), which reserves the change: until the caller drops the reservation
/// no turn is sent and no agent terminal opens (`adding`), so the stop that follows a server's answer stops no turn that
/// began meanwhile. Then `hold_for_vault` stops the agents and the change is written under the vault lock, the one every
/// start holds while it fences and starts an agent. Lock order everywhere: `vault_gate`, then `procs`.
pub fn may_add_vault(app: &AppHandle) -> Result<Adding, String> {
    if ADDING.swap(true, Ordering::SeqCst) { return Err(trc("err.refence_busy")); }
    let adding = Adding(());
    let st = app.state::<App>();
    let capturing = !CAPTURES.lock().unwrap().is_empty();
    if capturing || st.procs.lock().unwrap().values().any(|p| !p.remote && p.turns.busy()) { return Err(trc("err.refence_busy")); }
    let open = app.state::<pty::Ptys>().agents();
    if open > 0 { return Err(trc_v("err.refence_terminals", &open.to_string())); }
    Ok(adding)
}
static ADDING: AtomicBool = AtomicBool::new(false);
/// A vault change reserved by `may_add_vault`, until dropped.
pub struct Adding(());
impl Drop for Adding { fn drop(&mut self) { ADDING.store(false, Ordering::SeqCst); } }
/// Whether a vault is being added: a new turn or agent terminal waits for it (checked under `procs` or `vault_gate`).
pub fn adding() -> bool { ADDING.load(Ordering::SeqCst) }
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
    // a capture started after may_add_vault looked: it runs with the old fence
    for pid in CAPTURES.lock().unwrap().iter() { std::process::Command::new("kill").args(["-9", &pid.to_string()]).status().ok(); }
    gate
}
/// The vault captures running now (lib.rs capture_vault), by pid: busy like a turn for a vault change.
pub static CAPTURES: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

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
    p.extend(config_dirs(&app.state::<App>(), eb));
    p.iter().map(|x| crate::vault::canon(x)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
    fn a_picked_vault_is_one_of_the_vaults_here() {
        let s = json!({"vault": "/me/vault", "extraVaults": ["/me/other"], "sharedVaults": [{"id": "0123456789abcdef", "name": "Team", "host": "h", "port": 1, "fp": "ab", "folder": "/teams/a/shared"}]});
        assert_eq!(picked_vault(&s, None), Ok(None));
        assert_eq!(picked_vault(&s, Some("")), Ok(None));
        assert_eq!(picked_vault(&s, Some("/me/vault")), Ok(None), "the main vault is no pick");
        assert_eq!(picked_vault(&s, Some("/teams/a/shared")), Ok(Some("/teams/a/shared".into())));
        assert_eq!(picked_vault(&s, Some("/me/other")), Ok(Some("/me/other".into())));
        // a folder that is no vault here, also one inside a vault or written another way, is refused
        for bad in ["/etc", "/me/vault/Contexts", "/teams/a/shared/", "/teams/a/../a/shared", "relative"] { assert!(picked_vault(&s, Some(bad)).is_err(), "{bad}"); }
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
    /// What codex asks, through its own parser, and what Relay does with it: the deny line, or None for a card.
    fn ask(g: &Guard, lines: &[serde_json::Value]) -> Option<String> {
        let p: &dyn agent_core::AgentProvider = &agent_codex::PROVIDER;
        let mut parse = p.parser();
        let mut evs = vec![];
        for l in lines { evs.extend(parse(&l.to_string())); }
        let Some(agent_core::Event::Permission { request }) = evs.into_iter().find(|e| matches!(e, agent_core::Event::Permission { .. })) else { panic!("no card") };
        screen(g, p, &request)
    }
    fn cmd(command: &str, cwd: &str) -> Vec<serde_json::Value> {
        vec![json!({"id": 7, "method": "item/commandExecution/requestApproval", "params": {"threadId": "t", "turnId": "u", "itemId": "c", "command": command, "cwd": cwd}})]
    }
    fn patch(path: &str) -> Vec<serde_json::Value> {
        vec![json!({"method": "item/started", "params": {"item": {"type": "fileChange", "id": "f", "status": "inProgress", "changes": [{"path": "/team/shared/a.md", "kind": {"type": "update"}, "diff": "x"}, {"path": path, "kind": {"type": "add"}, "diff": "y"}]}}}),
             json!({"id": "r8", "method": "item/fileChange/requestApproval", "params": {"threadId": "t", "turnId": "u", "itemId": "f"}})]
    }
    #[test]
    fn codex_is_denied_outside_its_workspace_before_a_card() {
        let all = ["/me/vault".to_string(), "/team/shared".to_string()];
        let configs = ["/me/.claude".to_string()];
        let g = Guard { rules: fence("/team/shared", &all, &configs, Some("/me/data")), dir: "/team/shared".into(), shared: true, home: "/me".into() };
        let deny = r#"{"id":7,"result":{"decision":"decline"}}"#.to_string();
        for out in ["/bin/zsh -lc 'cat /me/vault/Inbox.md'", "cat ~/notes.txt", "cat $HOME/x", "cat ../other/x", "cp a.md /tmp/a.md", "ls /me/data"] {
            assert_eq!(ask(&g, &cmd(out, "/team/shared")), Some(deny.clone()), "{out}");
        }
        assert_eq!(ask(&g, &cmd("ls", "/me/vault")), Some(deny.clone()), "a command run from another folder");
        for ok in ["/bin/zsh -lc 'printf hi > hello.txt'", "curl -s https://example.com 2>/dev/null", "git -C ./Projects push", "/usr/bin/git status"] {
            assert_eq!(ask(&g, &cmd(ok, "/team/shared")), None, "{ok}");
        }
        // a patch is denied for any one of its files outside, or inside on what the fence keeps (its .claude)
        assert_eq!(ask(&g, &patch("/me/vault/x.md")), Some(r#"{"id":"r8","result":{"decision":"decline"}}"#.into()));
        assert!(ask(&g, &patch("/team/shared/.claude/settings.json")).is_some());
        assert_eq!(ask(&g, &patch("/team/shared/b.md")), None);
        // a main-vault conversation may leave its vault, not into another one or the workspaces' keys
        let mut rules = fence("/me/vault", &all, &configs, None);
        rules.extend(shared_copies("/me/data"));
        let main = Guard { rules, dir: "/me/vault".into(), shared: false, home: "/me".into() };
        assert!(ask(&main, &cmd("cat /team/shared/x.md", "/me/vault")).is_some());
        assert!(ask(&main, &cmd("cat /me/data/shared-0a.key", "/me/vault")).is_some());
        assert_eq!(ask(&main, &cmd("cat /me/code/app/README.md /me/data/shared-0a/key", "/me/vault")), None);
    }
    #[test]
    fn workspaces_run_claude_code_and_codex_only() {
        let ids: Vec<&str> = crate::agents::PROVIDERS.iter().map(|p| p.id()).collect();
        assert_eq!(ids.iter().filter(|i| FENCED_AGENTS.contains(i)).collect::<Vec<_>>(), [&"claude", &"codex"]);
        assert!(ids.contains(&"opencode") && ids.contains(&"pi"));
        // every guarded agent answers a deny in its own protocol
        assert!(GUARDED.iter().all(|id| FENCED_AGENTS.contains(id)));
    }
}
