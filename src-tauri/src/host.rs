//! This Mac as a work machine: Relay's own relay-server (`relay --relay-server serve --ram-disk`, main.rs) under a
//! LaunchAgent, so Relay on another Mac runs conversations here, also while this Relay is closed. Only the Relay
//! installed as an app: launchd may not run a development build out of ~/Documents (TCC). The server is the same code
//! as the one in Docker, so the two stay on one protocol; a new Relay restarts it on its new binary (`refresh`).

use relay_server::{clients, data_dir, identity, launch_agent, pair_line, ramdisk, LAUNCH_LABEL};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// The binary launchd runs: this Relay's, when it is an installed app.
fn exe() -> Option<String> {
    std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned()).filter(|p| p.contains(".app/Contents/MacOS/"))
}
fn plist_path() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/LaunchAgents").join(format!("{LAUNCH_LABEL}.plist"))
}
/// The LaunchAgent for `exe`, with this Relay's version in it, so a new version reads as a change.
fn plist(exe: &str) -> String {
    let args = [exe, "--relay-server", "serve", "--ram-disk"].map(String::from);
    format!("{}<!-- Relay {} -->\n", launch_agent(&args), env!("CARGO_PKG_VERSION"))
}
fn launchctl(args: &[&str]) -> Result<String, String> {
    let out = Command::new("launchctl").args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}
fn domain() -> String {
    let uid = Command::new("id").arg("-u").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    format!("gui/{uid}")
}
/// (Re)load the LaunchAgent from its file: bootout first, a loaded one would refuse the bootstrap.
fn load() -> Result<(), String> {
    let d = domain();
    launchctl(&["bootout", &format!("{d}/{LAUNCH_LABEL}")]).ok();
    launchctl(&["bootstrap", &d, &plist_path().to_string_lossy()]).map(|_| ())
}

pub fn status() -> Value {
    let on = plist_path().exists();
    let running = on && launchctl(&["print", &format!("{}/{LAUNCH_LABEL}", domain())]).is_ok_and(|s| s.contains("state = running"));
    let data = data_dir();
    // identity() would make a certificate: only for a server that has one
    let fingerprint = if on { identity(&data).map(|i| i.fingerprint()).unwrap_or_default() } else { String::new() };
    let names: Vec<String> = clients(&data).into_iter().map(|c| c.name).collect();
    json!({"supported": exe().is_some(), "on": on, "running": running, "ram": ramdisk::device_at(&data.join("work")).is_some(),
        "fingerprint": fingerprint, "clients": names})
}

/// Turn it on (write the LaunchAgent, load it) or off (unload it, the server ejects its RAM disk, remove the file).
/// The pairings stay in relay-server's data folder for a next time.
pub fn set(on: bool) -> Result<Value, String> {
    if on {
        let exe = exe().ok_or("Only the Relay installed in Applications can run as a machine.")?;
        let path = plist_path();
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&path, plist(&exe)).map_err(|e| e.to_string())?;
        load()?;
    } else {
        launchctl(&["bootout", &format!("{}/{LAUNCH_LABEL}", domain())]).ok();
        fs::remove_file(plist_path()).ok();
    }
    Ok(status())
}

/// A one-time pairing line for the running server, with this Mac's LAN address.
pub fn pair() -> Result<String, String> { pair_line(&data_dir(), None, None).map_err(|e| e.to_string()) }

/// At start: a LaunchAgent from another Relay version or place is rewritten and reloaded, so the server runs this
/// binary and speaks its protocol. Nothing when it is off or this is a development build.
pub fn refresh() {
    let (Some(exe), Ok(old)) = (exe(), fs::read_to_string(plist_path())) else { return };
    let new = plist(&exe);
    if old != new && fs::write(plist_path(), new).is_ok() {
        if let Err(e) = load() { eprintln!("relay: reloading relay-server's LaunchAgent: {e}"); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plist_runs_this_binary_as_server_with_its_version() {
        let p = plist("/Applications/Relay.app/Contents/MacOS/relay");
        assert!(p.contains("<string>/Applications/Relay.app/Contents/MacOS/relay</string><string>--relay-server</string><string>serve</string><string>--ram-disk</string>"));
        assert!(p.contains(&format!("<!-- Relay {} -->", env!("CARGO_PKG_VERSION"))));
    }
}
