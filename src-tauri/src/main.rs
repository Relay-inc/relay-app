// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `relay --broker <socket> <spec>`: hold one agent's pipes (src/broker.rs), nothing else of the app starts
    let a: Vec<String> = std::env::args().collect();
    if a.len() == 4 && a[1] == "--broker" { return relay_lib::broker::main(&a[2], &a[3]); }
    relay_lib::run()
}
