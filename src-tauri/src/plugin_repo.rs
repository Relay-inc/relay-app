// Plugins from a GitHub repo (the other half of plugins.rs). A repo is a plugin when it has a `relay-plugin.json` in its
// root: name, command, args, env, secrets, an optional `install` command, the name Claude Code knows it by and a
// description. "Add from GitHub" resolves a ref (tag, branch, commit, the default branch when none) to a commit, downloads
// that commit's tarball with the user's gh login (public repos work without one), unpacks it into a staging folder and
// reads the manifest: that is `plugin_github_fetch`, which runs nothing. The settings page shows what would run, and only
// `plugin_install` (after the user confirmed) moves the folder to `plugins/<id>/` in the app data folder, runs the
// manifest's install command there and returns the entry. An update is the same with the folder swapped, the old one kept
// until the new one installed. Removing deletes the folder (never one outside `plugins/`).
//
// Claude Code can be given the same server (`claude mcp add-json --scope user`), so the agent calls the plugin's tools
// and the inline views match. That copies the plugin's secrets into Claude Code's own config, which the user chose on the
// confirmation card, so a save of a synced plugin writes it again (`plugin_claude_sync`).

use serde_json::{json, Value};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::plugins::{entry, keychain_get, service, slug, string_list, strings, valid_env_name};
use crate::{fs, home, in_path, trc, trc_v, App};

const MANIFEST: &str = "relay-plugin.json";
/// How long an install command may run.
const INSTALL_LIMIT: Duration = Duration::from_secs(10 * 60);

/// Where the plugins live (and `.staging` for downloads that wait for the user's answer).
pub fn dir(app: &AppHandle) -> PathBuf { crate::data_dir(app).join("plugins") }
fn staging(app: &AppHandle) -> PathBuf { dir(app).join(".staging") }

// ---------- what the user typed

/// `owner/repo` and the ref after an `@`, from `github.com/owner/repo@v1`, `https://github.com/owner/repo.git` or
/// `owner/repo`. Only the characters GitHub allows in a name and in a ref (a ref goes into an API path).
pub fn parse_spec(text: &str) -> Option<(String, Option<String>)> {
    let t = text.trim();
    let t = t.strip_prefix("https://").or_else(|| t.strip_prefix("http://")).unwrap_or(t);
    let t = t.strip_prefix("www.").unwrap_or(t);
    let t = t.strip_prefix("github.com/").unwrap_or(t);
    let (repo, rf) = match t.split_once('@') { Some((r, f)) => (r, Some(f)), None => (t, None) };
    let repo = repo.trim_end_matches('/').trim_end_matches(".git");
    let name_ok = |s: &str| !s.is_empty() && s.len() <= 100 && !s.chars().all(|c| c == '.') && s.chars().all(|c| c.is_ascii_alphanumeric() || "-._".contains(c));
    let (owner, name) = repo.split_once('/')?;
    if !name_ok(owner) || !name_ok(name) { return None; }
    let rf = match rf {
        None | Some("") => None,
        Some(f) if f.len() <= 200 && !f.contains("..") && !f.starts_with('/') && f.chars().all(|c| c.is_ascii_alphanumeric() || "-._/".contains(c)) => Some(f.to_string()),
        Some(_) => return None,
    };
    Some((format!("{owner}/{name}"), rf))
}

// ---------- the manifest

/// The manifest, checked strictly (a field of the wrong shape is an error that names it, a field it does not know is
/// ignored) and normalized to `{name, command, args, env, secrets, install, mcp, description}`.
pub fn manifest(text: &str) -> Result<Value, String> {
    let m: Value = serde_json::from_str(text).map_err(|_| trc_v("err.repo_manifest", "JSON"))?;
    let bad = |field: &str| trc_v("err.repo_manifest", field);
    let text_in = |k: &str, max: usize| m[k].as_str().filter(|s| (1..=max).contains(&s.chars().count()) && !s.contains('\0'));
    let name = text_in("name", 60).ok_or_else(|| bad("name"))?;
    let command = text_in("command", 500).ok_or_else(|| bad("command"))?;
    let args = if m["args"].is_null() { vec![] } else { strings(&m["args"], 50, 2000).ok_or_else(|| bad("args"))? };
    let secrets = if m["secrets"].is_null() { vec![] } else { strings(&m["secrets"], 20, 60).ok_or_else(|| bad("secrets"))? };
    let env = if m["env"].is_null() { json!({}) } else { m["env"].clone() };
    let env_ok = env.as_object().is_some_and(|e| e.len() <= 50 && e.iter().all(|(k, v)| valid_env_name(k) && v.as_str().is_some_and(|v| v.len() <= 2000 && !v.contains('\0'))));
    if !env_ok { return Err(bad("env")); }
    if !secrets.iter().all(|s| valid_env_name(s) && env.get(*s).is_none()) { return Err(bad("secrets")); }
    let optional = |k: &str, max: usize| if m[k].is_null() { Ok(None) } else { text_in(k, max).map(Some).ok_or_else(|| bad(k)) };
    let install = optional("install", 2000)?;
    let description = optional("description", 500)?;
    let mcp = optional("mcp", 100)?;
    if mcp.is_some_and(|n| !n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) { return Err(bad("mcp")); }
    Ok(json!({"name": name, "command": command, "args": args, "env": env, "secrets": secrets, "install": install, "mcp": mcp, "description": description}))
}

/// What the manifest's command and arguments are once installed in `base`: `${pluginDir}` is the folder, and an argument
/// that is a file of the download (`server.mjs`) is made absolute so it starts from wherever the app was opened. `seen`
/// is where the files are now (the staged copy), `base` where they will be.
pub fn resolve(seen: &Path, base: &Path, command: &str, args: &[String]) -> (String, Vec<String>) {
    let at = |s: &str| s.replace("${pluginDir}", &base.to_string_lossy());
    let command = if command.starts_with("./") { base.join(&command[2..]).to_string_lossy().into_owned() } else { at(command) };
    let args = args.iter().map(|a| {
        let a = at(a);
        let rel = !a.starts_with(['-', '/']) && !a.contains("..") && seen.join(&a).is_file();
        if rel { base.join(&a).to_string_lossy().into_owned() } else { a }
    }).collect();
    (command, args)
}

// ---------- download and unpack

/// Why a tarball must not be unpacked, from `tar -tf` (the names) and `tar -tvf` (their types, the first character of a
/// line): a name that is absolute or climbs out with `..`, a symlink or a hard link (it could point anywhere).
pub fn unsafe_entry(names: &str, verbose: &str) -> Option<String> {
    if names.lines().count() != verbose.lines().count() { return Some("listing".into()); }
    for (name, line) in names.lines().zip(verbose.lines()) {
        if name.starts_with('/') || name.split('/').any(|p| p == "..") || line.starts_with(['l', 'h']) { return Some(name.into()); }
    }
    None
}

/// An answer from GitHub's API: with gh when it is installed (so a private repo works with the user's login), else, or
/// when gh fails, unauthenticated with curl.
fn github(state: &App, path: &str) -> Result<Vec<u8>, String> {
    let mut why = String::new();
    if let Some(gh) = in_path(state, "gh") {
        let o = Command::new(gh).args(["api", path]).env("PATH", &state.path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if o.status.success() { return Ok(o.stdout); }
        why = String::from_utf8_lossy(&o.stderr).trim().to_string();
    }
    let url = format!("https://api.github.com/{path}");
    let o = Command::new("/usr/bin/curl").args(["-sfL", "-m", "120", "-H", "Accept: application/vnd.github+json", "-H", "User-Agent: relay", &url]).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { return Ok(o.stdout); }
    Err(trc_v("err.repo_download", if why.is_empty() { "not found, or private and gh is not signed in" } else { &why }))
}

/// The commit a ref points to, `{sha, date, message}`; the default branch when there is no ref.
fn commit(state: &App, repo: &str, rf: Option<&str>) -> Result<Value, String> {
    let c: Value = serde_json::from_slice(&github(state, &format!("repos/{repo}/commits/{}", rf.unwrap_or("HEAD")))?).map_err(|e| e.to_string())?;
    let sha = c["sha"].as_str().filter(|s| s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())).ok_or_else(|| trc_v("err.repo_download", repo))?;
    Ok(json!({"sha": sha, "date": c["commit"]["committer"]["date"], "message": c["commit"]["message"].as_str().unwrap_or("").lines().next().unwrap_or("")}))
}

fn tar(args: &[&str], dir: &Path) -> Result<String, String> {
    let o = Command::new("/usr/bin/tar").args(args).current_dir(dir).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into_owned()) } else { Err(trc_v("err.repo_tar", String::from_utf8_lossy(&o.stderr).trim())) }
}
/// Unpack a GitHub tarball (everything inside one top folder) into `into`, after the listing was checked.
fn unpack(tarball: &Path, into: &Path) -> Result<(), String> {
    let (file, work) = (tarball.to_string_lossy(), tarball.parent().unwrap());
    if let Some(entry) = unsafe_entry(&tar(&["-tzf", &file], work)?, &tar(&["-tvzf", &file], work)?) { return Err(trc_v("err.repo_tar", &entry)); }
    fs::create_dir_all(into).map_err(|e| e.to_string())?;
    tar(&["-xzf", &file, "-C", &into.to_string_lossy(), "--strip-components=1", "--no-same-owner"], work)?;
    Ok(())
}

/// A folder under `.staging`, named by digits only (what the webview hands back).
fn stage_dir(app: &AppHandle, stage: &str) -> Result<PathBuf, String> {
    let d = staging(app).join(stage);
    if stage.is_empty() || stage.len() > 30 || !stage.chars().all(|c| c.is_ascii_digit()) || !d.is_dir() { return Err(trc("err.repo_stage")); }
    Ok(d)
}

/// Whether `path` is a real folder or file inside `root` (not `root` itself), symlinks and `..` resolved: the only places
/// Relay deletes from.
pub fn inside(root: &Path, path: &Path) -> bool {
    let (Ok(root), Ok(path)) = (root.canonicalize(), path.canonicalize()) else { return false };
    path != root && path.starts_with(&root)
}

/// The card for an install or an update: what was downloaded and what would run. `id` is the plugin to update, else the
/// plugin gets a new one.
fn download(app: &AppHandle, repo: &str, rf: Option<&str>, update: Option<&str>) -> Result<Value, String> {
    let state = app.state::<App>();
    let c = commit(&state, repo, rf)?;
    let sha = c["sha"].as_str().unwrap();
    // downloads nobody answered (the app quit with a card open) go away with the next one
    let root = staging(app);
    for old in fs::read_dir(&root).into_iter().flatten().flatten() {
        let aged = old.metadata().and_then(|m| m.modified()).is_ok_and(|t| t.elapsed().is_ok_and(|e| e > Duration::from_secs(3600)));
        if aged { fs::remove_dir_all(old.path()).ok(); }
    }
    let stage = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default().to_string();
    let work = root.join(&stage);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let built = (|| {
        let tarball = work.join("source.tgz");
        fs::write(&tarball, github(&state, &format!("repos/{repo}/tarball/{sha}"))?).map_err(|e| e.to_string())?;
        unpack(&tarball, &work.join("tree"))?;
        let text = fs::read_to_string(work.join("tree").join(MANIFEST)).map_err(|_| trc("err.repo_nomanifest"))?;
        let m = manifest(&text)?;
        let id = match update {
            Some(id) => id.to_string(),
            None => {
                let taken: Vec<String> = state.settings.lock().unwrap()["plugins"].as_array().into_iter().flatten().filter_map(|p| p["id"].as_str().map(String::from)).collect();
                let base = slug(m["name"].as_str().unwrap());
                (1..).map(|i| if i == 1 { base.clone() } else { format!("{base}-{i}") }).find(|c| !taken.contains(c) && !dir(app).join(c).exists()).unwrap()
            }
        };
        let (command, args) = resolve(&work.join("tree"), &dir(app).join(&id), m["command"].as_str().unwrap(), &string_list(&m["args"]));
        let claude = m["mcp"].as_str().unwrap_or(&id).to_string();
        let exists = fs::read_to_string(format!("{}/.claude.json", home())).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some_and(|c| c["mcpServers"].get(&claude).is_some());
        fs::write(work.join("meta.json"), json!({"repo": repo, "ref": rf, "sha": sha, "id": id}).to_string()).map_err(|e| e.to_string())?;
        // what an update changes in what runs, against the manifest that sits in the installed folder
        let changed: Vec<&str> = update.and_then(|id| fs::read_to_string(dir(app).join(id).join(MANIFEST)).ok()).and_then(|t| manifest(&t).ok())
            .map(|old| ["command", "args", "env", "secrets", "install"].into_iter().filter(|k| old[*k] != m[*k]).collect()).unwrap_or_default();
        Ok(json!({"stage": stage, "repo": repo, "owner": repo.split('/').next(), "ref": rf, "sha": sha, "date": c["date"], "message": c["message"],
            "id": id, "name": m["name"], "description": m["description"], "command": command, "args": args, "env": m["env"], "secrets": m["secrets"],
            "install": m["install"], "claude": claude, "claudeExists": exists, "changed": changed}))
    })();
    if built.is_err() { fs::remove_dir_all(&work).ok(); }
    built
}

/// Add from GitHub, step one: download and read the manifest, run nothing. The answer is the confirmation card.
#[tauri::command]
pub async fn plugin_github_fetch(app: AppHandle, spec: String) -> Result<Value, String> {
    let (repo, rf) = parse_spec(&spec).ok_or_else(|| trc_v("err.repo_spec", spec.trim()))?;
    tauri::async_runtime::spawn_blocking(move || download(&app, &repo, rf.as_deref(), None)).await.map_err(|e| e.to_string())?
}

/// Check for updates: the card for the ref's current commit, or null when the installed commit is it.
#[tauri::command]
pub async fn plugin_github_check(app: AppHandle, id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = entry(&app.state::<App>(), &id)?["source"].clone();
        let (Some(repo), sha) = (source["repo"].as_str(), source["sha"].as_str()) else { return Err(trc_v("err.plugin_unknown", &id)) };
        let rf = source["ref"].as_str();
        if commit(&app.state::<App>(), repo, rf)?["sha"].as_str() == sha { return Ok(Value::Null); }
        download(&app, repo, rf, Some(&id))
    }).await.map_err(|e| e.to_string())?
}

/// The user said no: the download goes.
#[tauri::command]
pub fn plugin_github_cancel(app: AppHandle, stage: String) {
    if let Ok(d) = stage_dir(&app, &stage) { fs::remove_dir_all(d).ok(); }
}

/// Run the install command in `dir`; what it printed (the end of it) when it fails or takes longer than `limit`.
pub fn run_install(dir: &Path, cmd: &str, path: &str, limit: Duration) -> Result<(), String> {
    let child = Command::new("/bin/sh").args(["-c", cmd]).current_dir(dir).env("PATH", path)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0)
        .spawn().map_err(|e| trc_v("err.plugin_start", &format!("{cmd}: {e}")))?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { tx.send(child.wait_with_output()).ok(); });
    match rx.recv_timeout(limit) {
        Ok(Ok(o)) if o.status.success() => Ok(()),
        Ok(Ok(o)) => {
            let out = format!("{}\n{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            let lines: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
            let tail = lines[lines.len().saturating_sub(30)..].join("\n");
            Err(trc_v("err.repo_install", &tail.chars().rev().take(3000).collect::<Vec<_>>().into_iter().rev().collect::<String>()))
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            // the whole group, so what the script started stops too
            Command::new("/bin/kill").args(["-s", "KILL", "--", &format!("-{pid}")]).output().ok();
            Err(trc("err.repo_timeout"))
        }
    }
}

/// Step two, after the user confirmed: the staged folder moves to `plugins/<id>/` (the old one aside for an update), the
/// install command runs there, and the entry comes back for the settings to save. A failed install puts everything back.
#[tauri::command]
pub async fn plugin_install(app: AppHandle, stage: String, sync: bool) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = stage_dir(&app, &stage)?;
        let meta: Value = serde_json::from_str(&fs::read_to_string(work.join("meta.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let id = meta["id"].as_str().unwrap_or_default().to_string();
        let m = manifest(&fs::read_to_string(work.join("tree").join(MANIFEST)).map_err(|e| e.to_string())?)?;
        let (state, root) = (app.state::<App>(), dir(&app));
        let (dest, aside) = (root.join(&id), root.join(format!(".old-{id}")));
        let updating = state.settings.lock().unwrap()["plugins"].as_array().is_some_and(|l| l.iter().any(|p| p["id"] == id.as_str()));
        if !crate::plugins::valid_id(&id) || (!updating && dest.exists()) { return Err(trc_v("err.plugin_bad", &id)); }
        if updating { crate::plugins::stop(&app, &id); }
        fs::remove_dir_all(&aside).ok();
        if dest.exists() { fs::rename(&dest, &aside).map_err(|e| e.to_string())?; }
        let undo = || { fs::remove_dir_all(&dest).ok(); if aside.exists() { fs::rename(&aside, &dest).ok(); } };
        fs::rename(work.join("tree"), &dest).map_err(|e| { undo(); e.to_string() })?;
        if let Some(cmd) = m["install"].as_str() {
            if let Err(e) = run_install(&dest, cmd, &state.path, INSTALL_LIMIT) { undo(); return Err(e); }
        }
        fs::remove_dir_all(&aside).ok();
        fs::remove_dir_all(&work).ok();
        let (command, args) = resolve(&dest, &dest, m["command"].as_str().unwrap(), &string_list(&m["args"]));
        Ok(json!({"id": id, "name": m["name"], "command": command, "args": args, "env": m["env"], "secrets": m["secrets"], "on": true,
            "allowed": [], "views": [], "mcp": m["mcp"], "sync": sync,
            "source": {"repo": meta["repo"], "ref": meta["ref"], "sha": meta["sha"]}}))
    }).await.map_err(|e| e.to_string())?
}

// ---------- Claude Code

/// What Claude Code is given for the plugin: `claude mcp add-json`'s stdio server, the secrets from the keychain in its env.
fn claude_json(cfg: &Value, id: &str) -> Value {
    let mut env = cfg["env"].as_object().cloned().unwrap_or_default();
    for name in string_list(&cfg["secrets"]) { if let Some(v) = keychain_get(&service(id), &name) { env.insert(name, json!(v)); } }
    json!({"type": "stdio", "command": cfg["command"], "args": cfg["args"], "env": env})
}
/// The name Claude Code knows the plugin by.
pub fn claude_name(cfg: &Value) -> String { cfg["mcp"].as_str().or(cfg["id"].as_str()).unwrap_or_default().to_string() }

fn claude(bin: &str, path: &str, args: &[&str]) -> Result<(), String> {
    let o = Command::new(bin).args(args).env("PATH", path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { return Ok(()); }
    let (out, err) = (String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
    Err(format!("claude {}: {}", args[..args.len().min(3)].join(" "), format!("{}\n{}", err.trim(), out.trim()).trim()))
}
/// The server in Claude Code's user config, replaced when it is there (the card said so) and, when the plugin was
/// renamed, the old name removed. A remove that finds nothing is not an error.
pub fn claude_put(bin: &str, path: &str, name: &str, previous: Option<&str>, json: &Value) -> Result<(), String> {
    for old in previous.into_iter().filter(|p| *p != name).chain([name]) { claude(bin, path, &["mcp", "remove", "--scope", "user", old]).ok(); }
    claude(bin, path, &["mcp", "add-json", "--scope", "user", name, &json.to_string()])
}

/// Register the plugin in Claude Code (replacing a server of that name), after it is saved. `previous` is the name it had
/// before an edit changed it.
#[tauri::command]
pub async fn plugin_claude_sync(app: AppHandle, id: String, previous: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<App>();
        let cfg = entry(&state, &id)?;
        claude_put(&crate::claude_bin(&app, &state), &state.path, &claude_name(&cfg), previous.as_deref(), &claude_json(&cfg, &id))
    }).await.map_err(|e| e.to_string())?
}

/// Everything a removed plugin leaves on disk: its server in Claude Code when it was synced (best effort: the user may
/// have removed it there already) and its folder. Only a folder that is inside the plugins folder is deleted.
pub fn remove(app: &AppHandle, cfg: &Value) -> Result<(), String> {
    let state = app.state::<App>();
    if cfg["sync"] == true { claude(&crate::claude_bin(app, &state), &state.path, &["mcp", "remove", "--scope", "user", &claude_name(cfg)]).ok(); }
    if cfg["source"].is_object() {
        let folder = dir(app).join(cfg["id"].as_str().unwrap_or_default());
        if folder.exists() {
            if !inside(&dir(app), &folder) { return Err(trc_v("err.plugin_bad", cfg["name"].as_str().unwrap_or(""))); }
            fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("relay-repo-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn repos_and_refs_as_typed() {
        let g = |s: &str| parse_spec(s).map(|(r, f)| (r, f.unwrap_or_default()));
        assert_eq!(g("kristoffeys/relay-plugin-garmin"), Some(("kristoffeys/relay-plugin-garmin".into(), "".into())));
        assert_eq!(g("github.com/a/b@v1.2"), Some(("a/b".into(), "v1.2".into())));
        assert_eq!(g(" https://github.com/a/b.git@feat/x "), Some(("a/b".into(), "feat/x".into())));
        assert_eq!(g("https://www.github.com/a/b/"), Some(("a/b".into(), "".into())));
        assert_eq!(g("a/b@"), Some(("a/b".into(), "".into())));
        for bad in ["", "a", "a/b/c", "/a/b", "a/b c", "a/b@x..y", "a/b@x?y=1", "a/b@/x", "a b/c", "../b"] { assert_eq!(g(bad), None, "{bad}"); }
    }

    #[test]
    fn the_manifest_is_strict_about_what_it_reads() {
        let m = manifest(r#"{"name": "Garmin", "command": "node", "args": ["server.mjs"], "secrets": ["GARMIN_PASSWORD"], "env": {"REGION": "eu"}, "mcp": "garmin", "install": "npm ci", "extra": 1}"#).unwrap();
        assert_eq!((m["name"].as_str(), m["install"].as_str(), m["mcp"].as_str()), (Some("Garmin"), Some("npm ci"), Some("garmin")));
        let small = manifest(r#"{"name": "A", "command": "x"}"#).unwrap();
        assert_eq!((small["args"].clone(), small["secrets"].clone(), small["install"].clone()), (json!([]), json!([]), Value::Null));
        for (text, field) in [
            ("nope", "JSON"), (r#"{"command": "x"}"#, "name"), (r#"{"name": "A"}"#, "command"), (r#"{"name": "A", "command": ""}"#, "command"),
            (r#"{"name": "A", "command": "x", "args": "a"}"#, "args"), (r#"{"name": "A", "command": "x", "args": [1]}"#, "args"),
            (r#"{"name": "A", "command": "x", "env": {"1X": "a"}}"#, "env"), (r#"{"name": "A", "command": "x", "env": {"A": 1}}"#, "env"),
            (r#"{"name": "A", "command": "x", "secrets": ["a b"]}"#, "secrets"),
            (r#"{"name": "A", "command": "x", "env": {"K": "1"}, "secrets": ["K"]}"#, "secrets"),
            (r#"{"name": "A", "command": "x", "mcp": "a b"}"#, "mcp"), (r#"{"name": "A", "command": "x", "install": 3}"#, "install"),
        ] { assert!(manifest(text).unwrap_err().contains(field), "{text}"); }
    }

    #[test]
    fn paths_resolve_against_the_install_folder() {
        let seen = tmp("resolve");
        fs::write(seen.join("server.mjs"), "").unwrap();
        let base = Path::new("/data/plugins/garmin");
        let (c, a) = resolve(&seen, base, "node", &["server.mjs".into(), "--port".into(), "${pluginDir}/cfg.json".into(), "stdio".into(), "../server.mjs".into()]);
        assert_eq!(c, "node");
        assert_eq!(a, ["/data/plugins/garmin/server.mjs", "--port", "/data/plugins/garmin/cfg.json", "stdio", "../server.mjs"]);
        assert_eq!(resolve(&seen, base, "./run.sh", &[]).0, "/data/plugins/garmin/run.sh");
        assert_eq!(resolve(&seen, base, "${pluginDir}/bin/x", &[]).0, "/data/plugins/garmin/bin/x");
    }

    #[test]
    fn a_tarball_that_escapes_or_links_out_is_refused() {
        let ok = "repo-abc/\nrepo-abc/server.mjs\nrepo-abc/a..b/c\n";
        let ok_v = "drwxr-xr-x  0 r r 0 Jan 1 repo-abc/\n-rw-r--r--  0 r r 5 Jan 1 repo-abc/server.mjs\n-rw-r--r--  0 r r 5 Jan 1 repo-abc/a..b/c\n";
        assert_eq!(unsafe_entry(ok, ok_v), None);
        assert!(unsafe_entry("repo/../../etc/x\n", "-rw-r--r-- 0 r r 1 Jan 1 repo/../../etc/x\n").is_some());
        assert!(unsafe_entry("/etc/x\n", "-rw-r--r-- 0 r r 1 Jan 1 /etc/x\n").is_some());
        assert!(unsafe_entry("repo/link\n", "lrwxr-xr-x 0 r r 0 Jan 1 repo/link -> /etc\n").is_some());
        assert!(unsafe_entry("repo/hard\n", "hrw-r--r-- 0 r r 0 Jan 1 repo/hard link to repo/x\n").is_some());
        assert!(unsafe_entry("a\nb\n", "-rw 0 r r 0 Jan 1 a\n").is_some(), "a listing that does not line up");
    }

    #[test]
    fn unpacking_with_the_real_tar() {
        let w = tmp("unpack");
        fs::create_dir_all(w.join("src/repo-abc")).unwrap();
        fs::write(w.join("src/repo-abc/relay-plugin.json"), "{}").unwrap();
        let make = |name: &str| assert!(Command::new("/usr/bin/tar").args(["-czf", name, "-C", "src", "repo-abc"]).current_dir(&w).status().unwrap().success());
        make("good.tgz");
        unpack(&w.join("good.tgz"), &w.join("tree")).unwrap();
        assert!(w.join("tree/relay-plugin.json").is_file(), "the top folder is stripped");
        symlink("/etc", w.join("src/repo-abc/out")).unwrap();
        make("bad.tgz");
        assert!(unpack(&w.join("bad.tgz"), &w.join("tree2")).is_err());
        assert!(!w.join("tree2").exists(), "nothing was unpacked");
        fs::remove_dir_all(&w).ok();
    }

    #[test]
    fn only_a_folder_inside_the_plugins_folder_may_be_deleted() {
        let root = tmp("guard");
        let (plugins, outside) = (root.join("plugins"), root.join("outside"));
        fs::create_dir_all(plugins.join("garmin")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, plugins.join("evil")).unwrap();
        assert!(inside(&plugins, &plugins.join("garmin")));
        assert!(!inside(&plugins, &plugins), "not the folder itself");
        assert!(!inside(&plugins, &outside));
        assert!(!inside(&plugins, &plugins.join("garmin/../../outside")));
        assert!(!inside(&plugins, &plugins.join("evil")), "a link that leads out");
        assert!(!inside(&plugins, &plugins.join("gone")), "a path that is not there");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn install_commands_run_in_the_folder_and_are_cut_off() {
        let d = tmp("install");
        let path = "/usr/bin:/bin";
        run_install(&d, "echo hi > made.txt", path, Duration::from_secs(10)).unwrap();
        assert_eq!(fs::read_to_string(d.join("made.txt")).unwrap().trim(), "hi");
        let e = run_install(&d, "echo building; echo broke >&2; exit 3", path, Duration::from_secs(10)).unwrap_err();
        assert!(e.contains("building") && e.contains("broke"), "{e}");
        let t = std::time::Instant::now();
        assert!(run_install(&d, "sleep 30", path, Duration::from_millis(300)).is_err());
        assert!(t.elapsed() < Duration::from_secs(10));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn claude_code_gets_the_server_and_a_rename_removes_the_old_name() {
        let d = tmp("claude");
        // a stand-in for `claude` that writes down what it was asked, so no real Claude Code config is touched
        let (bin, log) = (d.join("claude"), d.join("log"));
        fs::write(&bin, format!("#!/bin/sh\necho \"$@\" >> {}\n", log.display())).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        let cfg = json!({"id": "garmin", "mcp": "garmin-2", "command": "node", "args": ["/p/server.mjs"], "env": {"REGION": "eu"}, "secrets": []});
        claude_put(bin.to_str().unwrap(), "/usr/bin:/bin", &claude_name(&cfg), Some("garmin"), &claude_json(&cfg, "garmin")).unwrap();
        let lines: Vec<String> = fs::read_to_string(&log).unwrap().lines().map(String::from).collect();
        assert_eq!(lines[0], "mcp remove --scope user garmin");
        assert_eq!(lines[1], "mcp remove --scope user garmin-2", "replace what is there");
        assert!(lines[2].starts_with("mcp add-json --scope user garmin-2 {") && lines[2].contains("\"command\":\"node\"") && lines[2].contains("\"REGION\":\"eu\""));
        assert_eq!(claude_name(&json!({"id": "x"})), "x");
        fs::remove_dir_all(&d).ok();
    }
}
