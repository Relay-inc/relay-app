# Plan: four features for a consultancy team

Status: design and plan (phase 1 of 3). No production code yet. Phase 2 builds one PR at a time once the open
questions below are answered, phase 3 integrates and tests in the harness.

A consultancy asked for four things:

1. Consultants use whichever AI they want, not only Claude Code.
2. Knowledge lands, anonymised, in a database, so it stays when a consultant leaves.
3. A user-management system.
4. Relay runs on macOS and Windows.

Every design below builds on what Relay already has (the agent provider contract, workspaces on a relay-server,
device certificates, the signed member list). None of them adds a second system next to an existing one.

## Open questions

Only the ones whose answer changes the design. Each has the assumption this plan uses until it is answered.

**Feature 1, any AI**

1. Which agents or models, concretely? A named list of CLIs, or "any model" (OpenAI, Gemini, Mistral, local models)
   through an agent that supports many providers? *Assumption: any model through OpenCode (and Pi), plus the four
   CLIs Relay has. A new CLI only on request.*
2. Their own logins or company API keys? If keys: does Relay store them, or does each CLI keep its own config?
   *Assumption: both. The CLI's own login stays the default, Relay can hold a key per provider in the OS secret
   store and pass it as an environment variable.*
3. Must a non-Claude agent work in a team workspace, with mail and the orchestrator? *Assumption: team workspaces
   yes (that is where the team works), mail and orchestrator later.*
4. Is an agent without permission prompts (Pi) acceptable? *Assumption: allowed in a personal vault, never in a team
   workspace.*

**Feature 2, knowledge database**

5. Which data: notes, decisions, conversation summaries, full transcripts? *Assumption: notes plus a summary per
   settled conversation (decisions, learnings, how-tos). No raw transcripts.*
6. What does anonymous mean: the consultant's name out, end-client names out, every person and identifier out?
   Pseudonymised (an admin can map back) or anonymous (nobody can)? *Assumption: pseudonymised, people and end
   clients replaced by stable placeholders.*
7. Where does it live: inside a team workspace (end-to-end encrypted, the server cannot read it), on the relay-server
   readable by it, or in a database the consultancy owns? *Assumption: inside a team workspace.*
8. Who reads it: every consultant, management only, agents too? *Assumption: every member of that workspace and
   their agents.*
9. Do the contracts with end clients allow keeping their data after the engagement? Pseudonymised data is still
   personal data under the GDPR. *Unknown, needs the consultancy's answer before anything is built.*

**Feature 3, user management**

10. Which roles beyond admin and member: read-only, an organisation admin over all workspaces, others? *Assumption:
    `reader` and an organisation admin.*
11. Is SSO (Entra ID or another OIDC provider) required in the first version? *Assumption: no, device certificates
    plus invites first, SSO as a later PR.*
12. How many people and devices, and does a person use more than one device? *Unknown. Assumption: tens of people,
    one or two devices each.*

**Feature 4, Windows**

13. Which features must work on Windows? Meeting recording, "this computer as a work machine", the Design drawer and
    dictate-anywhere are macOS-only today. *Assumption: conversations, workspaces, boards, mail, Git and Pages. The
    rest later.*
14. Windows 11 on x64 only, or also ARM? WSL allowed or not? *Assumption: Windows 11 x64, native, no WSL.*
15. Is there a code-signing certificate for Windows and a Windows machine to test on? Without a certificate every
    install shows a SmartScreen warning. *Unknown.*

**Across features**

16. Who runs the relay-server: the consultancy on its own infrastructure, or someone for them? *Assumption: the
    consultancy, on its own server.*

## Feature 1: any AI

### Where it stands

- Relay runs four agent CLIs through one contract, `agent_core::AgentProvider`
  (`packages/agent-core/src/lib.rs:215-279`), registered in `PROVIDERS` (`src-tauri/src/agents.rs:10`) and `AGENTS`
  (`src/shared/plugins.ts:18`): Claude Code, Codex, OpenCode and Pi. One normalised event model
  (`agent_core::Event`) feeds the webview, permissions go through one pending folder. Full table:
  `docs/development.md` › Agent providers.
- `caps` (18 flags) say what a provider can do, the webview hides the rest. Claude Code has them all. Codex lacks
  questions, fork and subagents, OpenCode lacks limits and titles, Pi has no permission prompts at all.
- Any model is already reachable indirectly: OpenCode and Pi list every model their own config knows (OpenRouter,
  Ollama, LM Studio and so on), and the model picker is searchable for lists of hundreds (#234).
- Relay manages no AI login or key. Claude Code removes `ANTHROPIC_API_KEY` to run on the subscription
  (`agent-claude/src/lib.rs:197`), Codex can keep `OPENAI_API_KEY` from the environment (option `auth`), OpenCode
  and Pi use their own `auth login`. The keychain holds board and calendar tokens only.
- Claude Code only today:
  - Team workspaces (`err.vault_only_claude`, `session/mod.rs:105`, `lib.rs:1922`). The fence is built from Claude
    Code's deny rules, strict MCP and auto mode (`policy.rs:122-142`).
  - The control pipe with Relay's in-process MCP tools: mail (`actions.rs:91-94`), orchestrator
    (`session/mod.rs:258`), design.
  - Moving a conversation to a work machine (`lib.rs:1699`), vault capture (`lib.rs:644`), multiple accounts.
- Vault rules: only `CLAUDE.md` and `.claude -> System`. Other CLIs get Relay's actions hint
  (`prompts/conversation/relay-actions-hint.md`) through their system prompt, but no `AGENTS.md` is written and
  whether they read `CLAUDE.md` or the skills is not verified.
- The package READMEs of Codex, OpenCode and Pi say the app itself did not run them live.

### Design

**Recommended: A. Make the open agents first-class, any model through them.** OpenCode (and Codex for OpenAI) become
equal to Claude Code where it matters for a team:

- **Rules for every agent.** The starter and team vaults get an `AGENTS.md` that points to the same rules as
  `CLAUDE.md`. `vaultcheck.rs` accepts either.
- **A fence that does not depend on Claude's settings.** Every permission request already passes Relay's pending
  folder. For providers with `caps.permissions`, Relay answers a request for a path outside the conversation's vault
  with a deny before it becomes a card, and starts the CLI with its own deny config where it has one (to verify per
  CLI). Then `err.vault_only_claude` becomes "only providers that ask for permission". Pi stays out of team
  workspaces. The fence stays a guard, not a sandbox, as `docs/workspaces.md` › Trust says for Claude Code today.
- **Relay's tools over standard MCP.** Mail, orchestrator and design run over Claude Code's control pipe. A
  `relay --mcp` stdio server with the same tools reaches every CLI that speaks MCP. Its caller is traced the way the
  `relay` CLI is traced now (`agent-core/src/peer.rs`).
- **Keys where wanted.** Settings › Agents gets an optional API key per provider, kept in the OS secret store
  (feature 4 makes that cross-platform) and passed as an environment variable at spawn, never in `settings.json`.
  The subscription login stays the default.
- An organisation can limit which providers and models its workspaces allow (feature 3, policy in the member list).

Trade-off: the most value for the least code, since the contract exists. What it makes harder: every gap
(subagents, titles, limits) stays a per-CLI gap, and the quality of an agent depends on its CLI, not on Relay.

**B. Add more CLIs one by one** (for example the CLIs of other model vendors) through the existing contract. Around
1 to 1.5 days each, each with its own permission model, storage and fence work. Good for one named CLI, does not
scale to "any".

**C. Relay's own agent loop on an OpenAI-compatible API.** Rejected: it duplicates what the CLIs do (tools, context,
permissions), moves Relay away from "a shell around the real CLIs", and needs API keys for everything.

### Risks

- The fence for non-Claude agents rests on their permission requests. A CLI that runs a tool without asking (or a
  shell command that reads elsewhere) gets past it. Same limit as today, but it must be tested per CLI.
- CLI protocols change without notice (`codex app-server`, `opencode serve`). Fixture tests catch format drift only
  after a release.

## Feature 2: knowledge that stays

### Where it stands

- No database for knowledge. The relay-server stores files and JSON only (`relay-server/src/lib.rs:139-146`), no
  database crate. The app has one SQLite (FTS5, BM25) index per folder for related notes (`src-tauri/src/related.rs`).
- A team workspace already keeps what was written in it: when a member is removed, their notes stay with the team,
  the key rotates (#322), and every new member reads all of it (an invite carries every epoch's key). Notes, documents
  (Yjs logs, history kept for good) and comments are on the server, sealed.
- The server never reads them: only members' devices hold the key (`docs/workspaces.md` › Trust, Keys).
- Conversations are not shared: transcripts are each CLI's own files on the laptop (`~/.claude/projects/...`), `.claude`
  never syncs, and nothing about a conversation goes to the server for a workspace.
- Vault capture already reads a settled conversation for decisions, state and follow-ups and writes them to the vault
  (Claude Code only, `lib.rs:644`).
- Nothing anonymises anything today.

### Design

**Recommended: A. Knowledge as notes in the team workspace, anonymised on the Mac before they are written.**

- When a conversation in a team workspace settles, capture (extended to every provider with `caps.write`) also writes
  a knowledge note into a `Knowledge/` folder: the problem, what was decided, what worked, without the chatter.
- Before it is written, two passes on the Mac:
  1. Deterministic: names from the workspace's People notes and members, emails, phone numbers, IBANs, addresses
     become stable placeholders (`[Person 3]`, `[Client A]`). The mapping is a file in the workspace.
  2. The agent rereads the result for what the rules missed.
- The consultant sees the note and the replacements as a card (approve, edit, reject) before it goes in. Nothing is
  written without that click.
- Reading: the existing FTS5 index plus a `relay knowledge.search` action, so agents in that workspace use it.
- The server stays blind, there is no new trust boundary, and offboarding is the existing removal with key rotation.

Trade-off: no new system and end-to-end encryption kept. What it makes harder: it is files, so queries across all
workspaces or a dashboard for management are not possible on the server. And the mapping is readable by every member
(they all hold the same key), so it is pseudonymised for outsiders, not for members.

**B. A knowledge store on the relay-server that the server can read** (SQLite with FTS, later embeddings), fed with
anonymised records from the Macs, access per role (feature 3). Central and queryable, but the server then holds
plaintext for this data, which breaks the workspace promise for it, and needs its own access control, backup and
GDPR handling.

**C. A sink to a database the consultancy owns.** Relay pushes the same anonymised records (JSON) to an endpoint the
consultancy runs. Their infrastructure, their rules. Integration work per customer, and Relay cannot vouch for what
happens downstream.

The record format of A is designed so B or C can be added later as a sink without changing capture.

### Risks

- **Legal.** Pseudonymised data stays personal data. Keeping end-client knowledge after an engagement may break the
  contract with that client. This blocks the build until question 9 is answered.
- **Anonymisation is never complete.** A project description can identify a client without naming it. The review
  card is the safety net, so it must be fast or consultants will skip it.
- The agent that anonymises sees the raw text, but it saw it in the conversation already.

## Feature 3: user management

### Where it stands

- Identity is a device, never a person: a self-signed P-256 certificate, pinned by its SHA-256 fingerprint
  (`relay-remote/src/tls.rs`), one per Mac (`machines.rs:88`). Per workspace each Mac also has an Ed25519 identity and
  an X25519 key (`relay-remote/src/vault.rs:120-127`).
- The display name is the Mac's computer name (`lib.rs:2667`), unchecked. No email, no account, no SSO (the only
  OAuth is GitHub's device flow on a server, `relay-server/src/github.rs`).
- Two Macs of one person are two members. A phone is a linked device of its laptop (`LINKED_OPS`).
- Roles per workspace: `admin` and `member`. Admins invite (single-use link, 24 h), remove, promote, demote and rotate
  the key. The member list is an append-only, hash-chained, Ed25519-signed log that every Mac checks
  (`relay-remote/src/members.rs`). The server cannot forge an entry.
- An admin of any workspace on a server may update that server to a signed release only (`KEEPER_OPS`).
- No organisation level: nothing lists people across workspaces, offboarding is per workspace, and there is no
  central policy (`policy.rs` is the per-conversation fence, `permissions.rs` reports macOS privacy grants).

### Design

**Recommended: A. People on top of devices, in the signed member list, plus an organisation admin on the server.**

- **A person.** New member-list entries: a person (name, optional email) and the devices that belong to them, a new
  device added by an admin or by one of the person's own devices. The UI shows people, the list still checks
  devices.
- **Roles.** `reader` next to `admin` and `member`: the server refuses writes from a reader (`vault_put`,
  `vault_delete`, document updates), the UI opens notes read-only. Enforcing on the server is enough because every
  write passes it.
- **Organisation admin.** A server-level role that extends today's keeper: it sees every workspace on the server with
  its people, and offboards a person in one step (a signed `remove` in every workspace plus `revoke` of their
  devices). To sign those entries it must be an admin of each list, so a new workspace on such a server adds the
  organisation admins as admins from the start.
- **Policy.** The organisation admin can sign workspace settings into the list, the way `docs-on` already works:
  allowed agent providers (feature 1), knowledge capture on or off (feature 2).

Trade-off: stays within the trust model (devices and signatures, the server cannot grant itself rights). What it makes
harder: offboarding still needs an admin's Relay online to rotate keys, and a person who loses every device needs a
new invite.

**B. SSO (OIDC, for example Entra ID) for enrolment, on top of A.** A device may join only after an OIDC login, the
server checks the token against the tenant and maps groups to roles. Offboarding in the directory locks the person
out at the next connection. Needs the server to reach the identity provider and an app registration per tenant.
Keys stay per device, so a removal still rotates through an admin's Mac. A later PR if question 11 says so.

**C. Accounts with passwords on the server.** Rejected: weaker than device certificates and a second identity system
next to them.

### Risks

- Changing the member list is the most security-sensitive code in Relay. Every new entry kind needs the same
  checks as #322 and #340 (a fork, a held-back list, an entry by a removed admin).
- Organisation admins as admins of every workspace means they can read every workspace. That is likely what a
  consultancy wants, but it must be said in the UI.

## Feature 4: macOS and Windows

### Where it stands

The app does not build on Windows, and not on Linux either. The relay-server builds for Linux (Docker, release
binaries) but not for Windows. There is no `cfg(windows)` anywhere, and there is no Rust CI at all.

- **Blocks the build:**
  - `agent-pi` is declared under the macOS-only dependencies (`src-tauri/Cargo.toml:97`) while `agents.rs:10` uses
    it everywhere.
  - `host.rs:6` imports `relay_server::ramdisk`, which only exists on macOS.
  - Unix sockets without a gate: the `relay` CLI socket (`actions.rs`) and the broker sockets
    (`relay-remote/src/broker.rs`, `relay-server/src/lib.rs`).
  - `process_group`, `libc::kill` and `killpg` (`broker.rs`, `plugins.rs`, `agent-core/src/discover.rs`, the Codex and
    OpenCode bridges).
  - Unix permissions and symlinks in some fifteen files (`PermissionsExt`, `mode(0o600)`, `os::unix::fs::symlink`).
  - `transcribe-rs` with `whisper-metal` (`Cargo.toml:63`), probably.
- **Builds once gated, but broken:**
  - Secrets go through `/usr/bin/security` (`providers.rs:74-92`, `calendar.rs`, `plugins.rs`, mail).
  - Hard-coded `/usr/bin/curl`, `/usr/bin/sqlite3`, `/bin/sh`, `/bin/kill`, `/bin/ps`, `scutil`, `xattr`, `shasum`.
  - Shell and PATH: login shell `$SHELL` or `/bin/zsh -lic`, PATH split on `:`, `HOME`, CLI lookup in Homebrew
    folders, `python3` for `build-index.py`, a `#!/bin/sh` shim for `relay`, `.sh` hooks in the starter vault.
  - The `.claude -> System` symlink in every vault (Windows needs Developer Mode or admin rights for symlinks).
  - The window: `titleBarStyle: Overlay`, the `sidebar` vibrancy the CSS relies on, `macOSPrivateApi`.
  - The updater manifest publishes `darwin-aarch64` only (`scripts/release.sh:80`). Deep links on Windows need the
    single-instance plugin.
  - Shortcuts default to `meta` (the Windows key there), 22 `metaKey` checks, 65 `⌘` glyphs, "This Mac" strings.
- **macOS by design, with a no-op elsewhere:** banners, keep-awake, the meeting system-audio tap (and `afconvert`,
  not gated), dictate-anywhere paste, clipboard, the Design drawer snapshot, tray badges, "open in terminal", this Mac
  as a work machine (LaunchAgent, RAM disk), the privacy-permissions page.
- **Already cross-platform:** Tauri 2 and its plugins, muda, `notify`, portable-pty (ConPTY), cpal, rusqlite,
  rustls and rcgen, yrs, async-imap, the board and integration crates, git on PATH.

### Design

**Recommended: A. Native Windows build of the same app, behind a small platform layer.** WebView2 renders the same
React app.

- One `platform` module per concern, chosen at compile time: secrets (the `keyring` crate, macOS Keychain and
  Windows Credential Manager, same service names), local IPC (named pipes on Windows, the `interprocess` crate or
  std, with the client process id from `GetNamedPipeClientProcessId`, which keeps the caller tracing),
  process groups (Job Objects), the user's shell and PATH (PowerShell or `cmd`, `;`, `USERPROFILE`), HTTP through
  `reqwest` instead of `curl`.
- Vault layout: `.claude` as a directory junction on Windows (no admin needed), file names compared as NTFS does,
  `build-index.py` replaced by Relay's own Rust index where Python is missing.
- The window: native title bar or Mica on Windows, an opaque sidebar where vibrancy is missing, shortcuts as
  `mod` (⌘ on macOS, Ctrl on Windows) with the glyphs following.
- Features without a Windows equivalent stay off there in v1 (see question 13). Meeting system audio can come later
  through WASAPI loopback.
- Release: an NSIS installer and `windows-x86_64` in `latest.json`, built on a Windows runner or VM, signed when
  there is a certificate.
- A CI job on `windows-latest` and `macos-latest` that runs `cargo check` and `cargo test --workspace`, so a Unix-only
  call never lands again.

Trade-off: one codebase, Windows users get the real app. What it makes harder: every future PR must keep both
platforms building (the CI job enforces it), and release builds need a Windows machine.

**B. Windows through WSL.** The app on Windows, agents and vault in WSL. Rejected: two file systems, slow file
watching across the boundary, and consultants would need WSL set up.

**C. A browser client against the relay-server.** Works on any OS, but it is a second frontend and runs agents on the
server, which the workspace design deliberately avoids (the server cannot read a workspace). Only if installing an
app is impossible.

### Risks

- **Agent CLIs on Windows.** Whether each CLI (Claude Code, Codex, OpenCode, Pi) runs natively on Windows, and how it
  finds its config, is not verified here. Relay is only as cross-platform as the agents it runs.
- **The broker and caller tracing** are the hardest part: conversations survive an app restart through Unix sockets
  and the `relay` CLI identifies its caller through the process tree. Both need a Windows equivalent that keeps the
  same security property.
- No Windows test machine in the loop today (question 15). Every estimate below assumes one.

## Plan of approach

One feature per PR, small enough to review (the review of #278, 4.7k lines, asked for exactly that). Estimates are
working days with AI, including tests and harness screenshots, calibrated on recent PRs: #278 (shared vaults,
4,730 lines) was planned at 4 to 4.5 days and merged a day after the plan, #322 (key rotation, 2,114 lines) took
about a day. Unknown territory (Windows, legal) gets a wider range.

### PRs

| # | PR | Feature | Depends on | Days |
|---|---|---|---|---|
| W1 | Build gate: fix the `agent-pi` dependency, gate every Unix-only call behind a `platform` module with a Windows stub, CI on macOS and Windows (`cargo check`, `cargo test`) | 4 | none | 2 |
| W2 | Secrets through `keyring` (Keychain and Credential Manager), same service names, no migration needed on macOS | 4 | W1 | 1 |
| W3 | Processes on Windows: named pipes for the broker and the `relay` CLI with caller tracing, Job Objects, shell and PATH, `reqwest` for `curl` | 4 | W1 | 2.5 to 3.5 |
| W4 | Vaults on Windows: `.claude` junction, NTFS name rules in sync, no Python needed for the index, starter-vault hooks without `bash` | 4 | W1 | 1.5 |
| W5 | Window and input: title bar, sidebar without vibrancy, `mod` shortcuts and glyphs, notifications via the Tauri plugin, deep links via single-instance | 4 | W1 | 1.5 |
| W6 | Release for Windows: NSIS, updater entry, release script on a Windows runner, signing if a certificate exists | 4 | W2 to W5 | 1 to 1.5 |
| A1 | `AGENTS.md` in the starter and team vaults, `vaultcheck` accepts it | 1 | none | 0.5 |
| A2 | Fence for providers with permissions (deny outside the vault in the pending folder, CLI deny config), lift "Claude Code only" for workspaces | 1 | A1 | 2 |
| A3 | API key per provider in the secret store, passed as env at spawn | 1 | W2 | 1 |
| A4 | `relay --mcp`: mail, orchestrator and design tools over stdio MCP for every CLI | 1 | A2 | 1.5 to 2 |
| U1 | People: person and device entries in the member list, people in Members | 3 | none | 2 |
| U2 | `reader` role, enforced on the server, read-only in the UI | 3 | U1 | 1 |
| U3 | Organisation admin: people across workspaces, offboarding in one step, signed workspace policy (allowed providers, capture) | 3 | U1, U2 | 2 |
| U4 | SSO enrolment (OIDC), only if question 11 asks for it | 3 | U3 | 3 to 4 |
| K1 | Knowledge capture: knowledge note per settled workspace conversation, review card, every provider with `caps.write` | 2 | A2, questions 5 to 9 | 2 |
| K2 | Anonymiser: deterministic pass with the mapping file, agent pass, the replacements on the card | 2 | K1 | 2 |
| K3 | `relay knowledge.search` on the FTS5 index | 2 | K1 | 1 |

Totals: Windows 9.5 to 11 days, any AI 5 to 5.5, user management 5 (plus 3 to 4 for SSO), knowledge 5. Together
about 25 days without SSO.

### Order

1. **Wave 1, in parallel:** W1 (src-tauri and packages, platform gates), A1 (the vault resources) and U1
   (`relay-remote/members.rs`, `relay-server/vaults.rs`, Members UI). They touch different files, except a few
   lines of `relay-server/src/lib.rs` that W1 gates and U1 extends: merge W1 first and rebase U1.
2. **Wave 2:** W2, W4 and W5 in parallel (different files) with A2 and U2. W3 alone, it touches the broker and
   `actions.rs`, the same files as A4.
3. **Wave 3:** A3 (after W2), U3, A4 (after W3, same files), then W6 when W2 to W5 are in.
4. **Wave 4:** K1 to K3, only after the knowledge questions are answered, since they decide what K1 builds.
   U4 only when asked for.

Not parallel: W3 with A4 (broker, `actions.rs`), U1 with U2 and U3 (member list), K1 with K2. Everything that changes
`lib.rs` broadly (W1, W5) goes in on its own and the others rebase.

### What phase 3 tests

- Two isolated Relay instances against one relay-server (the existing recipe): a reader writing, an organisation
  admin offboarding someone, a knowledge note going through review.
- Codex and OpenCode in a team workspace trying to read outside it.
- The Windows build installed on a real Windows 11 machine: install, update, a conversation, a workspace round, an
  app restart with a running conversation (the broker).
