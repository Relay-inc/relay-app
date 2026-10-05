# integration-linear

The Linear board: a project is a team, a board the whole team ("All issues", board id = team id) or one of its
Linear projects. Columns are the team's workflow states by type (triage, backlog, unstarted, started,
completed, canceled) then position, completed and canceled only with `integrations.linear.done`. Cards are
the issues (identifier, title, assignee, priority, due date), 100 per page, at most 10 pages. A click opens Relay’s ticket window with its Markdown description, paginated comments and history, attachments, status/assignee pickers and a ticket-linked conversation. The browser link still opens the issue’s `url`.

## Setup

1. In Linear, Settings › Account › Security & access: create a personal API key.
2. In Vault › Settings… › Integrations › Linear, paste it, Save and test (runs the `viewer` query: "Connected as …").
3. Pick a team, or one of its projects, per vault project under "Boards per vault project".

The key is in the macOS keychain at `vault-app.linear`, account `token`, and is sent as `Authorization`.

## What the backend allows

Only `POST https://api.linear.app/graphql` with a body of `query` and `variables`. Queries are read-only. Ticket mutations are matched exactly (whitespace collapsed) with validated variables: moving an issue, assigning/unassigning it, commenting, requesting a file upload and linking the uploaded file. No arbitrary issue edits or deletes are allowed. GraphQL errors, also those answered with 200,
read as "Linear: <message>"; an authentication error and the rate limit (429 or `RATELIMITED`) as a plain
message. Nothing retries by itself.

## Files

- `src/index.ts`: the `BoardProvider` (with its glyph). `src/map.ts`: the queries and the response mapping, pure.
- `src/locales.ts`: its strings in en, nl, fr and de.
- `src/lib.rs`: the backend `Provider`, with tests (`cargo test -p integration-linear`).
- `tests/`: the mapping on fixture JSON (`pnpm test`).

Files use Linear’s `fileUpload` mutation, a backend PUT of the raw bytes with the returned signed headers, and `attachmentCreate`. The upload transport permits only HTTPS on `uploads.linear.app` and `storage.googleapis.com`, does not follow redirects, and never sends the API key to storage. As with the other integrations, the host limits files to 50 MB. Attachment links open in the browser; private files may require authentication.

API references:
- https://linear.app/developers/how-to-upload-a-file-to-linear
- https://linear.app/developers/attachments
- https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
