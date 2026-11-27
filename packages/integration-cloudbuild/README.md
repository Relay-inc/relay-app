# integration-cloudbuild

Google Cloud Build, read-only. Not a board: it has no webview package, the main window's side is
`src/application/cloudbuild` and the settings' side `src/application/settings/cloudbuild.ts`. A vault project linked to
a GCP project (settings.json `cloudbuild.<vault project>` = `{ project, location }`, location `global` by default) gets a
button in its title bar: its dot is the worst status of the project's triggers (failed, then running, then passed), its
menu lists each trigger with its last build (branch, commit, when), and a click opens the build's log in the Google
Cloud console. Builds that came from no trigger are grouped as "Manual". Refreshed when the title bar shows and when
the menu opens, at most once a minute. One call: the last 50 builds, so a trigger that has not run among those is not listed.

## Setup

1. Install the Google Cloud CLI and run `gcloud auth login`.
2. The account needs `cloudbuild.builds.list` on the project (role Cloud Build Viewer).
3. In Vault › Settings… › Integrations › Cloud Build, Connect, then Check (lists the projects the login can see).
4. Per vault project, in Settings › Projects, pick its GCP project and location.

No token is stored. The backend runs `gcloud auth print-access-token` (gcloud found on the login-shell PATH, as gh is),
keeps the token in memory for 45 minutes (a re-check in the settings drops it), and sends it to curl on stdin as
`Authorization: Bearer`. It never reaches the webview.

## What the backend allows

Only `GET`, without a body, on:

- `cloudresourcemanager.googleapis.com/v1/projects` (the project picker), with at most `pageSize` and `pageToken`
- `cloudbuild.googleapis.com/v1/projects/<project>/locations/<location>/builds`, with at most `pageSize`

`<project>` is a GCP project id, `<location>` is `global` or a region like `europe-west1`. Anything else, including
starting, retrying or cancelling a build, is refused before it leaves the app, so an account with more rights than
needed still cannot change anything through Relay.
