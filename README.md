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
| `src/productive.ts` | Productive board in the sidebar. Moving a card writes to Productive right away. |
| `src-tauri/src/vault.rs`, `src/vault-setup.ts` | The per-vault mapping: detection, found / missing, the first-launch screen and the mapping rows in Settings. |
| `src/settings-window.ts` | Settings window: vault folder, per-project icon and label, Productive integration, language. |
| `src/i18n.ts`, `src/locales/` | UI strings in English, Dutch, French and German. `t(key)` in the webview, `tr()` in `lib.rs` for the menu bar and errors. The language follows macOS unless set in the settings. |

State lives in `~/Library/Application Support/be.laurentmeersman.vault/`: `settings.json`,
`sessions.json` (conversation to session id) and `pending/`. The Productive token sits
in the macOS keychain (`vault-app.productive`) and never reaches the webview.

## Other folders

- `design/`: mockups and screenshots per iteration, most of it gitignored.
- `spike/`: the throwaway scripts that proved stream-json plus a permission MCP tool works.

## Tests

```sh
cd src-tauri && cargo test
```

The transcript and vault tests read the vault in `$VAULT` (`VAULT=/path/to/vault cargo test`) and
skip themselves without it.
