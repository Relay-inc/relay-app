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
/// The last round of each shared vault with sync on: {vault: {"at", "ok", "error", "commit", "pulled"}}.
static SHARED: Mutex<Value> = Mutex::new(Value::Null);
/// How often a shared vault syncs: often enough that the team's changes show the same morning.
// ponytail: one fixed interval for every shared vault, a setting per vault when someone asks
const SHARED_MINUTES: u64 = 5;
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

/// Commit everything that changed, as the user or, on a Mac without a git identity, as Relay. Some(commit) when
/// something was committed.
fn commit_all(vault: &str, path_env: &str) -> Result<Option<String>, String> {
    if git(vault, path_env, &["status", "--porcelain"])?.is_empty() { return Ok(None); }
    git(vault, path_env, &["add", "-A"])?;
    let msg = format!("Relay sync {}", chrono::Local::now().format("%Y-%m-%d %H:%M"));
    git(vault, path_env, &[who(vault, path_env).as_slice(), &["commit", "-q", "-m", &msg]].concat())?;
    Ok(Some(git(vault, path_env, &["rev-parse", "--short", "HEAD"])?))
}
fn who(vault: &str, path_env: &str) -> Vec<&'static str> {
    if git(vault, path_env, &["config", "user.email"]).is_ok() { vec![] } else { vec!["-c", "user.name=Relay", "-c", "user.email=relay@localhost"] }
}

/// One round of a shared vault, a clone of the team's repository: commit what changed here, put it on top of what the
/// team pushed (rebase on the upstream branch) and push. A conflict puts the vault back as it was before the rebase, its
/// own commit kept, and names the files; every next round tries again. Returns (own commit, commits pulled).
fn shared_round(vault: &str, path_env: &str) -> Result<(Option<String>, usize), String> {
    let up = git(vault, path_env, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .map_err(|_| "the vault has no upstream branch: clone it from the team's repository".to_string())?;
    let (remote, branch) = up.split_once('/').ok_or_else(|| format!("not a remote branch: {up}"))?;
    let url = git(vault, path_env, &["remote", "get-url", remote])?;
    if is_public(&url, path_env) { return Err("the remote is public, a vault only syncs to a private repository".into()); }
    let commit = commit_all(vault, path_env)?;
    git(vault, path_env, &["fetch", "-q", remote])?;
    let pulled: usize = git(vault, path_env, &["rev-list", "--count", &format!("HEAD..{up}")])?.parse().unwrap_or(0);
    if pulled > 0 && rebase(vault, path_env, &up)? { rebuild_index(vault, path_env); }
    if git(vault, path_env, &["rev-list", "--count", &format!("{up}..HEAD")])? != "0" {
        git(vault, path_env, &["push", "-q", remote, &format!("HEAD:refs/heads/{branch}")])?;
    }
    Ok((commit, pulled))
}

/// The index script of a vault laid out with project cards: what it writes nobody edits by hand.
const INDEX_SCRIPT: &str = "System/scripts/build-index.py";
/// What a vault with project cards generates from them (build-index.py): its work-state and repo index.
fn generated(vault: &str) -> Vec<String> {
    if !Path::new(vault).join(INDEX_SCRIPT).is_file() { return vec![]; }
    let ws = crate::relay_config::load(vault).and_then(|c| c["paths"]["workState"].as_str().map(String::from)).filter(|s| !s.is_empty());
    vec![ws.unwrap_or_else(|| "System/rules/core/work-state.md".into()), "System/index/repos.json".into()]
}

/// Rebase what is here on the team's `up`. A conflict only in generated files takes the team's version (the index is
/// rebuilt afterwards from the cards, which did merge); any other conflict puts the vault back as it was before the
/// rebase, its own commits kept, and names the files. Ok(true) when a generated file was taken.
fn rebase(vault: &str, path_env: &str, up: &str) -> Result<bool, String> {
    let gen = generated(vault);
    let mut step = git(vault, path_env, &[who(vault, path_env).as_slice(), &["rebase", "-q", up]].concat());
    let mut took = false;
    while let Err(e) = step {
        let files: Vec<String> = git(vault, path_env, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default().lines().map(String::from).collect();
        if files.is_empty() || !files.iter().all(|f| gen.contains(f)) {
            git(vault, path_env, &["rebase", "--abort"]).ok();
            if files.is_empty() { return Err(e); }
            return Err(format!("conflict with the team in {}: run git pull --rebase in the vault and resolve it, the next round pushes", files.join(", ")));
        }
        // during a rebase "ours" is the branch rebased onto: the team's
        for f in &files { git(vault, path_env, &["checkout", "--ours", "--", f])?; git(vault, path_env, &["add", "--", f])?; }
        took = true;
        // a commit that only changed generated files is empty now
        let empty = git(vault, path_env, &["diff", "--cached", "--quiet"]).is_ok();
        step = if empty { git(vault, path_env, &["rebase", "--skip"]) }
            else { git(vault, path_env, &[who(vault, path_env).as_slice(), &["-c", "core.editor=true", "rebase", "--continue"]].concat()) };
    }
    Ok(took)
}
/// The vault's index from its cards again, after a rebase took the team's generated files; the next round commits it.
fn rebuild_index(vault: &str, path_env: &str) {
    let o = Command::new("python3").arg(Path::new(vault).join(INDEX_SCRIPT)).env("VAULT", vault).env("PATH", path_env).output();
    if let Some(o) = o.ok().filter(|o| !o.status.success()) { eprintln!("build-index {vault}: {}", String::from_utf8_lossy(&o.stderr).trim()); }
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
    let commit = commit_all(vault, path_env)?;
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

/// A round of every shared vault with sync on (settings `syncVaults`). New commits from the team: "vault-pulled", so
/// the sidebar reads the vaults again.
fn run_shared(app: &AppHandle) {
    let st = app.state::<App>();
    let on = { let s = st.settings.lock().unwrap(); crate::extra_vaults(&s).into_iter().filter(|v| syncs(&s, v)).collect::<Vec<_>>() };
    let at = chrono::Utc::now().timestamp();
    let mut all = serde_json::Map::new();
    let mut pulled_any = false;
    for v in on {
        let last = match shared_round(&v, &st.path) {
            Ok((commit, pulled)) => { pulled_any |= pulled > 0; json!({"at": at, "ok": true, "error": "", "commit": commit, "pulled": pulled}) }
            Err(e) => json!({"at": at, "ok": false, "error": e, "commit": null, "pulled": 0}),
        };
        all.insert(v, last);
    }
    *SHARED.lock().unwrap() = Value::Object(all.clone());
    app.emit("shared-sync", Value::Object(all)).ok();
    if pulled_any { app.emit("vault-pulled", ()).ok(); }
}
/// Whether a shared vault syncs with the team: its path in the settings' `syncVaults`.
pub fn syncs(s: &Value, vault: &str) -> bool { s["syncVaults"].as_array().is_some_and(|a| a.iter().any(|v| v == vault)) }

pub fn start(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || {
        let mut next = Instant::now() + Duration::from_secs(60);
        let mut next_shared = next;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let now = NOW.swap(false, Ordering::Relaxed);
            if now || Instant::now() >= next_shared {
                run_shared(&h);
                next_shared = Instant::now() + Duration::from_secs(60 * SHARED_MINUTES);
            }
            if !now && Instant::now() < next { continue; }
            run(&h);
            next = Instant::now() + Duration::from_secs(60 * minutes(&config(&crate::vault(&h.state::<App>()))));
        }
    });
}

/// The shared vaults' last rounds, for Settings: {vault: {at, ok, error, commit, pulled}}.
#[tauri::command]
pub fn shared_sync(_state: tauri::State<App>) -> Value { SHARED.lock().unwrap().clone() }
/// Run a round now: Settings saved, or a shared vault's sync switched on.
pub fn sync_now() { NOW.store(true, Ordering::Relaxed); }

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

    #[test]
    fn shared_round_takes_the_teams_commits_and_stops_at_a_conflict() {
        let tmp = std::env::temp_dir().join(format!("relay-sharedsync-{}", std::process::id()));
        std::fs::remove_dir_all(&tmp).ok();
        let path_env = std::env::var("PATH").unwrap();
        let bare = tmp.join("team.git");
        let sh = |args: &[&str], dir: &Path| assert!(Command::new("git").args(args).current_dir(dir).output().unwrap().status.success(), "{args:?}");
        std::fs::create_dir_all(&tmp).unwrap();
        sh(&["init", "-q", "--bare", "-b", "main", "team.git"], &tmp);
        let seed = tmp.join("seed");
        sh(&["clone", "-q", bare.to_str().unwrap(), "seed"], &tmp);
        std::fs::write(seed.join("work-state.md"), "| X | Active |\n").unwrap();
        sh(&["add", "-A"], &seed);
        sh(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"], &seed);
        sh(&["push", "-q", "origin", "HEAD:main"], &seed);
        for c in ["me", "colleague"] { sh(&["clone", "-q", bare.to_str().unwrap(), c], &tmp); }
        let (me, them) = (tmp.join("me"), tmp.join("colleague"));
        let (m, t) = (me.to_str().unwrap(), them.to_str().unwrap());
        // different files: my round takes their commit and pushes mine on top
        std::fs::write(them.join("meeting.md"), "theirs").unwrap();
        assert_eq!(shared_round(t, &path_env).unwrap().1, 0);
        std::fs::write(me.join("note.md"), "mine").unwrap();
        let (commit, pulled) = shared_round(m, &path_env).unwrap();
        assert!(commit.is_some());
        assert_eq!(pulled, 1);
        assert!(me.join("meeting.md").is_file(), "the team's note is here");
        assert_eq!(shared_round(t, &path_env).unwrap().1, 1, "and mine reached them");
        // the same line on both sides: an error naming the file, my change kept, no rebase left halfway
        std::fs::write(them.join("work-state.md"), "| X | Blocked |\n").unwrap();
        shared_round(t, &path_env).unwrap();
        std::fs::write(me.join("work-state.md"), "| X | Quiet |\n").unwrap();
        let e = shared_round(m, &path_env).unwrap_err();
        assert!(e.contains("conflict") && e.contains("work-state.md"), "{e}");
        assert_eq!(std::fs::read_to_string(me.join("work-state.md")).unwrap(), "| X | Quiet |\n");
        assert!(!me.join(".git/rebase-merge").exists() && !me.join(".git/rebase-apply").exists());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn a_conflict_in_the_generated_index_takes_the_teams_and_rebuilds() {
        let tmp = std::env::temp_dir().join(format!("relay-gensync-{}", std::process::id()));
        std::fs::remove_dir_all(&tmp).ok();
        let path_env = std::env::var("PATH").unwrap();
        let sh = |args: &[&str], dir: &Path| assert!(Command::new("git").args(args).current_dir(dir).output().unwrap().status.success(), "{args:?}");
        let w = |p: std::path::PathBuf, body: &str| { std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(p, body).unwrap(); };
        std::fs::create_dir_all(&tmp).unwrap();
        sh(&["init", "-q", "--bare", "-b", "main", "team.git"], &tmp);
        let seed = tmp.join("seed");
        sh(&["clone", "-q", tmp.join("team.git").to_str().unwrap(), "seed"], &tmp);
        // the index script: the work-state is every card's name, as build-index.py makes it from the cards
        w(seed.join(INDEX_SCRIPT), "import os,glob\nv=os.environ['VAULT']\nn=sorted(os.path.basename(p) for p in glob.glob(v+'/Contexts/*/Projects/*.md'))\nopen(v+'/System/rules/core/work-state.md','w').write(' '.join(n)+'\\n')\n");
        w(seed.join("System/rules/core/work-state.md"), "\n");
        sh(&["add", "-A"], &seed);
        sh(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"], &seed);
        sh(&["push", "-q", "origin", "HEAD:main"], &seed);
        for c in ["me", "colleague"] { sh(&["clone", "-q", tmp.join("team.git").to_str().unwrap(), c], &tmp); }
        let (me, them) = (tmp.join("me"), tmp.join("colleague"));
        // each adds a card and rebuilds the index: the same generated line on both sides
        w(them.join("Contexts/Work/Projects/Theirs.md"), "t");
        w(them.join("System/rules/core/work-state.md"), "Theirs.md\n");
        shared_round(them.to_str().unwrap(), &path_env).unwrap();
        w(me.join("Contexts/Work/Projects/Mine.md"), "m");
        w(me.join("System/rules/core/work-state.md"), "Mine.md\n");
        let (_, pulled) = shared_round(me.to_str().unwrap(), &path_env).unwrap();
        assert_eq!(pulled, 1);
        assert!(me.join("Contexts/Work/Projects/Theirs.md").is_file() && me.join("Contexts/Work/Projects/Mine.md").is_file(), "both cards");
        assert_eq!(std::fs::read_to_string(me.join("System/rules/core/work-state.md")).unwrap(), "Mine.md Theirs.md\n", "rebuilt from both cards");
        // the rebuilt index goes out with the next round, and reaches the colleague
        shared_round(me.to_str().unwrap(), &path_env).unwrap();
        shared_round(them.to_str().unwrap(), &path_env).unwrap();
        assert_eq!(std::fs::read_to_string(them.join("System/rules/core/work-state.md")).unwrap(), "Mine.md Theirs.md\n");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
