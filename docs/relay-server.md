# Running a relay-server

A relay-server keeps your team's workspaces in sync and can run Relay conversations while laptops are closed. This
guide sets one up on a Linux box with Docker in about fifteen minutes, with one compose file
([`deploy/relay-server/compose.yml`](../deploy/relay-server/compose.yml)). How the server works and what it can and
cannot see: [packages/relay-server/README.md](../packages/relay-server/README.md) and [workspaces.md](workspaces.md).

## Requirements

- A Linux box (amd64 or arm64) that stays on, with 1 GB of RAM to spare and disk for the workspaces.
- Docker Engine 25 or newer with the compose plugin (`docker compose version`).
- One TCP port the Macs can reach (47800 by default).
- Outbound HTTPS at the first start: the container installs Claude Code then. A server that only holds workspaces
  never uses it, and starts without it when the download fails.
- Relay on the Macs at the same version as the server. The image tag is the Relay version it belongs to.

## Install

```sh
mkdir relay-server && cd relay-server
base=https://raw.githubusercontent.com/Relay-inc/relay-app/main/deploy/relay-server
curl -fsSLO "$base/compose.yml" -O "$base/backup.sh" -o .env "$base/.env.example"
chmod +x backup.sh
docker compose up -d --wait
```

`.env` holds what you can change: the name Relay shows for the machine (`RELAY_HOST`), the port (`RELAY_PORT`), the
RAM for the mirror's working copy and another image tag. `--wait` returns once the healthcheck passes.
`docker compose ps` shows `healthy`, `docker compose logs` shows `listening on 0.0.0.0:47800`.

While the image is private (see [The image](#the-image)), log in first with a GitHub token that has `read:packages`:
`docker login ghcr.io -u <your GitHub user>`, the token as the password.

The healthcheck is `relay-server health`: a TLS handshake with the server's own certificate on its port and one
request. It needs a relay-server that has the command, an older image prints its usage and passes.

## Open the port

Allow TCP on `RELAY_PORT` from where the Macs are: the office network, the VPN, or your home addresses. The server
speaks only mutual TLS with pinned certificates, a device that is not paired fails in the handshake, but there is no
reason to show the port to the whole internet.

On the box itself, with ufw:

```sh
ufw allow from 192.168.1.0/24 to any port 47800 proto tcp
```

At a cloud provider, an ingress rule on the box's network (security list, security group or firewall rule):

| Direction | Protocol | Source | Port |
|---|---|---|---|
| Ingress | TCP | `203.0.113.0/24` (your office or VPN range) | 47800 |

Give the box a DNS name (`relay.example.com`) and pair with that name. Moving to another box is then a DNS change,
not a new pairing for every Mac.

## First pairing

```sh
docker compose exec relay-server relay-server pair --host relay.example.com
```

It prints a `relay://` line that works once, for 10 minutes. Paste it in Relay › Settings › Machines on your own Mac.
Tick Only for workspaces when this Mac should use the server for workspaces and nothing else.

The first device paired with a code is the server's owner. Under Settings › Machines › Organisation the owner starts
the organisation and becomes its first organisation admin: they see every workspace on the server, add other
organisation admins after comparing a code on both Macs, and offboard people
([workspaces.md › Organisation](workspaces.md#organisation)). Everyone else joins through a workspace's invite link
and needs no pairing line.

Conversations on this machine need a Claude login, a server for workspaces only does not:
`docker compose exec -it relay-server claude`, then `/login`. The login stays in the volume.

## SSO

Joining a workspace can go through Google or Microsoft Entra ID. An organisation admin sets it in Relay under
Settings › Machines › Organisation › SSO for joining. Nothing is configured on the server: the setting is signed by
the admin's Mac and the server only checks the ID token at the join. The steps and the app registration:
[workspaces.md › SSO](workspaces.md#sso).

## Update

Keep the server at the version of the Relay apps that use it, they speak one protocol. Two ways:

- **From Relay.** When Relay is newer, Settings › Machines shows Update to <version>. Relay sends the server the
  Linux binary from its GitHub release, with its signature. From a workspace admin the server takes only an
  official, signed release. The binary stays in the volume (`data/bin/relay-server`) and every start prefers it
  while it is newer than the image's, so recreating the container keeps the update.
- **The image tag.** Set `RELAY_SERVER_IMAGE=ghcr.io/relay-inc/relay-server:<version>` in `.env` (or take the newer
  `compose.yml`), then `docker compose pull && docker compose up -d --wait`.

Make a backup before either.

## What the server keeps

Everything is in the one volume `relay`, mounted at `/home/relay`:

| Path | Content |
|---|---|
| `data/identity.crt.der`, `data/identity.key.der` | The server's certificate and private key. Every paired Mac pins this certificate. |
| `data/clients.json` | The paired devices: name, certificate fingerprint, date, whether it came in through an invite |
| `data/org.json` | The organisation's signed list of admins and its SSO setting |
| `data/vaults/<id>/` | A workspace: `vault.json` (members, roles, open invites and the signed member list), `blobs/` (one sealed record per file), `docs/` (sealed document updates) |
| `data/mirror/<device>/` | A laptop's sealed mirror and GitHub token, when it uses the machine for conversations |
| `data/pending/`, `data/profiles/`, `data/sids.json` | Open permission cards, each laptop's agent settings, which conversation runs which Claude session |
| `data/serve.json`, `data/pairing.json` | The port it listens on, an open pairing code |
| `data/bin/relay-server` | The binary of the last update from Relay |
| `.claude/` | Claude Code's login and transcripts |
| `repos/` | The repos conversations work in |

What it does not keep: the workspace keys, file names or paths, or a readable byte of a workspace. Records are sealed
on the Macs. The server sees how many files there are, their sizes, when they change and who the members are
([workspaces.md › Trust](workspaces.md#trust)). The mirror's plain-text working copy is a RAM disk (`work`) that is
gone at every stop.

## Backup and restore

```sh
./backup.sh backup                          # relay-server-<date>.tar.gz in this folder
./backup.sh backup /mnt/backup/relay.tar.gz
```

It stops the server for the few seconds tar needs, so no record is half written, and starts it again. Laptops
reconnect on their own. Claude Code itself and the RAM disk are left out. A cron line for every night:

```
30 3 * * * cd /opt/relay-server && ./backup.sh backup /mnt/backup/relay-$(date +\%u).tar.gz
```

The backup holds the server's private key and the list of paired devices: keep it as safe as the box.

**On a new box** (or the same one after a disk failure):

1. Install Docker, put `compose.yml`, `.env`, `backup.sh` and the backup in a folder.
2. `./backup.sh restore relay-2026-11-10.tar.gz`. It refuses a volume that already holds a server identity, unless you
   add `--force`.
3. `docker compose up -d --wait`.
4. Point the DNS name at the new box, or give it the old address. The Macs connect to the address in their pairing
   line.

The server comes back with the same certificate, so every Mac accepts it without a new pairing. What changed after
the backup is not on it: a device paired later pairs again, and each member's Mac still holds its own copy of every
workspace file.

**Without the certificate** there is no way back to the same server. Every Mac refuses it during the handshake,
because it no longer is the server they paired with, and nothing on the server can change that. Treat it as a new
server: each Mac forgets the machine and pairs again (or joins through a new invite), the owner starts a new
organisation (its list is bound to the server's certificate), and admins make the workspaces again and invite their
members. The members' folders on their Macs are untouched.

## The image

`ghcr.io/relay-inc/relay-server` gets a tag per Relay release, for amd64 and arm64. No workflow builds it:
`scripts/release.sh` runs `scripts/push-server-image.sh` on a Mac at the end of every release, which pushes the image
with the version and `latest` and attaches the Linux binaries with their signatures to the GitHub release. Between
releases there is no new image. `scripts/release.sh` refuses to release while the tag in `compose.yml` is not the
version being released.

The package is private today, so every server needs `docker login ghcr.io`. Making it public is a setting of the
package, not of a workflow: an owner of the Relay-inc organisation opens the package on GitHub (Packages ›
relay-server › Package settings) and changes its visibility to public under Danger Zone. The organisation's
package settings must allow public packages. Once public, `docker login` is no longer needed and nothing else in
this guide changes.

## Test the recipe

`deploy/relay-server/smoke.sh` runs the whole thing on one machine: it builds the image's test target from the
checkout (a stand-in claude, nothing to install), starts `compose.yml` on port 47899, waits for the healthcheck, pairs a
throwaway certificate with the printed line and asks `info` over mutual TLS, then backs up the volume, deletes it,
restores it and checks the server came back with the same certificate and still knows the device. It needs OpenSSL 3
or newer (`OPENSSL=/opt/homebrew/bin/openssl` on a Mac, LibreSSL does not send the client certificate).
`RELAY_SERVER_IMAGE=ghcr.io/relay-inc/relay-server:<version>` tests a published image instead.
