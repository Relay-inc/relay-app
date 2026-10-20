// Vault sync: every few minutes the vault is committed and pushed to a git remote the user set in Settings, as a
// backup. Push only, never a pull, so there is nothing to merge: a remote with commits this vault lacks refuses the
// push and the error shows in Settings. The setting lives in the vault's .relay/config.json under `sync`
// ({"remote", "on", "minutes"}), so it travels with the vault. Git runs with the user's own credentials (ssh keys, a
// credential helper, gh) and never prompts. A remote anyone can read is refused before every push: a vault holds notes
// about clients and people. A vault folder that is not a repo yet becomes one; a folder inside another repo is refused,
// or the sync would commit that whole repo.

use serde_json::{json, Value};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use super::App;

pub const MINUTES: [u64; 4] = [5, 15, 30, 60];
/// The last round: {"at" (epoch s), "ok", "error", "commit"}; null before the first.
static LAST: Mutex<Value> = Mutex::new(Value::Null);
/// Run a round now (the setting was saved), without waiting for the interval.
static NOW: AtomicBool = AtomicBool::new(false);

fn config(vault: &str) -> Value {
    crate::relay_config::load(vault).map(|c| c["sync"].clone()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}
fn minutes(cfg: &Value) -> u64 { cfg["minutes"].as_u64().filter(|m| MINUTES.contains(m)).unwrap_or(15) }

/// The remote as the user typed it, refused when it carries a password or token: the config is part of the vault and
/// gets committed and pushed itself.
pub fn check_remote(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.is_empty() { return Ok(String::new()); }
    if u.chars().any(char::is_whitespace) || u.starts_with('-') { return Err(format!("not a git remote: {u}")); }
    if let Some((_, rest)) = u.split_once("://") {
        let auth = rest.split('/').next().unwrap_or("");
        if auth.contains('@') && auth.split('@').next().unwrap_or("").contains(':') {
            return Err("the remote contains a password or token: use ssh or a credential helper instead".into());
        }
        return Ok(u.into());
    }
    // scp-style git@host:path, or a repository on a disk
    if u.contains(':') || u.starts_with('/') { return Ok(u.into()); }
    Err(format!("not a git remote: {u}"))
}

/// The https address of a remote, to ask it without credentials whether anyone can read it. None for a local path.
fn public_url(url: &str) -> Option<String> {
    if let Some(r) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) {
        return Some(format!("https://{}", r.split_once('@').map_or(r, |(_, h)| h)));
    }
    if let Some(r) = url.strip_prefix("ssh://") {
        // ssh://git@host[:port]/path: the port is ssh's, not the web's
        let (host, path) = r.split_once('@').map_or(r, |(_, h)| h).split_once('/')?;
        return Some(format!("https://{}/{path}", host.split(':').next()?));
    }
    if url.starts_with('/') || url.contains("://") { return None; }
    let (host, path) = url.split_once('@').map_or(url, |(_, h)| h).split_once(':')?;
    (!host.contains('/')).then(|| format!("https://{host}/{}", path.trim_start_matches('/')))
}

fn git(vault: &str, path_env: &str, args: &[&str]) -> Result<String, String> {
    let o = Command::new("git").arg("-C").arg(vault).args(args).env("PATH", path_env).env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null()).output().map_err(|e| format!("git: {e}"))?;
    if o.status.success() { return Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string()); }
    // the line that says what went wrong, not the hints git puts after it (a refused push ends on "hint: …")
    let e = String::from_utf8_lossy(&o.stderr);
    let line = e.lines().find(|l| l.starts_with("fatal:") || l.starts_with("error:") || l.contains("[rejected]")).or_else(|| e.lines().last());
    Err(format!("git {}: {}", args[0], line.map_or("failed", str::trim)))
}

/// Whether the remote answers a request without any credentials: then anyone can read it. Global and system git config
/// are left out, so no credential helper or `insteadOf` rewrite to ssh signs the request in.
fn is_public(url: &str, path_env: &str) -> bool {
    let Some(https) = public_url(url) else { return false };
    Command::new("git").args(["-c", "credential.helper=", "ls-remote", "--heads", &https])
        .env("PATH", path_env).env("GIT_TERMINAL_PROMPT", "0").env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_ASKPASS", "").env("SSH_ASKPASS", "").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .status().is_ok_and(|s| s.success())
}

/// One round: commit what changed, push the branch. Some(commit) when something was committed.
fn round(vault: &str, remote: &str, path_env: &str) -> Result<Option<String>, String> {
    if !Path::new(vault).join(".git").exists() {
        if git(vault, path_env, &["rev-parse", "--is-inside-work-tree"]).is_ok() {
            return Err("the vault sits inside another git repository: sync would commit all of it".into());
        }
        git(vault, path_env, &["init", "-b", "main"])?;
    }
    if is_public(remote, path_env) { return Err("the remote is public, a vault only syncs to a private repository".into()); }
    let branch = git(vault, path_env, &["symbolic-ref", "--short", "HEAD"]).map_err(|_| "the vault is not on a branch (detached HEAD)".to_string())?;
    let mut commit = None;
    if !git(vault, path_env, &["status", "--porcelain"])?.is_empty() {
        git(vault, path_env, &["add", "-A"])?;
        // a Mac without a git identity still commits, as Relay
        let who: Vec<&str> = if git(vault, path_env, &["config", "user.email"]).is_ok() { vec![] } else { vec!["-c", "user.name=Relay", "-c", "user.email=relay@localhost"] };
        let msg = format!("Relay sync {}", chrono::Local::now().format("%Y-%m-%d %H:%M"));
        git(vault, path_env, &[who.as_slice(), &["commit", "-q", "-m", &msg]].concat())?;
        commit = Some(git(vault, path_env, &["rev-parse", "--short", "HEAD"])?);
    }
    if git(vault, path_env, &["rev-parse", "-q", "--verify", "HEAD"]).is_ok() {
        git(vault, path_env, &["push", "-q", remote, &format!("HEAD:refs/heads/{branch}")])?;
    }
    Ok(commit)
}

fn run(app: &AppHandle) {
    let st = app.state::<App>();
    let vault = crate::vault(&st);
    let cfg = config(&vault);
    let remote = cfg["remote"].as_str().unwrap_or("");
    if vault.is_empty() || remote.is_empty() || cfg["on"] != true { return; }
    let r = check_remote(remote).and_then(|remote| round(&vault, &remote, &st.path));
    let at = chrono::Utc::now().timestamp();
    let last = match r {
        Ok(commit) => json!({"at": at, "ok": true, "error": "", "commit": commit}),
        Err(e) => json!({"at": at, "ok": false, "error": e, "commit": null}),
    };
    *LAST.lock().unwrap() = last.clone();
    app.emit("vault-sync", last).ok();
}

pub fn start(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || {
        let mut next = Instant::now() + Duration::from_secs(60);
        loop {
            std::thread::sleep(Duration::from_secs(5));
            if !NOW.swap(false, Ordering::Relaxed) && Instant::now() < next { continue; }
            run(&h);
            next = Instant::now() + Duration::from_secs(60 * minutes(&config(&crate::vault(&h.state::<App>()))));
        }
    });
}

/// The vault's sync setting and the last round, for Settings.
#[tauri::command]
pub fn vault_sync(state: tauri::State<App>) -> Value {
    let cfg = config(&crate::vault(&state));
    json!({"remote": cfg["remote"].as_str().unwrap_or(""), "on": cfg["on"] == true, "minutes": minutes(&cfg), "last": *LAST.lock().unwrap()})
}

/// Save the setting into .relay/config.json and run a round right away when it is on.
#[tauri::command]
pub fn set_vault_sync(state: tauri::State<App>, remote: String, on: bool, minutes: u64) -> Result<Value, String> {
    let vault = crate::need_vault(&state)?;
    let remote = check_remote(&remote)?;
    if !MINUTES.contains(&minutes) { return Err(format!("not an interval: {minutes}")); }
    let on = on && !remote.is_empty();
    let mut c = crate::relay_config::load(&vault).ok_or("no .relay/config.json")?;
    c["sync"] = json!({"remote": remote, "on": on, "minutes": minutes});
    crate::relay_config::save(&vault, &c)?;
    if on { NOW.store(true, Ordering::Relaxed); }
    Ok(vault_sync(state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remotes() {
        assert_eq!(check_remote(" git@github.com:me/vault.git ").unwrap(), "git@github.com:me/vault.git");
        assert_eq!(check_remote("").unwrap(), "");
        assert!(check_remote("https://me:ghp_secret@github.com/me/vault.git").is_err());
        assert!(check_remote("https://me@github.com/me/vault.git").is_ok());
        assert!(check_remote("--upload-pack=x").is_err());
        assert!(check_remote("vault").is_err());
    }

    #[test]
    fn public_urls() {
        assert_eq!(public_url("git@github.com:me/vault.git").unwrap(), "https://github.com/me/vault.git");
        assert_eq!(public_url("https://me@gitlab.com/me/vault.git").unwrap(), "https://gitlab.com/me/vault.git");
        assert_eq!(public_url("ssh://git@192.168.1.2:2222/me/vault.git").unwrap(), "https://192.168.1.2/me/vault.git");
        assert_eq!(public_url("/Volumes/backup/vault.git"), None);
    }

    #[test]
    fn round_commits_and_pushes() {
        let tmp = std::env::temp_dir().join(format!("relay-vaultsync-{}", std::process::id()));
        let (vault, bare) = (tmp.join("vault"), tmp.join("remote.git"));
        std::fs::create_dir_all(&vault).unwrap();
        let path_env = std::env::var("PATH").unwrap();
        Command::new("git").args(["init", "-q", "--bare"]).arg(&bare).status().unwrap();
        std::fs::write(vault.join("note.md"), "hi").unwrap();
        let (v, r) = (vault.to_str().unwrap(), bare.to_str().unwrap());
        assert!(round(v, r, &path_env).unwrap().is_some());
        assert_eq!(round(v, r, &path_env).unwrap(), None, "nothing changed, nothing committed");
        assert!(git(r, &path_env, &["rev-parse", "main"]).is_ok(), "pushed to the remote");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
