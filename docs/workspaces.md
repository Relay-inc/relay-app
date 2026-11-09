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
with what they hold, also not for whoever gets the server's disk. What they had before stays readable to them. The
new key comes from an admin's Mac and is named in the signed member list (Members, below): the server cannot hand the
members a key of its own, add a member, make one admin or hide a removal without every Mac refusing it or noticing.

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
`vault_manifest`, `vault_get`, `vault_put`, `vault_put_many`, `vault_delete`, `vault_stream`, `vault_pk`, `vault_rotate`, and `org_log` (an admin of
its workspace adds the organisation admins, Organisation below). It never runs agents, reads a mirror or pairs
further devices. While it is admin of a vault here it also gets `KEEPER_OPS` = `info` (the server's paths and version)
and `update` (with `signature`, the release's `.sig` of the binary), nothing more. A linked device (a phone) gets no vault ops.

Ids: vault id 16 lowercase hex, invite id 16 lowercase hex, invite code 32 lowercase hex (`tls::random_secret`),
blob name 64 lowercase hex. Anything else is refused.

| Request | Who | Reply |
|---|---|---|
| `vault_create {name}` | a full device (not vaults_only, not linked) | `{vault: {id, name}}`, the caller is its admin |
| `vault_info {vault}` | member | `{vault: {id, name, role, me, members: [{name, fp, role, added, pk, id, sig, mac}], people: [{who, name, email, devices}], invites: [{id, role, expires}], epoch, rekey, keys: {epoch: {sealed, holders}}, nohistory}}`, `people` the member list's people with their devices' fingerprints (`[]` without a list), `nohistory` whether the list makes the workspace one without history (read from the list like the roles), invites all for an admin and the caller's own for a member, `keys` only the caller's sealed key and who each rotation was sealed to |
| `vault_invite {vault, role, wrapped, epoch}` | admin, or a member that is a person on the list (role member only) | `{invite: {id, code, expires}}`, `role` admin, member or reader, `wrapped` hex at most 256 KiB, expires in 24 h; `epoch` the newest key sealed in, refused (`key changed`) when it is not the current one |
| `vault_invite_revoke {vault, invite}` | admin, or a member for an invite it made | `{}`, only that invite |
| `vault_join {vault, invite, name, proof}` | anyone with a valid link | `{vault: {id, name}, role, wrapped}`, `proof` = `tls::proof(code, client_fp, server_fp)`, 5 wrong proofs drop the invite, success consumes it, adds the device to `clients.json` as vaults_only when it is new (name deduplicated as in `pair`) and as a member |
| `vault_remove {vault, fp}` | admin, or the member itself (leave) | `{}`, refused when it would leave members without an admin, a vaults_only client with no vault left is removed from `clients.json`; sets `rekey` |
| `vault_manifest {vault}` | member | `{blobs: [{name, etag, size, meta, e}], epoch, rekey, role, me: {fp, pk, mac}}`, `meta` hex of the record's meta part, `etag` sha256 hex of the whole record file, `size` its bytes, `e` the epoch in its header |
| `vault_get {vault, name}` | member | reply line `{ok, len, etag}`, then `len` bytes: the record |
| `vault_put {vault, name, len, expect}` + `len` bytes | member, not a reader | `{etag}`, written only if the current record's etag is `expect` (`""`: it must not exist), else `changed meanwhile` |
| `vault_put_many {vault, files: [{name, len, expect}]}` + the bodies one after the other | member, not a reader | `{etags: {name: etag}, errors: {name: why}}` |
| `vault_delete {vault, name, expect}` | member, not a reader | `{}`, only if the current etag is `expect`, else `changed meanwhile` |
| `vault_stream {vault, v, since, epoch}` | member | stays open, see Live channel |
| `vault_pk {vault, pk, id, sig, mac, imac}` | member, for itself | `{}`, `pk` and `id` 64 hex, `sig` 128 hex, `mac` `<epoch>:<64 hex>`, `imac` 64 hex or empty; only the shape is checked here |
| `vault_log {vault}` | member | `{entries}`: the member list |
| `vault_append {vault, entry, keys}` | member, `entry.by` the caller, a reader only its `leave` | `{}`, only when the whole list still checks (`relay_remote::members::check`); whoever the entry takes off the list (`remove`, `leave`, or `person-remove` with every device of that person) is removed here in the same write; an `add` stores `keys` (epoch: sealed, epoch 0 included) for the new member, and may add an organisation admin as admin that never joined (it becomes a member here in the same write); `create` only on an empty list by an admin; `rekey` refused (it goes with `vault_rotate`) |
| `org_log {from}` | any device | `{entries, len, owner}`: the organisation list from `from` on, `owner` whether the caller is the server's owner (the first full device paired) |
| `org_append {entry}` | a full device, `entry.by` the caller | `{}`, only when the whole organisation list then still checks (`members::check_org`), `create` only by the owner on an empty list, `add` only of a full device paired here |
| `org_pk {id, pk, sig}` | a full device, for itself | `{}`, its organisation keys for an admin to add it, only the shape is checked here |
| `org_overview` | an organisation admin | `{workspaces: [{id, name, list, managed, admin, nohistory, members: [{fp, name, role, person, listed}], people}], people: [{name, email, devices, workspaces: [{id, name, role}]}], admins, candidates: [{fp, name, id, pk, sig}]}`: what each member list says, never a record |
| `org_revoke {fps}` | an organisation admin | `{revoked: [{fp, name}]}`, those devices (and the phones linked to them) out of `clients.json` as `relay-server revoke` does, never an organisation admin |
| `vault_rotate {vault, epoch, keys: {fp: sealed}, entry}` | admin | `{epoch}`, only the next epoch; `entry` the `rekey` entry, appended in the same write when the list then checks, and a sealed key for exactly the list's members; clears `rekey` and every open invite |

A reader (Roles, below) is refused every write with one answer, `read only: a reader of this workspace cannot change
it` (`members::READ_ONLY`): `vault_put`, `vault_put_many` (per file), `vault_delete`, `vault_append` other than its
`leave`, `vault_invite`, `vault_invite_revoke`, and the document ops `doc_push`, `doc_snapshot_put`, `doc_bind` and
`doc_unbind`. Its `update` frames on the live stream are dropped, its `awareness` frames pass (they only say where it
is). It still reads (`vault_info`, `vault_manifest`, `vault_get`, `vault_log`, `doc_list`, `doc_pull`, the stream),
publishes its own keys (`vault_pk`) and leaves.

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
  hex of the sealed frame, at most 256 KiB sealed. On a workspace without history the frame also carries `from`, the
  sender's session id (Without history, below).
- **Server to app:** `{"t": "frame", "seq", "from", "e", "kind", "doc", "n", "body"}`, `{"t": "files"}` after another
  member put or deleted a file (the rounds run at once; it names no file), `{"t": "ping"}` every 15 s and
  `{"t": "bye", "why"}` before it closes. `from` is the first 16 hex of the sender's certificate fingerprint, from the
  handshake, or on a workspace without history the session id the frame named. An update gets the next `seq` of its
  workspace, an awareness frame `seq` 0. A sender never gets its own;
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

`<data>/vaults/<id>/docs/<name>/log/<seq>` (and `<seq>.from`, the device that pushed it, or on a workspace without
history `<seq>.sid`, the session id its Relay sent) and `.../snap/<upto>`: a
document's sealed updates, numbered from 1 with no gap, and any snapshots members stored (see Documents, not handed
out). Written whole under the vault's lock; never deleted.

## Documents

The page features (editing, co-editing, history, comments, mentions) are behind Settings › General › Experimental › Files, off by default. The documents themselves are not: a Mac with Files off still pulls, pushes and writes a workspace's documents every round, so its notes never go stale; only the switch that turns a workspace's notes into documents is hidden there.

A note several members edit at once is a document instead of a file the rounds copy whole: a Yjs document whose
markdown is one Y.Text, so the `.md` written out is that text and nothing is lost going back and forth to Obsidian or
an agent. Its edits merge; there are no conflict copies for it.

- **Which note.** The workspace's manifest document (id `manifest`) maps each path to a random document id (32 hex) in
  its map `paths`. A rename changes only the manifest, so a document keeps its history across renames. A document's
  name on the server is the epoch-0 naming key over `doc:<id>`; a sidecar (comments) is `doc:<id>#<what>`. Paths
  compare as APFS does (case, normalization): a second note at a taken path is refused here, and two keys that are one
  name on disk (made apart) keep the first in order, the other moved to `<name> (conflict <first 8 of its id>).md`.
  Two members who make a note at the same path while apart both keep theirs: the manifest keeps one and the other is
  put back under that conflict name. Both are the same name on every Mac.
- **On the server**, per document an append-only log of sealed updates, each with the device that pushed it. Nothing
  there is read, merged or deleted: the log is the document's history, kept for good. Ops (members only, `vault_*`'s
  rules): `doc_push {vault, doc, updates: [len…]}` with the parts after the line (each at most 4 MiB, one push at
  most 16 MiB, under the vault's current key, else `key changed` / `no such key epoch`), answers `{seq, seqs}`;
  `doc_pull {vault, doc, since, limit}` answers a page of the updates after `since` (at most 1000 and 32 MiB, `more`
  past either), each with `from` (a session id on a workspace without history, where `doc_push` carries `from` too),
  and `doc_list {vault}`. `doc_snapshot_put {vault, doc, upto, len}` stores a member's
  snapshot (a place the log has, at least 200 updates past the last, none replaced) as an unchecked hint for the
  history to come: no pull hands one out, and Relay writes none yet. Limits: 10 000 documents a workspace, 512 MiB a
  member may push into a workspace a day (counted in memory, so a restart starts the day over). A push also goes at
  once to the other members' live streams as `{t:"doc", doc, seq, from, body}` when it fits a frame; one that does
  not waits for a pull.
- **A part** is laid out like a record: `u32 BE (meta_len | epoch << 20) || meta || body`, each `nonce ||
  ChaCha20-Poly1305(enc_key, aad, …)`. The meta's aad is `"docmeta:" + epoch + ":" + vault + ":" + name + ":" + kind +
  ":" + upto + ":" + author`, the body's `"docbody:" + … + ":" + author + ":" + n`, so a part opens only as the
  device that sealed it and a body only with its own meta. The meta is JSON: `a` the author device (16 hex), `t` ms,
  `l` its member list head, `n` the author's own counter for this document. The body is the Yjs update (v1). An
  update's seq is the server's, given after it is sealed, so it is not in the aad.
- **What a Mac checks.** A Mac builds a document from the log alone, a page at a time. A part is opened as the device
  the server says pushed it; one that does not open (another author, another key, tampered with) or does not apply is
  left out with a warning naming its place, and the next is taken. An update under an older key than the Mac's newest,
  past where it had the log when it took that key, is left out (a removed member still holds the old key); before a
  Mac's first pull on the new key it cannot tell, as with records. A gap in an author's counter is warned ("held
  back"). A meta naming a longer member list than the Mac's is warned, as for records and frames. Edits Yjs cannot
  place, because they build on an update the Mac left out or never got, make it read the log again from the start once
  per sync; while they stay missing, every round warns which author's edits are missing.
- **What the server can still do.** It cannot read a part, forge one, or pass one off as another member's. It can
  delay or withhold updates: a Mac notices when a later update of the same author, or one building on it, comes, not
  when nobody ever gets it. It can reorder or repeat updates: Yjs applies them in any order and more than once, so the
  text is the same. A member, holding the key, can write anything another member could, including a part sealed as
  another device (the server's `from` is what tells them apart).
- **On each Mac**, per workspace, each document's state and cursor (`shared-docs/<id>/`). Every round pulls the
  documents the server has further (the manifest first; one that fails is warned and the others go on), sends what the
  server has not taken from this Mac yet (an edit made off line goes then; what was pulled counts as held, so a push
  is only this Mac's own edits), and writes the notes whose text changed (temp file and rename): never where the file
  rounds keep files out (System/ outside its allowed folders, hidden), never through a symlink. A file it replaces that
  is not what Relay last wrote goes to the workspace trash first; a renamed note's old file goes once it is as Relay
  wrote it (to the trash first otherwise), unless another note has that place now or the file rounds keep it out. A
  note that is a document, and its old path until that file is gone, stay out of the file rounds. A live update is
  taken on a thread of its own, under the same lock as the rounds.
- **Which notes are documents.** None until an admin turns it on (Settings › Machines, "Notes as shared
  documents"): a `docs-on` entry in the member list, signed like any other, which every member checks; `docs-off`
  turns it off again. Then each round on an admin's Mac makes up to 50 notes documents: `.md` files the file rounds
  would sync, not through a link, no conflict copy, at most 2 MiB, and only once the last file round left the file the
  same here and on the server; never past 10 000 documents. A note's text goes to the server before its place in the
  manifest, so no Mac learns of a note it cannot read yet, and a Mac that has the place but not the text writes nothing
  for it. Two admins' Macs doing it for the same note at once: the manifest keeps one and the other Mac drops its own
  (its file, when it differs, stays next to the note as a conflict copy).
- **Older Relays.** Each document's record name (the file rounds' name for the path) is told to the server
  (`doc_bind {vault, names}`, at most 1000 a call); the server remembers who bound each and refuses a file-round write
  or delete of that record from then on. A name with a record already (an existing note) only an admin binds; each
  member binds at most 10 000. A moved or deleted note's old name is let go again (`doc_unbind`, by who bound it or an
  admin). The manifest says which records are bound, and a Relay does not seal those again after a key change. A
  Relay from before documents keeps syncing every other file and gets "this note is a shared document now: update
  Relay to change it" for a document's note; the copy it has stays as it was (the record is not deleted, or it would
  delete its file). A Relay with documents that meets the error (it had not learned of the document yet) says the note
  became a shared document and takes it on its next round.
- **A change on disk.** When the note's file changes outside the document (Claude, Obsidian, a page's save, git), the
  change is what differs from the text Relay last wrote there or took from it (kept per document, `<id>.out`, written
  after the cursor that names it), never the file over the document: lines matched (Myers), then the chars that
  differ, made on top of what others changed meanwhile as diff3 does (a change both made alike counts once, text others
  removed stays removed, text both put at one place stays, theirs first). It goes out as this Mac's update, with who
  made it in the meta (`o`: `claude` when a conversation's file tool wrote it in the last seconds, `relay` for a page's
  save or a link a move rewrote, else `disk`). The mtime and hash only notice the change; nothing is decided by which
  is newer. It is taken when the watcher hears of it, when a page saves, and at the latest by the next export, which
  takes a changed file in before it writes and leaves a file that changes while it writes for the next one. Relay's
  own writes are told to the watcher, so an open page takes them in without counting them as a change. A byte-order
  mark and CRLF line ends do not go into the document. With no text to measure against (a document from before this
  kept one), the file is not diffed: it stays as a conflict copy when it differs, and the document is written.
- **A program that writes back an old copy** of a note (an editor with a stale buffer, a script) undoes the others'
  edits in it, as any edit would; the history keeps them.
- **Moves and deletes.** A note moved in the Pages tab keeps its document: the move and the manifest change happen
  under the workspace's round lock, a manifest change that fails moves the files back, and links the move rewrote in
  the note go in as an edit. A note moved outside Relay (Finder, git) is a new note at its new place (the old one is
  written back). One document moved to two places at once on two Macs ends at the path that sorts first, on every
  Mac. A note deleted in the Pages tab leaves the manifest (map `gone`; the document and its log stay on the server for
  history), its file goes from every Mac (kept as a conflict copy where it was changed), and Undo puts it back. A
  note's file deleted any other way is written back, warned.

### A page open on a document

When a note that is a document is open as a page, its editor binds to the document instead of saving the file:

- **Open.** `shared_doc_open` gives the page everything this Mac has of the document; the page holds it as its own
  Y.Doc while it is open. Its editor shows the body; the head (frontmatter, the title's heading) is the start of the
  same Y.Text, edited through the properties above it.
- **Typing.** What is typed goes into that Y.Text and, every 300 ms, to the Mac's documents (`shared_doc_edit`,
  `Docs::apply_local`), which send it and write the `.md` out. No `write_note` for such a page.
- **What others do.** Another member's edit, and a change of the note's file taken in (Claude, Obsidian), reach the page
  as `shared-doc` events (`Docs::subscribe`) and land in the editor without moving the cursor.
- **⌘Z** undoes only what was typed on this Mac (a Y.UndoManager on this Mac's own edits).
- **Cursors.** Each Mac sends its cursor and selection as an `awareness` frame on the live channel (sealed like any
  frame), at most 10 a second and again every 10 s while it stays put; a member not heard from for 30 s has left the
  page. The others' cursors show with their name, their avatars in the page's bar. The name is the one the sender
  gives (its Mac's), so a member can show another name; it is not a proof of who is typing.
- **Closed.** The page's Y.Doc goes; the Mac's documents keep syncing, so another Mac's typing keeps the file current.

### Comments on a page

A page's comments (the speech bubble in its bar, or ⌥⌘M on a selection) never touch its `.md`. Each thread is a log of
entries that are never rewritten: a comment (its text, the quoted text and an anchor), replies, resolve, reopen and
delete (`src-tauri/src/comments.rs`).

- **On a document.** The entries live in the note's sidecar document `<id>#comments` (map `c`, one key per entry),
  sealed and synced like the note, live on the channel. Who wrote an entry is the author of the sealed update that last
  wrote it (`Docs::comments`, the `owners` in its cursor), never what the entry says of itself: an entry another member
  overwrites counts as theirs from then on. A comment's anchor is two Yjs relative positions in the note's text, so it
  stays on its words whatever anyone types around it; once they are deleted the thread says "On deleted text".
- **Anyone** replies, resolves and reopens; **only an entry's author deletes it**: a delete by someone else is left out
  when the threads are read. A modified Relay can still remove a key from the sidecar itself; the document's history
  keeps what it held.
- **Any other note** (a workspace of the user's own, a shared one whose notes are not documents) keeps its comments in
  `<workspace>/.relay/comments/<path>.json` on this Mac only (hidden, so no round syncs it), anchored by the quoted text
  and where it began.
- **Agents.** `relay comments.list path=…` reads a page's threads in the conversation's own workspace (runs);
  `relay comments.reply path=… id=… text=…` replies as the user (asks first). A path outside that workspace, or
  through a link out of it, is refused.

### Mentions and the Inbox

- **@ in a comment or reply** on a document lists the workspace's other members (from the server's member list) whose
  name starts with what is typed. The entry keeps who it mentions as the first 16 hex of their fingerprint (`m`, at most
  20), never names; what is not a member's 16 hex is left out when it is read. A note of the user's own has no `@`.
- **A banner, once.** After each round Relay looks for comments and replies that mention this Mac's member, written by
  someone else and not deleted, and shows a banner for each it has not told yet. The keys told are kept in
  `shared-docs/<vault>/mentions-seen.json`, so a restart tells nothing again and a member who was offline is told on
  their first round back. The very first look at a workspace only notes what is there, so updating Relay tells nothing
  old. With a phone paired, a push goes to its ntfy topic too, without a name or text (ntfy.sh is public).
- **The Inbox** in the workspace menu of a team workspace lists its open threads that mention you or are on a page this
  Mac edited, newest first; a click opens the page with that thread. Resolving a thread takes it out.
- **Names** of authors and mentions come from the server's member list (`shared_vaults::name_of`, full or 16-hex
  fingerprint); the signed member list holds no names, so the server could show another name for a member.

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

- Workspace key: 32 random bytes. HKDF-SHA256 with salt `relay shared vault v1` derives `enc` (ChaCha20-Poly1305),
  `name` (HMAC-SHA256) and `auth` (HMAC-SHA256, Key rotation). `name(path)` = hex HMAC(name, path).
- Invite: the link secret is 32 random bytes. HKDF-SHA256 with salt `relay vault invite v1` and info `wrap` derives a
  ChaCha20-Poly1305 key, and `wrapped` = hex(`nonce || seal(aad = "invite:" + vault id, plain)`), `plain` JSON
  `{"keys": {epoch: hex key}}`: every epoch's key, so a new member reads what was written before it came. An older
  Relay's invite is the one key's 32 bytes, which this one still takes; an older Relay cannot join from this one's.
- On the Mac the workspace's keys live in Relay's data folder as `shared-<id>.key` (0600), like the mirror keys,
  written whole (a temp file renamed over it): epoch 0's key in hex on the first line (before rotation existed that
  was the whole file), then `<epoch> <hex>` per later key and, once each, `secret <hex>` (X25519), `sign <hex>` (the
  Ed25519 seed), `creator <hex>`, `head <length> <hex>` (the member list as last checked), `expect <hex>` (the head an
  invite named, until checked once), `joined <hex>` (the invite secret, until this Mac is added), and
  `invite <id> <secret> <role> <epoch>` per open invite this Mac made. Every value is checked (64 lowercase hex where it
  is a key or hash); a duplicate or unknown line makes the file unreadable. The keys alone are the recovery key Relay
  shows when the workspace is made, and again on its row in Settings › Machines.

## Members

Who is in a workspace, who is an admin and which key is current come from its member list, never from the server's
own `vault.json` (that one only decides who may connect, and its roles follow the list). The list is an append-only
chain of entries (`relay_remote::members`), at most 10 000: `{seq, prev, kind, fp, id, pk, role, epoch, h, at, by, sig,
mac, who, name, email}`, `prev` the hash of the entry before (sha256 of what it signs and its signature), `sig` the
Ed25519 signature of `by` over every other field but `mac`, and the vault id. The person fields `who`, `name` and
`email` are signed only when one is set (as JSON after the rest), so an entry from before people signs as it did.
Every hex field is lowercase, and every field a kind does not use is empty.

- `create` (the creator, signed by itself, with `mac`: its identity vouched for under the vault's epoch-0 key, which the
  server never has), `add` (a member with its identity `id`, X25519 key `pk` and `role`), `remove`, `promote`,
  `demote`, `role` (`fp` gets `role`), `device` (a member's new keys) are signed by an admin of the list as it stood
  just before, `leave` by the
  member itself; `rekey` (epoch `epoch` is current, the sha256 of its key `h`) by an admin. No entry may leave the list
  without an admin, and none may leave it empty.
- `nohistory` (no other field) makes the workspace one without history (below). Only as entry 1, right after `create`,
  so signed by the creator. Anywhere else, a second one, or one by a member or reader is refused, and no entry undoes
  it. A list without it is another history than the one a member saw, which its Relay refuses as a fork.
- **Roles** are `admin`, `member` and `reader`, per device. An admin of the list picks one in Members, and its Relay writes
  `promote` or `demote` between admin and member (as before readers, so a list without readers stays readable for an
  older Relay) and a `role` entry for anything with reader. `promote` makes anyone an admin, `demote` makes an admin a
  member and leaves a reader as it is. The server's role follows the list. A member who was admin on the server before
  the list came in as a member (trust on upgrade only adds members) and is made admin this way.
- **A reader** reads the workspace and changes nothing. It is invited as one (`vault_invite` with role `reader`, only
  by an admin) or given the role by an admin. A device that joined with a reader invite goes on the list as a reader,
  also through trust on upgrade or Add to list, and the server refuses an `add` of it with another role. On the list it signs nothing but its own `leave`: no device of its own,
  no naming of itself, no `person-remove`, also not for its own person. A member gives nobody the reader role. The
  server refuses its writes (Wire protocol). Its Relay knows it is one from the server's role (`vault_info`), which
  follows the list: its rounds only pull (`sync::Mode::Pull`: what is unchanged here takes the server's side, a file
  deleted here comes back, any other change here is kept and not sent, and Settings says how many), its documents take
  no edit and bind nothing, a file change is not taken into a document, nothing is sealed again under a new key, and
  its pages open read-only with a line saying why. It still holds every key (it reads). A Relay from before readers
  refuses a list with a reader or a `role` entry: every member updates first.
- `policy` (`providers`, `capture`, no other field) is the workspace's policy (below), by an admin. Its two fields are
  signed only on a `policy` entry, so every entry from before signs as it did.
- A `remove` or `leave` leaves the list waiting for a `rekey`; a `device` entry is refused while it waits (the new keys
  could be the removed member's).
- **A new workspace** gets its list right away: Relay writes the `create` before anything else reaches the server.
- **Every Mac checks the list** against the creator's identity it knows: from the invite link (`creator=`), or, knowing
  none, only a list whose `create` is vouched for under epoch 0's key (a server cannot start one). It checks only what
  is new since it last checked, which must follow what it checked (else: a fork), and the list must reach the `head`
  in its key file (else: held back, also when the server has no list at all) and hold the head an invite link named.
  Every append this Mac makes moves its `head` on, so a dropped entry of its own is noticed too. A fork or a list held
  back stops this Mac's key step, shows a warning, and counts the key as changing (the part held back could be a
  removal).
- **The server cannot write an entry**: it has no member's identity, and it takes an append only when the whole list
  then still checks (so no member can break the list for the others). It refuses `vault_remove` on a listed workspace,
  and `relay-server revoke` leaves a listed workspace's members as they are (the device cannot connect any more; an
  admin removes it in Relay, which changes the key). What the server can do is hold entries back. Every record's meta
  (`l`) and every frame (bound into its seal) names the list head its writer had seen; a Mac that reads a longer one
  than the server gives it, or another one at a length it has, warns.
- **Joining.** The joiner's Relay publishes its keys (`vault_pk`) with `imac`, an HMAC with a key derived from the
  invite link's secret (HKDF info `join`). The inviting admin's Relay kept that secret, the invite's role and expiry
  (`invite` in its key file; dropped when revoked, expired, or a key change made the invite void) and adds the joiner
  once `imac` checks, sealing it the keys of every epoch since the invite. Until then the joiner reads with the keys
  its invite carried and is no holder of a new key.
- **Removing and leaving** is a signed entry (`vault_append`), and the server removes the member in the same write.
  From then on every Mac counts the key as changing, whatever the server's `rekey` says, and warns after an hour.
- **A member who set up Relay again** publishes new keys; every Mac shows it, and an admin can trust them with a
  `device` entry (after a confirm; only when the publication is signed by the new identity and vouched for under the
  newest key, and no removal waits). Every other Mac follows the list.
- **People** sit on top of devices: members stay devices (certificate fingerprint, identity, key), and a device may
  belong to a person. `person` (`who` 64 hex, `name` 1 to 100 characters without control characters or outer spaces,
  `email` optional) names a person, made the first time and renamed after, and with `fp` puts that device under it.
  `person-remove` (`who`) takes the person off with every device under it, and like a `remove` leaves the list waiting
  for a `rekey`. An `add` with `who` adds a device under that person. An admin may write any of these. Without an
  admin, a device may only: name itself as a new person (`fp` itself, while it has none), add a device under its own
  person as member, and take its own person off (which takes itself off too). A device that claims another person, or
  a person that adds an admin device through a member device, is refused like any entry by a non-admin. A device
  without a person stays a member as before, so a list from before people needs no change. A Relay from before people
  refuses a list once it holds one of these entries: every member updates first. `email` does nothing yet: it is there
  for a sign-in later. In Members the people show with their devices under them: Add a device… on your own person
  makes an invite link (as member) that your Relay adds under you, Name person… on a device without one (an admin for
  any, a member for this Mac), and Rename… and Remove for an admin (Remove also for the person itself, which makes
  this Mac leave). The grouping comes from the list as this Mac checked it, the server's `people` only before its
  first round.
- **A workspace from before the list** gets one from the first admin on this version, in one round: the `create`, then
  an `add` as member for every member the server lists whose Relay already published keys vouched for under the
  workspace key. Later rounds add nobody that way: a member whose Relay published its keys after that shows as Not on
  the list under Members, without a role or Remove, until an admin clicks Add to list there. That writes an `add` as
  member on the same proof (its keys signed by it and vouched for under the newest key), refused while a removal waits
  for a new key (the removed member still holds the current one). An invite does not help such a member: the server
  keeps its old entry and never notes the invite it joined with. Two admins at once:
  the server takes one list, and the other admin takes it on its next round.

## Organisation

A server can have an organisation (`relay-server/src/org.rs`, `relay-remote/src/org.rs`): organisation admins, a role
above the workspace admin that keeps the server (`KEEPER_OPS`) and manages every workspace on it. It stays within the
trust model: who is an organisation admin is a signed list, and what one does to a workspace is an entry on that
workspace's member list, signed by its Mac. The server grants nothing itself.

- **The organisation list** (`org.json` on the server, 0600) has the member list's rules (`members::check_org`): a hash
  chain of Ed25519-signed entries, checked under the name `org:<server fingerprint>` so it never checks as another
  server's or as a workspace's. Only four kinds: `create` (by the owner, the first full device paired with the server,
  its `mac` the sha256 of that name as there is no workspace key), `add` (an organisation admin: its device `fp`, its
  organisation identity `id` and X25519 key `pk`, role admin, no person), `remove` and `leave`. Everyone on it is an
  admin and may add or remove another, the last one stays. The server appends only what still checks.
- **Organisation keys.** Each Mac has, per server, an organisation identity and X25519 key (`org-<server>.key` in the
  app data, in a workspace key file's format). Its Relay publishes them (`org_pk`, signed by the identity) when the
  Organisation section opens. An admin adds a device on what it published, but only after the user compared the
  device's code (12 hex of the keys' sha256) with the one its own screen shows: a server that swapped the publication
  for its own keys gives another code. The add is refused when the keys changed since the comparison.
- **Every Mac checks the list** and pins it in its organisation key file: its creator, and the head it last saw. A list
  held back, forked, or started by another creator adds nobody to any workspace. The first sight is trust on first
  use: a Mac that has never seen the list takes the one the server gives (a server can start a fake one only before
  any Mac of the organisation saw the real one, and its admins would then be the server's own keys).
- **Organisation admins on a workspace.** A new workspace adds the organisation admins as admins right after its
  `create` (and `nohistory`). An admin of an existing workspace does the same with Add organisation admins in its
  settings. One that is not on the list goes on with an `add` carrying its organisation keys, and every key of the
  workspace so far sealed to its organisation key (epoch 0 included, as it never had an invite link). One that is a
  member or reader is promoted. The organisation admin's Relay takes the epoch-0 key sealed to it when its
  Organisation section opens (`org::adopt`), checks the list from a `create` vouched for under that key, and from then
  on signs that workspace's list with its organisation identity. It does not sync the workspace into a folder unless
  it also joins it.
- **The overview** (`org_overview`) shows every workspace with what its member list says (people, devices, roles) and
  whether every organisation admin is an admin of it (Managed, else Not managed), and every person across the
  workspaces, grouped by a device or an email two lists share. The server reads only the lists and its own device
  names, never a record.
- **Offboarding in one step.** Offboard on a person signs, in every workspace this Mac is admin of, a `person-remove`
  for the person that holds any of their devices, or a `remove` for a device under no person, then runs the key step
  so the key changes at once. Then `org_revoke` takes the devices off the server: they connect nowhere any more. A
  workspace where this Mac is no admin keeps the person, which the confirm and the result say, with what to do (ask an
  admin there, or have them add the organisation admins). An organisation admin is offboarded only after it left the
  organisation.
- **What it means.** An organisation admin is an admin of every workspace it manages, so it reads it. Settings says so
  where the role is given. A consultancy wants exactly that. A team that does not, has no organisation or does not
  add it to a workspace.
- **Compatibility.** A relay-server from before answers `unknown request` to `org_*`, and refuses an `add` of a device
  that never joined. A Relay from before reads a workspace with an organisation admin as any list with one more admin
  (it is a plain `add`), and never sees the organisation list.

## SSO

A server's organisation can make joining a workspace there go through a sign-in with an OpenID Connect provider:
Google first, another issuer through the same check (Entra ID's tenant check comes on top later). It is a gate on
joining, on top of the device model: keys stay per device, an invite link is still needed, and the server grants
itself nothing.

- **The setting is signed.** An organisation admin sets it under Settings › Machines › Organisation › SSO for joining:
  the provider (Google, or another issuer URL), the OAuth client id, the email domains allowed, and whether signing
  in is required. It goes on the organisation list as an `sso` entry this Mac signs (`members::check_org`), with the
  same rules as every other entry: only an organisation admin signs one, an https issuer, a client id and one to 20
  lower-case domains, each once. An entry with every field empty turns it off, a newer one replaces the older. The
  server cannot turn it on, off or wider: a changed field breaks the signature. A workspace's member list never takes
  one. There is no client secret anywhere: the app is a public client with PKCE.
- **Signing in.** The join form asks the link's server what to sign in with (`sso_info`, which a device not paired
  yet may ask while an invite is open). The app checks that answer against the same rules before it opens anything,
  then opens the system browser on the issuer's authorisation endpoint (from its discovery document): authorisation
  code, PKCE S256, a fresh `state`, `scope=openid email profile`, `prompt=select_account`, `hd` as a hint when there
  is one domain, and a `nonce`. The redirect comes back to a listener on `127.0.0.1` at a random port, the app checks
  `state`, swaps the code for tokens at the token endpoint with the code verifier and keeps the ID token in memory
  for the join. Google no longer allows custom URI schemes for desktop apps, so the redirect is the loopback address,
  not `relay://`.
- **The nonce binds the token to the device.** It is `sha256("relay-sso:<server fp>:<device fp>:<salt>")`
  (`org::sso_nonce`) with a fresh salt the join sends along. The server recomputes it from the TLS session's
  certificate, so a token one device got never joins another.
- **The server checks the token** at `vault_join` (`oidc.rs`), after the invite proof checks (a device without a good
  proof never makes the server fetch anything) and before the invite is spent: RS256 against the issuer's keys (its
  JWKS, found through its discovery document, which must name that issuer), `iss` (Google's with or without
  `https://`), `aud` the client id (a list with `azp` that client), `exp` and `iat` within a minute of skew, the
  `nonce`, `email_verified`, the email's domain in the list, and for Google `hd` equal to that domain (an address of
  the domain on a personal Google account has no `hd`, and Google's docs say to check `hd` when access is limited to
  a domain). Without a valid token a join is refused when SSO is required. When it is not, a join without one passes
  and a bad one is still refused. The keys are fetched at most once a minute per issuer, used for an hour, and no
  longer than two hours while the issuer cannot be reached: then joins fail closed.
- **What the server keeps.** Never the token. On the joiner's record (`vault.json`) the verified email, the name from
  the token and when, which an admin sees. Nothing is signed from it.
- **The email on the person.** Once the device is on the member list, its own Relay names itself as a new person with
  the email and name its own login returned (a `person` entry it signs, kept in its key file as `sso` until then). A
  server cannot put an address on anyone. A device that joins under an existing person (Add a device…) keeps that
  person. A reader signs nothing but its leave, so it stays without one.
- **Offboarding stays with the organisation admin.** A device that came in through SSO is not checked against the
  directory again. Doing that without the user needs one of two things this design leaves out: a refresh token kept
  for each person (Google's docs: a refresh token fails when "the user account may have been deleted or disabled",
  [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)), which the
  server would have to store, or a silent sign-in with `prompt=none`, which "will return an error if the user is not
  already authenticated" and needs that person's browser session
  ([OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)), which a server does not
  have. So SSO is the gate on joining, and removing someone is Offboard (Organisation). Closing their account at the
  provider stops new joins, not the devices that are in.
- **Making a Google client** (none exists for Relay, the organisation makes its own): in the Google Cloud console of
  the organisation's Google Workspace, register the app under Google Auth Platform (Branding, and the user type under
  Audience), then Clients › Create client › Application type Desktop app, which needs nothing more
  ([Manage OAuth Clients](https://support.google.com/cloud/answer/15549257)). Copy its client ID into SSO for joining with the Workspace's domain. Google's docs list the client secret as
  optional for the token request of a desktop app, so Relay sends none. Not verified against a real client yet: if
  Google asks for the secret, the token step fails with Google's message.
- **Compatibility.** A relay-server from before answers `unknown request` to `sso_info` and ignores a token on a join.
  A Relay from before refuses an organisation list with an `sso` entry (an unknown kind), so every organisation
  admin's Relay needs this version before SSO is turned on. A workspace's member list is unchanged.

## Policy

A workspace's policy is a `policy` entry on its member list, signed by an admin: `providers`, the agents allowed in it
(from `members::POLICY_PROVIDERS`: `claude` and `codex`, each once, at least one), and `capture`, on or off (used by
capture later). The newest one replaces the older. A policy by a member or reader, an unknown provider, none at all, or
the fields on another kind of entry are refused.

Every member's round takes the policy from the list and keeps it in the workspace's key file (`policy`), so a
conversation started before the next round still follows it. A conversation or a terminal in that workspace starts
only with an allowed provider (`policy::check_workspace_policy`, `err.workspace_policy`), and the composer greys out the
others. Its admin picks the agents and capture in the workspace's settings, a member sees them there. A Relay from
before refuses a list with a `policy` entry (an entry kind it does not know): every member updates first, as for
people and readers. A relay-server from before refuses the entry too, so it never gets on a list there.

## Without history

A workspace made without history keeps what its members write, and no record of who wrote what. It is chosen once,
when the workspace is made (New workspace › Workspace without history), and cannot be turned off: a workspace that
had a history would keep it. Its row in Settings › Machines and the workspace menu say "Without history".

- **The flag** is the member list's `nohistory` entry, right after `create` (Members, above). Every Mac checks it like
  any entry. Once its Relay saw it, the Mac keeps `nohistory` in its key file, so a round that cannot check the list
  (held back, a fork) still writes nothing that names it. The server reads it from the list and returns it in
  `vault_info`, which a Mac takes as a floor before it checked the list (a server can only hide the flag that way,
  never make a Mac write its name). The server reads it from entry 1 of the stored list for documents (above).
- **Conflict copies name no Mac:** `Notes/A (conflict 2026-10-02 1530).md` instead of `Notes/A (conflict Studio Mac
  2026-10-02 1530).md`.
- **Documents by session.** Documents, live co-editing, comments, page history and cursors work as anywhere, and
  nobody sees who did what. When a Mac opens such a workspace's documents it picks a random 16-hex session id, a new
  one at every start of Relay, and seals its updates, comments and cursors under it instead of its device (the AAD
  binds that id like any author). Its counter per document starts at 1 per session, and the gap check runs per
  session. `doc_push` and every live frame carry the session id as `from`. The server keeps it in `<seq>.sid` and
  relays it (pull, live stream, awareness), writes no `.from`, and refuses a push without one or with a member's
  device in it (`this workspace keeps no record of who wrote what: update Relay to edit its documents`), and drops
  such a frame. The first device to name a session holds it while the server runs, in memory only: another member's
  push under it is refused (`another member's session`), its frames dropped.
- **What the members see.** Page history lists each session as "Anonymous session" with its time, sessions of one
  person are not linked. A comment's author is "Anonymous". A Mac keeps the session ids it wrote under
  (`sessions.json` beside its documents, never synced), so its own comments stay its own after a restart, and a delete
  of one is sealed as the session that wrote it (only an entry's own author deletes it). Cursors read "Anonymous",
  coloured by the session id, and carry no name. Nobody is mentioned: comments name no member, the Inbox lists the
  open threads on pages this Mac edited.
- **`doc_bind`** still records the device that bound a name, on the server only (for `doc_unbind` and the 10 000 cap):
  the manifest says `bound` and nothing else.
- **What Relay writes into it.** The team starter's session protocol asks for no member's name in `Log.md`. Vault
  capture follows the workspace's own rules and adds no author field. The starter's templates and hooks write no
  author, computer or user name (`source-author` on a Reference is the source's author). Hooks do not run in a shared
  workspace.

**Reading it from other conversations.** A conversation is fenced to its own workspace, so one in a client's workspace
cannot open the knowledge workspace's files. `relay knowledge.search query=… [workspace=…] [limit=…]` searches the
workspaces without history this Mac is a member of (the `nohistory` in its key file, `shared_vaults::knowledge`), with
the same note index as ⌘K (`related::passages`), and prints at most 20 passages, 10 by default:

```json
[{ "workspace": "Know-how", "path": "Notes/Rates.md", "passage": "The rate limit is 60 per minute", "score": 1.23 }]
```

That is all it gives: the path in the workspace, the workspace's name, the line with the hit and its rank. No title,
no author, no session, no time, so the history the workspace does not keep does not come back through a search. It
never reads the user's own vault or a workspace with history, also not when named in `workspace`. It only reads, it is
`auto` like `reminders.list`, and the user changes that under Settings › Machines › Agent access or in `.relay/config.json`
(`"knowledge": "ask"`). A conversation that runs in the knowledge workspace itself reads its files as any, the action
works there too. Writing into it from elsewhere is not built.

What it does not hide:

- **The member list:** who is a member, with which role and devices, and who added whom. It is who may, not who did.
- **The server** still knows the device behind each request (access control), logs a line per pairing or join, and
  counts quota and rate limits per device.
- **A small team is not anonymous.** With three members and one of them online, a change at 14:02 names that person.
- **Copies outside Relay.** A member can keep their own git repo or backup of the folder. Relay does not sync it and
  cannot prevent it.
- **Content.** A note that says who wrote it is content, and Relay does not touch content.

| Where a change could name a device | In a workspace with history | Without history |
|---|---|---|
| Records, `vault_put` and `vault_delete`, the live `files` frame | No writer | The same |
| Conflict copies | The Mac's name and the minute | The minute |
| Documents, page history, comments, cursors | The device per update | A random session id per start of Relay |
| Member list, Members | Devices, people, roles, who added whom | The same |
| Server: stderr, quota, rate limit | Per device | The same |
| Starter session log | The member's name per entry | No names |

What is weaker than with history, in documents:

- **A session id is not authenticated.** The client chooses it. Any member holds the key and can seal under another
  session's id. The server's in-memory claim stops another device from pushing under a session it saw first, until the
  server restarts. Within the workspace this is accepted: a member can already write anything.
- **The gap check is per session.** An update held back inside a session shows. A lost tail of a session (its last
  updates, with nothing after them) does not. A document keeps the counters of its newest 256 sessions.
- **Timestamps stay in the sealed meta.** Members could match them with who was online.
- **The server** still sees the device behind each push at that moment, and keeps the session claim in memory.

**Compatibility.** A Relay from before this refuses a list with a `nohistory` entry, as an unknown kind: every member
updates before joining such a workspace. A Relay with the flag but without documents by session refuses a `docs-on`
on it, so once an admin turns documents on, that Relay stops at the list and syncs nothing of it, and a server of
that version refuses the `docs-on` itself. Should an older Relay still push, its push carries no session and the
server refuses it, its frames are dropped. Workspaces with history are unchanged.

## Key rotation

After a `remove` or `leave`, the next round of an admin of the list makes a new random key, epoch + 1, and sends
`vault_rotate` with the `rekey` entry (its sha256 in `h`) and the key sealed to exactly the members the list has then:
`hex(ephemeral X25519 public (32) || nonce (12) || ChaCha20-Poly1305(k, aad = "rekey:" + vault + ":" + epoch + ":" + fp,
key))`, `k` = HKDF-SHA256(salt `relay vault rekey v1`, the shared point, info the ephemeral public key); a low-order
public key is refused.

- **Taking it.** A member takes the key of epoch e only when its sha256 is the `h` of the list's `rekey` entry for e,
  which only an admin of the list could sign, one epoch at a time. A key of the server's own is refused. A Mac whose key
  is behind the server's sends nothing (`key changed`).
- **Each member's keys.** Every Relay makes, per workspace, an X25519 key (`secret`) and an Ed25519 identity (`sign`),
  saved in the key file before the server hears of them, and publishes them signed by the identity (`sig`) and
  vouched for under the newest key (`mac`).
- **Interrupted.** `vault_rotate` is one write on the server. An admin that stops after the server took it, before it
  saved the key, takes it from the list on its next round, sealed to itself. Two admins at once: the server takes one.
- **Old keys.** A record under an older epoch than the newest is taken only when its content is what this Mac had
  already (a removed member still holds that key); any member's round seals such records again, a hundred a round. A
  frame is taken only under the newest key; the server drops one under an older key. An invite carries the inviter's
  epoch; one behind is refused, and the inviter's Relay takes the new key and invites again.
- **Names stay.** Record names stay HMACs under epoch 0's naming key: renaming every record would rewrite the whole
  workspace, and a removed member who gets the server's disk learns only whether a path it guesses exists.

What it does not cover:

- **Holding back, everywhere.** A server that holds the same newest entries back from every member, and drops every
  record and frame that names them, is only noticed by the Mac that wrote them. Nobody takes a key the list does not
  name, so this delays a key change; it does not let anyone read.
- **A Mac that has no creator pinned yet.** The epoch-0 key never changes (record names stay under it). So anyone who
  was ever a member, removed at any time, still holds it, and together with the server could serve a first list of
  their own to a Mac that has no creator pinned yet: a member who updated Relay before the admin started the list, or
  a joiner whose invite link predates member lists. A Mac that has pinned a creator (every new workspace, every invite
  from this version) is not affected.
- **A server that stops reporting the key** after a Mac saw a list is treated as holding the list back: a warning, the
  key counts as changing, and removals wait. An older relay-server cannot start a new workspace's list ("needs an
  update"); the workspace is then taken off the server again.
- **What was read before.** A removed member keeps every key up to their removal and what they synced; a member's Mac
  holds the keys in a file (0600), like the mirror keys.

## Invite link

The pairing line with three more fields, and from member lists on two more:
`relay://<host>:<port>#fp=<64 hex>&code=<32 hex>&vault=<16 hex>&invite=<16 hex>&secret=<64 hex>&creator=<64 hex>&head=<64 hex>`
(`creator` the identity the member list starts with, `head` the list's last hash when the invite was made).
`PairLine` parses them as optional `vault`, `invite`, `secret`. A line with all three is an invite.
A link that opens Relay opens Settings › Machines with it in the join form. That page shows a workspace under the
machine that keeps it (the workspace's `fp` is the machine's), and under Workspaces when its server is not one of this
Mac's machines, as for a member who joined with a link.

The client side lives in `packages/relay-remote` (`vault.rs`, `client.rs`), the server side in `packages/relay-server/src/vaults.rs`.
