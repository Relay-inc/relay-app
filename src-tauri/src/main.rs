// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let a: Vec<String> = std::env::args().collect();
    // `relay --broker <socket> <spec>`: hold one agent's pipes (src/broker.rs), nothing else of the app starts
    if a.len() == 4 && a[1] == "--broker" { return relay_lib::broker::main(&a[2], &a[3]); }
    // `relay --codex-bridge <bin> <config>` / `--opencode-bridge …`: one conversation's bridge to its agent (the agent crates' bridge.rs)
    if a.len() == 4 && a[1] == "--codex-bridge" { std::process::exit(agent_codex::bridge::main(&a[2], &a[3])); }
    if a.len() == 4 && a[1] == "--opencode-bridge" { std::process::exit(agent_opencode::bridge::main(&a[2], &a[3])); }
    // `relay --notify <title> <body>`: one banner, see src/notify.rs
    if a.get(1).map(String::as_str) == Some("--notify") { return relay_lib::notify::banner(&a[2], &a[3]); }
    // `relay --cli …`: an agent's `relay` command (src/actions.rs), answered by the running app
    if a.get(1).map(String::as_str) == Some("--cli") { std::process::exit(relay_lib::cli(&a[2..])); }
    relay_lib::run()
}
