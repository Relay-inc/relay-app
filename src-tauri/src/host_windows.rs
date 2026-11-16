//! This PC as a work machine: Relay's own relay-server (`relay.exe --relay-server serve`, main.rs) started by Task
//! Scheduler when the user logs on, the counterpart of the LaunchAgent on a Mac (host.rs). Relay on a Mac then runs
//! conversations here, also while this Relay is closed. A task as the user, not a Windows service: the server has to
//! run once the user is logged on, not before, and needs no admin rights that way. Only the Relay installed on this
//! PC, not a development build, whose binary cargo replaces under the task.
//!
//! The working copy has no RAM disk here: it is on disk, in a folder only this user may open (relay-server's
//! private_dir, docs/workspaces.md › Trust).

use relay_server::{clients, data_dir, identity, pair_line, task_user, task_xml, TASK_NAME};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

/// The binary the task runs: this Relay's, when it is not a development build (`target\debug`, `target\release`).
fn exe() -> Option<String> {
    let p = std::env::current_exe().ok()?;
    (!p.components().any(|c| c.as_os_str() == "target")).then(|| p.to_string_lossy().into_owned())
}
/// The task as it was last registered, kept to see whether a new Relay changes it (`refresh`).
fn task_file() -> PathBuf { data_dir().join("task.xml") }
fn task(exe: &str) -> String { task_xml(exe, "--relay-server serve", &task_user(), env!("CARGO_PKG_VERSION")) }

fn schtasks(args: &[&str]) -> Result<String, String> {
    let out = relay_server::cmd("schtasks.exe").args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}
/// The task file as `schtasks /XML` reads it: UTF-16 with a byte order mark, as its declaration says.
fn utf16(s: &str) -> Vec<u8> { [0xFEFFu16].into_iter().chain(s.encode_utf16()).flat_map(u16::to_le_bytes).collect() }
fn from_utf16(b: &[u8]) -> Option<String> {
    let units: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16(units.strip_prefix(&[0xFEFF]).unwrap_or(&units)).ok()
}
/// Register the task from `xml`, replacing one of the same name, and start it now.
fn register(xml: &str) -> Result<(), String> {
    let file = task_file();
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&file, utf16(xml)).map_err(|e| e.to_string())?;
    schtasks(&["/Create", "/TN", TASK_NAME, "/XML", &file.to_string_lossy(), "/F"])?;
    schtasks(&["/End", "/TN", TASK_NAME]).ok(); // a server of the task registered before goes, the new one starts
    schtasks(&["/Run", "/TN", TASK_NAME]).map(|_| ())
}
/// Whether the server answers on the port it wrote in serve.json. Not Task Scheduler's status, which comes in the
/// user's language, and a server that took over after an update runs outside the task.
fn serving(data: &std::path::Path) -> bool {
    let port = fs::read_to_string(data.join("serve.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|v| v["port"].as_u64());
    port.is_some_and(|p| std::net::TcpStream::connect_timeout(&(std::net::Ipv4Addr::LOCALHOST, p as u16).into(), Duration::from_millis(300)).is_ok())
}

pub fn status() -> Value {
    let on = schtasks(&["/Query", "/TN", TASK_NAME]).is_ok();
    let data = data_dir();
    let running = on && serving(&data);
    // identity() would make a certificate: only for a server that has one
    let fingerprint = if on { identity(&data).map(|i| i.fingerprint()).unwrap_or_default() } else { String::new() };
    let names: Vec<String> = clients(&data).into_iter().map(|c| c.name).collect();
    json!({"supported": exe().is_some(), "on": on, "running": running, "ram": false, "fingerprint": fingerprint, "clients": names})
}

/// Turn it on (register the task, start it) or off (stop it, remove the task). The pairings stay in relay-server's
/// data folder for a next time.
pub fn set(on: bool) -> Result<Value, String> {
    if on {
        let exe = exe().ok_or("Only the Relay installed on this PC can run as a machine, not a development build.")?;
        register(&task(&exe))?;
    } else {
        schtasks(&["/End", "/TN", TASK_NAME]).ok();
        schtasks(&["/Delete", "/TN", TASK_NAME, "/F"]).ok();
        fs::remove_file(task_file()).ok();
    }
    Ok(status())
}

/// Where relay-server runs the conversations of other devices.
pub fn work_dir() -> Option<PathBuf> { Some(relay_server::mirror::work_dir(&data_dir())) }

/// A one-time pairing line for the running server, with this PC's LAN address.
pub fn pair() -> Result<String, String> { pair_line(&data_dir(), None, None).map_err(|e| e.to_string()) }

/// At start: a task from another Relay version or place is registered again and restarted, so the server runs this
/// binary and speaks its protocol. Nothing when it is off or this is a development build.
pub fn refresh() {
    let (Some(exe), Some(old)) = (exe(), fs::read(task_file()).ok().and_then(|b| from_utf16(&b))) else { return };
    let new = task(&exe);
    if old != new && schtasks(&["/Query", "/TN", TASK_NAME]).is_ok() {
        if let Err(e) = register(&new) { eprintln!("relay: registering relay-server's task again: {e}"); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_task_file_is_utf16_with_a_bom_and_reads_back() {
        let b = utf16("<Task>é</Task>");
        assert_eq!(&b[..4], &[0xFF, 0xFE, b'<', 0]);
        assert_eq!(from_utf16(&b).as_deref(), Some("<Task>é</Task>"));
        let t = task(r"C:\Users\me\AppData\Local\Relay\relay.exe");
        assert!(t.contains(r"<Command>C:\Users\me\AppData\Local\Relay\relay.exe</Command><Arguments>--relay-server serve</Arguments>"));
        assert!(t.contains(&format!("Relay {}:", env!("CARGO_PKG_VERSION"))));
    }
}
