# Changelog

Every PR adds a line under **Unreleased**, in the group that fits (Added, Changed, Fixed, Removed). CI fails a PR
that doesn't touch this file; the `skip-changelog` label opts out (docs, CI, refactors nobody notices).

To release: move Unreleased under a new version heading with the date, then set that version in `package.json` and
`src-tauri/Cargo.toml` (`tauri.conf.json` reads it from `package.json`). Versions follow [semver](https://semver.org);
the format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- Typing `/` in the composer lists Claude Code's slash commands and skills for the vault, with their descriptions; arrows pick, Tab or Enter completes, Escape closes. Relay asks Claude Code for the list when it starts (#26)
- A copy button on an answer when you hover it, and on each code block, in conversations and in the right panel (#26)
- The Productive board catches up with the bb plugin: group the columns by task list or by status (dragging a card then changes its status), search the cards, filter them by assignee and fold columns away. A task's panel shows its attachments and those on comments, takes new files (Add files, or drop them on the panel), posts comments and changes the status and assignee in place. Search, the assignee filter and folding work on the Trello and Linear boards too (#28)
- Trello and Linear can take their credentials from Claude Code's MCP config too, like Productive. When Claude Code has them for an integration that is not set up yet, Relay says so and offers to import them; otherwise the import sits under the integration's "…" menu, next to Clear token
- Vault notes named in a conversation open in the right panel: `[[wikilinks]]`, markdown links and `path.md` in code are clickable, and so is a Read/Edit line on a note. Links inside the opened note work too, so you can click through; only notes that exist in the vault become links (#22)
- A macOS notification when a turn ends, a turn stops or something waits for you while Relay is in the background; clicking it opens that conversation (#18)

### Changed
- Quitting Relay no longer cuts a running turn loose: the agent keeps working under a small broker process (about 2 MB), and Relay picks the conversation back up when you reopen it within 15 minutes, so you can keep typing instead of seeing "handled outside the app". Idle agents stop when Relay quits; the next message resumes them (#17)
- Each vault keeps its own Relay settings in `.relay/config.json`: the folder mapping (moved out of the app's settings), the headings it uses for open items and status in its own language, its contexts, the folders to skip and which GitHub repo belongs to which project. Relay creates the file from what it detects the first time it opens a vault, so English, Dutch, French and German vaults all work (#19)
- PRs per project now find their repos: checkouts in the usual code folders are matched to projects by name
- Settings › Projects is one list of all projects; each opens to its name in Relay, its icon on one line (emoji or website in one field, upload, none, guess again) and its GitHub repositories, which you can add or remove
- Project icons live in the vault: `.relay/config.json` (`icons`) says per project whether it is an image in `.relay/icons/`, an emoji, or a website whose favicon Relay fetches. Every project without one gets its favicon right away when Relay first opens the vault, and icons set before move there once. Settings › Projects › Project icons overrides any of them (emoji, website, upload, none, guess again), and **Find icons** lets Claude look up a website for every project without an icon (web search only): the client, else the project's own product, else the tool it is about (plesk.com for a Plesk server, n8n.io for n8n automations), so its favicon follows. Icons are also found via apple-touch-icon, /favicon.png and DuckDuckGo's favicon service when a site's page declares none
- Favicons and the "this conversation is about" suggestion work wherever a vault keeps its project notes, not only under `Projects/` or `Portfolio/`; a project with a short name like o2o gets its site too (only a domain that is exactly its name, o2o.be)

### Fixed
- Productive's "Import from Claude Code" finds the Productive MCP server wherever Claude Code keeps it: for the user, for the vault as a project, or in the vault's `.mcp.json` (it only looked at the first)
- Reminders added in Relay say `Relay` as their source instead of the old name
- Chats without a project are no longer named "Algemeen" in the terminal when the app is in another language

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
