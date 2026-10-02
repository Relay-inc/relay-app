// relay-server: see lib.rs. `relay-server serve` runs it, `pair` opens a pairing code, `clients` and `revoke` manage
// the paired devices, `service` prints a launchd or systemd unit to keep it running.

use relay_server::{clients, data_dir, pair_line, revoke, set_broker_env, Server};
use std::process::exit;

const USAGE: &str = "relay-server: runs Relay conversations on this machine

  relay-server serve [--port 47800] [--bind 0.0.0.0]   run (a launchd or systemd service, see `service`)
  relay-server pair [--host <ip>] [--port <port>]      a one-time line to paste in Relay › Settings › Machines
  relay-server clients                                  the paired devices
  relay-server revoke <name | fingerprint>              unpair a device, at once
  relay-server service                                  a service file that keeps `serve` running
  relay-server info                                     this server's fingerprint and data folder

The data folder is RELAY_SERVER_DATA, else the platform's application data folder.";

fn flag(args: &[String], name: &str) -> Option<String> { args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned() }
fn fail(e: impl std::fmt::Display) -> ! { eprintln!("relay-server: {e}"); exit(1) }

fn main() {
    let a: Vec<String> = std::env::args().collect();
    // `relay-server --broker <socket> <spec>`: hold one agent's pipes, started by `serve` itself
    if a.len() == 4 && a[1] == "--broker" { return relay_remote::broker::main(&a[2], &a[3]); }
    // `relay-server --perm-server`: an agent's permission tool, an MCP server on stdio, the same as the app's
    if a.get(1).map(String::as_str) == Some("--perm-server") { return agent_claude::perm_server::perm_server_main(); }
    let data = data_dir();
    match a.get(1).map(String::as_str) {
        Some("serve") => {
            set_broker_env();
            let port: u16 = flag(&a, "--port").map(|p| p.parse().unwrap_or_else(|_| fail("bad --port"))).unwrap_or(relay_remote::proto::PORT);
            let bind = flag(&a, "--bind").unwrap_or_else(|| "0.0.0.0".into());
            let server = Server::new(&data).unwrap_or_else(|e| fail(format!("{}: {e}", data.display())));
            let listener = std::net::TcpListener::bind((bind.as_str(), port)).unwrap_or_else(|e| fail(format!("{bind}:{port}: {e}")));
            eprintln!("relay-server: listening on {bind}:{port}, fingerprint {}, {} paired device(s)", server.fingerprint(), clients(&data).len());
            server.run(listener).unwrap_or_else(|e| fail(e));
        }
        Some("pair") => {
            let port = flag(&a, "--port").map(|p| p.parse().unwrap_or_else(|_| fail("bad --port")));
            let line = pair_line(&data, flag(&a, "--host"), port).unwrap_or_else(|e| fail(e));
            println!("Paste this line in Relay › Settings › Machines. It works once, for 10 minutes:\n\n{line}\n");
        }
        Some("clients") => {
            let list = clients(&data);
            if list.is_empty() { println!("No paired devices."); }
            for c in list { println!("{}  {}…  paired {}", c.name, &c.fp[..16], c.added); }
        }
        Some("revoke") => {
            let who = a.get(2).unwrap_or_else(|| fail("revoke <name | fingerprint>"));
            let gone = revoke(&data, who).unwrap_or_else(|e| fail(e));
            if gone.is_empty() { fail(format!("no paired device {who:?}")); }
            for c in gone { println!("Revoked {} ({}…). New connections from it fail.", c.name, &c.fp[..16]); }
        }
        Some("info") => {
            let id = relay_server::identity(&data).unwrap_or_else(|e| fail(e));
            println!("fingerprint {}\ndata {}", id.fingerprint(), data.display());
        }
        Some("service") => print!("{}", relay_server::service_file()),
        _ => { println!("{USAGE}"); }
    }
}
