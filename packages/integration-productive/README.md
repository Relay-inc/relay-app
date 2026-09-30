# integration-productive

The Productive board: a project is a Productive project (only yours with a user ID), a board is a board
(`folder` in the API), columns are its task lists, cards its open tasks. A click opens the task in the right
panel (fields, description, comments and changes), fetched in the background after the board loads.

## Setup

1. In Productive, Settings › API integrations: create a token.
2. In Vault › Settings… › Integrations › Productive, paste it and fill in the organisation ID (optionally your
   user ID), or use "Import from Claude Code", which reads the Productive MCP server's env in `~/.claude.json`.
3. Save and test, then pick the board from the board's header.

The token is in the macOS keychain at `vault-app.productive`, account `token`. Org and user are in
settings.json, `integrations.productive.{org, user}` (digits only).

## What the backend allows

`https://api.productive.io/api/v2`, with `X-Auth-Token` and `X-Organization-Id`: GET on any path, and PATCH
only on one task (`/tasks/<digits>`, with a body): moving a card to another task list. Nothing else.

## Files

- `src/index.ts`: the `BoardProvider` (with its glyph, Productive's favicon as vector).
- `src/locales.ts`: its strings in en, nl, fr and de.
- `src/lib.rs`: the backend `Provider` (allowlist, headers, errors) and `import` for `~/.claude.json`, with tests (`cargo test -p integration-productive`).
