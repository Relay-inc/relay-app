# Shared vaults on a relay-server

A vault several people share through a relay-server. The server stores only ciphertext and never has the vault key;
access is by device certificate (the mTLS pin every Relay already has). Relay syncs the vault into a plain folder on
each Mac with `sync::run` (TwoWay, conflict copies, never a merge).

## Trust

- The server sees: vault ids and names, member device names and fingerprints, blob names (HMACs of paths), blob sizes,
  when they change. It cannot read paths or contents.
- The server is trusted for availability and freshness, not for confidentiality: it could serve an older version of a
  blob (rollback) or drop one. Swapping one blob for another is caught (the name is bound in the AEAD).
- The vault key travels inside the invite link, after `#`, encrypted on the server under a secret only the link holds.
  Whoever has an unused link gets in: links are single use, expire after 24 h, and the admin sees who joined.
- v1 has no key rotation. Removing a member stops their device at the server at once; they keep what they already
  synced and the key. Rotation needs a static X25519 key per device (`x25519-dalek`, `ring` has only ephemeral
  agreement) and is a follow-up.

### What members can and cannot do to each other

- **Write notes in the vault.** Everything a member syncs, every other member's agent may read. A note can carry
  instructions aimed at an agent (prompt injection); the fence below limits what such an agent can reach.
- **Not run code on another Mac.** Claude Code runs what is in a project's config folder as plain code: the
  `settings.json` (hooks, `env`, `apiKeyHelper`, `statusLine`), and through hooks and skills the scripts they point at.
  `.claude` never syncs, and of the folder it links to (`System/` in a vault Relay makes; `System/` also before the
  link resolves, on a join's first round) only `rules/`, `reference/`, `index/`, `archive/` and `reminders.md` go, in
  both directions (`shared_vaults::filter`). Settings, hooks, scripts, skills and agents stay on each Mac. Paths match
  case-folded, as APFS compares them, so `System/Hooks/x.sh` and `Syﬆem/hooks/x.sh` are held back too; a vault whose
  `.claude` links to a folder with a non-ASCII name does not sync until that folder is renamed. A round follows no symlink, so a link
  someone made inside the folder does not take a member's writes out of it. Project MCP servers (`.mcp.json`) do not
  start: shared-vault conversations run with `--strict-mcp-config`.
- **Not reach your other vaults through your agent.** A conversation in a shared vault gets Read and Edit denies on
  every other vault, on their transcripts and auto memory in each Claude config folder (also of an account removed
  from the list), on what those folders keep per session (`file-history`, `history.jsonl`, `paste-cache`), and on
  Relay's data folder (keys, certificate, trash, bases). It runs in auto mode whatever the account's default mode, in
  the terminal too, because the auto
  classifier is what stops a script in Bash that no deny rule covers. That classifier is a model's judgement, not a
  sandbox: the fence is strong for Claude Code's file tools and file commands, weaker for arbitrary scripts.
- **Not keep a removed member in.** The server refuses their device at the next connection; they keep what they
  had synced (see key rotation above). Their open invites die with them.

## Wire protocol

JSON lines over the existing mTLS connection (`proto.rs`), one request per connection, like the mirror's `sync_*`.
Additive: an older server answers `unknown request`.

Handshake: a device is accepted when it is in `clients.json`, or a pairing code is open, or any vault has an open
(unexpired) invite. A device that is not paired may only send `pair` or `vault_join`.

A device that came in through an invite is a *vault-only* client (`Client.vaults_only = true`): it may only send
`VAULT_OPS` = `pair` (a code from the owner makes it a full device), `vault_list`, `vault_info`, `vault_invite`, `vault_invite_revoke`, `vault_join`, `vault_remove`,
`vault_manifest`, `vault_get`, `vault_put`, `vault_put_many`, `vault_delete`. It never runs agents, reads a mirror, pairs
further devices or sees `info` (the server's paths). A linked device (a phone) gets no vault ops.

Ids: vault id 16 lowercase hex, invite id 16 lowercase hex, invite code 32 lowercase hex (`tls::random_secret`),
blob name 64 lowercase hex. Anything else is refused.

| Request | Who | Reply |
|---|---|---|
| `vault_create {name}` | a full device (not vaults_only, not linked) | `{vault: {id, name}}`, the caller is its admin |
| `vault_list` | any client | `{vaults: [{id, name, role, members}]}`, the vaults the caller is a member of |
| `vault_info {vault}` | member | `{vault: {id, name, role, members: [{name, fp, role, added}], invites: [{id, role, expires}]}}`, invites only for admins (else `[]`) |
| `vault_invite {vault, role, wrapped}` | admin | `{invite: {id, code, expires}, fp}`; `role` admin or member, `wrapped` hex at most 512 chars, expires in 24 h |
| `vault_invite_revoke {vault, invite}` | admin | `{}` |
| `vault_join {vault, invite, name, proof}` | anyone with a valid link | `{vault: {id, name}, role, wrapped}`; `proof` = `tls::proof(code, client_fp, server_fp)`; 5 wrong proofs drop the invite; success consumes it, adds the device to `clients.json` as vaults_only when it is new (name deduplicated as in `pair`) and as a member |
| `vault_remove {vault, fp}` | admin, or the member itself (leave) | `{}`; refused when it would leave members without an admin; a vaults_only client with no vault left is removed from `clients.json` |
| `vault_manifest {vault}` | member | `{blobs: [{name, etag, size, meta}]}`; `meta` hex of the record's meta part, `etag` sha256 hex of the whole record file, `size` its bytes |
| `vault_get {vault, name}` | member | reply line `{ok, len, etag}`, then `len` bytes: the record |
| `vault_put {vault, name, len, expect}` + `len` bytes | member | `{etag}`; written only if the current record's etag is `expect` (`""`: it must not exist), else `changed meanwhile` |
| `vault_put_many {vault, files: [{name, len, expect}]}` + the bodies one after the other | member | `{etags: {name: etag}, errors: {name: why}}` |
| `vault_delete {vault, name, expect}` | member | `{}`; only if the current etag is `expect`, else `changed meanwhile` |

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
  ChaCha20-Poly1305 key; `wrapped` = hex(`nonce || seal(aad = "invite:" + vault id, vault key)`).
- On the Mac the vault key lives in Relay's data folder as `shared-<id>.key` (hex, 0600), like the mirror keys. It is
  also the recovery key Relay shows once when the vault is made.

## Invite link

The pairing line with three more fields:
`relay://<host>:<port>#fp=<64 hex>&code=<32 hex>&vault=<16 hex>&invite=<16 hex>&secret=<64 hex>`.
`PairLine` parses them as optional `vault`, `invite`, `secret`; a line with all three is an invite.

## Client API (relay-remote)

```rust
// vault.rs
pub struct VaultKey([u8; 32]);
impl VaultKey {
    pub fn generate() -> VaultKey;
    pub fn from_hex(s: &str) -> Option<VaultKey>;
    pub fn to_hex(&self) -> String;
    pub fn name(&self, path: &str) -> String;
    pub fn record(&self, path: &str, data: &[u8], mtime: i64) -> Result<Vec<u8>, String>;
    pub fn open_meta(&self, name: &str, meta: &[u8]) -> Result<sync::Entry, String>; // checks name(path) == name
    pub fn open_data(&self, name: &str, record: &[u8]) -> Result<Vec<u8>, String>;
}
pub fn wrap(key: &VaultKey, secret_hex: &str, vault: &str) -> Result<String, String>;
pub fn unwrap(wrapped_hex: &str, secret_hex: &str, vault: &str) -> Result<VaultKey, String>;

/// sync::Remote over a shared vault: encrypts on put, decrypts on get, maps the plaintext hashes sync::run plans
/// with to the server's etags (cached from the last manifest).
pub struct SealedRemote { .. }

// client.rs
pub fn vault_join(line: &str, id: &Identity, name: &str) -> Result<(PairLine, Joined, VaultKey), String>;
pub struct Joined { pub id: String, pub name: String, pub role: String }
impl Client {
    pub fn vault_create(&self, name: &str) -> Result<VaultRef, String>;            // VaultRef { id, name }
    pub fn vault_list(&self) -> Result<Vec<VaultSummary>, String>;                  // { id, name, role, members }
    pub fn vault_info(&self, vault: &str) -> Result<VaultInfo, String>;            // { id, name, role, members, invites }
    pub fn vault_invite(&self, vault: &str, role: &str, key: &VaultKey, host: &str, port: u16) -> Result<(String, Invite), String>; // the link, and { id, role, expires }
    pub fn vault_invite_revoke(&self, vault: &str, invite: &str) -> Result<(), String>;
    pub fn vault_remove(&self, vault: &str, fp: &str) -> Result<(), String>;
    pub fn sealed(&self, vault: &str, key: VaultKey) -> SealedRemote;
}
```
