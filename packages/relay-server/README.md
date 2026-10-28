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

- **A conversation from the Mac on the phone, signed.** A conversation that runs on the laptop itself reaches the
  phone only when it is shared there (`/share-phone`), and only through this server: see below.

What it does not change: an agent here runs with the same rights and in the same permission mode as on your laptop
(Relay sends the allow, deny and ask rules and `defaultMode` of `~/.claude/settings.json` with every start), and the
permission cards still come to Relay. Mail never runs here (Relay answers the mail tools itself). The vault comes as an encrypted mirror (below).

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
2. Repos live in `~/repos` (or `RELAY_SERVER_REPOS`), outside `~/Documents` on a Mac (see below). Relay clones them
   there once the machine is connected to GitHub.
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
5. Repos go in `repos` (`/home/relay/repos`). Relay clones them there once the machine is connected to GitHub (see
   GitHub below). A repo cloned there by hand shows up as well.
6. Pair: `docker exec relay-server relay-server pair --host 192.168.1.2` with the server's LAN address. Inside a
   container the server cannot see that address itself.

**Update from Relay:** when Relay is newer than the server, Settings › Machines shows Update to <version>. Relay
downloads relay-server's Linux binary for the server's CPU from its own GitHub release (with `gh`, the repo is
private), and its `.sig`, and sends them over the connection. The server checks the signature against Relay's release
key, built into it: required from a workspace admin (below), checked when sent by a paired device, which may also send an
unsigned binary it built itself. Then the checksum and that the binary runs and is that version, keeps it as
`data/bin/relay-server` and goes on in it in the same process. Conversations keep running, the mirror locks until
Relay's next sync round a few seconds later. Every start prefers that binary while it is newer than the image's, so
recreating the container keeps the update and a newer image wins again. A relay-server from before 0.0.5 cannot take
this yet: update it once by hand.

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

Every paired machine gets the mirror: Relay keeps four folders in sync on it, so a conversation there knows what
Claude Code knows on the laptop. Every conversation there starts in the mirrored vault. The one exception is a machine
paired with "Only for workspaces" ticked (`sharedOnly` in Relay's settings): it holds workspaces only, gets
nothing of the laptop and runs none of its conversations. Forget it and pair it again to change that.

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

## A conversation from the Mac on the phone

`/share-phone` in a conversation on the laptop lets its phone read and continue it, while it keeps running on the laptop
(`/unshare-phone` stops it). The laptop never listens on a port: Relay keeps a `share` connection open to the server the
phone is paired with, listing the shared conversations (key, title, agent). The phone sees them in its list. For each
request of the phone for one of them (`attach`, `kill`, `history {key}`) the server writes `{"open": token}` on that
connection, the laptop connects back with `share_open {token}`, and the server passes the bytes both ways. `start` for a
shared key is refused, so the phone never forks it onto the server.

The threat: this server (or someone who took it over) must be able to relay, not to make the laptop's agent do
anything. So the laptop believes only what the phone signed, and checks it itself (`relay_remote::share`):

- **The phone's key.** The phone signs with its certificate's private key (ECDSA P-256), sealed on the phone (the
  Android Keystore). The laptop learns the matching public key at pairing: the QR of Add phone carries a secret
  (`&link=`) that goes from the laptop's screen to the phone's camera, never to the server. The phone's first signed
  request carries `HMAC(link, its public key)`; the laptop then pins that key and the secret is used up. Only pinned
  keys count after that. Forget the machine on the laptop to drop them.
- **No replays.** Every connection the laptop serves starts with a fresh random challenge. The phone signs each line
  over the challenge, the conversation key, a counter that only goes up, and the line. A line from another connection,
  an older one, one sent twice, one changed on the way or one not signed is dropped before it reaches the agent.
- **Only what is shared.** The laptop answers only for conversations shared at that moment, on the laptop, that did not
  read mail (the same rule as moving to a machine), whatever key the server asks for. It stops passing lines the moment
  that changes.

What the server still can: see what passes (the shared conversation's lines and history, both ways, while the phone
follows it), drop or delay it, and know which conversations are shared and their titles. A phone paired before this
needs Add phone again to sign. The laptop must have Relay open; when it does not answer, the phone says so.

## Workspaces

A workspace is a team space several people keep in sync through this server, each in a plain folder on their own Mac
(the protocol and the crypto: `docs/workspaces.md`). The protocol and the server call it a vault, hence the `vault_*`
ops and `relay-server vaults`. The server stores each one in `data/vaults/<id>/`: `vault.json` (its name, the members'
device names and fingerprints, open invites) and one record per file in `blobs/`.

- **Only ciphertext.** Every record is sealed on the Mac with the workspace key, its name an HMAC of the path. The
  server never has the key: it sees how many files there are, their sizes, when they change and who the members are.
  Not a path, not a byte of content. It could hold back a newer version or drop one, but it cannot swap one file for
  another.
- **Invites.** An admin makes a link that works once, for 24 hours, and closes after 5 wrong tries. The workspace key
  travels in the link, sealed under a secret the server never sees. Whoever joins proves the link's code bound to both
  certificates, like pairing.
- **Workspace-only devices.** A device that came in through an invite may only work with the workspaces it is a member
  of: no agents, no mirror, no pairing, no workspaces of its own. Leaving its last workspace unpairs it. A linked
  device (a phone) gets no workspaces at all.
- **A workspace admin keeps the server.** A workspace-only device that is admin of a workspace here may also ask `info`
  and send an `update`, to an official release only: a binary without Relay's release signature, or with a bad one, is
  refused. Conversations, the mirror, phones and GitHub stay refused. It is read from the workspaces at every request,
  so a promotion or a removal counts at once.
- **A live channel.** A member's Relay keeps one `vault_stream` connection per workspace open next to its rounds; the
  server passes the frames members send (sealed with the workspace key, so unreadable here) to the other members at
  once. It stores none of them: only the last updates per workspace stay in memory for a short reconnect, gone at a
  restart, after which the rounds catch up. Members only, checked when the stream opens, on every frame and every 2 s;
  a frame is at most 256 KiB and a connection may send 100 lines a second (300 at once), past that its stream is closed.
  At most 4 streams per device and workspace, a 4 MiB queue and a 10 s write timeout per stream: a member that stops
  reading loses its stream, the others go on.
- **Documents.** A note members edit together is a document: an append-only log of updates sealed on the members'
  Macs (`doc_push`, `doc_pull` a page at a time, `doc_list`), under `vaults/<id>/docs/`. The server numbers them,
  notes who pushed each, and passes each new one to the other members' streams; it cannot read or forge them and never
  deletes any. It could hold some back or repeat them: the members' Relays warn of a gap in an author's updates or of
  edits that build on one they lack, and a repeat changes nothing. 10 000 documents a workspace, 512 MiB a member a
  day. A note that became a document is named to the server (`doc_bind`, its file's record name): a write or delete
  of that record by an older Relay's file sync is refused with "update Relay".
- **Removing someone** stops their device here at once, including their open stream. They keep what they already
  synced and the keys they had, so an admin's Relay then changes the workspace key: the new key goes to every member
  left, sealed to each one's own public key, and the server refuses writes under the old one. What is written after
  does not open with what the removed member holds.
- **A signed member list.** Who is in a workspace, who is an admin and which key is current come from a hash-chained
  list of entries each signed by an admin's identity (`vault_log`, `vault_append`); every member's Relay checks it from
  the creator. This server stores it and takes only entries that keep it valid; it cannot write one, and holding
  entries back is noticed by the members. The last admin cannot leave while others stay. `relay-server
  revoke` also takes a device out of its workspaces, and the key changes the same way.

`relay-server vaults` lists the workspaces with their members (name, role, fingerprint) and how many invites are open.

## Moving a conversation

Between two turns a conversation can move between this Mac and a machine, or between machines: pick another place in
the composer's machine list. Relay stops the agent, takes its transcript from where it ran (`session_get`), rewrites
the vault's paths and its memory's to the other side's, puts it where Claude Code on the
other side looks for it (`session_put`), and the next message resumes the same session there.

What moves is the conversation. Files that exist on one side only stay there: work not committed in a repo, or a vault
note in a folder the mirror leaves out. A conversation that read mail stays on this Mac. Subagents' transcripts and the
terminal's history do not move.

## GitHub

Settings › Machines › GitHub connects a machine to GitHub for the laptop that asks: the server starts GitHub's device
flow, Relay shows the 8-character code, you type it on github.com. Only that code passes through Relay, the token
(scope `repo read:user`) goes straight from GitHub to the server. The approval page on GitHub names Relay, the OAuth
app of Relay-inc. `RELAY_GITHUB_CLIENT_ID` points a server at another app.

- **Sealed per laptop.** The token is sealed with that laptop's mirror key, in `data/mirror/<device>/github.secret`.
  After a restart it is locked like the vault and works again once Relay on the laptop connects. Forget and revoke
  delete it, Disconnect too (it stays valid on GitHub until you revoke it there).
- **A credential helper, no variable.** While unlocked a plain copy sits in the working copy (`work/<device>/.github`,
  in RAM). Every agent of that laptop and the server's own git get `relay-server git-credential <that file>` as the
  only credential helper for `https://github.com`, and `Relay (<host>)` with `<login>@users.noreply.github.com` as
  the commit identity, through `GIT_CONFIG_*`. A conversation that was already running gets them at its next start.
- **The repos folder** is `RELAY_SERVER_REPOS`, else `~/repos` (`/home/relay/repos` in Docker), a folder per repo. Relay
  clones `https://github.com/<owner>/<repo>` there (a fetch when it is there already, a refusal when the folder holds
  another origin), lists each repo's branch, changes and commits not pushed, and pushes the branch checked out.
- **Snapshots.** To bring work to the laptop, the server puts everything in a repo (commits, changes, new files, not
  what `.gitignore` leaves out) in one commit on top of HEAD, built in an index of its own so the working tree and the
  index stay as they are, and force-pushes it to `relay/<machine>`.
- A linked device (a phone) can do none of this.

## Commands

| Command | What it does |
|---|---|
| `relay-server serve [--port 47800] [--bind 0.0.0.0] [--ram-disk]` | Run, on a Mac with the working copy on a RAM disk |
| `relay-server pair [--host <ip>] [--port <port>]` | Print a one-time pairing line |
| `relay-server clients` | The paired devices |
| `relay-server revoke <name or fingerprint>` | Unpair a device, and take it out of its workspaces |
| `relay-server vaults` | The workspaces, their members and open invites |
| `relay-server service` | A service file that keeps `serve` running |
| `relay-server info` | This server's fingerprint and data folder |
| `relay-server version` | This binary's version, the same as Relay's |
| `relay-server git-credential <file> <get\|store\|erase>` | Git's credential helper for github.com, set by the server for its agents |

## Files

In `~/Library/Application Support/relay-server` (Mac) or `~/.local/share/relay-server` (Linux), or `RELAY_SERVER_DATA`:

| File | Content |
|---|---|
| `identity.crt.der`, `identity.key.der` | The server's certificate and key (0600) |
| `clients.json` | Paired devices: name, fingerprint, date, and whether it only shares workspaces |
| `pairing.json` | The open pairing code, while there is one |
| `serve.json` | The port the running server listens on |
| `pending/<device>/` | Open permission cards, per device |
| `mirror/<device>/` | The device's sealed mirror and GitHub token |
| `vaults/<id>/` | A workspace: `vault.json` (members, invites, 0600) and its sealed records in `blobs/` |

The agents' transcripts are Claude Code's own, in `~/.claude/projects/` (sealed for conversations in the vault, see The
mirror). The brokers' sockets are in
`$TMPDIR/relay-server-agents`. An agent without Relay connected keeps its process for 24 hours, a running turn always
finishes.

## Tests

- `cargo test -p relay-server`: the whole path against the real binary, with a shell loop as the agent.
- `cargo test -p relay-server -- --ignored`: also one small Claude Haiku turn through the server on this machine's
  login, with a permission card answered over the network.
- `packages/relay-server/docker/selftest.sh`: Relay itself against relay-server in Docker (see above).
