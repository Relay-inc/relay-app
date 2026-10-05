# Relay

- Every PR adds a line under **Unreleased** in `CHANGELOG.md` (Added / Changed / Fixed / Removed), written for someone
  using the app, ending with the PR number once it exists. CI checks it; `skip-changelog` is for changes no user notices.
- The app version lives in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads `package.json`). Only
  bump it when cutting a release, see the top of `CHANGELOG.md`: a version bump on main is published as a GitHub
  release by `.github/workflows/release.yml`, so the version needs its own section in `CHANGELOG.md` first.
- A PR that changes what someone sees in the app puts screenshots of it in its description, made with the harness and
  uploaded with `scripts/pr-screenshots.sh`: see `harness/README.md` › Screenshots for a pull request. A new Tauri
  command gets its answer in `harness/mock-backend.ts` in the same PR, or the harness breaks on it.
