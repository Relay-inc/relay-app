// Updates from the public GitHub repo, anonymous or with the user's gh login when there is one (a higher rate limit),
// no token ships in the app. scripts/release.sh writes latest.json to the `updates` branch, its download url is the
// GitHub API url of the release's .app.tar.gz. An app updated this way gets no quarantine flag, only the first
// install needs the xattr line. A check at start and every 12 hours, quietly: the main window's settings button gets a
// dot and Settings › Updates shows the releases since this version and installs. Relay › Check for Updates opens
// that page. The same page updates the agent CLIs (npm, Homebrew or the CLI's own command).
use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

const EVERY: std::time::Duration = std::time::Duration::from_secs(12 * 60 * 60);
const REPO: &str = "Relay-inc/relay-app";

/// The update the last check found, installed from Settings › Updates.
static PENDING: Mutex<Option<tauri_plugin_updater::Update>> = Mutex::new(None);
/// What the last check said, for a window that opens after it (see `updates_status`).
static STATUS: Mutex<Value> = Mutex::new(Value::Null);

pub fn start(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || loop {
        tauri::async_runtime::block_on(check(&h));
        std::thread::sleep(EVERY);
    });
}

fn current(app: &AppHandle) -> String { app.package_info().version.to_string() }

/// `{version, checked, latest, releases: [{version, notes, date}], error}`: this Relay's version, when the last check
/// ran (ms, null before the first), the newer version it found (null for none), the releases on GitHub newest first
/// (the page shows the ones after this version) and why the check failed.
async fn check(app: &AppHandle) -> Value {
    let found = find(app).await;
    let (latest, error) = match &found {
        Ok(Some(u)) => (json!(u.version), Value::Null),
        Ok(None) => (Value::Null, Value::Null),
        Err(e) => (Value::Null, json!(e)),
    };
    // every release since this one, not only latest.json's newest: a skipped version's notes count too
    let releases = match &found {
        Ok(Some(u)) => releases(app).unwrap_or_else(|_| vec![json!({"version": u.version, "notes": u.body.clone().unwrap_or_default(), "date": null})]),
        _ => vec![],
    };
    *PENDING.lock().unwrap() = found.ok().flatten();
    let s = json!({"version": current(app), "checked": chrono::Utc::now().timestamp_millis(), "latest": latest, "releases": releases, "error": error});
    *STATUS.lock().unwrap() = s.clone();
    app.emit("updates", &s).ok();
    s
}

/// The repo's releases, their notes without what scripts/release.sh adds under the `---` (the first install's steps).
fn releases(app: &AppHandle) -> Result<Vec<Value>, String> {
    let out = crate::gh(&app.state::<crate::App>(), &["api", &format!("repos/{REPO}/releases?per_page=30")])?;
    let list: Vec<Value> = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    Ok(list.iter().filter(|r| r["draft"] != true).map(|r| {
        let body = r["body"].as_str().unwrap_or("").replace("\r\n", "\n");
        json!({"version": r["tag_name"].as_str().unwrap_or("").trim_start_matches('v'), "notes": body.split("\n---\n").next().unwrap_or("").trim(),
            "date": r["published_at"]})
    }).collect())
}

async fn find(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    // latest.json raw from the contents API, not wrapped in JSON
    let mut builder = app.updater_builder().header("Accept", "application/vnd.github.raw").map_err(|e| e.to_string())?;
    // the repo is public: without gh (or its login) the check goes anonymous
    if let Ok(token) = crate::gh(&app.state::<crate::App>(), &["auth", "token"]) {
        builder = builder.header("Authorization", format!("Bearer {}", token.trim())).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let mut update = updater.check().await.map_err(|e| e.to_string())?;
    // the download keeps the token (if any) but takes the updater's own Accept (application/octet-stream): GitHub
    // sends the asset's bytes for that, and its metadata for the raw type
    if let Some(u) = update.as_mut() { u.headers.remove("accept"); }
    Ok(update)
}

/// The last check's answer without looking again (checked null before the first check).
#[tauri::command]
pub fn updates_status(app: AppHandle) -> Value {
    let s = STATUS.lock().unwrap().clone();
    if s.is_null() { json!({"version": current(&app), "checked": null, "latest": null, "releases": [], "error": null}) } else { s }
}

/// Look again now (Check now, and Settings › Updates when it first shows).
#[tauri::command]
pub async fn updates_check(app: AppHandle) -> Value { check(&app).await }

/// Download the found update, its progress as "update-progress" `{done, total}` (bytes, total null when unknown),
/// install it and restart.
#[tauri::command]
pub async fn updates_install(app: AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) { return Err(crate::trc("upd.dev")); }
    let update = PENDING.lock().unwrap().clone().ok_or_else(|| crate::trc("upd.nothing"))?;
    let (mut done, mut shown) = (0u64, 0u64);
    update.download_and_install(|chunk, total| {
        done += chunk as u64;
        // about every 1% (or 256 KB without a total), not every chunk
        let step = total.map_or(256 * 1024, |t| (t / 100).max(1));
        if done - shown >= step || total == Some(done) { shown = done; app.emit("update-progress", json!({"done": done, "total": total})).ok(); }
    }, || {}).await.map_err(|e| e.to_string())?;
    app.request_restart(); // through RunEvent::Exit, so quit() runs as on Cmd-Q
    Ok(())
}

// ---------- the agent CLIs

/// How an installed CLI updates, from where its binary really lives (`real`, symlinks resolved): inside an npm prefix
/// with that prefix's npm, from a Homebrew formula or cask with brew, else with its own command (`own`: Claude Code's
/// and OpenCode's installers). The program and its arguments, or None when Relay cannot tell (update it by hand).
fn how(real: &str, own: &[&str], bin: &str, npm_of: impl Fn(&str) -> Option<String>, brew: Option<String>) -> Option<Vec<String>> {
    if let Some((prefix, rest)) = real.split_once("/lib/node_modules/") {
        let mut parts = rest.split('/');
        let first = parts.next()?;
        let pkg = if first.starts_with('@') { format!("{first}/{}", parts.next()?) } else { first.to_string() };
        return Some(vec![npm_of(prefix)?, "install".into(), "-g".into(), "--prefix".into(), prefix.into(), format!("{pkg}@latest")]);
    }
    for dir in ["/Caskroom/", "/Cellar/"] {
        if let Some((_, rest)) = real.split_once(dir) {
            return Some(vec![brew?, "upgrade".into(), rest.split('/').next()?.into()]);
        }
    }
    if own.is_empty() { return None; }
    Some(std::iter::once(bin.to_string()).chain(own.iter().map(|a| a.to_string())).collect())
}

/// The first `x.y.z` in a `--version` line ("codex-cli 0.160.0", "2.1.289 (Claude Code)").
fn semver_in(line: &str) -> Option<String> {
    line.split(|c: char| !c.is_ascii_digit() && c != '.').map(|w| w.trim_matches('.')).find(|w| w.matches('.').count() >= 2).map(String::from)
}

/// The version npm calls latest, from the registry. ponytail: a Homebrew cask can trail npm by a day, its Update
/// then finds nothing newer; ask brew for its own version if that confuses.
fn npm_latest(pkg: &str) -> Option<String> {
    let o = Command::new("/usr/bin/curl").args(["-sf", "-m", "10", &format!("https://registry.npmjs.org/{pkg}/latest")]).stdin(Stdio::null()).output().ok()?;
    serde_json::from_slice::<Value>(&o.stdout).ok()?["version"].as_str().map(String::from)
}

struct AgentInstall { id: &'static str, name: &'static str, on: bool, installed: Option<String>, pkg: Option<&'static str>, cmd: Option<Vec<String>> }

fn agent_installs(app: &AppHandle, state: &crate::App) -> Vec<AgentInstall> {
    let on: Vec<bool> = { let s = state.settings.lock().unwrap(); crate::agents::PROVIDERS.iter().map(|p| s["agents"]["providers"][p.id()]["on"] == true).collect() };
    crate::agents::PROVIDERS.iter().zip(on).map(|(p, on)| {
        let eb = crate::env_of(app, state, *p);
        let d = p.detect(&eb.env());
        let real = std::fs::canonicalize(&eb.bin).map(|r| r.to_string_lossy().into_owned()).unwrap_or_default();
        let npm_of = |prefix: &str| Some(format!("{prefix}/bin/npm")).filter(|n| std::path::Path::new(n).is_file()).or_else(|| crate::in_path(state, "npm"));
        let cmd = if d.installed { how(&real, p.self_update(), &eb.bin, npm_of, crate::in_path(state, "brew")) } else { None };
        let installed = d.installed.then(|| d.version.as_deref().and_then(semver_in).unwrap_or_default());
        AgentInstall { id: p.id(), name: p.name(), on, installed, pkg: p.npm_package(), cmd }
    }).collect()
}

/// Every agent CLI: switched on, its installed version (null when not installed, "" when it does not say), npm's
/// latest (null when unknown) and the update command as text (null when Relay cannot update it).
#[tauri::command]
pub async fn agent_updates(app: AppHandle, state: State<'_, crate::App>) -> Result<Value, String> {
    let list = agent_installs(&app, &state);
    tauri::async_runtime::spawn_blocking(move || {
        let latest: Vec<Option<String>> = std::thread::scope(|sc| {
            let jobs: Vec<_> = list.iter().map(|a| sc.spawn(move || a.installed.as_ref().and(a.pkg).and_then(npm_latest))).collect();
            jobs.into_iter().map(|j| j.join().ok().flatten()).collect()
        });
        Value::Array(list.iter().zip(latest).map(|(a, latest)| json!({"id": a.id, "name": a.name, "on": a.on, "installed": a.installed,
            "latest": latest, "command": a.cmd.as_ref().map(|c| c.join(" "))})).collect())
    }).await.map_err(|e| e.to_string())
}

/// Run an agent's update command; the last lines of its output when it fails.
#[tauri::command]
pub async fn agent_update(app: AppHandle, state: State<'_, crate::App>, id: String) -> Result<(), String> {
    let cmd = agent_installs(&app, &state).into_iter().find(|a| a.id == id).and_then(|a| a.cmd).ok_or_else(|| crate::trc("upd.agentManual"))?;
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let o = Command::new(&cmd[0]).args(&cmd[1..]).env("PATH", path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if o.status.success() { return Ok(()); }
        let err = String::from_utf8_lossy(if o.stderr.is_empty() { &o.stdout } else { &o.stderr }).into_owned();
        let tail: Vec<&str> = err.lines().rev().take(6).collect();
        Err(tail.into_iter().rev().collect::<Vec<_>>().join("\n"))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn npm(p: &str) -> Option<String> { Some(format!("{p}/bin/npm")) }

    #[test]
    fn versions_come_out_of_version_lines() {
        assert_eq!(semver_in("2.1.289 (Claude Code)").as_deref(), Some("2.1.289"));
        assert_eq!(semver_in("codex-cli 0.160.0").as_deref(), Some("0.160.0"));
        assert_eq!(semver_in("v1.1.6").as_deref(), Some("1.1.6"));
        assert_eq!(semver_in("pi"), None);
    }

    #[test]
    fn an_npm_install_updates_in_its_own_prefix() {
        let c = how("/Users/k/.npm-global/lib/node_modules/@openai/codex/bin/codex.js", &[], "/x", npm, None).unwrap();
        assert_eq!(c.join(" "), "/Users/k/.npm-global/bin/npm install -g --prefix /Users/k/.npm-global @openai/codex@latest");
        // the package is the outer one, not the platform binary nested in it
        let c = how("/opt/homebrew/lib/node_modules/opencode-ai/node_modules/opencode-darwin-arm64/bin/opencode", &["upgrade"], "/x", npm, None).unwrap();
        assert_eq!(c.last().unwrap(), "opencode-ai@latest");
    }

    #[test]
    fn homebrew_then_the_clis_own_command() {
        let brew = || Some("/opt/homebrew/bin/brew".to_string());
        assert_eq!(how("/opt/homebrew/Caskroom/claude-code/2.1.0/claude", &["update"], "/b", npm, brew()).unwrap().join(" "), "/opt/homebrew/bin/brew upgrade claude-code");
        assert_eq!(how("/opt/homebrew/Cellar/opencode/1.0/bin/opencode", &[], "/b", npm, brew()).unwrap().join(" "), "/opt/homebrew/bin/brew upgrade opencode");
        assert_eq!(how("/Users/k/.local/share/claude/versions/2.1.0", &["update"], "/Users/k/.local/bin/claude", npm, None).unwrap().join(" "), "/Users/k/.local/bin/claude update");
        assert_eq!(how("/usr/local/bin/pi", &[], "/usr/local/bin/pi", npm, None), None);
    }
}
