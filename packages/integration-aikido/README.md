# integration-aikido

Aikido Security, read-only. Not a board: it has no webview package, the main window's side is
`src/application/aikido` (the Security panel, `src/ui/features/aikido/AikidoPanel.tsx`) and the settings' side
`src/application/settings/aikido.ts`. A vault project's Aikido code repos are worked out, not linked: they are the
GitHub repos on its card in Settings › Projects (`project_repos`, `owner/name`) that Aikido scans, matched on the repo's
`url` in any shape (https, with or without more after the repo, no scheme, ssh, the GitHub API's; case and a trailing
`.git` or `/` aside; `matchRepos` and `urlSlug` in `src/domain/aikido/rules.ts`). A repo whose URL names no repo, or
that has none, matches on its name, only when no other GitHub repo in Aikido has that name. Only GitHub: a GitLab, Bitbucket or
Azure DevOps repo in Aikido never matches. The project gets the open issue groups of those repos: worst first, a row per
group with its locations and how to fix it, "Fix met Claude" to start a conversation that fixes exactly those
findings, and a red attention mark while a critical or high group is there that the user has not seen yet.
Read when the project's title bar or its Security tab shows, at most every 5 minutes (30 seconds after a failure, and
at once when the tab is opened after one); nothing polls in the background. The matched repos are kept before their
groups are read, so the tab shows even when that fails, with the error and the groups of the repos that did answer.
Save in Settings › Integrations › Aikido says which projects matched ("Matched: Orchard Health (2)"). The
Security tab, its red title bar icon and the project home's Security · Aikido card all read that one store.

## Setup

1. In Aikido › Settings › Integrations › API (REST), create a client with only the scopes `repositories:read` and
   `issues:read`. Copy the client ID and the client secret.
2. In Relay › Settings… › Integrations › Aikido, pick the region of the Aikido account (EU for app.aikido.dev, US, AU,
   ME), paste both, Save (exchanges them for a token and runs `GET /repositories/code`: "Connected, N repos").
3. Nothing per project: a vault project with GitHub repos on its card (Settings › Projects) that Aikido scans gets the
   Security tab by itself.

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

- `/repositories/code` with `page`, `per_page` (≤ 200), `filter_name`: read once per 5 minutes for every project,
  up to 5 pages of 200
- `/open-issue-groups` with `filter_code_repo_id`, `filter_status=open`, `page`, `per_page` (10 to 100)
- `/issues/export` with `format=json`, `filter_status=open`, `filter_issue_group_id`, `filter_code_repo_id`,
  `filter_severities` (critical, high, medium, low), `filter_issue_type=open_source`, `page`, `per_page` (10 to 100):
  the issues of a group or of a repo (file and lines, package installed and patched, CVE) for the fix prompt, one call
  instead of one per issue

Anything else, including ignoring, snoozing or solving an issue and starting a scan, is refused before it leaves the
app, so a client with more scopes than needed still cannot change anything through Relay.

Aikido allows 20 calls a minute per workspace and answers 429 above that: the panel then says so and keeps what it
showed. Its API has no link to an issue in the app, so "Openen in Aikido" opens the region's issues page.

## Agent actions (`relay aikido.…`)

Read-only, all `auto`, listed in `relay help` while Aikido is on and a client is stored (`aikido.status` always, so it
can say why not). They go through the same allowlist and token exchange as the app; the client and the token are never
printed. Each call counts against the 20 calls a minute.

| Action | Arguments | Gives |
|---|---|---|
| `aikido.status` | | `on`, `region`, `client_stored` (yes/no), `token` (`ok` or the error), `repos` (first page of 200) |
| `aikido.repos` | `name?` | code repos: `id`, `name`, `provider`, `url`, `last_scanned_at` (first 200) |
| `aikido.match` | `project?` | the project's linked GitHub repos beside Aikido's GitHub repos with their raw `url` |
| `aikido.groups` | `repo` | open issue groups: `id`, `title`, `severity`, `type`, `time_to_fix_minutes`, `locations` (first 100) |
| `aikido.issues` | `group` or `repo` | open issues: file and lines, package, installed and patched versions, CVE (10 per group, 100 per repo) |

`aikido.match` does not match: the rule lives in `src/domain/aikido/rules.ts` (`matchRepos`) and is the app's only
copy. The action shows both sides raw, so a slug that differs from the URL (case, `.git`, another owner) is visible
at a glance. If a repo is linked but not listed under `aikido_github`, Aikido does not have it (or has it under another
provider).
