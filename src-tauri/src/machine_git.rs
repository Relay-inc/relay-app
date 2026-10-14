// GitHub and repos on a work machine (relay-server's github.rs): the device flow that connects it, its repos with
// their state, Push and To Mac from Settings › Machines, the repo a conversation there gets at its first start, and the
// check before a conversation moves from there back to this Mac. The token stays on the machine; this Mac only ever
// sees the code to type on GitHub.

use crate::{machines::Machines, need_vault, repo_checkouts, repo_projects, trc, trc_v, App};
use relay_remote::client::Client;
use relay_remote::proto::{DeviceCode, Github, Info, RepoStatus};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

/// The start of the error move_conversation gives when a repo there has work that is not pushed, a JSON object
/// {repo, name, branch, machine} follows. The page recognises it and asks what to do (`choice`).
pub const REPO_WORK: &str = "repo-work:";

/// The repo made ready on a machine for a conversation's first start there: conversation key -> (machine id, repo).
static READY: Mutex<Option<HashMap<String, (String, RepoStatus)>>> = Mutex::new(None);

/// The branch the work of a machine goes to on GitHub: `relay/` and its name, lowercase, every run of other characters
/// one `-` ("Server 2" -> relay/server-2). A name without a letter or digit uses the machine's id.
pub fn snapshot_branch(name: &str, id: &str) -> String {
    let mut s = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() { s.push(c); } else if !s.ends_with('-') { s.push('-'); }
    }
    let s = s.trim_matches('-');
    format!("relay/{}", if s.is_empty() { id } else { s })
}

/// A request to a machine off the main thread. A relay-server from before GitHub there answers "unknown request".
async fn on<T: Send + 'static>(state: &App, id: &str, f: impl FnOnce(Value, Client) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let m = Machines::find(&state.settings.lock().unwrap(), id).ok_or_else(|| trc("err.no_machine"))?;
    let c = state.machines.client(&m);
    tauri::async_runtime::spawn_blocking(move || f(m, c)).await.map_err(|e| e.to_string())?
        .map_err(|e| if e.starts_with("unknown request") { trc("err.machine_no_github") } else { e })
}

#[tauri::command]
pub async fn machine_github(state: State<'_, App>, id: String) -> Result<Github, String> { on(&state, &id, |_, c| c.github()).await }
/// Starts connecting the machine to GitHub: the code to type there. A second start replaces the first.
#[tauri::command]
pub async fn machine_github_connect(state: State<'_, App>, id: String) -> Result<DeviceCode, String> { on(&state, &id, |_, c| c.github_login()).await }
/// Where connecting stands: `pending` until the code is typed on GitHub.
#[tauri::command]
pub async fn machine_github_poll(state: State<'_, App>, id: String) -> Result<Github, String> { on(&state, &id, |_, c| c.github_poll()).await }
#[tauri::command]
pub async fn machine_github_disconnect(state: State<'_, App>, id: String) -> Result<(), String> { on(&state, &id, |_, c| c.github_logout()).await }
#[tauri::command]
pub async fn machine_repos(state: State<'_, App>, id: String) -> Result<Vec<RepoStatus>, String> { on(&state, &id, |_, c| c.repos()).await }
/// Pushes the branch checked out in the repo folder `name` there.
#[tauri::command]
pub async fn machine_repo_push(state: State<'_, App>, id: String, name: String) -> Result<RepoStatus, String> { on(&state, &id, move |_, c| c.repo_push(&name)).await }

/// The work in a repo there to this Mac: a snapshot (commits, changes, new files) on `relay/<machine>` on GitHub, then
/// fetched into this Mac's checkout of that repo as the branch of the same name. Nothing is checked out here and the
/// working tree stays as it is. {branch, dir}.
#[tauri::command]
pub async fn machine_repo_to_mac(state: State<'_, App>, id: String, name: String) -> Result<Value, String> {
    let checkouts = repo_checkouts(&need_vault(&state)?);
    let path = state.path.clone();
    on(&state, &id, move |m, c| {
        let repo = c.repos()?.into_iter().find(|r| r.name == name).ok_or_else(|| trc_v("err.repo_unknown", &name))?;
        let (dir, _) = checkouts.get(&repo.repo.to_lowercase()).ok_or_else(|| trc_v("err.repo_no_checkout", &repo.repo))?;
        let branch = snapshot_branch(m["name"].as_str().unwrap_or(""), m["id"].as_str().unwrap_or(""));
        let git = |args: &[&str]| Command::new("git").env("PATH", &path).arg("-C").arg(dir).args(args).output().map_err(|e| e.to_string());
        // fetching into the branch checked out here would change it under the working tree: git refuses, say why first
        let head = git(&["symbolic-ref", "--quiet", "--short", "HEAD"])?;
        if String::from_utf8_lossy(&head.stdout).trim() == branch { return Err(trc_v("err.repo_branch_out", &format!("{branch} ({dir})"))); }
        c.repo_snapshot(&name, &branch)?;
        let out = git(&["fetch", "origin", &format!("+refs/heads/{branch}:refs/heads/{branch}")])?;
        if !out.status.success() { return Err(format!("git fetch: {}", String::from_utf8_lossy(&out.stderr).trim())); }
        Ok(json!({"branch": branch, "dir": dir}))
    }).await
}

/// Before a conversation's first start on a machine: its project's repo (`owner/repo`) cloned there, or fetched when it
/// is there already, for the start to give the agent (`ready`). A clone may take minutes, so the page asks for this
/// before it sends. Nothing on a machine from before repos there (null).
#[tauri::command]
pub async fn machine_repo_ensure(state: State<'_, App>, id: String, key: String, repo: String) -> Result<Option<RepoStatus>, String> {
    let mid = id.clone();
    let r = on(&state, &id, move |_, c| if c.info()?.repos.is_empty() { Ok(None) } else { c.repo_ensure(&repo).map(Some) }).await?;
    if let Some(r) = &r { READY.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, (mid, r.clone())); }
    Ok(r)
}
/// The repo made ready for this conversation on this machine, for its start there.
pub fn ready(key: &str, machine: &str) -> Option<RepoStatus> {
    READY.lock().unwrap().as_ref()?.get(key).filter(|(m, _)| m == machine).map(|(_, r)| r.clone())
}
/// The line Claude gets about that repo, after what its system prompt already says.
pub fn repo_line(system: Option<&str>, r: &RepoStatus) -> String {
    let line = format!("The GitHub repo {} is checked out at {} on this machine.", r.repo, r.path);
    match system { Some(s) if !s.is_empty() => format!("{s}\n\n{line}"), _ => line }
}

/// A project's repos, `owner/repo` lowercased, sorted as the page lists them.
pub fn project_repos(vault: &str, project: &str) -> Vec<String> {
    let mut v: Vec<String> = repo_projects(vault).into_iter().filter(|(_, p)| p == project).map(|(r, _)| r).collect();
    v.sort();
    v
}

/// Before a conversation moves from machine `m` back to this Mac: does a repo there of its project hold work that is
/// not pushed? Then, unless the user chose (`choice`: "push" snapshots it to `relay/<machine>` first, "move" moves
/// anyway), the move is refused with REPO_WORK. A machine from before repos there is not asked.
pub fn before_move(c: &Client, m: &Value, info: &Info, repos: &[String], choice: Option<&str>) -> Result<(), String> {
    if info.repos.is_empty() || repos.is_empty() || choice == Some("move") { return Ok(()); }
    let work: Vec<RepoStatus> = c.repos()?.into_iter().filter(|r| repos.contains(&r.repo.to_lowercase()) && (r.dirty || r.unpushed > 0)).collect();
    let Some(first) = work.first() else { return Ok(()) };
    let branch = snapshot_branch(m["name"].as_str().unwrap_or(""), m["id"].as_str().unwrap_or(""));
    if choice == Some("push") {
        for r in &work { c.repo_snapshot(&r.name, &branch)?; }
        return Ok(());
    }
    Err(format!("{REPO_WORK}{}", json!({"repo": first.repo, "name": first.name, "branch": branch, "machine": m["name"]})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_machines_branch_is_its_name_as_a_slug() {
        assert_eq!(snapshot_branch("Server", "a1b2"), "relay/server");
        assert_eq!(snapshot_branch("  My Server 2 ", "a1b2"), "relay/my-server-2");
        assert_eq!(snapshot_branch("NAS / Büro", "a1b2"), "relay/nas-b-ro");
        assert_eq!(snapshot_branch("--", "a1b2"), "relay/a1b2");
    }
    #[test]
    fn the_repo_line_follows_the_system_prompt() {
        let r = RepoStatus { repo: "acme/shop".into(), path: "/home/relay/repos/shop".into(), ..Default::default() };
        assert_eq!(repo_line(None, &r), "The GitHub repo acme/shop is checked out at /home/relay/repos/shop on this machine.");
        assert!(repo_line(Some("Be brief."), &r).starts_with("Be brief.\n\nThe GitHub repo acme/shop"));
        READY.lock().unwrap().get_or_insert_with(HashMap::new).insert("c:1".into(), ("m1".into(), r.clone()));
        assert_eq!(ready("c:1", "m1"), Some(r));
        assert_eq!(ready("c:1", "m2"), None, "made ready on another machine");
    }
}
