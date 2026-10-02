# integration-trello

The Trello board: a project is a workspace (boards outside your workspaces sit under "Personal and shared
boards"), columns are the board's open lists, cards its open cards, optionally only those you are a member of
(`integrations.trello.mine`). A move sets `idList` with `pos: "bottom"`, a click opens Relay’s ticket window with description, paginated activity, comments, list/member pickers, files and a ticket conversation. Members are added/removed individually so other assignments survive. The browser link still opens the card’s `shortUrl`.

## Setup

1. Create a Power-Up at trello.com/power-ups/admin and copy its API key.
2. Use the Token link next to it to allow access and copy the token.
3. In Vault › Settings… › Integrations › Trello, paste both, Save and test ("Connected as …").
4. Pick a board per vault project under "Boards per vault project".

Key and token are in the macOS keychain at `vault-app.trello`, accounts `key` and `token`, and travel in the
`Authorization: OAuth …` header, never in the URL.

## What the backend allows

`https://api.trello.com/1`: GET under `/members/me`, `/boards/` and `/organizations/`, and PUT only on one
card (`/cards/<24 hex>`) with a body of nothing but `idList` (a Trello id) and `pos`. 401/403 and 429 read as
a plain message; nothing retries by itself. Single-card detail and action GETs, comment POSTs and individual member POST/DELETEs are also allowed. Attachments are sent as multipart files only to the exact card attachment endpoint, with keychain authentication added by the backend. Redirects are not followed.

## Files

- `src/index.ts`: the `BoardProvider` (with its glyph). `src/map.ts`: the response mapping, pure.
- `src/locales.ts`: its strings in en, nl, fr and de.
- `src/lib.rs`: the backend `Provider`, with tests (`cargo test -p integration-trello`).
- `tests/`: the mapping on fixture JSON (`pnpm test`).

API reference: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
