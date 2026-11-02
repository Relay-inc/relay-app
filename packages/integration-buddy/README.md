# integration-buddy

Buddy pipelines, read-only. Not a board: it has no webview package, the main window's side is `src/application/buddy`
and the settings' side `src/application/settings/buddy.ts`. A vault project linked to a Buddy project (settings.json
`buddy.<vault project>` = `{ workspace, project }`) gets a button in its title bar: its dot is the worst status of the
project's enabled pipelines (failed, then running, then passed), its menu lists each pipeline with its last run, and a
click opens the pipeline in Buddy. Refreshed when the title bar shows and when the menu opens, at most once a minute.

## Setup

1. In Buddy, create a personal access token with only `WORKSPACE_READ`, `PROJECT_READ` and `PIPELINE_READ`.
2. In Vault › Settings… › Integrations › Buddy, pick the region (US for app.buddy.works, EU, Asia), paste the token,
   Save (runs `GET /workspaces`: "Connected, workspaces: …").
3. Per vault project, in Settings › Projects, pick its Buddy project.

The token is in the macOS keychain at `vault-app.buddy`, account `token`, and is sent as `Authorization: Bearer`.

## What the backend allows

Only `GET`, without a body, to the region's API host (`api.buddy.works`, `api.eu.buddy.works`, `api.asia.buddy.works`;
self-hosted Buddy is not supported) on:

- `/workspaces`
- `/workspaces/<workspace>/projects`
- `/workspaces/<workspace>/projects/<project>/pipelines`
- `/workspaces/<workspace>/projects/<project>/pipelines/<id>/executions`

with at most `page` and `per_page` as numbers. Anything else, including running a pipeline, is refused before it
leaves the app, so a token with more scopes than needed still cannot change anything through Relay.
