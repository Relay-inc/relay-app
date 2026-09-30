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
| `src/board.ts`, `src/providers/` | The board in the sidebar, one per switched-on integration. Moving a card writes to the tracker right away. See [Integrations](#integrations). |
| `src-tauri/src/providers.rs` | The backend registry of the integrations: token in the keychain, the curl call, settings migration. |
| `packages/` | The integrations, one package each (TypeScript + Rust + strings + tests), and `board-core`, the contract. |
| `src-tauri/src/vault.rs`, `src/vault-setup.ts` | The per-vault mapping: detection, found / missing, the first-launch screen and the mapping rows in Settings. |
| `src/settings-window.ts` | Settings window: vault folder, per-project icon and label, Integrations (board providers, GitHub), language. |
| `src/i18n.ts`, `src/locales/` | UI strings in English, Dutch, French and German. `t(key)` in the webview, `tr()` in `lib.rs` for the menu bar and errors. The language follows macOS unless set in the settings. |

State lives in `~/Library/Application Support/be.laurentmeersman.vault/`: `settings.json`,
`sessions.json` (conversation to session id) and `pending/`. Board provider tokens sit
in the macOS keychain (`vault-app.<provider>`, account `token`, so `vault-app.productive`) and never reach the webview.

## Integrations

The sidebar board shows one of these per vault project. Set them up under Vault › Settings… › Integrations; every
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
time, no plugin loading.

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
src/providers/index.ts        PROVIDERS, the webview registry
src-tauri/src/providers.rs    PROVIDERS, the backend registry; keychain, curl, settings migration
```

Strings: a package's `locales.ts` is typed with `Locales<Key>` (English is the reference), so a missing key in
any language fails `tsc`, as it does for the app's own `src/locales/`. The app merges them into its dictionaries
as `<id>.<key>` (`src/i18n.ts`); in the package, `translator<Key>(id)` is its `t`. Its native error strings
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

The app's commands (all take `provider`): `integration_status` (on, ready and a token), `integration_has_token`,
`integration_token(token, account?)` (save one secret, `token` by default; `""` without an account removes them all), `integration_call(method, path, body)`. The call runs curl
with the token over stdin; the webview never sees it. The keychain, curl and the commands are the app's, not a package's.

**Webview**, the package's TypeScript (`src/index.ts`, default export): a `BoardProvider<Key>` from `@vault/board-core`, registered in `PROVIDERS` in `src/providers/index.ts`.

```ts
interface BoardProvider {
  id: string; name: string; glyph: string;             // glyph: 16×16 SVG body
  strings: Locales<Key>;                               // its UI strings, en/nl/fr/de
  projects(ctx): Promise<Opt[]>;                       // level 1: Productive project, Trello workspace, Linear team
  boards(ctx, project): Promise<Opt[]>;                // level 2: Productive board, Trello board, Linear project
  columns(ctx, ref): Promise<Column[]>;                // task lists, lists, workflow states
  cards(ctx, ref): Promise<Card[]>;
  move(ctx, ref, card, toColumn): Promise<number | void>; // resolves with the new placement if known
  url(ctx, ref, cardId): Promise<string>;              // the card in the browser
  detail?: CardDetail;                                 // right-panel view; without it a click opens url()
  reset?(): void;                                      // drop caches
  settings: { fields: Field<Key>[]; tokenLabel: Key; help: Key; test(ctx): Promise<string>;
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

### Adding an integration

1. `packages/integration-<id>/` with a `package.json` (`@vault/integration-<id>`, depending on
   `@vault/board-core`) and a `Cargo.toml` (crate `integration-<id>`, depending on `board-core`).
2. `src/lib.rs`: `pub const PROVIDER: Provider`. Keep the allowlist to reads plus the one write that moves a
   card, and test it (and the error mapping) in the same file.
3. `src/index.ts`: the `BoardProvider<Key>` with its glyph and `strings`; `src/locales.ts` in all four
   languages; the response mapping in a pure module with fixture tests in `tests/`.
4. A README: how to get the key or token, what the allowlist permits.
5. Register it: a dependency line and a `PROVIDERS` entry on each side, `src-tauri/Cargo.toml` +
   `src-tauri/src/providers.rs` and `package.json` + `src/providers/index.ts`, then `pnpm install`.

## Other folders

- `design/`: mockups and screenshots per iteration, most of it gitignored.
- `spike/`: the throwaway scripts that proved stream-json plus a permission MCP tool works.

## Tests

```sh
cd src-tauri && cargo test   # the app
cargo test --workspace        # the app and every integration crate, from the repo root
pnpm test                     # the integrations' response mapping on fixture JSON
```

The transcript and vault tests read the vault in `$VAULT` (`VAULT=/path/to/vault cargo test`) and
skip themselves without it.
