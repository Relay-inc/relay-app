# Plan: four features for a consultancy team

Status: design and plan, revised after the second round of answers of 2026-11-09. Phase 2 is under way: W1 (#451),
A1 (#452) and U1 (#453) are open as PRs, U2 and A2 are built on their own branches (not pushed). The rest is built one
PR at a time, phase 3 integrates and tests in the harness.

A consultancy asked for four things:

1. Consultants use whichever AI they want, not only Claude Code.
2. Knowledge lands in a place that stays when a consultant leaves, without a record of who added what.
3. A user-management system.
4. Relay runs on macOS and Windows.

Every design below builds on what Relay already has (the agent provider contract, workspaces on a relay-server,
device certificates, the signed member list). None of them adds a second system next to an existing one.

## Open questions

Only the ones whose answer changes the design. Answered ones keep the answer and what it changes, open ones keep the
assumption this plan uses.

**Feature 1, any AI**

1. Which agents or models, concretely? **Answered: Claude Code and Codex (ChatGPT), for now.** OpenCode and Pi stay in
   Relay as they are but are out of scope for this customer: no work on them in this plan.
2. Their own logins or company API keys? **Answered: their own logins.** Each consultant signs in to Claude Code and
   Codex with their own account. A3 (API key per provider) is dropped.
3. Must a non-Claude agent work in a team workspace? **Answered: yes, Codex may work in a team workspace.** Mail and
   the orchestrator for Codex were not asked for and stay out (A4 deferred).
4. Is an agent without permission prompts (Pi) acceptable? **Dropped**, Pi is out of scope.

**Feature 2, knowledge**

5. Which data? **Answered: anything.** The knowledge workspace is a workspace like any other, anything may be in it.
   What it must not have is a record of who added what.
6. What does anonymous mean? **Answered: no history of who did what.** Content is not pseudonymised. K2 (the
   anonymiser) is dropped.
7. Where does it live, and does Relay need a central server next to the relay-server? **Answered by a proposal (see
   Feature 2 › Design): no separate server.** The knowledge workspace is an ordinary workspace on the customer's
   relay-server with a flag "without history", set when the workspace is created.
7b. Without documents (co-editing, comments, page history)? **Answered (second round): no.** The knowledge workspace
   works like every workspace, documents, co-editing, comments and page history included, with anonymous users:
   nobody sees who changed what. K1 becomes the anonymous author per session (Feature 2 › Design).
7c. Is the server operator someone who must not see who changed what? *Open. Assumption: no.* The server still sees
   the device certificate of every request (access control, quota, rate limits), so "anonymous" holds towards the
   other members and towards anyone reading the server's disk, not towards whoever runs the server. Hiding it from
   the server too needs blind tokens or group signatures, a redesign that is not in this plan.
7d. Mentions and the Inbox in the knowledge workspace? *Open. Assumption: no mentions there.* An @-mention names a
   member and tells the author's name to the mentioned person, so it breaks the anonymity. The Inbox keeps "a page I
   opened", "a page I edited" works only within one session.
8. Who reads it? **Answered: who has access is managed by the organisation admin (U3), with an overview per person.**
9. May end-client data be kept after an engagement? **Answered: data management is the customer's responsibility.**
   Nothing in the plan waits on it any more.

**Feature 3, user management**

10. Roles beyond admin and member? **Answered: `reader` and an organisation admin, yes.**
11. Is SSO required? **Answered: yes, confirmed in the second round:** signing in with Google through OIDC, as an
    existing internal tool of the team already does, and Entra ID later through the same OIDC layer. Relay itself has
    no Google login today (only the GitHub device flow on a server). U4 is in scope, Google first.
12. How many people and devices? **Answered: several people, each with several devices.** U1 covers a person with
    several devices.

**Feature 4, Windows**

13. Which features must work on Windows? **Answered (second round): everything**, meeting recording, this computer as
    a work machine, the Design drawer and dictation included. W7 to W11 add them.
14. Windows 11 on x64 only, or also ARM? WSL allowed? **Answered: Windows 11 x64, WSL allowed.** An agent CLI may run
    through WSL where its native build is missing (W12, only if needed). The app itself stays native.
15. Code-signing certificate and a test machine? **Answered: a Windows machine to test on is available, there is no
    certificate.** W6 gets a certificate as its precondition (Feature 4 › Signing). Open: which legal entity signs
    (below).
15b. Which legal entity holds the certificate? *Open.* Relay has no legal entity of its own today (the licensors are
    two people). Azure Artifact Signing gives public-trust certificates to organisations in the EU, individual
    developers only in the US and Canada, and an OV certificate is issued to an organisation as well. Without an
    entity there is no certificate, and without a certificate every install shows SmartScreen.

**Across features**

16. Who runs the relay-server? **Answered (second round): Relay runs it for the customer, or the customer runs it
    itself.** The server code is already public (FSL). The plan builds the install recipe first (S1, Docker) and treats
    a hosted server as a later product (ops, billing, updates and backups at Relay), not in these estimates.
17. Codex writes inside the workspace without asking, `.claude/` included (found while building A2). **Answered:
    accept it and write it down in Trust** (done in A2). A5 looks into Codex's permission profiles as a follow-up.

## Feature 1: any AI (Claude Code and Codex)

### Where it stands

- Relay runs four agent CLIs through one contract, `agent_core::AgentProvider`
  (`packages/agent-core/src/lib.rs:215-279`), registered in `PROVIDERS` (`src-tauri/src/agents.rs:10`) and `AGENTS`
  (`src/shared/plugins.ts:18`): Claude Code, Codex, OpenCode and Pi. One normalised event model
  (`agent_core::Event`) feeds the webview, permissions go through one pending folder. Full table:
  `docs/development.md` › Agent providers.
- `caps` (18 flags) say what a provider can do, the webview hides the rest. Codex lacks questions, fork and subagents
  next to Claude Code, it does ask for permission.
- Relay manages no AI login or key. Codex keeps its own `codex login` (or `OPENAI_API_KEY` from the environment,
  option `auth`). That matches answer 2, nothing to build.
- Claude Code only today:
  - Team workspaces (`err.vault_only_claude`, `session/mod.rs:105`, `lib.rs:1922`). The fence is built from Claude
    Code's deny rules, strict MCP and auto mode (`policy.rs:122-142`).
  - The control pipe with Relay's in-process MCP tools: mail (`actions.rs:91-94`), orchestrator
    (`session/mod.rs:258`), design.
  - Moving a conversation to a work machine (`lib.rs:1699`), vault capture (`lib.rs:644`), multiple accounts.
- **Open as PR: A1** (#452, rebased on `main`). The starter vault (and through it the team starter) has an
  `AGENTS.md` that points at `CLAUDE.md` and `System/rules/` instead of copying them. The vault check lists a missing
  `AGENTS.md` and repairs it.
- **Built: A2** (`b57fc238`, branch `relay/relay-a2-codex-fence-en-teamworkspaces-mw96qs8q`, on A1, not pushed),
  ready for a PR after A1 (#452).
  Relay checks every permission request Codex raises before it becomes a card: a path outside the workspace, or on
  what the fence keeps (another vault, Relay's data, Claude's config, the workspace's `.claude`), is declined at once.
  In a workspace Codex keeps its sandbox and asks the user, not its own auto review. Team workspaces allow Claude Code
  and Codex.
- The Codex package README says the app itself did not run it live.

### Design

**Chosen: make Codex first-class next to Claude Code, in team workspaces too.**

- **Rules for every agent.** Done in A1.
- **A fence that does not depend on Claude's settings (A2).** Every permission request already passes Relay's pending
  folder. For Codex, Relay answers a request for a path outside the conversation's vault with a deny before it
  becomes a card, and starts `codex app-server` with its own sandbox and approval config where it has one (to verify).
  Then `err.vault_only_claude` becomes an allowlist: Claude Code and Codex. OpenCode and Pi stay out of team
  workspaces. The fence stays a guard, not a sandbox, as `docs/workspaces.md` › Trust says for Claude Code today.
- **Logins.** Each consultant's own, as today. No key storage in Relay.
- **Later, not in this plan:** Relay's tools (mail, orchestrator, design) over a `relay --mcp` stdio server for Codex
  (A4). Not asked for in answer 3. Codex reaches `relay` actions through the `relay` CLI and the actions hint already.
- An organisation can narrow the allowed providers per workspace (U3, signed policy in the member list).

Dropped: adding more CLIs, Relay's own agent loop, an API key store (A3), OpenCode and Pi work.

### Decision: Codex writes inside the workspace without asking

A2 found the edge of that fence. Codex's own sandbox (`workspace-write`) lets it write anywhere inside the workspace
without raising a request, so Relay never sees those writes, `.claude/` (the workspace's Claude settings and hooks)
included. A consultant's Codex can therefore change the rules every member's Claude Code loads. The live run with
codex-cli 0.163 also showed reads outside the workspace going through without a request: writes outside are refused,
reads are not. Claude Code's deny rules do not apply to Codex, so nothing fences its reads yet.

**Decided (2026-11-09): accept it and write it down.** A2's `docs/workspaces.md` › Trust already says it: the guard
sees only what Codex asks for, its sandbox lets it read anywhere and write inside the workspace (its `.claude`
included) without asking. Rejected: Codex read-only in workspaces (every edit a card, much slower than Claude Code in
the same workspace).

**Follow-up (A5, after A2):** find out whether Codex's permission profiles can make `.claude/` in a workspace
read-only while the rest stays writable, and if so start Codex in a workspace with such a profile. About 0.5 to 1 day,
of which the first part is finding out whether the Codex version Relay supports has it (not verified).

### Risks

- The fence for Codex rests on its permission requests. A tool it runs without asking (or a shell command that reads
  elsewhere) gets past it. Same limit as Claude Code today, but it must be tested on Codex.
- `codex app-server` changes without notice. Fixture tests catch format drift only after a release.

## Feature 2: knowledge that stays, without history

### Where it stands

- A team workspace already keeps what was written in it: when a member is removed, their notes stay with the team,
  the key rotates (#322), and every new member reads all of it. The server never reads it (`docs/workspaces.md` ›
  Trust, Keys).
- No separate database is needed for "anything may be in it" (answer 5): a workspace holds any file.
- What links a change to a device or person today is listed below. That list is what K1 has to change.
- Document updates carry no per-update signature. A part is sealed with the workspace's symmetric key
  (`relay-remote/src/vault.rs` `seal_doc`), the author is a string bound into the AAD (`doc_aad`, `vault.rs:113`)
  and repeated in the sealed meta. The server proves the pusher over TLS and stamps `from` with the first 16 hex of
  its fingerprint, and a reader opens the part with that `from` as the author, so the server cannot relabel a part.
  Ed25519 signs only member-list entries, requests and invites. An author id that is not a fingerprint therefore
  breaks no signature check.

### Where a device or person is tied to a change today

| Place | What it records today | With anonymous authors (K1) |
|---|---|---|
| Files: sealed records, server `put` and `delete`, live `files` frame | No writer in the meta, no log on the server, a frame without sender. | Unchanged. The caller's identity stays per request for access control. |
| Conflict copies (`relay-remote/src/sync.rs:210`, `src-tauri/src/shared_vaults.rs` with `sys_name()`) | `Notes/A (conflict <computer name> <minute>).md`, synced to everyone. | No machine name: `Notes/A (conflict <minute>).md`. |
| Documents, server log (`relay-server/src/docs.rs:78`, `doc_pull` at `:102`) | A `<seq>.from` file per update with the pusher's fingerprint, returned to every member. Live updates are stamped the same way (`channel.rs:114`). | No `.from` is written. The client sends a random session id with each push, the server stores and relays that instead. |
| Documents, `doc_bind` (`docs.rs:130-149`) | `bound/<name>` keeps the binder's full fingerprint, checked by `doc_unbind`, 1000 names per member. | The owner stays on the server only (needed for unbind and the cap) and is never returned to members. |
| Documents, seal and gap check (`relay-remote/src/docs.rs:550-571` `take_part`, `me` at `:232`, `Cursor.mine` at `:55`) | The author is the device, its counter persists, `seen[author]` finds a held-back update per author. An empty `from` is refused. | `me` is a random id per session, its counter starts at zero per session, `seen` is pruned of old sessions. |
| Page history (`Docs::history` `docs.rs:573-614`, `lib.rs` `page_history`, `PageHistory.tsx`) | Sessions per author, named from the member list. | Each session shows as "Anonymous session" with its time. Sessions of one person are not linked. |
| Comments and the workspace Inbox (`docs.rs:313-335`, `lib.rs` `comments_of`, `workspace_inbox`, `tell_mentions`) | A comment's author is the device, "mine" is `author == me`, mentions name members and tell who mentioned. | A comment's author is the session id. Own comments are recognised through a local list of this Mac's session ids, never synced. No mentions (question 7d). |
| Live cursors (`awareness`, `channel.rs:266-268`, `shared_vaults.rs:371`, `src/application/workspace/coedit.ts`) | Fingerprint as `from`, the computer name in the sealed body, colour from `from`. | The server stamps the session id, the body carries no name, the cursor reads "Anonymous" with a colour from the session id. |
| Shared trash (`shared_vaults.rs:93`) | What a round deleted on this Mac, by minute. Never synced. | Unchanged. |
| Member list and Members (`members.rs`, `SharedVaults.tsx`) | Devices, people, roles, who added whom. | Unchanged. It is who may, not who did, and the organisation admin needs it (answer 8). |
| Server: stderr, quota (`docs.rs:48`), rate limit (`channel.rs:33`) | A line per pairing or join with name and IP. Quota and rate limit per fingerprint, in memory. | Unchanged. The server still knows the device at the moment of a push (question 7c). |
| Content written by agents or Relay (capture, hooks, templates) | Not checked. | K1 checks capture and the starter vault's templates and hooks for an author or computer name. |

### Design

**Chosen (second round): a workspace "without history" that works like every workspace, with an anonymous author per
session. No separate server.**

A central knowledge server next to the relay-server would need its own storage, access control, backup and trust
model, and the server would read the content. Everything answers 5 to 8 ask for is already a workspace: any file,
encrypted, access per person through the member list, offboarding through removal and key rotation, managed by the
organisation admin (U3). What is unwanted is the record of who did what.

- **The flag.** A signed member-list entry `nohistory`, only allowed as the entry right after `create` and never
  undone, checked by every Mac like `docs-on`. Set in the create dialog, so there is never a history from before it.
- **Anonymous author per session.** On a flagged workspace each Mac picks a random 16-hex author id when it opens the
  workspace's documents (a new one after every restart) and seals updates, comments and cursors under it. The server
  stores and relays that id instead of the pusher's fingerprint, writes no `.from` file, and refuses a push without a
  session id or with a fingerprint-shaped `from` on a flagged list, so an old Relay cannot leak names into it.
- **What keeps working.** Documents, live co-editing, comments, page history (by session, unnamed), cursors.
- **What changes for the user.** History and cursors say "Anonymous". Own comments stay editable on the Mac that wrote
  them, in that session and after a restart (local list of own session ids). No mentions.
- **Conflict copies without a machine name.**
- **What stays.** Identity per request (the server must know the caller is a member), the member list, the server's
  access log lines, quota and rate limits per device.

**What is unknown or weaker than today:**

- A session id is chosen by the client and not authenticated. A member can reuse another session's id and write as
  that session (gap warnings, comment ownership). Today only the server could relabel, now any key holder can. Within
  the workspace this is accepted, a member can already write anything.
- The gap check works per session. A held-back update inside a live session is still found, a lost tail of a session
  (its last updates, with nothing after them) is not.
- Timestamps stay in the sealed meta. Members could correlate them with who was online, which the plan does not try to
  hide.
- The server operator still sees the device per request (question 7c).
- The tests that assert `from` in `doc_pull` (`relay-server/src/docs.rs:209`) and author equality in the history tests
  (`relay-remote/src/docs.rs:1112`) change with it.

Trade-off: keeps co-editing, comments and history, at about 4 extra days over a flag without documents, and touches
the seal format and the gap check, the most security-sensitive part of documents. K1 lands as two PRs: K1a (flag,
conflict copies, capture check, UI label) and K1b (anonymous documents).

**Rejected: documents switched off in the knowledge workspace** (the first round's recommendation). The second round
asks for the same workspace with anonymous users.

**Rejected: a separate knowledge server or database.** It also breaks the promise that the server cannot read a
workspace.

### Reading and writing knowledge from other workspaces

- **K3, search from anywhere.** A conversation in a client workspace is fenced to that workspace, so it cannot read
  the knowledge workspace. A `relay knowledge.search` action (the `relay` CLI, so Claude Code and Codex both reach it)
  searches the knowledge workspaces this Mac is a member of with the existing FTS5 index (`src-tauri/src/related.rs`)
  and returns passages, read-only.
- **K4, capture into it (optional).** When a conversation settles, vault capture (`lib.rs:644`, Claude Code today,
  extended to Codex) can propose a knowledge note for the knowledge workspace: the problem, what was decided, what
  worked. The consultant approves it on a card, it is written as a plain file with no author field. Not asked for
  explicitly, it is how knowledge gets there without extra effort.

Dropped: the anonymiser (K2), the mapping file, the review of replacements.

### Risks

- **History outside Relay.** A member can still keep their own git repo or backup of the folder on their Mac. Relay
  does not sync it, but cannot prevent it. Said in the UI.
- **Content can name its author.** A note that says "written by" is content, and content is not touched (answer 6).
- **The member list itself.** It shows who is a member and who added whom. If the customer reads "no history" as "no
  member list either", access control per person (answer 8) is impossible. To confirm.
- **A small team is not anonymous.** With three members and one of them online, "Anonymous session" at 14:02 names
  that person. Said in the UI.

## Feature 3: user management

### Where it stands

- Identity is a device: a self-signed P-256 certificate, pinned by its SHA-256 fingerprint
  (`relay-remote/src/tls.rs`), one per Mac (`machines.rs:88`). Per workspace each Mac also has an Ed25519 identity and
  an X25519 key (`relay-remote/src/vault.rs:120-127`).
- **Open as PR: U1** (#453, stacked on #451, rebased on `main` once #451 is in). The member list knows people: a `person` entry (name, optional email) with devices under it,
  `person-remove` takes a person off with every device. A person's own device may add a new device of that person.
  Members shows people with their devices. `vault_info` returns `people`.
- **Built: U2** (`d413ae37` plus `c4afc66e`, branch `relay/relay-u2-rol-reader-mw95xap4`, on U1, not pushed). A
  `reader` role: the server answers every write by a reader with `members::READ_ONLY` (`vault_put`, `vault_delete`,
  `doc_push`, `doc_bind` and the rest), a reader's live updates are dropped, a reader's round only pulls, its pages open
  read-only.
- Roles per workspace before U2: `admin` and `member`. The member list is an append-only, hash-chained, Ed25519-signed log that
  every Mac checks (`relay-remote/src/members.rs`). The server cannot forge an entry.
- An admin of any workspace on a server may update that server to a signed release only (`KEEPER_OPS`).
- No organisation level yet, and no SSO (the only OAuth is GitHub's device flow on a server,
  `relay-server/src/github.rs`).

### Design

**Chosen: people on top of devices (U1, built), `reader`, an organisation admin, then SSO through OIDC.**

- **Roles (U2, built).** `reader` next to `admin` and `member`: the server refuses writes from a reader (`vault_put`,
  `vault_delete`, document updates), the UI opens notes read-only. Enforcing on the server is enough because every
  write passes it.
- **Organisation admin (U3).** A server-level role that extends today's keeper. It gets an overview per person: which
  workspaces they are in, with which role and which devices (answer 8). It offboards a person in one step (a signed
  `person-remove` in every workspace plus `revoke` of their devices). To sign those entries it must be an admin of
  each list, so a new workspace on such a server adds the organisation admins as admins from the start. It can sign
  workspace policy into the list, the way `docs-on` works: allowed agent providers (feature 1).
- **SSO (U4, then U5).** A device may join only after an OIDC login. Google first, Entra ID through the same layer
  (answer 11, confirmed). The app runs the login in the browser (authorisation code with PKCE, a loopback
  redirect), the server checks the ID token (issuer, audience, signature against the provider's keys, an allowed
  domain or tenant) and binds the verified email to the person (U1's email field). Offboarding in the directory locks
  the person out at the next connection. Keys stay per device, so a removal still rotates through an admin's Mac.
  Needs the server to reach the identity provider and an app registration per tenant, which the customer makes.

Trade-off: stays within the trust model (devices and signatures, the server cannot grant itself rights). What it makes
harder: offboarding still needs an admin's Relay online to rotate keys, and a person who loses every device needs a
new invite.

Rejected: accounts with passwords on the server (weaker than device certificates, a second identity system).

### Risks

- Changing the member list is the most security-sensitive code in Relay. Every new entry kind (`reader`, `nohistory`,
  the organisation admin) needs the same checks as #322 and #340 (a fork, a held-back list, an entry by a removed
  admin).
- Organisation admins as admins of every workspace means they can read every workspace. That is likely what a
  consultancy wants, but it must be said in the UI.
- SSO puts the identity provider in the join path. A provider outage blocks new devices, not existing ones.

## Feature 4: macOS and Windows

### Where it stands

**Open as PR: W1** (#451, rebased on `main`). The first `checks` run on `windows-latest` is the PR's own CI. The Rust side
type-checks for `x86_64-pc-windows-msvc`. Every Unix-only call sits behind a `cfg` gate with a stand-in that fails or
does nothing, marked with the PR that fills it in: Unix sockets in `relay-remote/sock.rs`, file modes and symlinks in
`src-tauri/platform.rs`, process groups and `kill`, relay-server and Whisper as macOS-only dependencies, `agent-pi`
moved to the common dependencies. CI (`checks`) runs the TypeScript checks on macOS and Windows and `cargo check` on
both. Nothing works on Windows yet.

What W2 to W11 still have to make work, as found before and after W1:

- Secrets go through `/usr/bin/security` (`providers.rs:74-92`, `calendar.rs`, `plugins.rs`, mail).
- Hard-coded `/usr/bin/curl`, `/usr/bin/sqlite3`, `/bin/sh`, `/bin/kill`, `/bin/ps`, `scutil`, `xattr`, `shasum`.
- Shell and PATH: login shell `$SHELL` or `/bin/zsh -lic`, PATH split on `:`, `HOME`, CLI lookup in Homebrew
  folders, `python3` for `build-index.py`, a `#!/bin/sh` shim for `relay`, `.sh` hooks in the starter vault.
- The `.claude -> System` symlink in every vault (Windows needs Developer Mode or admin rights for symlinks).
- The window: `titleBarStyle: Overlay`, the `sidebar` vibrancy the CSS relies on, `macOSPrivateApi`.
- The updater manifest publishes `darwin-aarch64` only (`scripts/release.sh:80`). Deep links on Windows need the
  single-instance plugin.
- Shortcuts default to `meta` (the Windows key there), 22 `metaKey` checks, 65 `⌘` glyphs, "This Mac" strings.
- macOS by design, a no-op elsewhere: banners, keep-awake, the meeting system-audio tap, dictate-anywhere paste, the
  Design drawer snapshot, tray badges, "open in terminal", this Mac as a work machine, the privacy-permissions page.
- relay-server does not build for Windows: `std::os::unix::net::UnixStream` used directly
  (`relay-server/src/lib.rs:34`), `exec` in place for its own update (`upgrade.rs:12-13`), `MetadataExt`
  (`vaults.rs:17`), a symlink in `mirror.rs:244`, and the work copy on a RAM disk (`ramdisk.rs`, macOS) or tmpfs
  (Linux), so a workspace's plaintext never lands on disk.
- Meeting recording converts with `afconvert` (`meeting.rs:326`, `:374`, `:419`), Whisper's model download uses
  `shasum` (`dictation.rs:172-191`).

### Design

**Chosen: a native Windows build of the same app, behind a small platform layer.** WebView2 renders the same React
app.

- One `platform` module per concern, chosen at compile time: secrets (the `keyring` crate, macOS Keychain and
  Windows Credential Manager, same service names), local IPC (named pipes on Windows, with the client process id from
  `GetNamedPipeClientProcessId`, which keeps the caller tracing), process groups (Job Objects), the user's shell and
  PATH (PowerShell or `cmd`, `;`, `USERPROFILE`), HTTP through `reqwest` instead of `curl`.
- Vault layout: `.claude` as a directory junction on Windows (no admin needed), file names compared as NTFS does,
  `build-index.py` replaced by Relay's own Rust index where Python is missing.
- The window: native title bar or Mica on Windows, an opaque sidebar where vibrancy is missing, shortcuts as
  `mod` (⌘ on macOS, Ctrl on Windows) with the glyphs following.
- Every feature works on Windows (answer 13), each with its own counterpart:

| Feature | macOS today | Windows counterpart | PR |
|---|---|---|---|
| Meeting recording | cpal for the mic, a Core Audio process tap in a private aggregate device for system audio (`meeting.rs:545-636`, macOS 14.2), `afconvert` to WAV and m4a. Without the tap it already records the mic only. | WASAPI loopback on the default output device (cpal opens it as an input on WASAPI, to verify in cpal 0.18), resampling and WAV in-process instead of `afconvert`, FLAC or Opus instead of m4a unless an AAC encoder is found. | W7 |
| This computer as a work machine | `host.rs` writes a LaunchAgent and drives `launchctl`, relay-server runs from it. | Task Scheduler (`schtasks`, at logon, restart on failure), the equivalent of a LaunchAgent. A Windows service (`windows-service`) only if it must run before login. relay-server itself ported: sockets through W3's named pipes, update by spawn-and-exit instead of `exec`, junction or copy instead of the symlink. The work copy has no RAM disk on Windows: a temp folder protected by the user's ACL, or a RAM disk driver. That is a security decision (open). | W8 |
| Whisper | transcribe-rs with whisper.cpp on Metal (`dictation.rs:23-58`). Dictation already falls back to the ONNX models elsewhere. | whisper.cpp on CPU, Vulkan where the GPU has it. Build with MSVC and cmake (the Vulkan SDK for Vulkan), `sha2` instead of `shasum`. Meeting transcription uses the same engine. | W9 |
| Dictate anywhere | global shortcut through `tauri-plugin-global-shortcut` (works everywhere), paste through accessibility and a CGEvent ⌘V with the pasteboard saved and restored (`anywhere.rs:184-280`). | `SendInput` Ctrl+V and the clipboard saved and restored (the `windows` crate or `arboard`). No accessibility permission to ask. | W10 |
| Design drawer | a child webview through Tauri (works everywhere), a WKUIDelegate so sign-in popups can close (`design.rs:35-73`), WKWebView `takeSnapshot` (`design.rs:521`). | WebView2: check whether the sign-in popup and `window.close()` work as they are, `CapturePreview` through `with_webview` for the snapshot. | W11 |

- **Agent CLIs through WSL (W12, only if needed).** WSL is allowed for an agent CLI whose native Windows build is
  missing or broken. Relay then spawns `wsl.exe -e <cli>`, translates the vault path (`C:\x` to `/mnt/c/x`) and the
  CLI's session and transcript paths (its `~/.claude` lives in the distro, `\\wsl$\<distro>\home\<user>` from
  Windows), and stops the agent inside WSL (killing `wsl.exe` does not always stop the Linux process). A Unix socket
  inside WSL is not reachable from Windows and a named pipe not from WSL, so the broker and the `relay` CLI need a
  loopback TCP port with a per-session token for those agents. Files under `/mnt/c` are slower and file watching
  across the boundary is unreliable. Native first, WSL only for the CLI that needs it.
- Release: an NSIS installer and `windows-x86_64` in `latest.json`, built on a Windows runner or VM, signed (W6, see
  Signing).

Rejected: the whole app through WSL (two file systems, slow watching, WSL setup per consultant) and a browser client
against the relay-server (a second frontend, agents on the server).

### Signing

W6 has a code-signing certificate as its precondition. Without one, every install and every update shows a SmartScreen
warning. Prices, looked up on 2026-11-09, **estimates**, excluding VAT:

| Option | Price | Source |
|---|---|---|
| Azure Artifact Signing (formerly Trusted Signing), Basic | 9.99 USD a month, 5,000 signatures a month, 0.005 USD per signature over that | Azure retail prices API (service "Trusted Signing") and the pricing page https://azure.microsoft.com/en-us/pricing/details/artifact-signing/ (quotas, the page itself shows no price), 2026-11-09 |
| Azure Artifact Signing, Premium | 99.99 USD a month, 100,000 signatures | same |
| OV certificate | 150 to 300 USD a year (Microsoft's range), SSL.com 129 USD for one year, key on a hardware token or cloud HSM (required since June 2023) | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options (page dated 2026-08-29), https://www.ssl.com/products/software-integrity/code-signing/ov/ |
| EV certificate | 400 USD and up a year (Microsoft), SSL.com 349 USD for one year | same pages, https://www.ssl.com/products/software-integrity/code-signing/ev/ |

- **Recommended: Azure Artifact Signing Basic.** The cheapest, no token to keep, and Tauri signs with it through
  `bundle > windows > signCommand` and `artifact-signing-cli` (https://v2.tauri.app/distribute/sign/windows/).
- EV no longer buys an instant SmartScreen reputation (Microsoft removed that in 2024, same Microsoft page). OV,
  EV and Artifact Signing all build reputation over time.
- Artifact Signing gives public-trust certificates to organisations in the EU (Belgium included), to individual
  developers only in the US and Canada (https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
  Validation takes 1 to 20 business days. Relay has no legal entity of its own yet (question 15b), so the certificate
  waits on that choice.

### Risks

- **Agent CLIs on Windows.** Whether Claude Code and Codex run natively on Windows, and how they find their config,
  is not verified here. Only those two matter now (answer 1).
- **The broker and caller tracing** are the hardest part: conversations survive an app restart through Unix sockets
  and the `relay` CLI identifies its caller through the process tree. Both need a Windows equivalent that keeps the
  same security property.
- No certificate yet (question 15): installs show a SmartScreen warning until there is one, and W6 waits on the
  legal entity (question 15b).
- **relay-server on Windows** (W8) loses the RAM disk. Where a workspace's plaintext may land on disk is a security
  decision, not a porting detail.
- **whisper.cpp on Windows** (W9): the MSVC and Vulkan build is not tried, CPU speed for a long meeting is unknown.
- Codex on Windows: whether its native build is good enough, or W12 is needed, is not verified here.

## Across features: the customer's relay-server

### Where it stands

- The server code is public in this repo (FSL). `packages/relay-server/docker/` has a multi-stage `Dockerfile`, a
  `compose.yml` (port 47800, a tmpfs work copy, four volumes, `restart: unless-stopped`), an `entrypoint.sh` that
  installs Claude Code on first start, and a self-test.
- That `compose.yml` builds from a source checkout, not from the published image. The image
  `ghcr.io/relay-inc/relay-server` (amd64 and arm64) is pushed by hand by `scripts/push-server-image.sh`, and the
  package is private (checked 2026-11-09), so pulling it needs a GitHub token.
- The install steps live in `packages/relay-server/README.md` › In Docker (`docker run`, Claude login, `relay-server
  pair`, updates), written for a developer. Not found: a compose file on the image, a healthcheck, firewall and
  exposure beyond the LAN, a backup and restore of the data volume (pairing identity, keys), Docker Desktop on Windows.
- No TLS termination to set up: pairing is mutual TLS with pinned certificates.

### Design

**Chosen (second round): an install recipe first, a hosted server as a later product.** The customer runs the server
itself, or Relay runs it for them from the same recipe. A hosted product (ops, billing, updates and backups at Relay)
is a business decision outside these estimates.

- **S1, install recipe.** A `compose.yml` on the published image (data volume, port, tmpfs work copy, healthcheck),
  an install guide in `docs/` for an operator who is not a developer: ports and exposure, the first admin's pairing,
  updates through Settings › Machines, backup and restore of the data volume, the Claude login only when the server
  is also a work machine. A smoke test that brings the compose file up and pairs a test client.
- The image has to be public, or the customer gets a pull token. Public is the simpler path and matches a public
  repo. *Assumption: public.*

## Plan of approach

One feature per PR, small enough to review (the review of #278, 4.7k lines, asked for exactly that). Estimates are
working days with AI, including tests and harness screenshots, calibrated on recent PRs: #278 (shared vaults,
4,730 lines) was planned at 4 to 4.5 days and merged a day after the plan, #322 (key rotation, 2,114 lines) took
about a day. Wave 1 of this plan (W1, A1, U1) was built by parallel agents within an hour of the plan, but is not
reviewed or merged yet, so it does not lower the estimates on its own. Unknown territory (Windows, SSO against a real
tenant) gets a wider range.

### PRs

| # | PR | Feature | Depends on | Days | State |
|---|---|---|---|---|---|
| W1 | Build gate: `cfg` gates with Windows stand-ins, `agent-pi` dependency, CI on macOS and Windows | 4 | none | 2 | PR #451 |
| A1 | `AGENTS.md` in the starter and team vaults, `vaultcheck` accepts and repairs it | 1 | none | 0.5 | PR #452 |
| U1 | People: person and device entries in the member list, people in Members | 3 | none (stacked on W1) | 2 | PR #453, on #451 |
| U2 | `reader` role, enforced on the server, read-only in the UI | 3 | U1 | 1 | built, `c4afc66e` |
| A2 | Fence for Codex (deny outside the vault in the pending folder, Codex sandbox kept), team workspaces allow Claude Code and Codex, the `.claude` edge written down in Trust | 1 | A1 | 1.5 | built, `b57fc238`, PR after #452 |
| A5 | Codex's permission profiles: `.claude/` read-only in a workspace if Codex supports it, else written down why not | 1 | A2 | 0.5 to 1 | |
| K1a | Workspace without history: `nohistory` entry at creation, conflict copies without a name, UI label, capture and templates checked for author fields | 2 | U2 (member list) | 1 | |
| K1b | Anonymous author per session in documents: no `.from` on the server, session id in seal, gap check and counters, cursors without a name, history and comments by session, no mentions | 2 | K1a | 3.5 to 4.5 | |
| U3 | Organisation admin: overview per person, offboarding in one step, signed workspace policy (allowed providers) | 3 | U1, U2, K1a (member list) | 2 to 2.5 | |
| U4 | SSO enrolment through OIDC, Google first: login in the browser, token check on the server, email bound to the person | 3 | U3 | 3 to 4 | |
| U5 | Entra ID on the same OIDC layer: tenant check, tested against a real tenant | 3 | U4 | 0.5 to 1 | |
| K3 | `relay knowledge.search`: read-only search of the knowledge workspaces from any conversation | 2 | K1a | 1 | |
| K4 | Capture into the knowledge workspace on a card, Claude Code and Codex (optional) | 2 | K1a, A2 | 1.5 | |
| W2 | Secrets through `keyring` (Keychain and Credential Manager), same service names | 4 | W1 | 1 | |
| W3 | Processes on Windows: named pipes for the broker and the `relay` CLI with caller tracing, Job Objects, shell and PATH, `reqwest` for `curl` | 4 | W1 | 2.5 to 3.5 | |
| W4 | Vaults on Windows: `.claude` junction, NTFS name rules in sync, no Python needed for the index, starter-vault hooks without `bash` | 4 | W1 | 1.5 | |
| W5 | Window and input: title bar, sidebar without vibrancy, `mod` shortcuts and glyphs, notifications via the Tauri plugin, deep links via single-instance | 4 | W1 | 1.5 | |
| W6 | Release for Windows: NSIS, updater entry, release script on a Windows runner, signing | 4 | W2 to W5, a certificate | 1 to 1.5 | |
| W7 | Meeting recording on Windows: WASAPI loopback plus mic, in-process conversion instead of `afconvert` | 4 | W1 | 2 to 3 | |
| W8 | This computer as a work machine on Windows: relay-server ported (pipes, update, junction, work copy without RAM disk), started by Task Scheduler | 4 | W3 | 4 to 6 | |
| W9 | Whisper on Windows: whisper.cpp on CPU or Vulkan, `sha2` for the model check | 4 | W1 | 1 to 3 | |
| W10 | Dictate anywhere on Windows: `SendInput` paste, clipboard saved and restored | 4 | W1 | 1 to 2 | |
| W11 | Design drawer on Windows: sign-in popups in WebView2, `CapturePreview` snapshot | 4 | W1 | 1 to 1.5 | |
| W12 | Agent CLIs through WSL (only if a native CLI falls short): `wsl.exe` spawn, path translation, stop, loopback socket with token | 4 | W3 | 3 to 5 | only if needed |
| S1 | Install recipe for relay-server: compose file on the published image, install guide, healthcheck, backup and restore, smoke test, public image | across | none | 1.5 to 2 | |

Dropped: A3 (API key per provider, answer 2), K2 (anonymiser, answer 6), A4 (`relay --mcp`, deferred, answer 3), and
all OpenCode and Pi work (answer 1). K1 of the first round (no documents in the knowledge workspace) became K1a plus
K1b (answer 7b).

Totals still to build, W12 not included: Windows 16.5 to 24.5 days (W2 to W6 7.5 to 9, W7 to W11 9 to 15.5), any AI
0.5 to 1, user management 5.5 to 7.5 (of which SSO 3.5 to 5), knowledge 7 to 8 (5.5 to 6.5 without K4), server 1.5 to
2. Together about 31 to 43 days. W12 adds 3 to 5 if a CLI needs it. Built so far: 7 (W1, A1, U1, U2, A2), of
which 4.5 open as PRs.

What grew since the first round: everything on Windows (W7 to W11, +9 to 15.5 days), the anonymous documents (K1b,
+3.5 to 4.5 over the flag) and the install recipe (S1). The ranges are widest where the platform is unknown (W8, W9).

### Order

0. **Land wave 1.** #451 (W1) first, then #453 (U1) rebased on `main`, #452 (A1) on its own. Then U2 (on U1) and A2
   (on A1) as PRs.
1. **Wave 2, in parallel:** W2, W4 and W5 (different files), S1 (server package and docs only). W3 alone, it touches
   the broker and `actions.rs`. Laurent tests the Windows PRs on his Windows machine. A2 as a PR once A1 is in, then A5.
2. **Wave 3:** K1a after U2, then K1b (seal and gap check, alone in `relay-remote/src/docs.rs`), K3, and K4 after A2.
   W7, W9, W10 and W11 in parallel (separate modules). W8 after W3.
3. **Wave 4:** U3 after K1a, then U4 and U5. W6 when W2 to W5 are in and there is a certificate.

Not parallel: the member-list chain U2, K1a, U3, U4 (each adds entry kinds or roles to `members.rs` and the server's
checks, so each rebases on the previous). That chain is the critical path, about 6.5 to 8.5 days from here, K1b runs
next to U3 because it touches documents, not the member list. The Windows chain W3, W8 is 6.5 to 9.5 days. Everything
that changes `lib.rs` broadly (W5) goes in on its own and the others rebase.

### What phase 3 tests

- Two isolated Relay instances against one relay-server (the existing recipe): a reader writing, an organisation
  admin offboarding a person with two devices, a workspace without history (no `from` files on the server, a conflict
  copy without a name, two members co-editing a page with "Anonymous" cursors, history and comments by session, a push
  from an old Relay refused).
- Codex in a team workspace trying to read outside it.
- A device joining through a Google login, and refused with an account outside the allowed domain.
- The Windows build installed on a real Windows 11 machine: install, update, a conversation with Claude Code and with
  Codex, a workspace round, an app restart with a running conversation (the broker), a meeting recorded with system
  audio, dictation into another app, the Design drawer, and this PC as a work machine for a Mac.
- The install recipe on a clean Linux host: compose up, pair the first admin, update, restore from a backup.
