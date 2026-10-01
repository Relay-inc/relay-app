# Changelog

Every PR adds a line under **Unreleased**, in the group that fits (Added, Changed, Fixed, Removed). CI fails a PR
that doesn't touch this file; the `skip-changelog` label opts out (docs, CI, refactors nobody notices).

To release: move Unreleased under a new version heading with the date, then set that version in `package.json` and
`src-tauri/Cargo.toml` (`tauri.conf.json` reads it from `package.json`). Versions follow [semver](https://semver.org);
the format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- A macOS notification when a turn ends, a turn stops or something waits for you while Relay is in the background; clicking it opens that conversation (#18)

### Changed
- Quitting Relay no longer cuts a running turn loose: the agent keeps working under a small broker process (about 2 MB), and Relay picks the conversation back up when you reopen it within 15 minutes, so you can keep typing instead of seeing "handled outside the app". Idle agents stop when Relay quits; the next message resumes them (#17)

## [0.0.1] - 2026-10-01

First version with a number: everything merged up to and including #15.

### Added
- Relay: the brand, app name, icon and bundle identifier `be.laurentmeersman.relay` (#13)
- Agent providers behind one contract: Claude Code, Codex and OpenCode (#7)
- Board providers behind one contract: Productive, Trello and Linear (#3)
- Native Gmail in the app, with mail tools for Claude over the stream-json pipe; replies only become drafts (#10, #12)
- Native reminders with their own engine, a new-reminder form and a menu bar icon; the menu bar title turns red while something is overdue (#8, #11)
- First-launch vault picker and a per-vault path mapping (#2)
- Usage view with plan limits and token usage (#4)
- Mail view, reminder date picker, turn status and daily project favicons (#5)
- Window state is remembered, middle-click closes a chat, a Tomorrow reminder group (#6)
- The UI in English, Dutch, French and German, following the macOS language by default (#1)

### Changed
- Settings after bb: pages in a sidebar, sections in cards, agents and integrations as lists you add to (#15)
- Usage and Settings are compact icon buttons in the sidebar footer (#9)

### Fixed
- Claude is found on the login-shell PATH, not only in `~/.local/bin` (#14)

[Unreleased]: https://github.com/LaurentMe/vault-app/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/LaurentMe/vault-app/releases/tag/v0.0.1
