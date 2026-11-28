# integration-aikido

Aikido Security, read-only. Not a board: it has no webview package, the main window's side is
`src/application/aikido` (the Security panel, `src/ui/features/aikido/AikidoPanel.tsx`) and the settings' side
`src/application/settings/aikido.ts`. A vault project linked to one or more Aikido code repos (settings.json
`aikido.<vault project>` = `[code_repo_id, …]`) gets the open issue groups of those repos: worst first, a row per
group with its locations and how to fix it, "Fix met Claude" to start a conversation that fixes exactly those
findings, and a red attention mark while a critical or high group is there that the user has not seen yet.
Refreshed when the panel shows, at most every 5 minutes; nothing polls in the background.

## Setup

1. In Aikido › Settings › Integrations › API (REST), create a client with only the scopes `repositories:read` and
   `issues:read`. Copy the client ID and the client secret.
2. In Relay › Settings… › Integrations › Aikido, pick the region of the Aikido account (EU for app.aikido.dev, US, AU,
   ME), paste both, Save (exchanges them for a token and runs `GET /repositories/code`: "Connected, N repos").
3. Per vault project, in Settings › Projects, link its code repos. Repos that match the project's GitHub repos (by
   name) are suggested.

The client ID and secret are in the macOS keychain at `vault-app.aikido`, accounts `client_id` and `client_secret`.
The backend (`src-tauri/src/aikido.rs`) exchanges them at `POST https://app.aikido.dev/api/oauth/token` (Basic auth,
`grant_type=client_credentials`) for a bearer token, keeps that in memory until a minute before `expires_in`, and sends
it as `Authorization: Bearer`. Neither the client nor the token ever reaches a webview, settings.json or a log.

Not confirmed by Aikido's docs: whether the US, AU and ME regions have their own token endpoint. The docs only name
`app.aikido.dev/api/oauth/token` (the OpenAPI spec also says `app.aikido.io`), so that one is tried first and the
region's own host (`app.<region>.aikido.dev/api/oauth/token`) only when it refuses.

## What the backend allows

Only `GET`, without a body, to the region's host (`app.aikido.dev`, `app.us.aikido.dev`, `app.au.aikido.dev`,
`app.me.aikido.dev`) under `/api/public/v1` on:

- `/repositories/code` with `page`, `per_page` (≤ 200), `filter_name`
- `/open-issue-groups` with `filter_code_repo_id`, `filter_status=open`, `page`, `per_page` (10 to 100)
- `/issues/export` with `format=json`, `filter_status=open`, `filter_issue_group_id`, `filter_code_repo_id`,
  `filter_severities` (critical, high, medium, low), `page`, `per_page` (10 to 100): the issues of a group (file and
  lines, package installed and patched, CVE) for the fix prompt, one call instead of one per issue

Anything else, including ignoring, snoozing or solving an issue and starting a scan, is refused before it leaves the
app, so a client with more scopes than needed still cannot change anything through Relay.

Aikido allows 20 calls a minute per workspace and answers 429 above that: the panel then says so and keeps what it
showed. Its API has no link to an issue in the app, so "Openen in Aikido" opens the region's issues page.
