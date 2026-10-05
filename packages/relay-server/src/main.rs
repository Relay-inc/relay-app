// relay-server: see lib.rs. `relay-server serve` runs it, `pair` opens a pairing code, `clients` and `revoke` manage
// the paired devices, `service` prints a launchd or systemd unit to keep it running (cli.rs).

fn main() {
    let a: Vec<String> = std::env::args().collect();
    // `relay-server --broker <socket> <spec>`: hold one agent's pipes, started by `serve` itself
    if a.len() == 4 && a[1] == "--broker" { return relay_remote::broker::main(&a[2], &a[3]); }
    // `relay-server --perm-server`: an agent's permission tool, an MCP server on stdio, the same as the app's
    if a.get(1).map(String::as_str) == Some("--perm-server") { return agent_claude::perm_server::perm_server_main(); }
    relay_server::cli::run(&a);
}
