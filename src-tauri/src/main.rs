// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `relay --notify <title> <body>`: one banner, see src/notify.rs
    let a: Vec<String> = std::env::args().collect();
    if a.get(1).map(String::as_str) == Some("--notify") { return relay_lib::notify::banner(&a[2], &a[3]); }
    relay_lib::run()
}
