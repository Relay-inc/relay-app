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
- **Linked devices (a phone).** A paired device can open a pairing for a device of its own (`pair_device`). That one
  shares its conversations, cards and mirror, but may only work with conversations: no mirror files, no moving
  sessions, no updating the server, no pairing further devices. Revoking a device revokes the devices linked to it.

What it does not change: an agent here runs with the same rights as on your laptop, and the permission cards still
come to Relay. Mail never runs here (Relay answers the mail tools itself). The vault comes as an encrypted mirror (below).

## On a Mac, with the Relay app

The simplest way on a Mac: Relay itself is the server. Install Relay on that Mac (in Applications, then once
`xattr -dr com.apple.quarantine /Applications/Relay.app`), install Claude Code there and log in (`claude`, then
`/login`), and switch on Settings › Machines › This Mac as a machine. Relay installs a LaunchAgent that runs
`Relay --relay-server serve --ram-disk` (this same code, inside Relay's binary), so it keeps running while Relay is
closed and a new Relay restarts it on its own version. Make a pairing line on that page and paste it in the other Mac's
Relay. `--ram-disk` keeps the mirror's working copy on a RAM disk that is hidden from Finder and ejected when the server
stops, as a tmpfs does on Linux.

## Set up from the source

1. Install Claude Code on this machine and log in with your own account: `claude`, then `/login`. Relay never sends
   your login anywhere, this machine has its own.
2. Optional: clone repos you want Claude to work in here, outside `~/Documents` on a Mac (see below).
3. Build and run: `cargo build --release -p relay-server`, then `target/release/relay-server serve` (on a Mac with
   `--ram-disk`).
4. Keep it running: `relay-server service` prints a LaunchAgent (Mac) or a systemd user unit (Linux) with the steps.
5. Pair: `relay-server pair` on this machine, paste the line in Relay › Settings › Machines. Pick the machine next to
   the model in a new conversation, or make it the default on that settings page.

**On a Mac:** a LaunchAgent may not read `~/Documents`, `~/Desktop` or `~/Downloads` without Full Disk Access. Keep
the repos in another folder (for example `~/repos`), or give `relay-server` Full Disk Access in System Settings.

## In Docker (a Linux server, Unraid, or a Mac with Docker Desktop)

Every Relay release also gets `ghcr.io/relay-inc/relay-server` for amd64 and arm64 (`scripts/push-server-image.sh`,
run on a Mac after the release), tagged with the same version (`:latest` is the newest), so a server and an app of the same version speak the same protocol. Claude Code is not in the
image: the first start installs it with Anthropic's installer into the `.local` volume, where its own updates stay.

1. The package is private. Log in once with a GitHub token that has `read:packages`:
   `docker login ghcr.io -u <your GitHub user>`, the token as the password.
2. Make the folders, owned by the container's user (uid 1000):
   ```sh
   mkdir -p /mnt/user/appdata/relay-server/{data,claude,repos,local}
   chown -R 1000:1000 /mnt/user/appdata/relay-server
   ```
3. Run it:
   ```sh
   docker run -d --name relay-server --hostname lserver --restart unless-stopped -p 47800:47800 \
     --tmpfs /home/relay/work:uid=1000,gid=1000,mode=0700,size=2g \
     -v /mnt/user/appdata/relay-server/data:/home/relay/data \
     -v /mnt/user/appdata/relay-server/claude:/home/relay/.claude \
     -v /mnt/user/appdata/relay-server/repos:/home/relay/repos \
     -v /mnt/user/appdata/relay-server/local:/home/relay/.local \
     ghcr.io/relay-inc/relay-server:latest
   ```
   `docker logs relay-server` shows Claude Code being installed, then `listening on 0.0.0.0:47800`.
4. Log in to Claude once: `docker exec -it relay-server claude`, then `/login` (it shows a URL to open on your laptop).
   The login stays in the `claude` folder.
5. Optional: clone repos into `repos`, e.g. `docker exec relay-server git clone <url> /home/relay/repos/<name>`. Private
   repos need a deploy key or a token inside the container. A conversation starts in the vault's mirror, Claude can
   work in a repo there when you point it at the folder.
6. Pair: `docker exec relay-server relay-server pair --host 192.168.1.2` with the server's LAN address. Inside a
   container the server cannot see that address itself.

**Update from Relay:** when Relay is newer than the server, Settings › Machines shows Update to <version>. Relay
downloads relay-server's Linux binary for the server's CPU from its own GitHub release (with `gh`, the repo is
private) and sends it over the connection. The server checks the checksum and that the binary runs and is that
version, keeps it as `data/bin/relay-server` and goes on in it in the same process. Conversations keep running, the
mirror locks until Relay's next sync round a few seconds later. Every start prefers that binary while it is newer than
the image's, so recreating the container keeps the update and a newer image wins again. A relay-server from before
0.0.5 cannot take this yet: update it once by hand.

**Update by hand:** `docker pull ghcr.io/relay-inc/relay-server:latest`, then `docker rm -f relay-server` and the same
`docker run`. The folders keep the pairing, the login, Claude Code and the repos; the mirror is locked until Relay
connects again.

**From the source**, without the registry: `docker compose -f packages/relay-server/docker/compose.yml up -d --build`
on the machine itself, or build on your laptop and load the image over ssh, so the source never goes there:
```sh
docker buildx build --platform linux/amd64 -f packages/relay-server/docker/Dockerfile --target server -t relay-server --load .
docker save relay-server | gzip | ssh root@192.168.1.2 'gunzip | docker load'
```
Then run it as above with `relay-server` as the image. On an Apple-silicon Mac the amd64 build takes about a minute
and a half.

## Testing on one Mac

`packages/relay-server/docker/selftest.sh` runs the whole thing without a second computer or a Claude login: the image's
`test` target (relay-server with a stand-in `claude`, `docker/fake-claude`) in Docker, and a separate build of Relay
with the `selftest` feature, with its own bundle id, data folder, broker folder and a throwaway vault, so the Relay you
use is not touched. The app pairs through Settings › Machines and starts a conversation from the main window by driving
the pages themselves, then answers a permission card, reads the history, survives a dropped connection, quits mid-turn
and takes the conversation back after a restart. The report is in `/tmp/relay-selftest/report.txt`.

## The mirror

Every paired machine gets the mirror, there is no switch: Relay keeps four folders in sync on it, so a conversation
there knows what Claude Code knows on the laptop. Every conversation there starts in the mirrored vault:

| Folder | From the laptop | Direction |
|---|---|---|
| `context` | `~/.claude/CLAUDE.md`, `skills/`, `agents/`, `commands/` | laptop to machine |
| `plugins` | the switched-on plugins | laptop to machine |
| `vault` | the vault, without `.obsidian`, `.git`, `.trash`, `.relay` and the excluded folders | both ways |
| `memory` | the vault's auto memory | both ways, `MEMORY.md` merged line by line |

The transcripts of the device's conversations are sealed the same way, as a fifth folder (`sessions`) that never
comes from the laptop: Claude Code keeps them in `<config>/projects/<slug of the vault's working copy>/`, and the server
makes that folder a link into the working copy at every unlock. Transcripts that were there before move in and are
sealed. A conversation that runs outside the vault's working copy (a repo) keeps its transcript in plain text.

A file changed on both sides keeps both versions: the machine's becomes `Name (conflict <machine> <date>).md`. Hooks,
transcripts, MCP servers and repos never go along: what a repo needs for Claude belongs in the repo.

### How the copy is encrypted

The machine only ever stores ciphertext. The key stays with the laptop.

- **The key.** Relay makes a random 256-bit key per machine the first time it syncs with it, and keeps it in
  its app data as `mirror-<machine>.key` (0600). It sends the key with an `unlock` request over the mutual-TLS
  connection at the start of every sync round. The server keeps it in memory only, never on disk.
- **Two keys from one.** HKDF-SHA256 derives a key to encrypt and a key to name the blobs from it, so neither is
  used for two jobs. A store from before HKDF is converted in place on its first unlock.
- **One blob per file**, in `data/mirror/<device>/<root>/`:
  - the name is HMAC-SHA256 of `<root>\0<path>`, so the disk shows neither file names nor folders,
  - the content is ChaCha20-Poly1305 (`ring`) over the path plus the file, with a fresh random 96-bit nonce per write
    and the root as associated data, so a blob moved to another root does not open,
  - on disk: `nonce (12 bytes) || ciphertext || tag (16 bytes)`.
- **A check blob** (`data/mirror/<device>/check`) holds a known text sealed with the key. A wrong key is refused at
  `unlock` ("this mirror was made with another key") instead of being used on the store.
- **Unlocked**, the server opens every blob into the working copy in `RELAY_SERVER_WORKDIR`, which should be a RAM disk
  (compose.yml and the `docker run` above mount a tmpfs at `/home/relay/work`). The agents work there. Every 5 seconds
  the server seals what changed back into blobs and removes the blobs of deleted files.
- **Locked** after a restart: only the blobs are left, the working copy is gone with the RAM disk. Conversations wait
  until the laptop connects and unlocks again. `relay-server revoke` and Forget in Relay delete a device's store.

What this protects, and what it does not:

| Who | Sees |
|---|---|
| Someone with the disk, a backup of `appdata` or the server while it is locked | How many files, their sizes and when they changed. No names, no content. |
| Root on the running server while the mirror is unlocked | Everything: the working copy is plain text in RAM, as it must be for the agent to read it. |
| Another device paired with the same server | Nothing: each device has its own store, working copy and key. |

Known limits:
- The blobs are sealed one by one, nothing binds the set together. Someone who can write to the disk can delete a blob
  or put back an older one of the same file, and the server would unpack that older version.
- A tmpfs can be swapped to disk when the machine has swap. Unraid has none by default. A Mac encrypts its swap.
- Claude Code keeps more than transcripts in its config folder, in plain text on disk: `history.jsonl` (the prompts),
  `file-history/` (a copy of each file before an edit), `paste-cache/`, `todos/`, and on Linux the login
  (`.credentials.json`). Only the transcripts are sealed.
- Losing the key file on the laptop makes the copy unreadable. Nothing is lost: Forget the machine, pair it again,
  and the next round sends everything again.

Without a RAM disk the server logs a warning and Settings › Machines says the working copy is on disk.

## Moving a conversation

Between two turns a conversation can move between this Mac and a machine, or between machines: pick another place in
the composer's machine list. Relay stops the agent, takes its transcript from where it ran (`session_get`), rewrites
the vault's paths and its memory's to the other side's, puts it where Claude Code on the
other side looks for it (`session_put`), and the next message resumes the same session there.

What moves is the conversation. Files that exist on one side only stay there: work not committed in a repo, or a vault
note in a folder the mirror leaves out. A conversation that read mail stays on this Mac. Subagents' transcripts and the
terminal's history do not move.

## Commands

| Command | What it does |
|---|---|
| `relay-server serve [--port 47800] [--bind 0.0.0.0] [--ram-disk]` | Run, on a Mac with the working copy on a RAM disk |
| `relay-server pair [--host <ip>] [--port <port>]` | Print a one-time pairing line |
| `relay-server clients` | The paired devices |
| `relay-server revoke <name or fingerprint>` | Unpair a device |
| `relay-server service` | A service file that keeps `serve` running |
| `relay-server info` | This server's fingerprint and data folder |
| `relay-server version` | This binary's version, the same as Relay's |

## Files

In `~/Library/Application Support/relay-server` (Mac) or `~/.local/share/relay-server` (Linux), or `RELAY_SERVER_DATA`:

| File | Content |
|---|---|
| `identity.crt.der`, `identity.key.der` | The server's certificate and key (0600) |
| `clients.json` | Paired devices: name, fingerprint, date |
| `pairing.json` | The open pairing code, while there is one |
| `serve.json` | The port the running server listens on |
| `pending/<device>/` | Open permission cards, per device |

The agents' transcripts are Claude Code's own, in `~/.claude/projects/` (sealed for conversations in the vault, see The
mirror). The brokers' sockets are in
`$TMPDIR/relay-server-agents`. An agent without Relay connected keeps its process for 24 hours, a running turn always
finishes.

## Tests

- `cargo test -p relay-server`: the whole path against the real binary, with a shell loop as the agent.
- `cargo test -p relay-server -- --ignored`: also one small Claude Haiku turn through the server on this machine's
  login, with a permission card answered over the network.
- `packages/relay-server/docker/selftest.sh`: Relay itself against relay-server in Docker (see above).
