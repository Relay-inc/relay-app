//! Remote updates: Relay sends the relay-server binary of its own version (`update`), the server checks it, keeps it as
//! `<data>/bin/relay-server` and goes on in it. Every later start prefers that binary while it is newer than the one
//! that started, so a container that is recreated from the same image keeps the update, and a newer image wins again.
//! Not where the server is the Relay app itself (a Mac, or a Windows PC as a work machine): it updates with Relay.
//!
//! On Linux the server re-executes itself, which keeps the process (PID 1 in Docker), the brokers and the RAM working
//! copy. Windows has no exec: the server starts the new binary and exits, and the new one waits for the old one's lock
//! on the data folder (`lock`), so two never serve at once. Either way only the mirror's keys are gone with the old
//! process: the mirror is locked until Relay's next sync round unlocks it, a few seconds later.

use base64::Engine;
use relay_remote::sync;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Set for the binary that takes over from an updated one (Windows), so it waits for the old one's lock.
const TAKEOVER: &str = "RELAY_SERVER_TAKEOVER";

/// Whether `exe` is relay-server's own binary, not the Relay app running as the server (`relay --relay-server`).
pub fn is_server(exe: &Path) -> bool { exe.file_stem().is_some_and(|n| n == "relay-server") }
/// Whether this server can take an update from Relay: not on a Mac, and on Windows only as relay-server.exe.
pub fn can() -> bool {
    !cfg!(target_os = "macos") && (!cfg!(windows) || std::env::current_exe().is_ok_and(|e| is_server(&e)))
}

/// Where the binary from the last update is kept.
pub fn path(data: &Path) -> PathBuf { data.join("bin").join(format!("relay-server{}", std::env::consts::EXE_SUFFIX)) }

/// What `<bin> version` prints, when it runs here at all.
fn version_of(bin: &Path) -> Option<String> {
    let out = crate::cmd(bin).arg("version").stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|v| !v.is_empty())
}
/// `a` is a later version than `b` ("0.0.10" after "0.0.9").
pub fn newer(a: &str, b: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a) > parse(b)
}

/// Run this process's arguments on `bin`. Only returns when that fails.
#[cfg(unix)]
fn exec(bin: &Path) -> std::io::Error { std::os::unix::process::CommandExt::exec(Command::new(bin).args(std::env::args().skip(1))) }
/// Windows: start `bin` with this process's arguments and exit, the new process waits for this one's lock. Out of
/// Task Scheduler's job when the job allows it, so the task ending does not take the new server along.
#[cfg(windows)]
fn exec(bin: &Path) -> std::io::Error {
    use std::os::windows::process::CommandExt;
    const BREAKAWAY: u32 = 0x0100_0000; // CREATE_BREAKAWAY_FROM_JOB
    let start = |flags| Command::new(bin).args(std::env::args().skip(1)).env(TAKEOVER, "1").creation_flags(flags).stdin(Stdio::null()).spawn();
    match start(agent_core::job::NO_WINDOW | BREAKAWAY).or_else(|_| start(agent_core::job::NO_WINDOW)) {
        Ok(_) => std::process::exit(0),
        Err(e) => e,
    }
}

/// How long a binary that takes over waits for the old one to let go.
const TAKEOVER_WAIT: std::time::Duration = std::time::Duration::from_secs(15);
/// The data folder's lock, held by the serving process until it exits: a second `serve` on the same folder stops at
/// once, a binary taking over from an update (`TAKEOVER`) waits for the old one to exit. Used on Windows, where an
/// update is a new process (exec keeps the process elsewhere).
pub fn lock(data: &Path) -> Result<fs::File, String> {
    let takeover = std::env::var_os(TAKEOVER).is_some();
    std::env::remove_var(TAKEOVER); // not for the brokers this server starts
    lock_at(&data.join("serve.lock"), if takeover { TAKEOVER_WAIT } else { std::time::Duration::ZERO })
}
fn lock_at(file: &Path, wait: std::time::Duration) -> Result<fs::File, String> {
    fs::create_dir_all(file.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
    let f = fs::OpenOptions::new().create(true).truncate(false).write(true).open(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let until = std::time::Instant::now() + wait;
    loop {
        match f.try_lock() {
            Ok(()) => return Ok(f),
            Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < until => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(fs::TryLockError::WouldBlock) => return Err(format!("another relay-server serves from {} already", file.parent().unwrap_or(Path::new("")).display())),
            Err(fs::TryLockError::Error(e)) => return Err(format!("{}: {e}", file.display())),
        }
    }
}

/// At the start of `serve`: go on in the kept binary instead, when it is newer than this one.
pub fn adopt(data: &Path) {
    if !can() { return; }
    let bin = path(data);
    // the binary an update on Windows moved aside, free now that the process that ran it is gone
    if cfg!(windows) { fs::remove_file(old(&bin)).ok(); }
    let me = std::env::current_exe().and_then(|p| p.canonicalize()).ok();
    if me.is_some() && me == bin.canonicalize().ok() { return; }
    let Some(v) = version_of(&bin) else { return };
    if !newer(&v, VERSION) { return; }
    eprintln!("relay-server: {VERSION} goes on in {v} from the last update ({})", bin.display());
    eprintln!("relay-server: running {} failed: {}", bin.display(), exec(&bin));
}
/// Where an update on Windows moves the running binary: Windows renames a running executable but does not replace it.
fn old(bin: &Path) -> PathBuf { bin.with_file_name(format!("relay-server.old{}", std::env::consts::EXE_SUFFIX)) }

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
    if !can() { return Err(if cfg!(target_os = "macos") { "this machine is Relay on a Mac: it updates with Relay there" } else { "this machine is the Relay app: it updates with Relay there" }.into()); }
    if sync::sha256_hex(body) != sha256 { return Err("the binary arrived damaged (checksum)".into()); }
    let bin = path(data);
    fs::create_dir_all(bin.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = bin.with_file_name(format!("relay-server.new{}", std::env::consts::EXE_SUFFIX));
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&tmp, std::os::unix::fs::PermissionsExt::from_mode(0o755)).map_err(|e| e.to_string())?;
    if version_of(&tmp).as_deref() != Some(version) {
        fs::remove_file(&tmp).ok();
        return Err(format!("the binary does not run here, or is not relay-server {version}"));
    }
    // Windows: the kept binary may be the one running, moved aside first (adopt removes it at the next start)
    if cfg!(windows) && bin.exists() {
        fs::remove_file(old(&bin)).ok();
        fs::rename(&bin, old(&bin)).map_err(|e| e.to_string())?;
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
    fn the_server_binary_is_told_from_the_app() {
        assert!(is_server(Path::new("/usr/local/bin/relay-server")));
        assert!(is_server(Path::new("C:/Users/x/AppData/Local/Relay/server/bin/relay-server.exe")));
        assert!(!is_server(Path::new("C:/Users/x/AppData/Local/Relay/relay.exe")));
        assert!(!is_server(Path::new("/Applications/Relay.app/Contents/MacOS/relay")));
        assert!(path(Path::new("d")).ends_with(format!("relay-server{}", std::env::consts::EXE_SUFFIX)));
        assert_eq!(old(&path(Path::new("d"))).file_name().unwrap().to_string_lossy(), format!("relay-server.old{}", std::env::consts::EXE_SUFFIX));
    }
    // the lock a Windows update hands over: a second server stops at once, the one taking over waits for the first
    #[test]
    fn only_one_server_holds_the_data_folder() {
        let dir = std::env::temp_dir().join(format!("relay-lock-{}", std::process::id()));
        let file = dir.join("serve.lock");
        let first = lock_at(&file, std::time::Duration::ZERO).unwrap();
        assert!(lock_at(&file, std::time::Duration::ZERO).unwrap_err().contains("serves from"));
        let at = std::time::Instant::now();
        let gone = std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_millis(300)); drop(first); });
        lock_at(&file, std::time::Duration::from_secs(5)).expect("taken over once the first let go");
        assert!(at.elapsed() >= std::time::Duration::from_millis(250));
        gone.join().unwrap();
        fs::remove_dir_all(&dir).ok();
    }
    #[cfg(unix)]
    #[test]
    fn a_damaged_or_foreign_binary_is_refused() {
        let data = std::env::temp_dir().join(format!("relay-upgrade-{}", std::process::id()));
        if !can() { return; }
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
