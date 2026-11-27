// Google Cloud Build's credentials: the user's own gcloud login, like GitHub uses gh's. No token of ours in the keychain;
// the access token comes from `gcloud auth print-access-token`, stays in this process and goes only to curl
// (providers::call_with), never to a webview.

use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::trc;

// ponytail: Google's tokens last an hour, kept 45 minutes; a `gcloud auth login` as someone else shows up after that
// (or at once when the settings window checks again, see `account`). Per-account caching if anyone switches often.
const KEEP: Duration = Duration::from_secs(45 * 60);
static CACHE: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// gcloud from the login-shell PATH (an app started from the Finder does not have /opt/homebrew/bin), its output on
/// success, else the reason: not installed, not signed in, or gcloud's own words.
fn gcloud(path: &str, args: &[&str]) -> Result<String, String> {
    let bin = agent_core::which("gcloud", path).ok_or_else(|| trc("err.no_gcloud"))?;
    let o = Command::new(bin).args(args).env("PATH", path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { return Ok(String::from_utf8_lossy(&o.stdout).trim().to_string()); }
    let e = String::from_utf8_lossy(&o.stderr);
    Err(if e.contains("auth login") || e.contains("active account") { trc("err.gcloud_login") } else { format!("gcloud: {}", e.trim()) })
}

/// The account gcloud is signed in with, for the settings window. Drops the cached token, so a new login is picked up.
pub fn account(path: &str) -> Result<String, String> {
    *CACHE.lock().unwrap() = None;
    let a = gcloud(path, &["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"])?;
    if a.is_empty() { Err(trc("err.gcloud_login")) } else { Ok(a) }
}

/// An access token for the active account, from the cache while it is fresh.
pub fn token(path: &str) -> Result<String, String> {
    if let Some((t, at)) = CACHE.lock().unwrap().as_ref() { if at.elapsed() < KEEP { return Ok(t.clone()); } }
    let t = gcloud(path, &["auth", "print-access-token"])?;
    if t.is_empty() || !t.chars().all(|c| c.is_ascii_alphanumeric() || "-_.~+/=".contains(c)) { return Err(trc("err.gcloud_login")); }
    *CACHE.lock().unwrap() = Some((t.clone(), Instant::now()));
    Ok(t)
}
