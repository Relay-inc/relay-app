// `relay-serve [config]`: the server side of Relay, see src/serve.rs. Also `relay-serve --broker <socket> <spec>`,
// because the brokers it starts are this binary again (broker::launch runs current_exe).
fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() == 4 && a[1] == "--broker" { return relay_core::broker::main(&a[2], &a[3]); }
    let file = a.get(1).cloned().unwrap_or_else(|| format!("{}/.config/relay/serve.json", relay_core::home()));
    if let Err(e) = relay_core::serve::main(&file) { eprintln!("relay-serve: {e}"); std::process::exit(1); }
}
