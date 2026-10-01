# @relay/agent-pi / agent-pi

Pi ([pi-mono](https://github.com/earendil-works/pi-mono) by Mario Zechner, <https://pi.dev>) as an agent provider. Written
against pi 0.85.1 (`pi --mode rpc`, its docs/rpc.md and docs/session-format.md, and its session files).

## Install

    npm install -g @earendil-works/pi-coding-agent
    pi                                             # then /login for a subscription, or an API key in the environment

Then Settings › Agents › Pi › Use. Not installed, the pane says so with the npm command next to the status. The program
defaults to the first of `~/.npm-global/bin/pi`, `/opt/homebrew/bin/pi`, `/usr/local/bin/pi`, `~/.local/bin/pi`,
`~/.bun/bin/pi` that exists. Installed but without any model (no login or key), the note is `pi, then /login`.
`$PI_CODING_AGENT_DIR` and `$PI_CODING_AGENT_SESSION_DIR` are honoured (default `~/.pi/agent`).

## How it runs

- **Runs** `pi --mode rpc [--session-id <id> | --fork <id>] [--model <provider/id>] [--thinking <level>]` in the vault,
  one process per conversation (`caps.persistent`), no bridge: pi speaks JSON lines on stdin and stdout itself. A resume
  is `--session-id <id>`, which opens that session and creates one with that id when pi no longer has it; a fork is
  `--fork <id>` (a new session with a copy of the entries). A model without a `/` is ignored (pi's own default).
- **Turns** (`events::input`): two stdin lines, `get_state` and then `prompt` with the text and the images
  (`{type: image, data, mimeType}`). The answer to `get_state` is the only place the output names the session id
  (also for a fork, whose id is new): that is the `Event::Session`. The prompt carries `streamingBehavior: "followUp"`,
  so a message sent while pi runs is queued instead of refused; pi then settles once for everything it was given, and
  the parser ends one turn per accepted prompt (the first carries the tokens). A refused prompt ends its turn at once.
- **Events** (`src/events.rs`): `message_update` text and thinking deltas (the first piece starts the block; a block that
  did not stream is shown whole at its `*_end`), `toolcall_end` → tool call (also from a finished message when it never
  streamed), `tool_execution_end` → result (`isError`), `agent_settled` → turn end with the tokens and pi's cost of the
  run's assistant messages and the time from the first message to the last. A message that stopped with `error` or
  `aborted` (until a later one succeeds, as after pi's own retry) makes the turn end with its `errorMessage`. Canonical
  names: bash → Bash, read → Read, write → Write, edit → Edit, grep → Grep, find / ls → Glob, anything else (extension
  tools) by its own name; `path` is `file_path` for Read, Write and Edit.
- **Permissions and questions**: none. Pi has no permission prompts by design: every tool call runs, so
  `caps.permissions` and `caps.questions` are false and there is nothing in the settings to switch on. An extension that
  asks through pi's extension UI (`extension_ui_request`) is not answered (see Known gaps).
- **Models and efforts**: `pi --list-models` (the models of the providers pi has a login or key for, as `provider/model`,
  "model · provider"), kept for 5 minutes. Efforts are pi's thinking levels (off, minimal, low, medium, high, extra
  high, max), the same for every model; a level a model does not have is left to pi. "" is pi's default.
- **History**: the session's file (found by the id at the end of its name, `<time>_<id>.jsonl`), as events: user text and
  images, assistant text, thinking, tool calls and results, a failed message's error, each with its time. The offset is a
  byte offset up to the last whole line. A session with branches (`/tree` in pi) is read in file order.
- **Sessions** (`caps.background`): the vault's pi sessions of the last 8 days (header `cwd` the vault or below, as given
  or as its real path), named by `/name` (`session_info`) or else the first message, newest first, all idle. Terminal:
  `pi --session <id>` in the vault, or `pi` for a new one.
- **Usage** (`src/session.rs`): one record per assistant message from the session files under the sessions folder, read
  incrementally: `provider/model`, `usage.input`, `usage.output` (pi counts the reasoning tokens in it), `cacheRead`,
  `cacheWrite`, and `usage.cost.total`, which pi computes from its model prices at API list prices (also on a
  subscription); 0, a model without a price, shows as unpriced. A fork starts with a copy of its parent's entries (same
  ids and times): they are counted once. No plan or rate limits (`caps.limits` false): pi has none of its own.

Tests: `cargo test -p agent-pi`, `pnpm test`. Fixtures in `tests/fixtures/`, all live runs of pi 0.85.1 with
`--session-dir` in a temp folder (nothing under `~/.pi` was written; the login was read), trimmed of signatures, response
ids and the history that `agent_end` repeats: `rpc-live.jsonl` (a bash command), `rpc-live-resume.jsonl` (the same session
resumed with `--session-id`), `rpc-live-tools.jsonl` (write, edit and read), `rpc-live-queued.jsonl` (a second prompt
sent while the first ran), `rpc-live-error.jsonl` (a provider refusing the request), `session-live.jsonl`,
`session-resumed.jsonl` and `session-fork.jsonl` (the session files of those runs and a fork), `list-models.txt`.

## What ran live, what did not

Ran with pi 0.85.1 on the ChatGPT login (`openai-codex/gpt-5.5`, `--thinking low` / `medium`), cwd a temp folder, session
folder a temp folder: a new session with an exact id, the same one resumed (the model remembered the first turn), a
fork (new id from `get_state`, the parent's context there), a bash command, write / edit / read, an image prompt
(a red square, answered "Red"), a prompt queued with `followUp` while another ran, two failing requests
(`anthropic/claude-haiku-4-5`: the account was out of usage; `openai-codex/gpt-5.4-mini`: not supported with a ChatGPT
account), `pi --list-models`. The parser, history, usage and sessions code runs on those recordings; the spawn arguments
and the stdin lines are asserted in tests and were the ones sent by hand.

Not run: the app itself (spawning through Tauri and the broker, the Usage view's Pi section, the settings pane);
streamed thinking (the models tried sent no reasoning summary; the `thinking_*` events are handled as the docs
describe them); `--thinking` on a model without that level; a trust prompt for a vault with a project-local `.pi`;
`detect` on a fresh install without a login; sessions of another pi version (file format 3 assumed).

## Known gaps

- No permission cards and no questions: pi runs everything it is asked to. Run it only where that is acceptable.
- An extension's dialog (`extension_ui_request` with `select`, `confirm`, `input`, `editor`) is not shown and not
  declined: the extension waits for its own timeout, if it set one. Extensions in `~/.pi/agent/extensions` do load.
- No plan or rate limits, no subagents, no AI titles (a session is named by its first message).
- Efforts are one global list; the model list shows what pi can reach, not what the account may use (the two failing
  models above are listed).
- A session list older than 8 days is not shown (the usage window); history of any session still opens by id.
- A prompt that pi handles without running the model (an extension command such as `/name`) ends no turn, so the
  conversation stays busy until the process is restarted.
- The duration of a turn ends at the start of the last model call, since messages carry their start time.
