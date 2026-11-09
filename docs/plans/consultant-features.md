# Plan: four features for a consultancy team

Status: design and plan, revised after the answers of 2026-11-09. Phase 2 is under way: W1, A1 and U1 are built on
their own branches (not merged). The rest is built one PR at a time, phase 3 integrates and tests in the harness.

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
8. Who reads it? **Answered: who has access is managed by the organisation admin (U3), with an overview per person.**
9. May end-client data be kept after an engagement? **Answered: data management is the customer's responsibility.**
   Nothing in the plan waits on it any more.

**Feature 3, user management**

10. Roles beyond admin and member? **Answered: `reader` and an organisation admin, yes.**
11. Is SSO required? **Answered: yes, "as we did with Google".** Relay itself has no Google login today (only the
    GitHub device flow on a server). *Assumption: signing in with Google through OIDC, and Entra ID later through the
    same OIDC layer.* U4 is in scope, Google first.
12. How many people and devices? **Answered: several people, each with several devices.** U1 covers a person with
    several devices.

**Feature 4, Windows**

13. Which features must work on Windows? *Assumption: conversations, workspaces, boards, mail, Git and Pages. Meeting
    recording, "this computer as a work machine", the Design drawer and dictate-anywhere later.*
14. Windows 11 on x64 only, or also ARM? WSL allowed? *Assumption: Windows 11 x64, native, no WSL.*
15. Code-signing certificate and a test machine? **Partly answered: a Windows machine to test on is available.** The
    certificate is still unknown. Without one every install shows a SmartScreen warning.

**Across features**

16. Who runs the relay-server? *Assumption: the consultancy, on its own server.*

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
- **Built: A1** (`701bf78f`, branch `relay/relay-a1-agents-md-voor-codex-mw93qs7p`, not merged). The starter vault (and through
  it the team starter) has an `AGENTS.md` that points at `CLAUDE.md` and `System/rules/` instead of copying them. The
  vault check lists a missing `AGENTS.md` and repairs it.
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
- What links a change to a device or person today is listed below. That list is what the flag has to change.

### Where a device or person is tied to a change today

| Place | What it records | Who sees it | With the flag |
|---|---|---|---|
| Files: sealed records (`relay-remote/src/vault.rs` `seal_record`) | meta is path, hash, size, mtime and the member-list head `l`. No writer. | members | Unchanged. Nothing to remove. |
| Files: server `put` and `delete` (`relay-server/src/vaults.rs:413-443`) | Checks the caller is a member, writes the blob. No log of who wrote it, no log line. | server | Unchanged. The caller's identity is still needed per request for access control. |
| Files: live `files` frame (`relay-server/src/channel.rs:125`) | `{t:"files"}`, names no sender and no file. | members | Unchanged. |
| Conflict copies (`relay-remote/src/sync.rs:210`, called from `src-tauri/src/shared_vaults.rs:143, 273, 295, 348` with `sys_name()`) | `Notes/A (conflict <computer name> <minute>).md`, synced to everyone. | members | No machine name: `Notes/A (conflict <minute>).md`. |
| Documents: server log (`relay-server/src/docs.rs:78`) | A `<seq>.from` file per update with the pusher's fingerprint (16 hex), returned by `doc_pull`. Bound names keep the binder's fingerprint (`doc_bind`, `docs.rs:139`). The daily quota is per member, in memory. | server, members | None of it exists: a workspace without history has no documents (below). |
| Documents: sealed parts (`relay-remote/src/docs.rs` `take_part`, `Keys::open_doc`) | The author is bound into every sealed update and used for the gap check per author's counter. | members | Not used, no documents. |
| Page history (`lib.rs` `page_history`, `PageHistory.tsx`) | Sessions per author from the document log, named after the member list. A note that is no document shows the commits of a local git repo, which never syncs (`.git` is filtered). | members | Only the local git case remains, which is the member's own repo on their own Mac. |
| Comments and the workspace Inbox (`docs.rs` sidecar `#comments`, `PageComments.tsx`, `workspace_inbox`) | Each entry's author is the sealed update's author. Mentions name members. | members | None, comments live on documents. |
| Live cursors (`awareness` frames, `channel.rs:268`, `src/application/workspace/coedit.ts`) | Sender fingerprint (`from`) plus the computer name inside the sealed body. | members on the same page | None, cursors are only sent for documents. The server refuses `awareness` frames for the workspace. |
| Shared trash (`shared_vaults.rs:93`, `<data>/shared-trash/<id>/<minute>/<path>`) | What a round deleted or emptied on this Mac, by minute. No device or person. Never synced. | the Mac itself | Unchanged. |
| Member list and Members (`relay-remote/src/members.rs`, `SharedVaults.tsx`) | Devices, people (U1), roles, and the signed entries of who added, removed or promoted whom. | members | Unchanged. It is access control, not a record of content. The organisation admin needs it (answer 8). |
| Server stderr (`relay-server/src/lib.rs:264, 351`) | A line when a device pairs or joins a workspace, with its name and IP. | server operator | Unchanged, it logs access, not changes. |
| Content written by agents or Relay itself (vault capture, hooks, frontmatter templates) | Not checked: whether any of them writes a computer name or author into a note. | members | Unknown. K1 checks capture and the starter vault's templates and hooks, and leaves them out of the flagged workspace if they do. |

### Design

**Recommended: a workspace flag "without history", on the customer's relay-server. No separate server.**

A central knowledge server next to the relay-server would need its own storage, access control, backup and trust
model, and the server would read the content. Everything answer 5 to 8 ask for is already a workspace: any file,
encrypted, access per person through the member list, offboarding through removal and key rotation, managed by the
organisation admin (U3). What a workspace adds that is unwanted here is the record of who did what, and that is small
and mostly in documents.

- **The flag.** A signed member-list entry `nohistory`, only allowed as the entry right after `create` and never
  undone, checked by every Mac like `docs-on` is. Set at creation (a choice in the create dialog), so there is never a
  history from before the flag. The server sees it in the list it already checks, so it cannot be turned off without
  every Mac noticing.
- **No documents.** `docs-on` is refused on a flagged list. The workspace syncs as files, which carry no writer. That
  removes the per-update `from` log on the server, page history by author, comments and live cursors in one rule. The
  server also refuses `doc_push`, `doc_bind` and `awareness` frames for a flagged workspace, so an old or modified
  Relay cannot add them.
- **Conflict copies without a machine name.** `conflict_copy` gets an empty machine for a flagged workspace.
- **What stays.** Identity per request (the server must know the caller is a member), the member list (who has
  access), and the server's access log lines. That is "who may", not "who did".
- **In the UI.** The workspace shows "without history" in Members and in the workspace switcher. Pages offers no
  history or comments for it, as for any note that is no document.

Trade-off: the smallest change that removes the record. What it makes harder: no live co-editing, comments or page
history in the knowledge workspace. Two people editing the same note at once get a conflict copy (without a name).

**Alternative, if co-editing is wanted there: documents with a throwaway author.** Each Mac seals updates under a
random author id per session instead of its fingerprint, and the server stores no `from`. This changes the seal
format and the gap check per author, the most security-sensitive part of documents. About 2 extra days. Only on
request.

**Rejected: a separate knowledge server or database.** See above. It also breaks the promise that the server cannot
read a workspace.

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

## Feature 3: user management

### Where it stands

- Identity is a device: a self-signed P-256 certificate, pinned by its SHA-256 fingerprint
  (`relay-remote/src/tls.rs`), one per Mac (`machines.rs:88`). Per workspace each Mac also has an Ed25519 identity and
  an X25519 key (`relay-remote/src/vault.rs:120-127`).
- **Built: U1** (`6f632b4b`, branch `relay/relay-u1-personen-in-de-ledenlijst-mw93wgkg`, stacked on W1, not
  merged). The member list knows people: a `person` entry (name, optional email) with devices under it,
  `person-remove` takes a person off with every device. A person's own device may add a new device of that person.
  Members shows people with their devices. `vault_info` returns `people`.
- Roles per workspace: `admin` and `member`. The member list is an append-only, hash-chained, Ed25519-signed log that
  every Mac checks (`relay-remote/src/members.rs`). The server cannot forge an entry.
- An admin of any workspace on a server may update that server to a signed release only (`KEEPER_OPS`).
- No organisation level yet, and no SSO (the only OAuth is GitHub's device flow on a server,
  `relay-server/src/github.rs`).

### Design

**Chosen: people on top of devices (U1, built), `reader`, an organisation admin, then SSO through OIDC.**

- **Roles (U2).** `reader` next to `admin` and `member`: the server refuses writes from a reader (`vault_put`,
  `vault_delete`, document updates), the UI opens notes read-only. Enforcing on the server is enough because every
  write passes it.
- **Organisation admin (U3).** A server-level role that extends today's keeper. It gets an overview per person: which
  workspaces they are in, with which role and which devices (answer 8). It offboards a person in one step (a signed
  `person-remove` in every workspace plus `revoke` of their devices). To sign those entries it must be an admin of
  each list, so a new workspace on such a server adds the organisation admins as admins from the start. It can sign
  workspace policy into the list, the way `docs-on` works: allowed agent providers (feature 1).
- **SSO (U4, then U5).** A device may join only after an OIDC login. *Assumption from answer 11: Google first, Entra
  ID through the same layer.* The app runs the login in the browser (authorisation code with PKCE, a loopback
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

**Built: W1** (`05c353d0`, branch `relay/relay-w1-windows-build-gate-ci-mw9351qy`, not merged). The Rust side
type-checks for `x86_64-pc-windows-msvc`. Every Unix-only call sits behind a `cfg` gate with a stand-in that fails or
does nothing, marked with the PR that fills it in: Unix sockets in `relay-remote/sock.rs`, file modes and symlinks in
`src-tauri/platform.rs`, process groups and `kill`, relay-server and Whisper as macOS-only dependencies, `agent-pi`
moved to the common dependencies. CI (`checks`) runs the TypeScript checks on macOS and Windows and `cargo check` on
both. Nothing works on Windows yet.

What W2 to W6 still have to make work, as found before W1:

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
- Features without a Windows equivalent stay off there in v1 (question 13).
- Release: an NSIS installer and `windows-x86_64` in `latest.json`, built on a Windows runner or VM, signed when
  there is a certificate.

Rejected: Windows through WSL (two file systems, slow watching, WSL setup per consultant) and a browser client
against the relay-server (a second frontend, agents on the server).

### Risks

- **Agent CLIs on Windows.** Whether Claude Code and Codex run natively on Windows, and how they find their config,
  is not verified here. Only those two matter now (answer 1).
- **The broker and caller tracing** are the hardest part: conversations survive an app restart through Unix sockets
  and the `relay` CLI identifies its caller through the process tree. Both need a Windows equivalent that keeps the
  same security property.
- No certificate yet (question 15): installs show a SmartScreen warning until there is one.

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
| W1 | Build gate: `cfg` gates with Windows stand-ins, `agent-pi` dependency, CI on macOS and Windows | 4 | none | 2 | built, `05c353d0` |
| A1 | `AGENTS.md` in the starter and team vaults, `vaultcheck` accepts and repairs it | 1 | none | 0.5 | built, `701bf78f` |
| U1 | People: person and device entries in the member list, people in Members | 3 | none (stacked on W1) | 2 | built, `6f632b4b` |
| U2 | `reader` role, enforced on the server, read-only in the UI | 3 | U1 | 1 | |
| K1 | Workspace without history: `nohistory` entry at creation, no documents, server refuses document and awareness traffic, conflict copies without a name, UI label, capture and templates checked for author fields | 2 | U2 (member list) | 1.5 | |
| U3 | Organisation admin: overview per person, offboarding in one step, signed workspace policy (allowed providers) | 3 | U1, U2, K1 (member list) | 2 to 2.5 | |
| U4 | SSO enrolment through OIDC, Google first: login in the browser, token check on the server, email bound to the person | 3 | U3 | 3 to 4 | |
| U5 | Entra ID on the same OIDC layer: tenant check, tested against a real tenant | 3 | U4 | 0.5 to 1 | |
| A2 | Fence for Codex (deny outside the vault in the pending folder, Codex sandbox config), team workspaces allow Claude Code and Codex | 1 | A1 | 1.5 | |
| K3 | `relay knowledge.search`: read-only search of the knowledge workspaces from any conversation | 2 | K1 | 1 | |
| K4 | Capture into the knowledge workspace on a card, Claude Code and Codex (optional) | 2 | K1, A2 | 1.5 | |
| W2 | Secrets through `keyring` (Keychain and Credential Manager), same service names | 4 | W1 | 1 | |
| W3 | Processes on Windows: named pipes for the broker and the `relay` CLI with caller tracing, Job Objects, shell and PATH, `reqwest` for `curl` | 4 | W1 | 2.5 to 3.5 | |
| W4 | Vaults on Windows: `.claude` junction, NTFS name rules in sync, no Python needed for the index, starter-vault hooks without `bash` | 4 | W1 | 1.5 | |
| W5 | Window and input: title bar, sidebar without vibrancy, `mod` shortcuts and glyphs, notifications via the Tauri plugin, deep links via single-instance | 4 | W1 | 1.5 | |
| W6 | Release for Windows: NSIS, updater entry, release script on a Windows runner, signing if a certificate exists | 4 | W2 to W5 | 1 to 1.5 | |

Dropped: A3 (API key per provider, answer 2), K2 (anonymiser, answer 6), A4 (`relay --mcp`, deferred, answer 3), and
all OpenCode and Pi work (answer 1).

Totals still to build: Windows 7.5 to 9 days, any AI 1.5, user management 6.5 to 8.5 (of which SSO 3.5 to 5),
knowledge 4 (2.5 without K4). Together about 19.5 to 23 days. Built so far: 4.5.

### Order

0. **Land wave 1.** W1 first, then U1 rebased on main (it is stacked on W1), A1 on its own.
1. **Wave 2, in parallel:** U2 (member list), A2 (agents), W2, W4 and W5 (different files). W3 alone, it touches the
   broker and `actions.rs`. Laurent tests the Windows PRs on his Windows machine.
2. **Wave 3:** K1 after U2, then K3 and A2-based K4. W6 when W2 to W5 are in.
3. **Wave 4:** U3 after K1, then U4 and U5.

Not parallel: the member-list chain U2, K1, U3, U4 (each adds entry kinds or roles to `members.rs` and the server's
checks, so each rebases on the previous). That chain is the critical path, about 8.5 to 10.5 days. Everything that
changes `lib.rs` broadly (W5) goes in on its own and the others rebase.

### What phase 3 tests

- Two isolated Relay instances against one relay-server (the existing recipe): a reader writing, an organisation
  admin offboarding a person with two devices, a workspace without history (no `from` files on the server, a conflict
  copy without a name, `docs-on` refused, a document push refused).
- Codex in a team workspace trying to read outside it.
- A device joining through a Google login, and refused with an account outside the allowed domain.
- The Windows build installed on a real Windows 11 machine: install, update, a conversation with Claude Code and with
  Codex, a workspace round, an app restart with a running conversation (the broker).
