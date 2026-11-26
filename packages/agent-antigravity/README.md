# @relay/agent-antigravity / agent-antigravity

Google's Antigravity CLI (`agy`, <https://antigravity.google>) as an agent provider. Written against `agy` 1.5.13 and
its ACP server (`agy acp`, the [Agent Client Protocol](https://agentclientprotocol.com), protocol version 1), which
Antigravity documents for clients that run it as a subprocess
(<https://antigravity.google/docs/ide/extensions/acp>).

## Install

    curl -fsSL https://antigravity.google/cli/install.sh | bash
    agy acp --login                                # a Google sign-in in the browser

Then Settings › Agents › Antigravity › Use. Not installed, the pane says so with the install command next to the
status. The program defaults to the first of `~/.local/bin/agy`, `/opt/homebrew/bin/agy`, `/usr/local/bin/agy` that
exists. Installed but without a model list (no sign-in), the note is `agy acp --login`. `agy` keeps its sign-in in the
system's keychain: Relay never reads it, and calls nothing of Google's itself. Everything goes through `agy`.

## How it runs

- **Runs** `relay --antigravity-bridge <agy> '<config>'` in the vault, one process per conversation
  (`caps.persistent`). The bridge (`src/bridge.rs`) starts `agy acp` and does the handshake the app cannot:
  `initialize` (without file access through the client: the agent reads and writes the folder itself), then
  `session/resume` with the stored id, or `session/new` when there is none or the agent no longer has it, then
  `session/set_model` and `session/set_mode` when the conversation or the settings ask for one. After that it passes
  lines both ways and fills the session id and a request id into every `session/prompt`. A request from the agent
  other than `session/request_permission` is declined (`-32601`), so a turn never waits on an answer nobody gives.
  When the app closes stdin the agent is stopped. `GEMINI_API_KEY` and `GOOGLE_API_KEY` are removed from the
  environment, so a conversation runs on the sign-in and not on a key that happens to be set.
- **Relay's hint** on its `relay` command goes in as `_meta.antigravity.systemPrompt.append` of `session/new`, when the
  agent's `initialize` says it takes one.
- **Events** (`src/acp.rs`): `session/update` with `agent_message_chunk` and `agent_thought_chunk` → text and thinking
  (the first piece starts the block, the rest are deltas), `tool_call` and `tool_call_update` → one tool call and one
  result per `toolCallId`, however many updates it gets (`failed` is an error, also for a refused call), a `diff` with
  both texts → a patch (one hunk around the change), a command's `rawOutput` → its output, `usage_update` → the context
  meter, `available_commands_update` → the slash commands. The response to `session/prompt` ends the turn with its
  tokens (`inputTokens` without the cached ones, `outputTokens` with the thinking); a `stopReason` other than
  `end_turn` or `cancelled` is the turn's error. Canonical names: `read_file` → Read, `write_file` → Write,
  `edit_file` → Edit (`Target` and `Replacement` as `old_string` and `new_string`), `run_command` → Bash; another tool
  that names a file by the protocol's `kind` (edit, read), anything else by its own name.
- **Permissions** (`caps.permissions`): `session/request_permission` → a card, with the command or the change. The
  answer is the option the agent offered for allowing or refusing once, by its own id; without such an option the
  request is cancelled. The settings' mode (Settings › Agents › Antigravity › Ask) is one of the agent's own: `auto`
  (it approves edits and safe commands and asks before what cannot be undone), which is what a conversation starts in,
  as Claude Code does in Relay, `accept-edits`, or the agent's default, which asks before every edit and command, also
  an `ls`.
- **Models**: `agy models` (the models of the account, also other makers' when the plan has them), kept for 5 minutes.
  The thinking level is part of a model's id there, so there is no separate effort (`caps.effort` false).
- **History**: the log the bridge keeps per conversation, `antigravity/<session id>.jsonl` beside the app's pending
  folder: the session line, the app's prompts with their time, the agent's lines as they passed (without the command
  list). Read with the same parser, as whole blocks. Antigravity's own store is a database per conversation that only
  its CLI reads, so a conversation that did not run in Relay has no history here.
- **Terminal** (`caps.terminal`): `agy --conversation <id>` in the vault, or `agy` for a new one.
- **Usage**: one record per turn from those logs (the bridge stamps a turn's end with its time, model and folder),
  unpriced. **Limits** (`caps.limits`): the plan's name as `session/new` gives it (`_meta.antigravity.tier`), known once
  a conversation has run since the app started, and no windows: `agy` has no command or message for what is left of a
  plan.

Tests: `cargo test -p agent-antigravity`, `pnpm test`. Fixtures in `tests/fixtures/`: `acp-live.jsonl` (the agent's
lines of a live run of `agy` 1.5.13 in a temp folder: a read, a search, an edit and a command allowed, then a write
refused), `models.txt` (`agy models`), `fake-acp.py` (a stand-in for `agy acp`, for the bridge).

## What ran live, what did not

Ran with `agy` 1.5.13 on a Google sign-in (the starter plan, `gemini-3.8-flash-high`), cwd a temp folder: a new
session, reads, an edit and commands allowed, a write refused, the system prompt appended, the same session resumed in a
new process (`session/resume`, and `agy --conversation <id>` in the CLI), a turn cancelled, the model and the mode set.
`cargo test -p agent-antigravity -- --ignored` runs a turn and a resume through the bridge on the real CLI. The parser
runs on that recording; the spawn arguments and the stdin lines are asserted in tests.

Not run: the app itself (spawning through Tauri and the broker, the cards, the Usage view's Antigravity section, the
settings pane); a turn refused for a used-up plan (the error text is matched like the other providers', the reset time
is not read); an image prompt; `accept-edits` and `auto` beyond setting them; a sign-in other than a personal Google
account; Windows and Linux; `agy` older than 1.5.

## Known gaps

- Main vault only: no fence for a workspace or another vault folder (`policy::FENCED_AGENTS`).
- No "always allow" on a card (the agent offers once only), no questions, fork, subagents or AI titles.
- No session list: a conversation started in the terminal is not shown, and has no history in Relay.
- The plan's name without what is left of it, and only after a conversation has run.
- Relay's own tools (mail) are not offered: they go over Claude Code's control pipe. The `relay` command works.
- A patch is one hunk from the first changed line to the last.
- A message sent while a turn runs is passed on as another `session/prompt`; what `agy` does with it was not measured.
