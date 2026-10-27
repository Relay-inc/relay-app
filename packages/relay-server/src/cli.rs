// The command line of relay-server, shared by its own binary (main.rs) and the Relay app (`relay --relay-server …`).

use crate::{clients, data_dir, pair_line, revoke, set_broker_env, Server};
use std::process::exit;

const USAGE: &str = "relay-server: runs Relay conversations on this machine

  relay-server serve [--port 47800] [--bind 0.0.0.0] [--ram-disk]
                                                        run (a launchd or systemd service, see `service`)
  relay-server pair [--host <ip>] [--port <port>]      a one-time line to paste in Relay › Settings › Machines
  relay-server clients                                  the paired devices
  relay-server revoke <name | fingerprint>              unpair a device, at once (and take it out of its shared vaults)
  relay-server vaults                                   the shared vaults: members and open invites
  relay-server service                                  a service file that keeps `serve` running
  relay-server info                                     this server's fingerprint and data folder
  relay-server version                                  this binary's version (Relay's)
  relay-server git-credential <token file> <get|store|erase>
                                                        git's credential helper for github.com, set by the server

The data folder is RELAY_SERVER_DATA, else the platform's application data folder. --ram-disk (Mac) keeps the
mirror's working copy on a RAM disk, as a tmpfs does on Linux.";

fn flag(args: &[String], name: &str) -> Option<String> { args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned() }
fn fail(e: impl std::fmt::Display) -> ! { eprintln!("relay-server: {e}"); exit(1) }

/// The commands after the program's name, `a[0]`: `relay-server <command>`, or `relay --relay-server <command>` when
/// the Relay app runs as the server (its LaunchAgent). Whoever calls this answers `--broker`.
pub fn run(a: &[String]) {
    let data = data_dir();
    match a.get(1).map(String::as_str) {
        Some("serve") => {
            crate::upgrade::adopt(&data);
            // before Server::new starts any thread, see ramdisk::eject_on_stop
            if a.iter().any(|x| x == "--ram-disk") { ram_disk(&data); }
            set_broker_env();
            let port: u16 = flag(a, "--port").map(|p| p.parse().unwrap_or_else(|_| fail("bad --port"))).unwrap_or(relay_remote::proto::PORT);
            let bind = flag(a, "--bind").unwrap_or_else(|| "0.0.0.0".into());
            let server = Server::new(&data).unwrap_or_else(|e| fail(format!("{}: {e}", data.display())));
            let listener = std::net::TcpListener::bind((bind.as_str(), port)).unwrap_or_else(|e| fail(format!("{bind}:{port}: {e}")));
            eprintln!("relay-server: listening on {bind}:{port}, fingerprint {}, {} paired device(s)", server.fingerprint(), clients(&data).len());
            server.run(listener).unwrap_or_else(|e| fail(e));
        }
        Some("pair") => {
            let port = flag(a, "--port").map(|p| p.parse().unwrap_or_else(|_| fail("bad --port")));
            let line = pair_line(&data, flag(a, "--host"), port).unwrap_or_else(|e| fail(e));
            println!("Paste this line in Relay › Settings › Machines. It works once, for 10 minutes:\n\n{line}\n");
        }
        Some("clients") => {
            let list = clients(&data);
            if list.is_empty() { println!("No paired devices."); }
            for c in &list {
                let of = c.parent.as_ref().map(|p| format!("  linked to {}", list.iter().find(|x| &x.fp == p).map_or("?", |x| x.name.as_str()))).unwrap_or_default();
                println!("{}  {}…  paired {}{of}", c.name, &c.fp[..16], c.added);
            }
        }
        Some("revoke") => {
            let who = a.get(2).unwrap_or_else(|| fail("revoke <name | fingerprint>"));
            let gone = revoke(&data, who).unwrap_or_else(|e| fail(e));
            if gone.is_empty() { fail(format!("no paired device {who:?}")); }
            for c in gone { println!("Revoked {} ({}…). New connections from it fail.", c.name, &c.fp[..16]); }
        }
        Some("vaults") => {
            let all = crate::vaults::all(&data);
            if all.is_empty() { println!("No shared vaults."); }
            for v in &all {
                println!("{}  {}  {} member(s), {} open invite(s)", v.name, v.id, v.members.len(), v.invites.len());
                for m in &v.members { println!("  {}  {}  {}…", m.name, m.role, &m.fp[..16]); }
            }
        }
        Some("info") => {
            let id = crate::identity(&data).unwrap_or_else(|e| fail(e));
            println!("fingerprint {}\ndata {}", id.fingerprint(), data.display());
        }
        Some("version") => println!("{}", crate::upgrade::VERSION),
        Some("git-credential") => {
            let (Some(file), Some(op)) = (a.get(2), a.get(3)) else { fail("git-credential <token file> <get|store|erase>") };
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).ok();
            print!("{}", crate::github::credential(std::path::Path::new(file), op, &input));
        }
        Some("service") => print!("{}", crate::service_file()),
        _ => { println!("{USAGE}"); }
    }
}

/// `serve --ram-disk`: the working copy (`<data>/work`) on a RAM disk, ejected when the server stops. A Mac only, and
/// not when RELAY_SERVER_WORKDIR points elsewhere. Without one the server runs on, and Mirror warns about the disk.
#[cfg(target_os = "macos")]
fn ram_disk(data: &std::path::Path) {
    if std::env::var_os("RELAY_SERVER_WORKDIR").is_some() { return; }
    match crate::ramdisk::mount(&data.join("work")) {
        Ok(dev) => crate::ramdisk::eject_on_stop(dev),
        Err(e) => eprintln!("relay-server: {e}"),
    }
}
#[cfg(not(target_os = "macos"))]
fn ram_disk(_: &std::path::Path) { eprintln!("relay-server: --ram-disk is for a Mac, mount a tmpfs here (RELAY_SERVER_WORKDIR)"); }
