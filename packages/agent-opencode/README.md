# @relay/agent-opencode / agent-opencode

OpenCode ([sst/opencode](https://github.com/sst/opencode), <https://opencode.ai>) as an agent provider. Written against
opencode 1.18.33 (`opencode serve`, its OpenAPI document at `/doc`, and its SQLite storage).

## Install

    npm install -g opencode-ai                     # or: brew install sst/tap/opencode
    curl -fsSL https://opencode.ai/install | bash  # or the install script (~/.opencode/bin/opencode)
    opencode auth login                            # a model provider; OpenCode Zen's free models need no login

Then Settings › Agents › OpenCode › Use. Not installed, the pane says so with `npm install -g opencode-ai` next to the
status and the other install commands in its hint. The program defaults to the first of `~/.opencode/bin/opencode`,
`/opt/homebrew/bin/opencode`, `/usr/local/bin/opencode`, `~/.local/bin/opencode`, `~/.npm-global/bin/opencode`,
`~/.bun/bin/opencode` that exists. Installed but without any model (no provider set up), the note is `opencode auth login`.

## How it runs

- **Runs** `relay --opencode-bridge <opencode> '<config>'` (the app's own binary, src/bridge.rs) in the vault, one process per conversation
  (`caps.persistent`). The bridge starts a private `opencode serve --hostname 127.0.0.1 --port 0` with a random
  `OPENCODE_SERVER_PASSWORD` (HTTP basic auth, user `opencode`), subscribes to `GET /event`, opens the session
  (`GET /session/<id>` to resume, `POST /session/<id>/fork` to fork, else `POST /session`; a resume opencode no longer
  has starts a new one) and writes `bridge.session`. Then it passes the events of that session to stdout and turns the
  app's stdin lines into `POST /session/<id>/prompt_async` (with `model: {providerID, modelID}` and `variant`),
  `POST /permission/<id>/reply` and `POST /question/<id>/reply|reject`. A failed request is a `bridge.error` line.
  Closing its stdin stops the server.
- **Permissions** (Settings › Agents › OpenCode › Ask, `settings.agents.providers.opencode.permissions`): by default
  ("ask") the bridge sets `OPENCODE_CONFIG_CONTENT` to `{"permission": {"edit": "ask", "bash": "ask", "webfetch": "ask"}}`,
  merged over the user's own config, so edits, commands and fetches come to the cards. "config" leaves permissions to
  the user's opencode.json (whose default is to allow most things without asking). `permission.asked` becomes
  `Event::Permission` (kind "tool": `bash` → Bash with the command, `edit` → Edit with the file and diff, `webfetch` →
  WebFetch, anything else by its name with its patterns); `tool_use_id` is opencode's `per_…` id. `respond()` answers
  `once` or `reject` (with the deny message). "Always" is not offered.
- **Questions**: `question.asked` becomes a question card (AskUserQuestion's shape: question, header, options,
  `multiSelect` from `multiple`); the answer goes back as the chosen labels per question, a deny as a reject.
- **Events** (`src/events.rs`): `message.part.delta` of a text or reasoning part → text / thinking (the first piece
  starts the block); a part that did not stream is shown whole when its `time.end` is set; the user's own message
  and synthetic parts are left out. Tool parts → a tool call when they leave `pending`, a result at `completed` /
  `error`, with the canonical names (bash → Bash, read → Read, write → Write, edit / multiedit / patch → Edit, glob /
  list → Glob, grep → Grep, webfetch → WebFetch, websearch → WebSearch, task → Agent, todowrite → TodoWrite, skill →
  Skill) and `filePath` as `file_path`. `session.error` and an assistant message's `error` → error. `session.idle`
  → turn end, with the tokens and cost of the turn's assistant messages (reasoning counted as output) and the time
  from the first one's creation to the last one's completion.
- **Models and efforts**: `opencode models --verbose` (the models of the providers set up in OpenCode, as
  `provider/model`, "Name · provider"), kept for 5 minutes; efforts are the model variants any of them has (low,
  medium, high, max, …). "" is OpenCode's default model from its config. A model id without a `/` is ignored.
- **History**: the session's rows of `message` and `part` in `opencode.db`, as events: user text (images inline when
  they are data URLs), assistant text, reasoning, tool calls and results, errors, each message with its time. The
  offset is the number of whole messages read (an assistant message still running is read again).
- **Sessions** (`caps.background`): the vault's top-level sessions in `opencode.db` (`parent_id` null, not archived,
  `directory` the vault or below, as given or as its real path), newest first, as idle interactive sessions. Terminal:
  `opencode --session <id>` in the vault, or `opencode` for a new one.
- **Usage** (`src/store.rs`): one record per assistant message in the last 8 days, from `json_extract` of its `data`:
  `providerID/modelID`, `tokens.input` (without the cached ones), `tokens.output + tokens.reasoning`,
  `tokens.cache.read/write`, and `cost`, the USD opencode recorded from its model prices. The query runs again only
  when `opencode.db` or its `-wal` changed. No plan or rate limits (`caps.limits` false): OpenCode has none of its own.
- Storage: `$XDG_DATA_HOME/opencode/opencode.db`, default `~/.local/share/opencode/opencode.db`, read with the system's
  `/usr/bin/sqlite3 -readonly -json`. Nothing under it is written by the app.

Tests: `cargo test -p agent-opencode`, `pnpm test`. Fixtures in `tests/fixtures/`: three live `GET /event` streams as
the bridge wrote them (`serve-live.jsonl`: a bash command asked for and allowed; `serve-live-resume.jsonl`: the same
session resumed with a variant; `serve-live-reject.jsonl`: a write asked for through the "ask" setting and rejected),
`history.json` and `usage.json` (the queries of `src/store.rs` on the resulting database), `models-verbose.txt`
(`opencode models --verbose`, three models), and `fake-serve.py`, a stand-in server for the bridge (still python).

## What ran live, what did not

Ran with opencode-ai 1.18.33 from a throwaway `npm install` in `/tmp`, with `HOME` and every `XDG_*` folder pointed into
that temp folder (nothing of the user's `~/.local/share/opencode` or config was read or written, no login), on OpenCode
Zen's free `opencode/big-pickle`:

- the bridge (then python) driven by a small script: a new session, a bash permission answered `once`, streamed text, turn end with
  tokens; the same session resumed (the model remembered the first turn) with variant `high`; a write asked for
  through `OPENCODE_CONFIG_CONTENT` and rejected (no file was written, the tool part ended in `error`, the turn ended).
- The history, usage and sessions queries on the resulting `opencode.db`; `opencode models --verbose`; `/doc`.

Not run: the app itself (spawning through Tauri, the cards, the Usage view's OpenCode section, the settings select);
a question (`question.asked`, written from the OpenAPI schema); images; fork; a priced model (the free models record
cost 0, so a non-zero `cost` is only in a hand-written test row); the terminal commands; `detect` on a real install.

## Known gaps

- No plan or rate limits: OpenCode has none, and the providers' own are not read.
- No subagents strip: `task` calls show as Agent tool calls, their child sessions are not followed. No AI titles
  (OpenCode titles its sessions itself; the app does not read them back for its own conversations).
- A card is once or reject; "always" (opencode's `always` patterns) is not offered.
- Sessions from the database are all reported idle, so a turn running in the OpenCode TUI is not followed live.
- Cost is what opencode recorded: 0 for free models and for models it has no price for, which then show as free.
- Efforts are one global list of variants; a model without the chosen variant is left to OpenCode.
- The event names are those of 1.18.33 (`message.part.delta`, `permission.asked`, `question.asked`, `session.idle`);
  older versions with `permission.updated` are not handled.
- The bridge is Rust, run as a subcommand of the app; only the test's stand-in server needs python3.
