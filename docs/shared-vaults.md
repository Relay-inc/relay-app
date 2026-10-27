# Shared vaults on a relay-server

A vault several people share through a relay-server. The server stores only ciphertext and never has the vault key.
Access is by device certificate (the mTLS pin every Relay already has). Relay syncs the vault into a plain folder on
each Mac with `sync::run` (TwoWay, conflict copies, never a merge).

## Trust

**What the server sees:** vault ids and names, member device names and fingerprints, blob names (HMACs of paths) and
sizes, and when they change. Not paths, not contents. It is trusted to keep the files, not to keep them secret: it could
serve an old version or drop one, but a swapped blob is caught (the name is bound in the AEAD), and a record it cannot
read is shown as damaged, never as deleted.

**Invites:** the link carries a secret, after `#`, that unwraps the vault key. The server keeps the key only encrypted
under that secret, which it never sees. Links are single use, last 24 h, and die with the admin who made them.

**Removing a member** stops their device at the server at once. They keep what they synced and the key: v1 has no key
rotation (it needs a static X25519 key per device, `ring` has only ephemeral agreement).

**The fence is a guard, not a sandbox.** It keeps a conversation in its vault and Claude Code's file tools and file
commands out of the others. It is not a boundary against a member who sets out to reach your Mac through a note that
steers your agent: a script in Bash or a local socket can still get out, and only the auto-mode classifier judges
those. Share a vault with people you would let read what your agent can read. What it does:

- **A conversation stays in its vault.** It runs in its project's vault and may not read or edit the other vaults or
  their transcripts. In any vault but the main one it also may not touch Relay's data folder or Claude's config
  folders (with their `.claude.json`), and runs with no own MCP servers or connectors, no hooks, no auto memory, in auto
  mode. A main-vault conversation may not read the shared vaults' trash, bases and keys. Codex and OpenCode run in the
  main vault only.
- **Nothing a member writes runs on your Mac.** `.claude` never syncs, and of the folder it links to (`System/`) only
  the notes go (`rules/`, `reference/`, `index/`, `archive/`, `reminders.md`). Names compare as APFS and HFS+ do, a round
  follows no symlink, and a `.claude` linking somewhere the filter cannot guard is refused.
- **Your own mail, reminders and calendar stay out.** A conversation in another vault gets an error for reading them
  through `relay` or the mail tools. Writing to you (a reminder, a draft) still works. `relay` answers for the
  conversation its caller really runs under, traced from the calling process. Integrations (Productive, GitHub, Trello)
  stay readable on purpose: that is the team's work.
- **A vault added reaches running conversations.** Relay first checks that none is in a turn and no terminal tab runs
  one, then stops them and writes the change under one lock that also holds back new starts. Their next message starts
  them with the new fence. A conversation in an outside terminal (iTerm) keeps its old rules until it starts again.
- **A project's key never moves.** It is its name in the main vault, else its name and its vault's id. The sidebar shows
  a label, with the folder only when two vaults have the name.

## Wire protocol

JSON lines over the existing mTLS connection (`proto.rs`), one request per connection, like the mirror's `sync_*`.
Additive: an older server answers `unknown request`.

Handshake: a device is accepted when it is in `clients.json`, or a pairing code is open, or any vault has an open
(unexpired) invite. A device that is not paired may only send `pair` or `vault_join`.

A device that came in through an invite is a *vault-only* client (`Client.vaults_only = true`): it may only send
`VAULT_OPS` = `pair` (a code from the owner makes it a full device), `vault_info`, `vault_invite`, `vault_invite_revoke`, `vault_join`, `vault_remove`,
`vault_manifest`, `vault_get`, `vault_put`, `vault_put_many`, `vault_delete`. It never runs agents, reads a mirror, pairs
further devices or sees `info` (the server's paths). A linked device (a phone) gets no vault ops.

Ids: vault id 16 lowercase hex, invite id 16 lowercase hex, invite code 32 lowercase hex (`tls::random_secret`),
blob name 64 lowercase hex. Anything else is refused.

| Request | Who | Reply |
|---|---|---|
| `vault_create {name}` | a full device (not vaults_only, not linked) | `{vault: {id, name}}`, the caller is its admin |
| `vault_info {vault}` | member | `{vault: {id, name, role, members: [{name, fp, role, added}], invites: [{id, role, expires}]}}`, invites only for admins (else `[]`) |
| `vault_invite {vault, role, wrapped}` | admin | `{invite: {id, code, expires}}`, `role` admin or member, `wrapped` hex at most 512 chars, expires in 24 h |
| `vault_invite_revoke {vault, invite}` | admin | `{}` |
| `vault_join {vault, invite, name, proof}` | anyone with a valid link | `{vault: {id, name}, role, wrapped}`, `proof` = `tls::proof(code, client_fp, server_fp)`, 5 wrong proofs drop the invite, success consumes it, adds the device to `clients.json` as vaults_only when it is new (name deduplicated as in `pair`) and as a member |
| `vault_remove {vault, fp}` | admin, or the member itself (leave) | `{}`, refused when it would leave members without an admin, a vaults_only client with no vault left is removed from `clients.json` |
| `vault_manifest {vault}` | member | `{blobs: [{name, etag, size, meta}]}`, `meta` hex of the record's meta part, `etag` sha256 hex of the whole record file, `size` its bytes |
| `vault_get {vault, name}` | member | reply line `{ok, len, etag}`, then `len` bytes: the record |
| `vault_put {vault, name, len, expect}` + `len` bytes | member | `{etag}`, written only if the current record's etag is `expect` (`""`: it must not exist), else `changed meanwhile` |
| `vault_put_many {vault, files: [{name, len, expect}]}` + the bodies one after the other | member | `{etags: {name: etag}, errors: {name: why}}` |
| `vault_delete {vault, name, expect}` | member | `{}`, only if the current etag is `expect`, else `changed meanwhile` |

`revoke` of a client also removes its memberships.

## Storage on the server

`<data>/vaults/<id>/vault.json` (mode 0600):
`{id, name, created, members: [{fp, name, role, added}], invites: [{id, code, role, wrapped, expires, fails, by}]}`.
Expired invites are dropped whenever the file is read.

`<data>/vaults/<id>/blobs/<name>`: one record per file, written to a temp file and renamed, under a per-vault lock so
the compare-and-swap holds. A record at most `mirror::MAX_FILE` plus 64 KiB.

## Record

`u32 big endian meta_len || meta (meta_len bytes, at most 64 KiB) || data`

- `meta` = `nonce (12) || ChaCha20-Poly1305(enc_key, aad = "meta:" + name, JSON {"p": path, "h": sha256 hex of the
  plaintext, "s": plaintext size, "m": mtime})`
- `data` = `nonce (12) || ChaCha20-Poly1305(enc_key, aad = "data:" + name, plaintext)`

The server only parses `meta_len` (to list `meta` in the manifest) and checks it fits the record.

## Keys

- Vault key: 32 random bytes. HKDF-SHA256 with salt `relay shared vault v1` derives `enc` (ChaCha20-Poly1305) and
  `name` (HMAC-SHA256). `name(path)` = hex HMAC(name, path).
- Invite: the link secret is 32 random bytes. HKDF-SHA256 with salt `relay vault invite v1` and info `wrap` derives a
  ChaCha20-Poly1305 key, and `wrapped` = hex(`nonce || seal(aad = "invite:" + vault id, vault key)`).
- On the Mac the vault key lives in Relay's data folder as `shared-<id>.key` (hex, 0600), like the mirror keys. It is
  also the recovery key Relay shows when the vault is made, and again on its row in Settings.

## Invite link

The pairing line with three more fields:
`relay://<host>:<port>#fp=<64 hex>&code=<32 hex>&vault=<16 hex>&invite=<16 hex>&secret=<64 hex>`.
`PairLine` parses them as optional `vault`, `invite`, `secret`. A line with all three is an invite.

The client side lives in `packages/relay-remote` (`vault.rs`, `client.rs`), the server side in `packages/relay-server/src/vaults.rs`.
