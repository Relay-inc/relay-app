# Workspaces on a relay-server

A workspace is a team space several people share through a relay-server. The server stores only ciphertext and never
has the workspace key. Access is by device certificate (the mTLS pin every Relay already has). Relay syncs the workspace
into a plain folder on each Mac with `sync::run` (TwoWay, conflict copies, never a merge). Each member's own Obsidian
vault never goes to a workspace: in the app it is their Personal workspace, next to the other vault folders they added
and the shared workspaces. The sidebar shows one workspace at a time, picked in its footer (⌃1 to ⌃9).

The protocol and the code call a workspace a vault: the server ops are `vault_*`, the Tauri commands `shared_vault_*`,
the settings key `sharedVaults`, the Rust module `shared_vaults.rs`. Only the app and these docs say workspace.

## Deletes

A round that would delete more than max(5, a fifth of the files) holds those deletes until the user lets them through
in Settings (both directions): an agent's `rm -rf` or a checkout here must not empty everyone's folder. What a round
deletes here is kept in `shared-trash/<id>/` for 30 days.

The Pages tab makes deletes on purpose too:

- **A move or rename** takes files away from their old place. Those pass the brake in the next round only, only as
  deletes on the server, and only while the server still has the content each file had when it was moved (its hash).
  A member who changed it meanwhile keeps it; a failed round drops the allowance, so a later one counts them like any
  delete.
- **Delete** (into the workspace's `.trash/`, which does not sync) is a delete like any other: the brake counts it, and
  it deletes for every member, who keep it 30 days in their `shared-trash`. The app asks first and says so. Undo puts
  it back here and it syncs again.

## Trust

**What the server sees:** workspace ids and names, member device names and fingerprints, blob names (HMACs of paths)
and sizes, and when they change. Not paths, not contents. It is trusted to keep the files, not to keep them secret: it
could serve an old version or drop one, but a swapped blob is caught (the name is bound in the AEAD), and a record it
cannot read is shown as damaged, never as deleted.

**Invites:** the link carries a secret, after `#`, that unwraps the workspace key. The server keeps the key only
encrypted under that secret, which it never sees. Links are single use, last 24 h, and die with the admin who made
them.

**A workspace admin keeps the server.** An admin may update it (`info`, `update`), but only to an official Relay
release: the binary must carry the release's minisign signature (the updater's key, `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`, built into the server). Unsigned or badly signed is refused before anything is written or
run. A device the owner paired may still send an unsigned binary (a server built from source), never a badly signed
one. The server refuses an admin everything else a paired device may do: conversations, the mirror, a phone, GitHub,
repos, making workspaces. Whether a device is an admin is read from the workspaces at every request, so a promotion or
a removal counts at once. In Relay the server then shows under Settings › Machines as one for workspaces only, marked
`auto` in the settings (`shared_vaults::keepers`), with no Forget and no New workspace: it goes again when this Mac is
admin of no workspace there. A machine the user paired is never touched.

**The live channel** passes frames, not files: sealed under the workspace key on the sender's Mac, passed to the
other members, never written to disk. The server sees which workspace and which record name (an HMAC) a frame is for,
its size, its kind (`update` or `awareness`) and who sent it, as with records. It could drop or delay one, not read,
forge or move one: the seal binds the workspace, the kind, the record name, the sender's device and the sender's own
counter, and Relay drops a frame it saw already (by that counter) and one that claims to be its own. That guarantee is
against the server only: every member holds the same key, so a member could seal a frame in another member's name.

**Removing a member** stops their device at the server at once, and closes their live stream. They keep what they
synced and the keys they had, so the key changes (Key rotation, below): what is written after the change does not open
with what they hold, also not for whoever gets the server's disk. What they had before stays readable to them.

**The fence is a guard, not a sandbox.** It keeps a conversation in its workspace and Claude Code's file tools and file
commands out of your vault and the other workspaces. It is not a boundary against a member who sets out to reach your
Mac through a note that steers your agent: a script in Bash or a local socket can still get out, and only the
auto-mode classifier judges those. Share a workspace with people you would let read what your agent can read. What it
does:

- **A conversation stays where it runs.** It runs in its project's vault or workspace, a general one in the one picked
  in its composer before its first message (the workspace the sidebar shows unless another is picked, checked against the vaults and
  workspaces here), and may not read or edit the others or their transcripts. Its first message names a project only
  of that vault or workspace, and once it started it moves only to its projects. Anywhere but the main vault it also
  may not touch Relay's data folder or Claude's config folders (with their `.claude.json`), and runs with no own MCP
  servers or connectors, no hooks, no auto memory, in auto mode. A main-vault conversation may not read the workspaces'
  trash, bases and keys. Codex and OpenCode run in the main vault only.
- **Nothing a member writes runs on your Mac.** `.claude` never syncs, and of the folder it links to (`System/`) only
  the notes go (`rules/`, `reference/`, `archive/`, `reminders.md`). Names compare as APFS and HFS+ do, a round
  follows no symlink, and a `.claude` linking somewhere the filter cannot guard is refused.
- **The project index is each Mac's own.** `work-state.md` and `System/index/` are generated from the project cards,
  so they do not sync: Relay rebuilds them after every round that moved a file. `System/scripts/` does not sync either,
  and Relay only ever runs its own `build-index.py`, which it also puts there for the workspace's conversations, as it
  puts its own skills in `System/skills/` (see What a new workspace starts as). A workspace with a script of its own
  (other card fields) is left alone: its conversations rebuild the index with it, and a Mac that joins such a workspace
  needs that script copied in by hand. Two people only clash on a card they both changed. A conflict copy of a rule
  lands in `System/conflicts/rules/`, out of what every conversation loads.
- **Your own mail, reminders and calendar stay out.** A conversation in a workspace or another vault folder gets an
  error for reading them through `relay` or the mail tools. Writing to you (a reminder, a draft) still works. `relay`
  answers for the conversation its caller really runs under, traced from the calling process. Integrations
  (Productive, GitHub, Trello) stay readable on purpose: that is the team's work.
- **A workspace added reaches running conversations.** Relay first checks that none is in a turn and no terminal tab
  runs one, then stops them and writes the change under one lock that also holds back new starts. Their next message
  starts them with the new fence. A conversation in an outside terminal (iTerm) keeps its old rules until it starts
  again. While a workspace is being made or joined, a new turn waits. A turn typed on a phone that already follows a
  conversation goes to the agent directly, past that check, and is cut off if it lands in those few seconds.
- **A project's key never moves.** It is its name in the main vault, else its name and its workspace's id. The sidebar
  shows a label, with the folder only when two of them have the name.

## What a new workspace starts as

A workspace made in an empty folder starts as the team starter (`vault::create_team`): the starter vault
(`src-tauri/resources/default-vault`) without the parts about one person (`vault::TEAM_DROP`: `user-profile.md`,
`System/rules/personal`, `Contexts/Personal`), with `src-tauri/resources/team-vault` copied over it. That overlay holds
a `CLAUDE.md` for a team workspace (several members, each with their own Claude, everything visible to all, no secrets,
personal things in each member's own vault), `System/rules/core/team.md` in place of the profile, team wording in
`memory.md`, `thinking-partner.md` and `session-protocol.md`, a `Work` context only, and a team setup skill. That skill
interviews whoever runs it about the team: what the workspace is for, who works in it, the contexts, conventions,
external people and organizations, projects, and what never goes in. On a workspace that started as a personal vault
it offers to move what is the team's into `team.md` and asks before it removes a personal file. A folder with notes is
uploaded as it is. The first start of Relay still makes the personal starter vault. `scripts/check-default-vault.py`
checks the team starter too.

**Skills are placed on each Mac.** `System/skills/` never syncs, so after a round that moved a file Relay writes its
own skills there (`vault::place_skills`, the starter's with the team overlay's on top), only the files that differ.
A folder it wrote has a `.relay-skill` file and follows Relay's version: edit a copy under another name. A folder of
the same name without that file is Relay's only when it is empty or exactly a starter's copy (the personal setup of a
folder an older Relay made), any other is the user's own and stays as it is. Relay only writes these files, it runs
nothing from the workspace.

## Wire protocol

Here a workspace is a vault, as in the code.

JSON lines over the existing mTLS connection (`proto.rs`), one request per connection, like the mirror's `sync_*`.
Additive: an older server answers `unknown request`.

Handshake: a device is accepted when it is in `clients.json`, or a pairing code is open, or any vault has an open
(unexpired) invite. A device that is not paired may only send `pair` or `vault_join`.

A device that came in through an invite is a *vault-only* client (`Client.vaults_only = true`): it may only send
`VAULT_OPS` = `pair` (a code from the owner makes it a full device), `vault_info`, `vault_invite`, `vault_invite_revoke`, `vault_join`, `vault_remove`,
`vault_manifest`, `vault_get`, `vault_put`, `vault_put_many`, `vault_delete`, `vault_stream`, `vault_pk`, `vault_rotate`. It never runs agents, reads a mirror or pairs
further devices. While it is admin of a vault here it also gets `KEEPER_OPS` = `info` (the server's paths and version)
and `update` (with `signature`, the release's `.sig` of the binary), nothing more. A linked device (a phone) gets no vault ops.

Ids: vault id 16 lowercase hex, invite id 16 lowercase hex, invite code 32 lowercase hex (`tls::random_secret`),
blob name 64 lowercase hex. Anything else is refused.

| Request | Who | Reply |
|---|---|---|
| `vault_create {name}` | a full device (not vaults_only, not linked) | `{vault: {id, name}}`, the caller is its admin |
| `vault_info {vault}` | member | `{vault: {id, name, role, members: [{name, fp, role, added, pk, mac}], invites: [{id, role, expires}], epoch, rekey, keys: {epoch: sealed}}}`, invites only for admins (else `[]`), `keys` only the caller's |
| `vault_invite {vault, role, wrapped}` | admin | `{invite: {id, code, expires}}`, `role` admin or member, `wrapped` hex at most 8192 chars, expires in 24 h |
| `vault_invite_revoke {vault, invite}` | admin | `{}` |
| `vault_join {vault, invite, name, proof}` | anyone with a valid link | `{vault: {id, name}, role, wrapped}`, `proof` = `tls::proof(code, client_fp, server_fp)`, 5 wrong proofs drop the invite, success consumes it, adds the device to `clients.json` as vaults_only when it is new (name deduplicated as in `pair`) and as a member |
| `vault_remove {vault, fp}` | admin, or the member itself (leave) | `{}`, refused when it would leave members without an admin, a vaults_only client with no vault left is removed from `clients.json`; sets `rekey` |
| `vault_manifest {vault}` | member | `{blobs: [{name, etag, size, meta, e}], epoch, rekey, role, me: {fp, pk, mac}}`, `meta` hex of the record's meta part, `etag` sha256 hex of the whole record file, `size` its bytes, `e` the epoch in its header |
| `vault_get {vault, name}` | member | reply line `{ok, len, etag}`, then `len` bytes: the record |
| `vault_put {vault, name, len, expect}` + `len` bytes | member | `{etag}`, written only if the current record's etag is `expect` (`""`: it must not exist), else `changed meanwhile` |
| `vault_put_many {vault, files: [{name, len, expect}]}` + the bodies one after the other | member | `{etags: {name: etag}, errors: {name: why}}` |
| `vault_delete {vault, name, expect}` | member | `{}`, only if the current etag is `expect`, else `changed meanwhile` |
| `vault_stream {vault, v, since, epoch}` | member | stays open, see Live channel |
| `vault_pk {vault, pk, mac}` | member, for itself | `{}`, `pk` 64 hex, `mac` `<epoch>:<64 hex>` |
| `vault_rotate {vault, epoch, keys: {fp: sealed}}` | admin | `{epoch}`, only the next epoch, a sealed key for every member and nobody else; clears `rekey` and every open invite |

A `vault_put` (and each file of `vault_put_many`) under another epoch than the current one is refused: `key changed`
for an older one, `no such key epoch` for a newer one. `revoke` of a client also removes its memberships and sets `rekey`.

## Live channel

Next to its rounds, Relay keeps one `vault_stream` connection per workspace open (`relay_remote::channel`, the server's
side `relay-server/src/channel.rs`). It carries frames between members within moments instead of at the next 10 s
round. Nothing uses the frames yet: the documents edited together come next. The workspace menu says per team
workspace whether it is live or syncing every 10 s. An older server answers `unknown request` (to a device that only
shares vaults: `"vault_stream" is not allowed …`); Relay then stays on rounds and asks again every 5 minutes. An older
Relay never asks and keeps its rounds.

- **Open:** `{"op": "vault_stream", "vault", "v": 1, "since", "epoch"}`. Another `v` is refused. The reply line is
  `{ok, v, epoch, seq, resumed}`: `epoch` is new at every start of the server, `seq` the last update it passed on for
  this workspace. `resumed`: the stream asked with this `epoch` and a `since` the server still has everything after;
  those updates follow at once, in order. Not resumed: some may be missing, and the rounds bring them.
- **App to server:** `{"t": "frame", "kind", "doc", "n", "body"}` and `{"t": "ping"}`. `kind` `update` or `awareness`,
  `doc` a record name (64 hex), `n` the sender's own counter (it starts at the time in µs, so it never repeats), `body`
  hex of the sealed frame, at most 256 KiB sealed.
- **Server to app:** `{"t": "frame", "seq", "from", "e", "kind", "doc", "n", "body"}`, `{"t": "ping"}` every 15 s and
  `{"t": "bye", "why"}` before it closes. `from` is the first 16 hex of the sender's certificate fingerprint, from the
  handshake. An update gets the next `seq` of its workspace, an awareness frame `seq` 0. A sender never gets its own;
  Relay also drops a frame whose `from` is its own device, and one whose `n` is not above the last it took from that
  sender for that document and kind.
- **Seal:** `nonce (12) || ChaCha20-Poly1305(enc_key, aad = "frame:" + vault + ":" + kind + ":" + doc + ":" + from + ":" + n,
  plaintext)`, under the sender's newest key; after a rotation `e` names that key's epoch and the aad starts with
  `"frame:" + e + ":"`. A frame that does not open (a key this Mac does not hold yet, or tampered with) is dropped.
- **Members:** checked when the stream opens and on every frame, against the workspace's members as vault.json last
  said (re-read when it changes, every 2 s by the workspace's one checker). A removal by an admin closes the stream at
  once, a `revoke` by the CLI (another process) within 2 s.
- **Limits:** 100 lines a second (frames and pings), 300 at once. At most 4 streams per device per workspace; a fifth
  closes the oldest. Each stream has a queue of 4 MiB and a write timeout of 10 s: a member that stops reading loses its
  stream (it catches up through rounds) and never holds up the others; streams are closed outside the server's lock.
  The server closes a stream that sent nothing for 45 s; the app does the same for a server silent that long.
- **Memory:** the last 512 updates or 2 MiB per workspace, shared by every stream (a resume sends from it), nothing on
  disk. A workspace nobody streams for 10 minutes is freed, its updates with it; so is one whose last member left.
- **Reconnect:** after 1 s, doubling up to 60 s.

## Storage on the server

`<data>/vaults/<id>/vault.json` (mode 0600):
`{id, name, created, members: [{fp, name, role, added}], invites: [{id, code, role, wrapped, expires, fails, by}]}`.
Expired invites are dropped whenever the file is read.

`<data>/vaults/<id>/blobs/<name>`: one record per file, written to a temp file and renamed, under a per-vault lock so
the compare-and-swap holds. A record at most `mirror::MAX_FILE` plus 64 KiB.

## Record

`u32 big endian (meta_len | epoch << 20) || meta (meta_len bytes, at most 64 KiB) || data`

- `meta` = `nonce (12) || ChaCha20-Poly1305(enc_key, aad = "meta:" + name, JSON {"p": path, "h": sha256 hex of the
  plaintext, "s": plaintext size, "m": mtime})`
- `data` = `nonce (12) || ChaCha20-Poly1305(enc_key, aad = "data:" + name, plaintext)`

`enc_key` is the key of the record's epoch. From epoch 1 on the aads are `"meta:" + epoch + ":" + name` and
`"data:" + epoch + ":" + name`, so the epoch in the header is bound into both seals. Epoch 0 is how every record was
before rotation existed: its header is the plain `meta_len`. The server parses `meta_len` (to list `meta` in the
manifest) and the epoch (to refuse a write under an old key), and checks it fits the record.

## Keys

- Workspace key: 32 random bytes. HKDF-SHA256 with salt `relay shared vault v1` derives `enc` (ChaCha20-Poly1305) and
  `name` (HMAC-SHA256). `name(path)` = hex HMAC(name, path).
- Invite: the link secret is 32 random bytes. HKDF-SHA256 with salt `relay vault invite v1` and info `wrap` derives a
  ChaCha20-Poly1305 key, and `wrapped` = hex(`nonce || seal(aad = "invite:" + vault id, vault key)`).
- On the Mac the workspace's keys live in Relay's data folder as `shared-<id>.key` (0600), like the mirror keys:
  epoch 0's key in hex on the first line (before any rotation that is the whole file, as it always was), then
  `<epoch> <hex>` per later key, `secret <hex>` (this member's X25519 secret) and `pin <fp> <public key>`. The keys
  alone are the recovery key Relay shows when the workspace is made, and again on its row in Settings › Machines.
- An invite after a rotation carries every epoch's key (`u32 BE epoch || key` each), so a new member reads what was
  written before it came; before any rotation it is the one key's 32 bytes, as always.

## Key rotation

Removing a member, a member leaving, or `revoke` sets `rekey` on the workspace. The next round of an admin's Relay
rotates: a new random workspace key, epoch + 1, sealed to every member left, made current by `vault_rotate` in one step.

- **Each member's public key.** Every Relay makes an X25519 key per workspace (`secret` in its key file) and registers
  the public half with `vault_pk`, vouched for with `mac` = `epoch:` + hex HMAC-SHA256(auth key of that epoch,
  `"pk:" + vault + ":" + fp + ":" + pk`) (HKDF info `auth`). It registers again after every rotation, under the new key.
- **Sealed to each member:** `hex(ephemeral X25519 public (32) || nonce (12) || ChaCha20-Poly1305(k, aad = "rekey:" +
  vault + ":" + epoch + ":" + fp, new key))`, `k` = HKDF-SHA256(salt `relay vault rekey v1`, the X25519 shared point,
  info the ephemeral public key). A low-order public key is refused.
- **Who it waits for.** The admin's Relay seals only to a public key vouched for under the current key, and one that
  matches what it pinned for that member at an earlier rotation. A member with neither (a Relay that predates rotation,
  or one not opened since the last rotation) holds it up; Settings › Machines names them, and the workspace keeps
  working on the old key meanwhile.
- **Interrupted.** `vault_rotate` is one write on the server: a rotation happened or it did not. An admin that stops
  after the server took it but before it saved the key gets it back on its next round, sealed to itself like everyone.
- **The others.** A member's round sees the new epoch in the manifest and fetches its sealed key (`vault_info.keys`). A
  write it made meanwhile under the old key is refused (`key changed`) and goes through on the next round. Its live
  channel starts again with the new key.
- **Names stay.** Record names stay HMACs under epoch 0's naming key: renaming every record would rewrite the whole
  workspace, and a removed member who gets the server's disk learns only whether a path it guesses exists.
- **Nothing is sealed again.** Records written before the rotation stay under their old key: the removed member had
  read them already. A new member gets every epoch's key in its invite.
- **What it does not cover.** A server that colludes with a removed member at the first rotation after the removal
  could slip in its own public key for a member: that member's vouching mac is under a key the removed member still
  holds. Pins catch it from the next rotation on.

## Invite link

The pairing line with three more fields:
`relay://<host>:<port>#fp=<64 hex>&code=<32 hex>&vault=<16 hex>&invite=<16 hex>&secret=<64 hex>`.
`PairLine` parses them as optional `vault`, `invite`, `secret`. A line with all three is an invite.
A link that opens Relay opens Settings › Machines with it in the join form. That page shows a workspace under the
machine that keeps it (the workspace's `fp` is the machine's), and under Workspaces when its server is not one of this
Mac's machines, as for a member who joined with a link.

The client side lives in `packages/relay-remote` (`vault.rs`, `client.rs`), the server side in `packages/relay-server/src/vaults.rs`.
