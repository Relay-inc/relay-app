# @vault/agent-codex / agent-codex

OpenAI Codex as an agent provider. Written against codex-cli 0.159.2 (`codex app-server` protocol v2).

## Install and log in

    npm install -g @openai/codex     # or: brew install codex
    codex login                      # the ChatGPT login; the app never reads ~/.codex/auth.json, only checks it exists

Then Settings › Agents › Codex › Use. The program defaults to the first of `/opt/homebrew/bin/codex`,
`/usr/local/bin/codex`, `~/.local/bin/codex`, `~/.npm-global/bin/codex` that exists. `$CODEX_HOME` is honoured
(default `~/.codex`).

## How it runs

- **Runs** `/usr/bin/python3 bridge.py <codex> '<config>'` in the vault, one process per conversation (`caps.persistent`).
  `bridge.py` starts `codex app-server` (JSON-RPC 2.0 over stdio), does the handshake (`initialize`, `initialized`,
  `thread/resume` for a known session, else `thread/start`, with cwd, model, `model_reasoning_effort`, sandbox and approval
  policy) and then passes lines through. It fills in the thread id (and model and effort) of each `turn/start` the Rust
  side writes, and declines server requests the app has no card for (`item/tool/requestUserInput`, MCP elicitations, …),
  so a turn never waits on something nobody can answer. Closing its stdin stops codex.
- **Account**: `OPENAI_API_KEY` and `CODEX_API_KEY` are removed from the environment, so it runs on the ChatGPT login,
  unless Settings › Agents › Codex › Account is "OPENAI_API_KEY from the environment".
- **Sandbox and approvals** (Settings › Agents › Codex, stored as `settings.agents.providers.codex.{sandbox, approval}`):
  `workspace-write` + `on-request` by default; also `read-only` / `danger-full-access` and `untrusted` / `never`.
- **Events** (`src/app_server.rs`): the thread/start or resume response and `thread/started` → session;
  `item/agentMessage/delta` → text (whole `agentMessage` items when not streamed); reasoning summary deltas → thinking;
  `item/started` / `item/completed` of `commandExecution` → Bash, `fileChange` → Edit (Write when it only adds files),
  `mcpToolCall` → `mcp__<server>__<tool>`, `webSearch` → WebSearch; `turn/completed` → turn end with `durationMs`, the
  error, and the turn's tokens (the thread total from `thread/tokenUsage/updated` minus the total at `turn/started`);
  `error` (not retried) and JSON-RPC errors → error.
- **Permissions**: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` (and the v1
  `execCommandApproval` / `applyPatchApproval`) become `Event::Permission` (kind "tool", Bash or Edit with the command
  or the file and diff); `tool_use_id` is `v2:<json-rpc id>`. `respond()` answers `{"decision": "accept" | "decline"}`
  (v1: `"approved"` / `{"denied": …}`). No questions: Codex's `requestUserInput` is declined by the bridge.
- **Models and efforts**: the CLI's own `~/.codex/models_cache.json` (visibility "list", by priority); efforts are the
  ones any listed model supports (minimal … ultra), else low/medium/high. "" is Codex's default from its config.
- **History**: the thread's rollout, `rollout_path` from `state_5.sqlite` (table `threads`), else found by file name under
  `sessions/`: user messages (not `<environment_context>` and other harness text), assistant text, `shell`/`exec_command`
  calls as Bash, `apply_patch` as Edit/Write, their outputs as results (`exit_code` ≠ 0 is an error), each with its time.
- **Sessions** (the conversation list, `caps.background`): the vault's threads in `state_5.sqlite` (`archived = 0`, cwd the
  vault or below, as given or as its real path), newest first, as idle interactive sessions; without the database, the
  rollouts' `session_meta` stand in. Terminal: `codex resume <id>` in the vault, or `codex` for a new one.
- **Usage** (`src/rollout.rs`): token records from the `event_msg` `token_count` lines of every rollout under
  `$CODEX_HOME/sessions` (read incrementally with `agent_core::usage::Tail`): `last_token_usage` per model call, a
  repeated `total_token_usage` skipped, input without the cached tokens, the model from the file's `turn_context`,
  unpriced. Rate limits: the newest of the rollouts' `token_count.rate_limits` and the app-server's
  `account/rateLimits/updated` (snake_case and camelCase both read): primary and secondary windows with used %,
  `resets_at` (or the older `resets_in_seconds`), the plan type. 300 minutes is "Current window, 5 hours", 10080 "This
  week", anything else "Window of {n}". A window whose reset has passed shows 0 %. No snapshot yet: `off.no-data`
  (no login: `off.no-login`).
- The system's `/usr/bin/sqlite3 -readonly -json` reads the thread index; nothing under `~/.codex` is written.

Tests: `cargo test -p agent-codex` (fixtures in `tests/fixtures/`: an app-server stream and a rollout written from the
generated protocol schema and the field names in the codex binary, the two live runs below trimmed and anonymised, a
`threads` query result, a stand-in app-server for `bridge.py`), `pnpm test`.

## What ran live, what did not

Ran against the installed codex-cli 0.159.2 on its ChatGPT login, each bounded to 90 s, from a fresh temp folder:

1. `bridge.py` → new thread → one turn ("reply ok"): handshake, session id, streamed text, token usage, rate limits
   (`account/rateLimits/updated`: only a weekly primary window on this plan), `turn/completed`. The rollout and the
   `threads` row it left were read back and match the parsers (`tests/fixtures/*-live.jsonl`).
2. The same thread resumed, read-only sandbox, a turn that needs a write: `item/commandExecution/requestApproval` came
   in, the answer in `respond()`'s shape (`decline`) went back, the command ended `declined`, no file was written, the
   turn completed.

Not run live: the app itself (spawning through Tauri, the permission card, the Usage view, Settings), accepting an
approval, `item/fileChange/requestApproval` (codex asked for a shell command in the live run), images, effort and
model picks on a live turn, a resume that fails (only in the stand-in test), the v1 approval names, the terminal
commands. The two live runs left one thread (cwd a temp folder) in `~/.codex`.

## Known gaps

- No questions (Codex's `requestUserInput` is declined), no subagents, no fork, no AI titles.
- "Accept for the session" and exec-policy amendments are not offered: a card is allow or deny once.
- Sessions from the thread index are all reported idle, so the app does not follow a Codex turn running in a terminal.
- Tokens are unpriced (no public per-token prices for the ChatGPT plan's models); the Usage view counts them as such.
- Models and efforts are global lists; a model that does not take the chosen effort is left to Codex to refuse.
- Archived rollouts (`archived_sessions/`) are not counted.
- `bridge.py` needs `/usr/bin/python3` (as agent-claude's `perm_server.py` does) and is read from this checkout.
