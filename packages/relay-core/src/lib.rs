//! What runs an agent without the app around it: the broker that holds an agent's pipes, the provider registry and
//! sessions.json. No Tauri, so the app and the headless `relay serve` share it.

pub mod agents;
pub mod broker;

use std::process::{Command, Stdio};

pub fn home() -> String { std::env::var("HOME").unwrap_or_default() }

/// The login-shell PATH, so an agent's tools find gh, himalaya, node: a GUI app or a LaunchAgent gets a bare one.
pub fn login_path() -> String {
    Command::new("/bin/zsh").args(["-lic", "printf %s \"$PATH\""]).stdin(Stdio::null()).output()
        .ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin".into())
}
