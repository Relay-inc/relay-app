# integration-linear

The Linear board: a project is a team, a board the whole team ("All issues", board id = team id) or one of its
Linear projects. Columns are the team's workflow states by type (triage, backlog, unstarted, started,
completed, canceled) then position, completed and canceled only with `integrations.linear.done`. Cards are
the issues (identifier, title, assignee, priority, due date), 100 per page, at most 10 pages. A click opens
the issue's `url`.

## Setup

1. In Linear, Settings › Account › Security & access: create a personal API key.
2. In Vault › Settings… › Integrations › Linear, paste it, Save and test (runs the `viewer` query: "Connected as …").
3. Pick a team, or one of its projects, per vault project under "Boards per vault project".

The key is in the macOS keychain at `vault-app.linear`, account `token`, and is sent as `Authorization`.

## What the backend allows

Only `POST https://api.linear.app/graphql` with a body of `query` and `variables`. Any query goes; the one
mutation allowed is `issueUpdate(id, input: { stateId })` (`MOVE` in `src/map.ts` and `src/lib.rs`, compared
with whitespace collapsed) with exactly the two ids as variables. GraphQL errors, also those answered with 200,
read as "Linear: <message>"; an authentication error and the rate limit (429 or `RATELIMITED`) as a plain
message. Nothing retries by itself.

## Files

- `src/index.ts`: the `BoardProvider` (with its glyph). `src/map.ts`: the queries and the response mapping, pure.
- `src/locales.ts`: its strings in en, nl, fr and de.
- `src/lib.rs`: the backend `Provider`, with tests (`cargo test -p integration-linear`).
- `tests/`: the mapping on fixture JSON (`pnpm test`).
