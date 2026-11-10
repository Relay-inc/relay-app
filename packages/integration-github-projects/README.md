# integration-github-projects

The GitHub Projects (v2) board: a project is the user or one of their organizations (id = login), a board one of its
open projects. Columns are the options of the project's Status field (the first single-select field when there is no
Status), with No status first as on GitHub's own board. Cards are the items: issues, pull requests and draft items
(number, title, first assignee, labels), archived ones left out, 100 per page, at most 10 pages. A card's kind (to do,
doing, done) is read from its option's name. Moving a card sets the item's Status (or clears it for No status), New
task adds a draft item in that lane. A click opens the issue or pull request on GitHub, a draft opens the project:
there is no ticket window yet.

## Setup

1. In Vault › Settings… › Integrations › GitHub Projects, click Create token: GitHub opens a new classic token with
   `project`, `repo` and `read:org` ticked. Or, signed in with gh: `gh auth refresh -s project`, then `gh auth token`.
2. Paste it, Save and test ("Connected as …, n projects").
3. Pick a project per vault project under "Boards per vault project".

The token is in the macOS keychain at `vault-app.github-projects`, account `token`, and is sent as
`Authorization: Bearer`. A GitHub MCP server in Claude Code's config (`GITHUB_PERSONAL_ACCESS_TOKEN`) can hand it over.
Fine-grained tokens only reach organization projects.

## What the backend allows

Only `POST https://api.github.com/graphql` with a body of `query` and `variables`. Queries are read-only. Three
mutations are matched exactly (whitespace collapsed) with validated ids: setting an item's single-select value,
clearing it, and adding a draft item. GraphQL errors, also those answered with 200, read as "GitHub: <message>"; a
refused token, a missing `project` scope and the rate limit as a plain message. An organization behind SAML single
sign-on answers FORBIDDEN next to the others' data: that still counts as an answer, its projects are just not listed.

## Files

- `src/index.ts`: the `BoardProvider` (with its glyph). `src/map.ts`: the queries and the response mapping, pure.
- `src/locales.ts`: its strings in en, nl, fr and de.
- `src/lib.rs`: the backend `Provider`, with tests (`cargo test -p integration-github-projects`).
- `tests/`: the mapping on fixture JSON (`pnpm test`).

API reference: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
