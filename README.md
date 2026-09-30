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

Needs Rust, pnpm, `/usr/bin/python3`, Claude Code at `~/.local/bin/claude` (logged in), and iTerm
for "open in terminal".

There is no default vault. On first start the main window asks for the vault folder and shows what it
found in it, and no conversation, terminal or snapshot runs until one is saved. Change it later in
Vault › Settings… (Cmd-,). Vaults differ, so the app keeps a mapping per vault in `settings.json`:

```json
"vault": "/Users/me/vault",
"vaults": { "/Users/me/vault": {
  "workState": "Contexts/Personal/State/work-state.md",
  "reminders": "Contexts/Personal/State/reminders.md",
  "reminderScript": "",
  "notes": "Contexts" } }
```

Paths are relative to the vault (absolute ones work too). Picking a folder detects them: the
`System/` layout, the old `Resources/Meta/Claude/` one, else a search by file name; symlinks are
resolved. Only `workState` is required; without `reminders` or `reminderScript` those features are off.

`pnpm tauri build` builds the .app. Not used yet: the app reads `snapshot.py` and `perm_server.py`
from this checkout (`REPO` in `src-tauri/src/lib.rs`), so a build only works on this machine.

## How it works

| Part | What it does |
|---|---|
| `src-tauri/src/lib.rs` | All Tauri commands. Starts one `claude -p` per conversation in stream-json mode, with the vault as cwd, the login-shell PATH and `ANTHROPIC_API_KEY` removed. Reads terminal sessions and subagents from `~/.claude/projects/<vault-slug>/`. |
| `perm_server.py` | Stdio MCP server passed as `--permission-prompt-tool`. Writes each permission request or question to `pending/<id>.json`, waits for the app's `<id>.answer.json`. Files, not a socket, so a waiting question survives an app restart. |
| `snapshot.py` | One read-only JSON snapshot of the vault: work-state index, each project's `## Open`, reminders, `claude agents --json`. |
| `src/main.ts` | Main window: sidebar, conversations, permission cards, inspector, agents strip. |
| `src/reminders.ts` | Reminders view. Klaar, Morgen, +1 week and a date picker go through the vault's `System/scripts/reminder-digest.py`. |
| `src/board.ts`, `src/providers/` | The board in the sidebar, one per switched-on provider (Productive now). Moving a card writes to the tracker right away. See [Board providers](#board-providers). |
| `src-tauri/src/providers.rs` | The backend half of each board provider: allowed API calls, token in the keychain, settings migration. |
| `src-tauri/src/vault.rs`, `src/vault-setup.ts` | The per-vault mapping: detection, found / missing, the first-launch screen and the mapping rows in Settings. |
| `src/settings-window.ts` | Settings window: vault folder, per-project icon and label, Integrations (board providers, GitHub), language. |
| `src/i18n.ts`, `src/locales/` | UI strings in English, Dutch, French and German. `t(key)` in the webview, `tr()` in `lib.rs` for the menu bar and errors. The language follows macOS unless set in the settings. |

State lives in `~/Library/Application Support/be.laurentmeersman.vault/`: `settings.json`,
`sessions.json` (conversation to session id) and `pending/`. Board provider tokens sit
in the macOS keychain (`vault-app.<provider>`, account `token`, so `vault-app.productive`) and never reach the webview.

## Board providers

A task tracker shows as a kanban in the sidebar by implementing one contract in two halves.

**Backend**, `src-tauri/src/providers.rs`: a `Provider` in `PROVIDERS`.

| Field | What it does |
|---|---|
| `id`, `name` | `"productive"`, `"Productive"`. The id keys `settings.integrations.<id>` and the keychain service `vault-app.<id>`. |
| `defaults(&mut cfg)`, `check(&cfg)` | Fill in and validate `settings.integrations.<id>` on every load and save. Keep `on` (bool, sidebar row shown). |
| `ready(&cfg)`, `not_ready` | Whether the config is complete enough to call the API, and the `TEXT` key of the error when not. |
| `secrets` | The keychain accounts under `vault-app.<id>` that must all be there: `["token"]` for Productive, `["key", "token"]` for Trello. |
| `url(cfg, method, path, body)` | The full URL for a call the webview asks for, `None` when that method and path are not allowed. This is the allowlist: keep it to reads plus the one write that moves a card. |
| `headers(cfg, secrets)` | The headers carrying the secrets, in the order of `secrets` (and content type). |
| `error(code, body)` | An error answer as one line. |

Commands (all take `provider`): `integration_status` (on, ready and a token), `integration_has_token`,
`integration_token(token, account?)` (save one secret, `token` by default; `""` without an account removes them all), `integration_call(method, path, body)`. The call runs curl
with the token over stdin; the webview never sees it.

**Webview**, `src/providers/types.ts`: a `BoardProvider`, registered in `src/providers/index.ts`.

```ts
interface BoardProvider {
  id: string; name: string; glyph: string;             // glyph: 16×16 SVG body
  projects(ctx): Promise<Opt[]>;                       // level 1: Productive project, Trello workspace, Linear team
  boards(ctx, project): Promise<Opt[]>;                // level 2: Productive board, Trello board, Linear project
  columns(ctx, ref): Promise<Column[]>;                // task lists, lists, workflow states
  cards(ctx, ref): Promise<Card[]>;
  move(ctx, ref, card, toColumn): Promise<number | void>; // resolves with the new placement if known
  url(ctx, ref, cardId): Promise<string>;              // the card in the browser
  detail?: CardDetail;                                 // right-panel view; without it a click opens url()
  reset?(): void;                                      // drop caches
  settings: { fields: Field[]; tokenLabel: Key; help: Key; test(ctx): Promise<string>;
              allBoards?(ctx): Promise<BoardOpt[]>; import?: {...} };
}
```

`ctx` is `{ config: settings.integrations.<id>, call(method, path, body?) }`. `ref` is a `BoardRef`
`{ provider, project, board }`. Settings › Integrations draws a pane per provider from `settings.fields`
(each a string in `integrations.<id>`; a `secret` field goes to the keychain under its key instead, a `check`
field is a checkbox stored as a boolean), with the sidebar switch, the token and a Save that runs `test`.
A provider with `allBoards` (one call for every board) also gets a board picker per vault project there.

A vault project maps to at most one board: `settings.boards[<vault project>] = BoardRef`, set from the
board's header. Opening the board after a conversation in that project shows the linked board.

Settings from before the providers (a top-level `productive: { org, user }`) move to
`integrations.productive` with `on: true` when they are read.

**Trello** (`src/providers/trello.ts`): a project is a workspace (boards outside the user's workspaces sit
under "Personal and shared boards"), columns are the board's open lists, cards its open cards, optionally
only those the user is a member of (`integrations.trello.mine`). A move sets `idList` with `pos: "bottom"`,
a click opens the card's `shortUrl`. Key and token come from a Power-Up at trello.com/power-ups/admin and
travel in the `Authorization: OAuth …` header. 401/403 and 429 read as a plain message, nothing retries by
itself. The response mapping (`trello-map.ts`) is tested on fixture JSON with `pnpm test` (Node's test runner).

A new provider: a `Provider` in `providers.rs` (with a test for its `url` allowlist), a `BoardProvider`
in `src/providers/<id>.ts` added to `PROVIDERS`, its UI strings in all four locales.

## Other folders

- `design/`: mockups and screenshots per iteration, most of it gitignored.
- `spike/`: the throwaway scripts that proved stream-json plus a permission MCP tool works.

## Tests

```sh
cd src-tauri && cargo test
```

The transcript and vault tests read the vault in `$VAULT` (`VAULT=/path/to/vault cargo test`) and
skip themselves without it.
