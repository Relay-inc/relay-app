//! Remote updates: Relay sends the relay-server binary of its own version (`update`), the server checks it, keeps it as
//! `<data>/bin/relay-server` and re-executes itself on it. Every later start prefers that binary while it is newer than
//! the one that started, so a container that is recreated from the same image keeps the update, and a newer image wins
//! again. Not on a Mac: there the server is Relay itself and updates with Relay.
//!
//! Re-executing keeps the process (PID 1 in Docker), the brokers and the RAM working copy. Only the mirror's keys are
//! gone with the old process: the mirror is locked until Relay's next sync round unlocks it, a few seconds later.

use relay_remote::sync;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Whether this server can take an update from Relay.
pub const CAN: bool = !cfg!(target_os = "macos");

/// Where the binary from the last update is kept.
pub fn path(data: &Path) -> PathBuf { data.join("bin").join("relay-server") }

/// What `<bin> version` prints, when it runs here at all.
fn version_of(bin: &Path) -> Option<String> {
    let out = Command::new(bin).arg("version").stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|v| !v.is_empty())
}
/// `a` is a later version than `b` ("0.0.10" after "0.0.9").
pub fn newer(a: &str, b: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a) > parse(b)
}

/// Run this process's arguments on `bin`. Only returns when that fails.
fn exec(bin: &Path) -> std::io::Error { Command::new(bin).args(std::env::args().skip(1)).exec() }

/// At the start of `serve`: go on in the kept binary instead, when it is newer than this one.
pub fn adopt(data: &Path) {
    if !CAN { return; }
    let bin = path(data);
    let me = std::env::current_exe().and_then(|p| p.canonicalize()).ok();
    if me.is_some() && me == bin.canonicalize().ok() { return; }
    let Some(v) = version_of(&bin) else { return };
    if !newer(&v, VERSION) { return; }
    eprintln!("relay-server: {VERSION} goes on in {v} from the last update ({})", bin.display());
    eprintln!("relay-server: running {} failed: {}", bin.display(), exec(&bin));
}

/// The `update` request: the bytes must hash to `sha256`, run here and be relay-server `version`. Then they replace the
/// kept binary. The caller replies, then calls `restart`.
pub fn install(data: &Path, version: &str, sha256: &str, body: &[u8]) -> Result<(), String> {
    if !CAN { return Err("this machine is Relay on a Mac: it updates with Relay there".into()); }
    if sync::sha256_hex(body) != sha256 { return Err("the binary arrived damaged (checksum)".into()); }
    let bin = path(data);
    fs::create_dir_all(bin.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = bin.with_extension("new");
    fs::write(&tmp, body).and_then(|_| fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))).map_err(|e| e.to_string())?;
    if version_of(&tmp).as_deref() != Some(version) {
        fs::remove_file(&tmp).ok();
        return Err(format!("the binary does not run here, or is not relay-server {version}"));
    }
    fs::rename(&tmp, &bin).map_err(|e| e.to_string())
}

/// Go on in the binary `install` kept. Logs and keeps running the old one when that fails.
pub fn restart(data: &Path) {
    let bin = path(data);
    eprintln!("relay-server: updated, restarting on {}", bin.display());
    eprintln!("relay-server: running {} failed: {}", bin.display(), exec(&bin));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions_compare_by_number() {
        assert!(newer("0.0.10", "0.0.9"));
        assert!(newer("0.1.0", "0.0.9"));
        assert!(!newer("0.0.4", "0.0.4"));
        assert!(!newer("0.0.3", "0.0.4"));
    }
    #[test]
    fn a_damaged_or_foreign_binary_is_refused() {
        let data = std::env::temp_dir().join(format!("relay-upgrade-{}", std::process::id()));
        if !CAN { return; }
        let script = b"#!/bin/sh\necho 9.9.9\n";
        assert!(install(&data, "9.9.9", "00", script).unwrap_err().contains("damaged"));
        assert!(install(&data, "1.2.3", &sync::sha256_hex(script), script).unwrap_err().contains("not relay-server 1.2.3"));
        assert!(!path(&data).exists());
        install(&data, "9.9.9", &sync::sha256_hex(script), script).unwrap();
        assert_eq!(version_of(&path(&data)).as_deref(), Some("9.9.9"));
        fs::remove_dir_all(&data).ok();
    }
}
