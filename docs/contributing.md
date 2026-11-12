# Contributing to Relay

Running Relay from source, the architecture and the tests: [development.md](development.md).

## Pull requests

1. Branch off `main`. Several sessions often share one checkout, so a separate `git worktree` per branch saves you from
   committing on someone else's branch.
2. Fill in the PR template (`.github/pull_request_template.md`): what changes, and screenshots when the interface
   changed.
3. Add a line under **Unreleased** in [`CHANGELOG.md`](../CHANGELOG.md), in the group that fits (Added, Changed,
   Fixed, Removed). Write it for someone using the app and end it with the PR number once it exists. CI fails a PR
   that doesn't touch the changelog; the `skip-changelog` label is for changes nobody using the app notices (docs, CI,
   refactors).
4. Run the checks CI runs before you push:

   ```sh
   pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm check:compiler && pnpm format:check
   cargo test --workspace   # not in CI, run it when you touched Rust
   ```

## Test data

This repository is public. Fixtures, mocks, tests, screenshots and examples use fictional data only: no real clients,
companies, colleagues, tickets or e-mail addresses (use `example.com`). The harness cast is Northwind, Bluebird Studio,
Sofie Claes, Tom Willems, Lena Maes and Jonas Peeters.

## Screenshots

A PR that changes what someone sees shows it in its description. The screenshots come from the harness (the real
webview against a mocked backend), not from your own running Relay:

```sh
node harness/screens.mjs --label pr123 --browser webkit --only <view>,<view>
scripts/pr-screenshots.sh 123 harness/screens/pr123/*.png
```

The script uploads them to the `pr-assets` branch and prints an `<img>` line per file for the description. Adding a
view for a new state: [harness/README.md](../harness/README.md) › Screenshots for a pull request.

A new Tauri command gets its answer in `harness/mock-backend.ts` in the same PR, or the harness breaks on it.

## Versions and releases

The version lives in `package.json` and the root `Cargo.toml`, and the image tag in `deploy/relay-server/compose.yml`
follows it. Only bump it when cutting a release: move Unreleased
under a new version heading in `CHANGELOG.md`, set the version, merge, then run `scripts/release.sh` on a Mac, on an
up-to-date `main`. The top of `CHANGELOG.md` has the details. Run it from your own terminal: its dmg step needs
Finder permission that an agent session doesn't have. It adds the Windows installer when `RELAY_WINDOWS_SETUP` names one, built on a Windows
machine with `scripts/release-windows.ps1` ([development.md › Releasing for Windows](development.md#releasing-for-windows)).

## Adding things

- An agent provider (another coding-agent CLI): [development.md › Adding an agent provider](development.md#adding-an-agent-provider)
- A board integration (another tracker): [development.md › Adding an integration](development.md#adding-an-integration)
- A plugin: [development.md › Plugins (MCP Apps)](development.md#plugins-mcp-apps) and the example in
  [`packages/plugin-example`](../packages/plugin-example)
