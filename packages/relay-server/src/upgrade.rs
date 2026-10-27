//! Remote updates: Relay sends the relay-server binary of its own version (`update`), the server checks it, keeps it as
//! `<data>/bin/relay-server` and re-executes itself on it. Every later start prefers that binary while it is newer than
//! the one that started, so a container that is recreated from the same image keeps the update, and a newer image wins
//! again. Not on a Mac: there the server is Relay itself and updates with Relay.
//!
//! Re-executing keeps the process (PID 1 in Docker), the brokers and the RAM working copy. Only the mirror's keys are
//! gone with the old process: the mirror is locked until Relay's next sync round unlocks it, a few seconds later.

use base64::Engine;
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

/// Relay's release key, the one its updater checks: `plugins.updater.pubkey`, base64 of a minisign public key.
const TAURI_CONF: &str = include_str!("../../../src-tauri/tauri.conf.json");
fn release_key() -> String { serde_json::from_str::<serde_json::Value>(TAURI_CONF).ok().and_then(|c| c["plugins"]["updater"]["pubkey"].as_str().map(String::from)).unwrap_or_default() }

/// Whether `sig` (a release's `<asset>.sig`: base64 of a minisign signature, made by `tauri signer sign`) signs `body`
/// with `key` (base64 of a minisign public key).
fn signed_by(key: &str, sig: &str, body: &[u8]) -> bool {
    let text = |b64: &str| base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok().and_then(|b| String::from_utf8(b).ok());
    let (Some(k), Some(s)) = (text(key), text(sig)) else { return false };
    match (minisign_verify::PublicKey::decode(&k), minisign_verify::Signature::decode(&s)) { (Ok(k), Ok(s)) => k.verify(body, &s, false).is_ok(), _ => false }
}
/// A device that only keeps the server (a vault admin, lib.rs KEEPER_OPS) may install only an official release: signed
/// with `key`. A paired device may send an unsigned binary (a server built from source), never a badly signed one.
fn check(key: &str, sig: Option<&str>, signed_only: bool, body: &[u8]) -> Result<(), String> {
    match sig {
        Some(s) if !signed_by(key, s, body) => Err("the binary is not an official Relay release: its signature does not check out".into()),
        None if signed_only => Err("a vault admin may only install an official Relay release: this binary is not signed".into()),
        _ => Ok(()),
    }
}

/// The `update` request: the bytes must carry the release signature when `signed_only` (and any signature sent must
/// check out), hash to `sha256`, run here and be relay-server `version`. Then they replace the kept binary. The caller
/// replies, then calls `restart`.
pub fn install(data: &Path, version: &str, sha256: &str, sig: Option<&str>, signed_only: bool, body: &[u8]) -> Result<(), String> {
    check(&release_key(), sig, signed_only, body)?;
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
        assert!(install(&data, "9.9.9", "00", None, false, script).unwrap_err().contains("damaged"));
        assert!(install(&data, "1.2.3", &sync::sha256_hex(script), None, false, script).unwrap_err().contains("not relay-server 1.2.3"));
        assert!(install(&data, "9.9.9", &sync::sha256_hex(script), None, true, script).unwrap_err().contains("not signed"));
        assert!(!path(&data).exists());
        install(&data, "9.9.9", &sync::sha256_hex(script), None, false, script).unwrap();
        assert_eq!(version_of(&path(&data)).as_deref(), Some("9.9.9"));
        fs::remove_dir_all(&data).ok();
    }
    // TEST material only, never Relay's key: a throwaway key pair made with `tauri signer generate`, its private half
    // thrown away, and `tauri signer sign` of TEST_FIXTURE with it.
    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDJDQTlDRDZEMzYyQkRENkIKUldScjNTczJiYzJwTEQrRitpY3MxeWpwRkxCRkxuODJNTnZIUkRKZWVmR0Z0WUo2VlowZzk1V2MK";
    const TEST_FIXTURE: &[u8] = b"relay-server signature test fixture\n";
    const TEST_SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVScjNTczJiYzJwTEExOGRHWmIzQkloQjFsZzhvdCtHZjBNakpLcTVWSWxFWUFUbXNMeXdGZkMxMlhseGluLzZtMFVSTWxrVFJTbGNmYkpiWVNsWUNvWXNEV2FsamZpeHdnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzMTA4NzIyCWZpbGU6Zml4dHVyZQpOcm1OSVUzN0hOVkpFdGQ5NGxnUUVDTUYwN0g2Tmo2VW1XNys3Wjg0SUNXVEZNcWFkKzZWM3dKR25iSGJiWFBLQkU1R0MwM1o2dlRGMExIOU9iRy9CZz09Cg==";
    #[test]
    fn a_keeper_installs_only_a_signed_release() {
        // a vault admin: the release signature, nothing else
        assert!(check(TEST_KEY, Some(TEST_SIG), true, TEST_FIXTURE).is_ok());
        assert!(check(TEST_KEY, None, true, TEST_FIXTURE).unwrap_err().contains("not signed"));
        assert!(check(TEST_KEY, Some(TEST_SIG), true, b"another binary").unwrap_err().contains("does not check out"));
        assert!(check(TEST_KEY, Some("not a signature"), true, TEST_FIXTURE).unwrap_err().contains("does not check out"));
        assert!(check(&release_key(), Some(TEST_SIG), true, TEST_FIXTURE).is_err(), "signed with another key");
        // a paired device: unsigned goes (built from source), a signature it sends is checked all the same
        assert!(check(TEST_KEY, None, false, TEST_FIXTURE).is_ok());
        assert!(check(TEST_KEY, Some(TEST_SIG), false, b"another binary").is_err());
        assert!(release_key().len() > 100, "the release key is built in");
    }
}
