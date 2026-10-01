# relay-server

Runs Relay's agent conversations on another computer in your network (a home server, a spare Mac), so they keep
going while your laptop is closed. Relay connects to it over the LAN, or over your VPN when you are away.

## How it is secured

- **Mutual TLS 1.3 with pinned certificates.** The server and every paired device have their own certificate. Each
  side only accepts the exact certificate it paired with (its SHA-256 fingerprint), like Syncthing. A device that is
  not paired fails during the TLS handshake, before the server reads a single byte of a request.
- **No HTTP.** The server speaks JSON lines and the broker's own frames over TLS. A browser cannot talk to it, so a web
  page cannot reach it (the way CVE-2025-49596 and CVE-2026-22812 reached local servers).
- **Pairing with a one-time code.** `relay-server pair` prints a line with the server's address, its fingerprint and
  a code that works once, for 10 minutes, and closes after 5 wrong tries. Relay checks the server's certificate against
  the line, then proves it knows the code with an HMAC bound to both certificates.
- **Revoke per device.** `relay-server revoke <name>` removes one device; its next connection fails.
- **Each device its own conversations.** Two paired laptops never see or stop each other's conversations or cards.

What it does not change: an agent here runs with the same rights as on your laptop, and the permission cards still
come to Relay. Mail never runs here (Relay answers the mail tools itself), and neither does the vault.

## Set up

1. Install Claude Code on this machine and log in with your own account: `claude`, then `/login`. Relay never sends
   your login anywhere, this machine has its own.
2. Clone the repos you want to work on here, outside `~/Documents` on a Mac (see below).
3. Build and run: `cargo build --release -p relay-server`, then `target/release/relay-server serve`.
4. Keep it running: `relay-server service` prints a LaunchAgent (Mac) or a systemd user unit (Linux) with the steps.
5. Pair: `relay-server pair` on this machine, paste the line in Relay › Settings › Machines.
6. In the same settings page, link a project to its folder here. New conversations of that project run here.

`/usr/bin/python3` must exist (the permission tool is a small Python script). On a Mac it comes with the command line
tools (`xcode-select --install`).

**On a Mac:** a LaunchAgent may not read `~/Documents`, `~/Desktop` or `~/Downloads` without Full Disk Access. Keep
the repos in another folder (for example `~/repos`), or give `relay-server` Full Disk Access in System Settings.

## Commands

| Command | What it does |
|---|---|
| `relay-server serve [--port 47800] [--bind 0.0.0.0]` | Run |
| `relay-server pair [--host <ip>] [--port <port>]` | Print a one-time pairing line |
| `relay-server clients` | The paired devices |
| `relay-server revoke <name or fingerprint>` | Unpair a device |
| `relay-server service` | A service file that keeps `serve` running |
| `relay-server info` | This server's fingerprint and data folder |

## Files

In `~/Library/Application Support/relay-server` (Mac) or `~/.local/share/relay-server` (Linux), or `RELAY_SERVER_DATA`:

| File | Content |
|---|---|
| `identity.crt.der`, `identity.key.der` | The server's certificate and key (0600) |
| `clients.json` | Paired devices: name, fingerprint, date |
| `pairing.json` | The open pairing code, while there is one |
| `serve.json` | The port the running server listens on |
| `perm_server.py` | The permission tool the agents here use |
| `pending/<device>/` | Open permission cards, per device |

The agents' transcripts are Claude Code's own, in `~/.claude/projects/`. The brokers' sockets are in
`$TMPDIR/relay-server-agents`. An agent without Relay connected keeps its process for 24 hours, a running turn always
finishes.

## Tests

`cargo test -p relay-server` runs the whole path against the real binary with a shell loop as the agent. `cargo test
-p relay-server -- --ignored` also runs one small Claude Haiku turn through the server on this machine's login, with a
permission card answered over the network.
