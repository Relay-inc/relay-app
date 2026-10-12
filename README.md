# Vault

Native macOS app for talking to the Obsidian vault through Claude Code. Projects on the left, the
conversation in the middle, the project's Stand van zaken and `## Open` on the right. A Tauri shell
around the real `claude` CLI, running on the claude.ai subscription, never an API key.

Design and layout: `DESIGN.md`. Functional analysis: the vault note "Functionele Analyse Vault-app"
(project claude-ui).

## Run

```sh
pnpm install
pnpm tauri dev
```

Needs Rust, pnpm, Claude Code at `~/.local/bin/claude` (logged in), and iTerm
for "open in terminal".

On first start the main window offers a starter vault: Start copies `src-tauri/resources/default-vault` to
`~/Relay` (a vault already there is kept) with `.claude -> System` linked, and uses it. "I have a vault" asks for
the vault folder instead and shows what it found in it. No conversation, terminal or snapshot runs until a vault is
saved. `scripts/check-default-vault.py --vault <your vault>` checks the starter vault holds nothing from a real one. Change it later in
Vault › Settings… (Cmd-,). Vaults differ, so the app keeps a mapping per vault in `settings.json`:

```json
"vault": "/Users/me/vault",
"vaults": { "/Users/me/vault": {
  "workState": "Contexts/Personal/State/work-state.md",
  "reminders": "Contexts/Personal/State/reminders.md",
  "notes": "Contexts" } }
```

Paths are relative to the vault (absolute ones work too). Picking a folder detects them: the
`System/` layout, the old `Resources/Meta/Claude/` one, else a search by file name; symlinks are
resolved. Only `workState` is required; a missing `reminders` file is created by the first reminder you add (default `reminders.md` in the vault root).

`pnpm tauri build` builds the .app.

## How it works

| Part | What it does |
|---|---|
| `src-tauri/src/lib.rs` | All Tauri commands. Starts one process per conversation through its agent provider, with the vault as cwd and the login-shell PATH, and passes the provider's normalised events to the webview. See [Agent providers](#agent-providers). |
| `src-tauri/src/agents.rs`, `src/shared/plugins.ts` | The registry of the agent providers, `settings.agents` and sessions.json. |
| `src-tauri/src/snapshot.rs` | One read-only JSON snapshot of the vault: work-state index, each project's `## Open`, reminders, `claude agents --json`. |
| `packages/agent-claude/src/permission.rs` | Claude Code's permission requests and questions over the pipe (`--permission-prompt-tool stdio`): a `can_use_tool` control request becomes a card in `pending/<id>.json`, the user's answer a control response on stdin. The card is a file, so a waiting question survives an app restart. |
| `src/shared/` | What every layer uses: `i18n.ts` + `locales/` (UI strings in English, Dutch, French and German; `useT()` in a component, `t(key)` elsewhere, `tr()` in `lib.rs` for the menu bar and errors; the language follows macOS unless set in the settings), `plugins.ts` (the provider and agent registries), `icons.ts`, `markdown.ts`. |
| `src/domain/<context>/` | Pure types and rules per bounded context (conversations, agents, workspace, navigation, mail, board, reminders, pull-requests, usage, settings), unit tested with `node --test`. The agent events go through one reducer, `applyAgentEvent`. |
| `src/application/<context>/` | One Zustand + Immer store per context (`use<Context>Store`) and its use cases: loaders, actions, polls. `boot.ts` is the main window's start: settings, language and vault, the conversations from earlier versions, the listeners and polls. |
| `src/infrastructure/` | The only code that talks to the outside: `backend.ts` (every Tauri command and event, typed), `storage.ts` (localStorage), `window.ts`. |
| `src/ui/` | React 19 with the React Compiler, styled with Tailwind: `app/` (the window's grid, shortcuts and link handling), `features/<context>/` (`<Context>View.tsx` is the container), `components/` (permission card, image thumbnails, tool line, markdown), `hooks/`, `styles/`. Layers and rules: [docs/frontend-architecture.md](docs/frontend-architecture.md). |
| `src/application/reminders/`, `src/ui/features/reminders/` | Reminders. Klaar, Morgen, +1 week and a date picker go through the vault's `System/scripts/reminder-digest.py`. |
| `src-tauri/src/calendar.rs`, `src/domain/calendar/`, `src/application/calendar/` | Google calendars, read through each one's secret iCal address (kept in the keychain, service `relay-calendar`, never in settings.json or the webview). The meetings of the next 12 hours, recurring ones expanded; the ones about to start sit at the top of Waiting with a banner 5 minutes before, and a meeting note or a briefing about one starts from its card (restricted, like a conversation about a mail). |
| `src/application/board/`, `src/ui/features/board/` | The board in the sidebar, one per switched-on integration. Moving a card writes to the tracker right away. See [Integrations](#integrations). |
| `src-tauri/src/providers.rs` | The backend registry of the integrations: token in the keychain, the curl call, settings migration. |
| `packages/` | The integrations and the agent providers, one package each (TypeScript + Rust + strings + tests), and `board-core` and `agent-core`, their contracts. |
| `src-tauri/src/vault.rs`, `src/application/workspace/vault-setup.ts`, `src/ui/features/workspace/` | The per-vault mapping: detection, found / missing, the first-launch screen and the mapping rows in Settings. |
| `src/settings.tsx`, `src/application/settings/`, `src/ui/features/settings/` | Settings window: vault folder, per-project icon and label, Integrations (board providers, GitHub), Agents, language. |

State lives in `~/Library/Application Support/be.laurentmeersman.relay/`: `settings.json`,
`sessions.json` (conversation to session id, and to its provider when that is not Claude Code) and `pending/`. Board provider tokens sit
in the macOS keychain (`vault-app.<provider>`, account `token`, so `vault-app.productive`) and never reach the webview.

## Integrations

The sidebar board shows one of these per vault project. (The agents that answer in the conversations are the other kind of package: [Agent providers](#agent-providers).) Set them up under Vault › Settings… › Integrations; every
secret goes to the macOS keychain (service `vault-app.<id>`), never to settings.json or the webview. How to get a
key and what the backend lets through is in each package's README.

| Tracker | Project › board | Package |
|---|---|---|
| Productive | project › board | [`packages/integration-productive`](packages/integration-productive/README.md) |
| Trello | workspace › board | [`packages/integration-trello`](packages/integration-trello/README.md) |
| Linear | team › all issues or a Linear project | [`packages/integration-linear`](packages/integration-linear/README.md) |

### Layout

Each tracker is one self-contained package in a pnpm workspace (`pnpm-workspace.yaml`) and a Cargo workspace
(the root `Cargo.toml`, with `src-tauri` as a member). The app depends on them and registers them at compile
time, no plugin loading (plugins, below, are a separate thing).

```
packages/
  board-core/                 the contract, nothing tracker-specific
    src/types.ts, i18n.ts     BoardProvider, Card, Column, Field, Ctx, …; Locales, translator
    src/lib.rs                Provider, Text + t, path_ok, only_keys
  integration-<id>/           one tracker (productive, trello, linear)
    src/index.ts              the BoardProvider, with its glyph
    src/map.ts                the response mapping, pure (Trello, Linear)
    src/locales.ts            its UI strings in en, nl, fr, de
    src/lib.rs                the backend Provider: base URL, allowlist, headers, errors, secrets
    tests/, tests/fixtures/   the mapping on fixture JSON; the Rust tests sit in lib.rs
    README.md                 setup and what the allowlist permits
src/shared/plugins.ts         PROVIDERS, the webview registry
src-tauri/src/providers.rs    PROVIDERS, the backend registry; keychain, curl, settings migration
```

Strings: a package's `locales.ts` is typed with `Locales<Key>` (English is the reference), so a missing key in
any language fails `tsc`, as it does for the app's own `src/shared/locales/`. The app merges them into its dictionaries
as `<id>.<key>` (`src/shared/i18n.ts`); in the package, `translator<Key>(id)` is its `t`. Its native error strings
are a `Text` table in `lib.rs`.

### The contract

**Backend**, the package's Rust crate: a `board_core::Provider` (`pub const PROVIDER`), registered in `PROVIDERS` in `src-tauri/src/providers.rs`.

| Field | What it does |
|---|---|
| `id`, `name` | `"productive"`, `"Productive"`. The id keys `settings.integrations.<id>` and the keychain service `vault-app.<id>`. |
| `text` | Its native strings (errors) in en, nl, fr, de, looked up with `board_core::t`. |
| `defaults(&mut cfg)`, `check(&cfg)` | Fill in and validate `settings.integrations.<id>` on every load and save. Keep `on` (bool, sidebar row shown). |
| `ready(&cfg)`, `not_ready` | Whether the config is complete enough to call the API, and the `text` key of the error when not. |
| `secrets` | The keychain accounts under `vault-app.<id>` that must all be there: `["token"]` for Productive and Linear, `["key", "token"]` for Trello. |
| `url(cfg, method, path, body)` | The full URL for a call the webview asks for, `None` when that method and path are not allowed. This is the allowlist: keep it to reads plus the one write that moves a card. |
| `headers(cfg, secrets)` | The headers carrying the secrets, in the order of `secrets` (and content type). |
| `ok(body)` | Whether a 2xx answer is a success. `true` for REST; Linear (GraphQL) answers errors with 200 and `errors`. |
| `error(code, body)` | An error answer as one line. |
| `actions` | What an agent may do with the tracker through `relay` (see [Agent actions](#agent-actions)): each builds its own request from checked arguments, so it is its own allowlist. |

The app's commands (all take `provider`): `integration_status` (on, ready and a token), `integration_has_token`,
`integration_token(token, account?)` (save one secret, `token` by default; `""` without an account removes them all), `integration_call(method, path, body)`. The call runs curl
with the token over stdin; the webview never sees it. The keychain, curl and the commands are the app's, not a package's.

**Webview**, the package's TypeScript (`src/index.ts`, default export): a `BoardProvider<Key>` from `@relay/board-core`, registered in `PROVIDERS` in `src/shared/plugins.ts`.

```ts
interface BoardProvider {
  id: string; name: string; glyph: string;             // glyph: 16×16 SVG body
  strings: Locales<Key>;                               // its UI strings, en/nl/fr/de
  projects(ctx): Promise<Opt[]>;                       // level 1: Productive project, Trello workspace, Linear team
  boards(ctx, project): Promise<Opt[]>;                // level 2: Productive board, Trello board, Linear project
  groupings?: { id: string; label: Key }[];           // more than one column layout (Productive: lists, statuses); first is default
  columns(ctx, ref, group?): Promise<Column[]>;        // task lists, lists, workflow states
  cards(ctx, ref): Promise<Card[]>;
  move(ctx, ref, card, toColumn, group?): Promise<number | void>; // resolves with the new placement if known
  search?(ctx, q): Promise<Hit[]>;                     // Cmd-K: matching cards on any board, each with its BoardRef
  url(ctx, ref, cardId): Promise<string>;              // the card in the browser
  detail?: CardDetail;                                 // right panel as data: view(d) gives fields, description, feed, files,
                                                       // actions; the app draws it. act() runs comment, status, assignee, attach
  reset?(): void;                                      // drop caches
  settings: { fields: Field<Key>[]; tokenLabel: Key; help: Key; test(ctx): Promise<string>;
              allBoards?(ctx): Promise<BoardOpt[]>; import?: {...} };
}
```

`ctx` is `{ config: settings.integrations.<id>, call(method, path, body?), upload(url, fields, file) }`; `upload` posts a
file as a form to a URL the backend's `upload` allows (Productive: its S3 bucket), without the secrets. A card's column in a
grouping other than the first is `card.in[group]`. `ref` is a `BoardRef`
`{ provider, project, board }`. Settings › Integrations draws a pane per provider from `settings.fields`
(each a string in `integrations.<id>`; a `secret` field goes to the keychain under its key instead, a `check`
field is a checkbox stored as a boolean), with the sidebar switch, the token and a Save that runs `test`.
A provider with `allBoards` (one call for every board) also gets a board picker per vault project there.

A vault project maps to at most one board: `settings.boards[<vault project>] = BoardRef`, set from the
board's header. Opening the board after a conversation in that project shows the linked board.

Settings from before the providers (a top-level `productive: { org, user }`) move to
`integrations.productive` with `on: true` when they are read.

### Adding an integration

1. `packages/integration-<id>/` with a `package.json` (`@relay/integration-<id>`, depending on
   `@relay/board-core`) and a `Cargo.toml` (crate `integration-<id>`, depending on `board-core`).
2. `src/lib.rs`: `pub const PROVIDER: Provider`. Keep the allowlist to reads plus the one write that moves a
   card, and test it (and the error mapping) in the same file.
3. `src/index.ts`: the `BoardProvider<Key>` with its glyph and `strings`; `src/locales.ts` in all four
   languages; the response mapping in a pure module with fixture tests in `tests/`.
4. A README: how to get the key or token, what the allowlist permits.
5. Register it: a dependency line and a `PROVIDERS` entry on each side, `src-tauri/Cargo.toml` +
   `src-tauri/src/providers.rs` and `package.json` + `src/shared/plugins.ts`, then `pnpm install`.

## Plugins (MCP Apps)

A plugin is an MCP server that Relay starts on this Mac and hosts the views of ([MCP Apps](https://github.com/modelcontextprotocol/ext-apps),
spec revision 2026-01-26). Add one under Settings › Plugins (a command, arguments, environment and secrets) or import it
from Claude Code's MCP config; Save and test lists its tools and views. Secrets live in the keychain
(`vault-app.plugin.<id>`, one entry per name), never in `settings.json` (`plugins`) or the webview.

A plugin with a `ui://` resource (`_meta.ui.resourceUri` on a tool, or a listed resource) shows in the sidebar. Its HTML is
served from the `relay-plugin://` scheme with the Content-Security-Policy its `_meta.ui.csp` declares (default: nothing
but inline script and style, no network) and shown in an iframe with `sandbox="allow-scripts"`: an opaque origin, so no
Tauri IPC and no access to the app. The view talks to Relay over postMessage (`ui/initialize`, `tools/call`,
`ui/open-link`; `src/domain/plugins/bridge.ts`), and the backend (`src-tauri/src/plugins.rs`) runs only tools the plugin
allows and whose `_meta.ui.visibility` includes `app`. The agent is not involved: it reaches MCP servers through Claude
Code. Not yet: views inside conversations, display modes, model context and permissions requests (camera, microphone).
`packages/plugin-example` is a server and view without dependencies to start from.

## Agent providers

The conversations run on a coding-agent CLI: Claude Code, Codex, OpenCode or Pi. Each is one package `packages/agent-<id>/` (Rust + TypeScript + strings + tests) implementing the contract in
[`packages/agent-core`](packages/agent-core/README.md). The app owns the processes, `sessions.json`, the pending folder,
the settings and the commands; a provider builds its command line, turns its output into normalised events, reads its
own transcripts and logs, and reports its limits and tokens.

| | Claude Code | Codex | OpenCode | Pi |
|---|---|---|---|---|
| Package | [`agent-claude`](packages/agent-claude/README.md) | [`agent-codex`](packages/agent-codex/README.md) | [`agent-opencode`](packages/agent-opencode/README.md) | [`agent-pi`](packages/agent-pi/README.md) |
| Permissions | cards, over the pipe (`--permission-prompt-tool stdio`), with "Always allow" | cards: command and patch approvals | cards: `permission.asked` (edits, commands, fetches ask by default) | none (pi runs every tool call) |
| Runs as | `claude -p` stream-json, one process per conversation | `codex app-server` (JSON-RPC over stdio) behind its bridge (`relay --codex-bridge`) | a private `opencode serve` (HTTP + SSE) behind its bridge (`relay --opencode-bridge`) | `pi --mode rpc` (JSON lines over stdio), no bridge |
| Questions | yes (AskUserQuestion) | no (declined) | yes (`question.asked`) | no |
| Thinking, images | –, yes | yes, yes | yes, yes | yes, yes |
| Resume, fork | yes, yes | yes, – | yes, yes | yes (`--session-id`), yes (`--fork`) |
| Subagents, titles | yes, yes | –, – | –, – | –, – |
| Models, efforts | built-in list, efforts | `~/.codex/models_cache.json` | `opencode models --verbose` (configured providers), model variants | `pi --list-models`, thinking levels |
| Session list, terminal | `claude agents`, attach / stop | `state_5.sqlite` threads, `codex resume` | `opencode.db` sessions, `opencode --session` | session files, `pi --session` |
| Tokens | `~/.claude/projects/**/*.jsonl`, priced at API list prices | rollout `token_count` events, unpriced | `opencode.db` assistant messages, with the cost OpenCode recorded | session files, with the cost pi computed from its prices |
| Limits | plan limits (`api.anthropic.com/api/oauth/usage`) | rate-limit windows from the rollouts and the app-server | none (OpenCode has none) | none (pi has none) |
| Known gaps | see its README | no questions, fork, subagents or titles; no accept-for-session; tokens unpriced | no limits, subagents or titles; no "always"; cost 0 where OpenCode has no price | no permissions or questions; extension dialogs unanswered; no limits, subagents or titles |

**Backend**, `agent_core::AgentProvider` (`packages/agent-core/src/lib.rs`), a `pub static PROVIDER` in the package,
registered in `PROVIDERS` in `src-tauri/src/agents.rs`:

| Method | What |
|---|---|
| `id`, `name`, `caps()` | `Caps`: persistent, images, thinking, permissions, questions, subagents, fork, terminal, background, effort, limits, title. The webview hides what is false. |
| `default_bin(home)`, `detect(env)` | Where the CLI installs itself (the settings can override it), and `Detect { installed, bin, version, logged_in, note }`. |
| `models()`, `efforts()` | `Choice { id, label }` for the composer's picks; "" is the CLI's default. |
| `command(env, launch)` | The `Command` for a conversation: args and provider env. The app sets cwd (the vault), PATH (login shell) and stdio. `Launch { key, name, model, effort, resume, fork, turn }`. |
| `input(turn)` | Persistent providers: the stdin line for a turn (`Turn { text, images }`). Per-turn providers get the turn in `launch.turn` and exit after it. |
| `parser()` | A stateful stdout-line → `Vec<Event>` function, one per process. |
| `respond(request, decision)` | The stdin line that answers a permission the provider raised as an event. |
| `history(env, sid, from)` | A session's messages as events from a byte offset, and the next offset. |
| `sessions`, `subagents`, `agent_log`, `terminal`, `stop_background`, `title` | Terminal and background sessions, subagents, "open in terminal" (`Terminal::Resume/New/Attach` → a shell command), the conversation title. All optional. |
| `limits(env)`, `usage(env, since)` | Usage, below. |

`env` is `Env { home, vault, path, bin, pending, opts }`; `opts` is the provider's own settings object
(`settings.agents.providers.<id>`, read with `env.opt(key)`).

**Accounts** (`caps.accounts`, Claude Code only for now): `opts.accounts` lists extra logins as `{name, dir}`, each its
own config folder (`CLAUDE_CONFIG_DIR`); `opts.active` is the one new conversations start on ("" is `~/.claude`) and
`opts.auto` switches. The app sets `opts.account` to the folder a process or a limits call is for, keeps it per
conversation in `sessions.json` (`{provider, sid, account}`) and reads every account's limits. With `auto` on, a
conversation whose account is used up (a window at 100% that applies to its model, or a turn refused for its limit) moves
to the next signed-in account with room on its next message, once idle: the process restarts there and the provider takes
its transcript along. A removed account keeps its conversations: they resume on the folder `sessions.json` recorded.

**Events** (`agent_core::Event`, JSON with `type` in snake_case), sent as the Tauri event `agent` with
`{project, provider, event}`: `session {id}`, `text {text, delta}`, `thinking {text, delta}`, `tool_call {id, name, input}`,
`tool_result {id, error}`, `permission {request}`, `turn_end {ok, error, usage, duration_ms}`, `error {text}`; the app adds
`stderr {text}` and `exit`. History uses the same events plus `user {text, images}` and `time {at}` (before the events of each
transcript line, so the app can time a turn it follows from the transcript). Tool calls use the canonical names
where they match (Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, Agent, Skill, TodoWrite, with input keys
file_path, command, pattern, query, url, description), so the webview words them well.

**Permissions** go through one folder for every provider (`agent_core::pending`): a request is `pending/<id>.json`
(`{id, project, provider, kind: "tool" | "question", tool_name, input, relay, at}`, plus `request_id` and `suggestions` for
Claude), the answer `<id>.answer.json` (`{behavior: "allow", updatedInput, updatedPermissions?}` or `{behavior: "deny", message}`;
a question has `input.questions` and is answered with `updatedInput.answers`). A provider raises `Event::Permission` (Claude's
`can_use_tool` request is turned into a card by the app): the app writes the file with `relay: true` and passes the user's
decision to `respond`, writing its line to the process's stdin. A card of Claude's is also in the broker's replay after an app
restart, with the same id. Files from before the providers read as Claude's.

**Usage**: `limits(env)` gives `Limits::On { plan, windows: [Window { id, label, name, pct, resets }] }` or
`Limits::Off(reason)`; `label` and `off.<reason>` are keys in the provider's own strings. The app asks at most once a
minute per provider. `usage(env, since)` gives `Record { at, model, session, vault, input, output, cache_read,
cache_write, cost }`, read incrementally (`agent_core::usage::Tail` keeps an offset per log file). The app aggregates
per provider (today, this week, by model, the vault's conversations) and over all of them (`usage_tokens`,
`usage_limits`). The Usage view shows a section per switched-on provider and the total; the sidebar count is the most
constrained window over all providers.

**Webview**, the package's TypeScript (`src/index.ts`, default export): an `AgentProvider<Key>` from
`@vault/agent-core` (`id`, `name`, `glyph`, `strings` in en/nl/fr/de, optional `modelName` and `options`: selects shown
in Settings › Agents and stored next to `on` and `bin`, the first choice the default), registered in `AGENTS` in
`src/shared/plugins.ts`. Its strings are merged into the app's as `<id>.<key>`; the app looks up `limits.loading`,
`off.<reason>`, each window's `label`, `tokens.reading` and `set.help`.

**Settings** (Settings › Agents): `settings.agents = { default, providers: { <id>: { on, bin, …options } } }`, Claude Code
on by default, the others off. The composer shows an agent pick next to model and effort when more than one is on; a conversation keeps its
agent once it has a message. `sessions.json` maps a conversation key to a session id string (Claude Code, as before the
providers, so old files and old builds keep working) or to `{provider, sid}`. Terminal keys are `t:<sid>` (Claude Code)
or `t:<provider>:<sid>`.

### Adding an agent provider

1. `packages/agent-<id>/` with a `package.json` (`@vault/agent-<id>`, depending on `@vault/agent-core`) and a `Cargo.toml`
   (crate `agent-<id>`, depending on `agent-core`).
2. `src/lib.rs`: `pub static PROVIDER` implementing `AgentProvider`. Set `caps` honestly: the webview hides what is false.
   - `default_bin` and `detect`: where the CLI installs itself; not installed, `installed: false` and a `note` with the
     install command (Settings shows it next to the status); `logged_in` only when the provider can really tell.
   - `command` (+ `input` for persistent providers): remove API keys from the environment when it should run on the
     user's subscription; check every id that goes on a command line (`valid_session`, `safe_model`).
   - `parser`: the output as `Event`s, in its own module, tested on fixture files in `tests/fixtures/` (live runs,
     trimmed, where you can; say which were written from docs). One `turn_end` per turn, also when it fails.
   - Permissions: raise `Event::Permission` and answer in `respond`, or use the pending folder directly. A request the
     app has no card for must be declined, never left waiting.
   - `history`, `sessions`, `terminal` from the CLI's own storage, read-only.
   - Usage: `usage(env, since)` as `Record`s (`cost` None when there is no price), `limits(env)` only where the CLI
     reports them, else `caps.limits` false.
3. `src/index.ts` with its glyph, `strings` and optional `options` (settings selects, read back as `env.opt(key)`);
   `src/locales.ts` in all four languages with `limits.loading`, `off.<reason>`, each window's `label`,
   `tokens.reading` and `set.help` (which should say how to install it); tests in `tests/` (at least the keys of every
   language and `modelName`).
4. A README: how to install it, how it runs, where it logs, how it asks for permissions and reports usage, what ran
   live and what did not, known gaps. A column in the table above.
5. Register it: a dependency line and a `PROVIDERS` entry on each side, `src-tauri/Cargo.toml` +
   `src-tauri/src/agents.rs` and `package.json` + `src/shared/plugins.ts`, then `pnpm install`.
6. `pnpm build`, `pnpm test` and `cargo test --workspace`.

## Agent actions

Everything an extension can do is also a shell command for the agent in a conversation, whatever provider runs
it: `relay help` lists the actions available there, `relay <extension>.<action> key=value …` (or one JSON object,
or `-` for JSON on stdin) runs one and prints JSON. `src-tauri/src/actions.rs` holds the registry, the policies,
the socket the app listens on and the CLI side.

- `relay` is a script the app writes to its data folder (`bin/relay`, `exec <this binary> --cli "$@"`) and puts first
  on every agent's PATH, with `RELAY_CONVERSATION` set to the conversation's key. The CLI asks the app over
  `$TMPDIR/relay-agents/relay.sock` (mode 0600); a call from anything that is not a running conversation is refused.
- Extensions: the board providers' `actions` (Productive projects, task lists, task search and read, comments,
  services, time entries; Trello boards, lists, card search and read, cards, comments; Linear teams, issue search
  and read, issues), mail (`search`, `read`, `thread`,
  `attachment`, `save_draft`, the relay-mail tools) and the vault's reminders (`list`, `add`, `done`, `push`). Only
  set-up extensions are listed.
- Per extension, **agent access** on or off (off: not listed, every call refused), and per action a policy:
  `auto` runs, `ask` shows a card in the conversation (the pending folder, like a permission; the command waits for
  it), `deny` refuses. Reads default to `auto`, writes to `ask`, a mail draft to `auto`. Both are set in each
  extension's Agent access section in Settings (Integrations › the extension; reminders under General) and kept in
  the vault's `.relay/config.json`, read on every call, so a hand edit applies at once:

  ```json
  "actions": { "productive": { "*": "ask", "add_time": "auto" }, "trello": { "access": false }, "linear": "auto" }
  ```

  The agent works in the vault, so Claude Code is denied `Edit(./.relay/**)`: it cannot hand itself permissions.
- Mail actions only run for Claude Code. A session that holds mail text keeps its own permission mode, it only stays
  on this Mac (see `mark_tainted` in lib.rs).
- Claude Code runs `relay` without a Bash card (`Bash(relay *)` in its allowed tools, so the action's own policy
  decides) and learns about it from one `--append-system-prompt` line. The other providers have `relay` on their
  PATH but are not told about it, and their own approval asks for each command.

## Other folders

- `design/`: mockups and screenshots per iteration, most of it gitignored.
- `spike/`: the throwaway scripts that proved stream-json plus a permission MCP tool works.

## Tests

```sh
cd src-tauri && cargo test   # the app
cargo test --workspace        # the app and every integration crate, from the repo root
pnpm test                     # the packages' and src/domain's pure TypeScript (node --test)
pnpm exec tsc --noEmit        # types
pnpm lint                     # ESLint, the layer boundaries and the React hooks rules included
pnpm check:compiler           # the React Compiler compiles every component and hook in src/ui
pnpm format:check             # Prettier
```

CI (`.github/workflows/frontend.yml`) runs all but cargo, plus `vite build`.

The frontend has a harness (`harness/`, see its README) that runs the real webview against a mocked Tauri backend,
on the dev server (`pnpm exec vite --config harness/vite.config.ts`, http://127.0.0.1:1430):

```sh
node harness/behaviour.mjs --url http://127.0.0.1:1430 --label mine   # user flows, recorded
node harness/behaviour.mjs --compare lit mine                         # against the Lit baseline
node harness/screens.mjs --url http://127.0.0.1:1430 --label mine     # a screenshot per view
node harness/diff.mjs lit mine                                        # pixel diff against the baseline
node harness/perf.mjs --label mine                                    # streaming, typing and view switches
```

The transcript and vault tests read the vault in `$VAULT` (`VAULT=/path/to/vault cargo test`) and
skip themselves without it.
