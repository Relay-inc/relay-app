# Changelog

Every PR adds a line under **Unreleased**, in the group that fits (Added, Changed, Fixed, Removed). CI fails a PR
that doesn't touch this file; the `skip-changelog` label opts out (docs, CI, refactors nobody notices).

To release: move Unreleased under a new version heading with the date, then set that version in `package.json` and
the root `Cargo.toml` (`[workspace.package]`, the app and relay-server read it there, `tauri.conf.json` reads it from
`package.json`). Once that is on main, run `scripts/release.sh` on a Mac, on main: it builds Relay and publishes it as
GitHub release `v<version>` with this version's section as its notes, then pushes relay-server's image and attaches
its Linux binaries (`scripts/push-server-image.sh`). Nothing of a release runs in GitHub Actions, only the checks of
a PR. Versions follow
[semver](https://semver.org); the format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

## [0.0.35] - 2026-10-26

### Added

- **A shared vault syncs with the team**: switch on Sync under Settings › General › Shared vaults for a vault that is a clone of the team's repository. Every 5 minutes Relay commits what changed, puts it on top of what the team pushed and pushes; the sidebar reads the vaults again when the team's changes come in. A conflict stops the round, keeps your change and names the files under the vault in Settings
- **Shared vaults**: Settings › General › Shared vaults adds other vaults, a team vault in git for example. Their projects show in the sidebar next to your own, one with a name your vault has too as "Name (folder)". A conversation stays in the vault of its project: Claude Code may not read or edit the other vaults (also from the terminal), a fork only takes a conversation of the same vault, and in a shared vault your own MCP servers and claude.ai connectors are off and the conversation stays on this Mac. Scratch notes, repos, icon and Design link live in the project's vault. A vault inside another is refused. Codex and OpenCode run in the main vault only. Links to notes in a shared vault don't open in the side panel yet
- **Files drawer**: the folder button next to Git shows the project's folders as a tree, as PhpStorm shows a project: its code folders from the vault's index and its folder in the vault. A folder opens on a click, files git sees changed show in its colour and ignored ones grey. A click on a file opens it: a vault note in the right drawer, a document or picture in its own app, code and text in a window over the app. A right-click shows it in Finder (#267)

### Changed

- **Diffs side by side in the Git drawer**: a file's diff, in the drawer and in a commit of the log, shows the old file on the left and the new one on the right, like JetBrains. A removed run of lines sits next to the added run that replaces it, long lines wrap so both sides stay level. The button in the diff's header switches back to one column. Line comments for the agent work in both views (#270)
- **Git drawer replaces Changes**: a project conversation can show a Git drawer with every repo of the project on this Mac and the worktrees the conversation made. Per repo you see the branch, tick files to stage them, discard a file's changes (after a confirmation), fold a repo to its header, and write one commit message under all repos (or let the model suggest one): Commit or Commit & Push makes a commit with it in every repo with ticked files, as in JetBrains. Under the commit box a log per repo draws the branch as a graph, like Sourcetree: a row per commit with its subject, branches and tags, author and age. The colour squares pick the repo, All branches shows every branch, its top edge drags it higher. A click on a commit opens it over the app: its message, its files and each file's diff against the commit before. The arrow next to a repo's branch pulls it, fast-forward only: when the branch went its own way, git's message shows under the repo. Commit is blocked while a conversation of the project is working in that repo. Git's own error shows in the drawer when a push or hook fails. Off by default: switch it on in Settings › General › Git in project conversations (#266)

### Fixed

- **A vault note fills the drawer**: the note stayed 520 px wide in a wider drawer, and a table's narrow columns broke their words per letter ("Poi nts"). The note now takes the drawer's width and a column is never narrower than its longest word, also in a conversation's tables (#271)
- **Updates without the GitHub CLI**: Relay finds and installs its updates without `gh` or a GitHub login, now that the repo is public. Settings › Updates said "gh not found" instead (#265)

## [0.0.34] - 2026-10-26

### Added

- **The end of a turn says what the turn did**: next to its duration, the line under the answer counts the file edits, failed tools and agents of that turn, and what it cost when the agent reports it (Claude Code, OpenCode, pi). Claude Code reports its cost over the whole process, so Relay now takes the difference per turn (#260)
- **Subagents show their context**: an agent's row, its line in the Agents column and its page show the context of its latest request ("42k context"), and "cut off" in red when its answer stopped at the output limit (Claude Code) (#260)
- **Find in a conversation**: ⌘F (or ⌃F) opens a find bar above the open conversation. Every match is marked, ↵ and ⇧↵ walk them with a count like "3 of 12", Esc closes it. It searches what the conversation shows, so the text inside a folded step is left out until you open it. The keys are in Settings › Shortcuts (#261)

### Changed

- **The context meter stands out**: the percentage next to the model pick gets a ring that fills up. It turns orange from 70% and red from 90%, where it was grey until 90% (#262)

### Fixed

- **A conversation's title is in the language you wrote in**: the generated title came out in Dutch for English messages too, because the prompt asking for it was written in Dutch. The prompt is English now and names the rule (#263)
- **The context meter counts against the right window after a restart**: a conversation on a 1M model, read again from its transcript, counted against 200k until its next turn ended, so 300k showed as 100% in red. The conversation now keeps the window its last turn reported, and without one, more than 200k counts as a 1M window (#262)

## [0.0.33] - 2026-10-24

### Fixed

- **The terminal button shows a conversation's open terminal**: clicking it again on a conversation that already runs in the project's terminal drawer shows that tab, instead of resuming the conversation in a new one. Once that shell has exited, it starts a new one as before (#253)
- **An arrow key at the edge of a field no longer types a character**: → at the end of the composer (and ← at the start) left an invisible control character (0x1d, the classic Mac arrow code) in the text. The key is unhandled by the page when the caret cannot move, and the webview typed it in. Relay now swallows those keys (#258)

### Added

- **Shortcuts in Settings**: a Shortcuts page lists every key Relay takes (anywhere, in a conversation, on Today, in Mail, dictation) and lets you change each one: click it and press the new key, the arrow puts it back. A key that would type in a field, that macOS or the Edit menu has, or that another command already has is refused with the reason. Tooltips and the menu bar follow (#256)
- **More than one Relay window**: Cmd-N (Window › New Window) opens another window with all of Relay, starting on Today. Both keep the same conversations, folders and Today up to date, and closing a window leaves its conversations running. The menu, a banner's click and dictation go to the window you used last, and banners come once (#257)
- **Cmd-Shift-T reopens the conversation closed last**, like a browser tab (#257)

### Changed

- **Cmd-T starts a conversation in this project**, the way a browser tab opens next to the one you're in. A general conversation is Cmd-Option-T. Cmd-N opens a new window now (#257)

### Removed

- **⌘1 to ⌘8 in Settings**: the sidebar showed them next to each page, but they did nothing (#256)

## [0.0.32] - 2026-10-22

### Fixed

- **Agents see a ticket's screenshots**: Start conversation on a ticket attaches its pictures to the new conversation, and a board pipeline's worker gets them as files on this Mac (their paths in its brief). Before, the agent only got the tracker's links, which it cannot open. Productive's originals load with the login of Relay's viewer window: open one picture there and sign in once (#251)
- **A ticket's picture opens in the viewer again**: the viewer window stayed white, because the guard for links in mails also refused the picture and the tracker's login in that window (#250)
- **Signing in with Google in the Design drawer no longer crashes Relay**: the Google popup opened as a Relay window, which aborted the app. It now opens as a plain window that closes itself once you're signed in (#249)

### Added

- **Continue a Mac conversation on your phone**: type `/share-phone` in a conversation that runs on this Mac and your phone lists it, reads it and writes to it through the machine it is paired with, while it keeps running here (Relay must be open). `/unshare-phone` stops it, the composer marks a shared one. The phone signs everything it sends and this Mac checks it, so the machine passes it on but cannot add anything of its own. A phone added before this version: Add phone again (#252)
- **Folders in the sidebar**: right-click a project (or General) › New folder groups its conversations. Drag a conversation onto a folder to put it there, the folder's + starts a new conversation in it, a click folds it to a count. Deleting a folder keeps its conversations under the project (#254)
- **Drag a conversation to another project**: drop it on another project, on a folder there, among that project's conversations, or on General. It moves there like with Change project…, and its next message tells the agent. Terminal sessions move along too, outside any folder (#254)
- **License**: Relay is source-available under the Functional Source License (FSL-1.1-ALv2). Use, change and share it for anything but a competing commercial product, every release becomes Apache-2.0 two years after it ships (`LICENSE.md`) (#247)

## [0.0.31] - 2026-10-20

### Added

- **Back up the vault to git**: Settings › General › Git backup takes a remote (ssh, https or a path on a disk); every 5 to 60 minutes Relay commits the vault and pushes it there, with your own git login. It only pushes, never pulls, and refuses a repository anyone can read. The last sync and any error show under it (#245)
- **See the pictures Claude looks at**: a Read of an image or a screenshot from an MCP tool shows it on hover over its step, a click opens it large in the zoom, like a pasted image. Also in older conversations, from the transcript (#244)

## [0.0.30] - 2026-10-19

### Added

- **A Design tool next to Terminal and Notes**: paste a project's Claude Design (claude.ai artifact) link and the canvas shows live in the right drawer, next to the conversation; you sign in to claude.ai once in it (#241)
- **Claude Code can work on the Design canvas**: a Claude Code conversation gets `design_read` (the canvas files), `design_snapshot` (a picture of the drawer), `design_prompt` (sends Claude Design a message and returns its answer) and `design_create` (starts a design for a project that has none, and saves its link). The Design drawer opens by itself. `design_prompt` and `design_create` act on your claude.ai account and run without asking; set `{"design": {"*": "ask"}}` under `actions` in the vault's `.relay/config.json` to get a card first (#242)

### Fixed

- **The orchestrator's empty state shows again after you close every worker**: the middle showed only the bare "The orchestrator. Give it a task…" line while the workers column was already empty, because closed workers still counted (#239)
- **A waiting message's time no longer sits on its bubble**: a message sent while the agent works showed its time half over the bubble; it now sits under it like on any other message, with "Waiting until … reads it" below (#240)

## [0.0.29] - 2026-10-16

### Added

- **OpenCode conversations show their subagents**: the agents column lists the agents an OpenCode conversation started with its task tool, with their last step, and opens each one's messages. An agent counts as done once it ends its turn or has been quiet for 15 minutes (#235)

### Changed

- **A vault note in the side panel reads as a document**: one bar with where it lives, copy path, open and close; the note's title and description on top; its properties folded into one line you can open; inline code without boxes; and a list of the notes it links to (#238)
- **The model pick can be searched**: with more than 10 models (OpenCode and Pi list hundreds through OpenRouter) the composer's model menu opens on a filter field. Type part of the name and press Enter to pick the first match. Model and effort are now the same menu as the agent pick instead of a native select (#234)
- **A vault note in the drawer reads like a document**: its frontmatter is a table of properties (empty ones left out, links clickable), headings step down with a rule under each section, tables get lines, task lists lose their bullets, and an Obsidian callout (`> [!note] Title`) is a tinted box, also in an answer (#233)
- **Leaving plan mode shows the plan**: the card puts Claude's plan as formatted markdown on the left and Allow and Deny on the right, instead of the plan as raw JSON (#233)
- **Stuck workers show up**: once a minute Relay checks the orchestrator's running workers. One that waits more than 10 minutes on a permission card, or whose turn runs 20 minutes without output, shows "Looks stuck" in the workers column and the reason on its page, and the coordinator hears about it once so it can tell you or stop it. The mark goes as soon as the worker moves again (#225)
- **The coordinator finds its way back after a compaction**: `workers` now gives each worker's brief (its first 400 characters), your answer to it and whether it looks stuck, and lists the newest 30, and the coordinator is told to call it after its conversation was compacted. The orchestrator selftest (`scripts/orch-selftest.sh`) now also checks that workers call `step`, that a worker needing a decision reports blocked with options, and that none is left marked stuck (#225)

### Fixed

- **Conversations no longer show twice**: Claude Code (2.1.299 at least) lists Relay's own conversations among its sessions, so a new or resumed conversation also showed as a terminal session under General until Relay knew its session id. Relay now recognises its own processes and leaves them out of the terminal sessions (#228)
- **A code block's copy button copies every time**: it showed its tick but sometimes left the clipboard as it was, because the webview's clipboard was refused now and then. The app now puts the text on the clipboard itself, for every copy button (#236)

## [0.0.28] - 2026-10-15

### Changed

- **The terminal button resumes a conversation inside Relay**: it opens in a tab of the project's terminal drawer on the right instead of iTerm or Terminal, and the shell stays after Claude quits. Option-click still opens the external terminal, and so does a conversation without a project (#230)

### Fixed

- **Switching between light and dark** happens in one frame: the sidebar, the page and the text change together instead of one after the other, and the sidebar keeps its frosted glass during the switch (#231)
- **Project icons load again**: since the React frontend no favicon was stored, so a website typed as a project's icon kept the default folder and a new vault got no icons at all. The favicon was read with `fetch()` on a data url, which the app's content security policy blocks, and it is decoded directly now. A website set as the icon also stays: its favicon is stored beside it instead of replacing it, and an icon changed while a favicon run is busy is left alone (#229)

## [0.0.27] - 2026-10-15

### Added

- **Times in a conversation**: each message you send shows when you sent it under it (the day too when it was not today), the line that ends a turn shows when it ended next to how long it took, and while a turn runs the working line counts up how long it has been going (#224)

### Fixed

- **A downloaded Relay opens again**: the DMG's app was only signed by the linker, so macOS called it damaged after a download, with no way past it short of `xattr`. The app is now signed (ad-hoc) as a whole: macOS still refuses it the first time because Apple has not notarized it, and System Settings › Privacy & Security › Open Anyway opens it. The release script checks the signature before it publishes (#226)

## [0.0.26] - 2026-10-14

### Added

- **A skill for the board pipeline**: Settings › Projects › pipeline › Skill names a Claude Code skill (for example `ticket-flow:develop` from Antenna's tools) that the agent follows for every ticket. Relay still pushes, opens the PR and moves and comments on the ticket; where the skill would ask a person or post on the ticket, the agent reports it and Relay puts it on the ticket. With a skill set, the skill judges whether a ticket is clear and whether it needs a plan approved (so Relay's pre-flight and Plan first drop out), and with Relay's review on, the skill skips its own review: one review per diff. Relay's checks and review stay the gate before the PR. Empty keeps Relay's own flow (#218)
- **Follow Claude Code's agents**: when Claude Code starts agents in a conversation, an Agents button in its title bar opens their column next to it (crab, what it was asked, the step it is on, how long), running ones first. An agent opens as its own page with the whole transcript (its brief, the tools it ran, what it wrote), followed live while it runs; Esc goes back to the conversation. A click on an agent above the composer opens the same page, instead of its last three messages (#210)
- **Orchestrator redesign**: the workers list is a column next to the Orchestrator, with its conversation first, then the latest run's workers and the earlier ones; a dot marks the ones waiting on you. A worker opens as a page beside the column: its state, step, question, report, the files it changed (+/− per file, read from git) and flags, with the composer talking to that worker and Esc going back. Reports in the conversation show as worker cards. A worker's question comes with buttons for the answers it offers (and a field for your own); answering on the card or the page sends it to the orchestrator and clears both. A worker that ended without a report offers Ask for the report and Restart. The title bar counts what runs, waits on you and is done; the composer drops the agent, model and effort picks here; an empty Orchestrator explains itself with three tasks to start from (#203)

### Changed

- **Prompts follow Anthropic's guidance**: text from third parties (mail, tickets, diffs, invites, the agent's own claims, a first review) now goes into the prompts inside its own tag (`<mail from=...>`, `<ticket>`, `<diff>`, `<agent_claims>`, `<meeting>`, `<review agent=...>`), with a closing tag inside it made harmless, and every prompt says so with the same sentence instead of its own warning. The time booking fetches its sources in parallel, the orchestrator is told to dispatch independent workers in one turn, the worker's step count matches the `step` tool (3-8), the mail-to-ticket prompt says one task without subtasks, and the vault capture uses today's date (#220)
- **Prompts in markdown**: every prompt Relay sends to a model (mail, meetings, pull request reviews, time booking, the orchestrator and the board pipeline, the vault capture, the title) is now a file in `prompts/` instead of a string in the code, so it can be read and edited in one place. The text sent does not change (#212)

### Fixed

- **Long reviews no longer drop their end unseen**: a pull request review sent up to 60,000 characters to a provider that takes 20,000, so later files were cut while the review still counted them as read; the text is now sized to what the provider takes (one `WRITE_MAX` in agent-core). The orchestrator's fallback review (a provider that cannot open the worktree) now puts the agent's claims, including the earlier blocking findings, before the diff and cuts the diff to what is left, so a big diff no longer cuts the claims (#221)

## [0.0.25] - 2026-10-14

### Added

- **GitHub on a work machine**: Settings › Machines connects a machine to GitHub with a code you type on github.com, and lists its repos with what is not pushed, Push, and To Mac (the work lands on `relay/<machine>` in your checkout here, nothing is checked out). A conversation on a machine about a project with a repo gets that repo there, cloned at its first message, and the composer shows which one. Moving it back to this Mac with work not pushed asks first: push it to `relay/<machine>` and move, or move anyway (#217)

### Changed

- **Reminders in the menu bar**: each reminder shows its title with the project underneath and the project's icon (a folder when it has none), the date sits on the right. Later shows the next three, the rest is under More, so the menu stays short (#208)
- **Reminder actions run without a card**: `relay reminders.add`, `done` and `push` default to Runs, like a mail draft. The reminders are the vault's own file, every change is in its history. A choice in Settings › General › Agent access still wins (#216)

### Fixed

- **Conversation titles**: the generated title no longer turns into Haiku's answer to the first message ("I can't search online, so..."). The message now goes to Haiku as quoted text to title, not as a question to answer
- **Project index of an own vault**: Relay no longer empties `work-state.md` at start in a vault with its own `build-index.py` (other card fields than the starter's `last`). Such a vault now runs its own script at start, a starter vault keeps getting the app's copy (#215)
- **Conversation titles**: the generated title no longer turns into Haiku's answer to the first message ("I can't search online, so..."). The message now goes to Haiku as quoted text to title, not as a question to answer (#207)

## [0.0.24] - 2026-10-13

### Added

- **Crabs for the orchestrator's workers**: each worker in the list next to the Orchestrator is a pixel crab dressed for its model (astronaut for Fable, detective for Opus, chef for Sonnet, racer for Haiku, a hard hat for a board pipeline's worker), walking while it works, and a name of its own (Pinchy, Barnacle, ...) that stays with it. A finished one carries its state mark. Settings › General › Crabs for the orchestrator's workers switches them off; reduced motion keeps them still (#202)
- **Worker progress**: workers get a `step` tool and report their plan's steps as they go; the workers list shows a bar with "2/5" and the step they are on, and the coordinator sees it in `workers` (#202)

## [0.0.23] - 2026-10-12

### Added

- **Arrows in a long conversation**: scrolled up from the end, an arrow above the composer takes you down to the latest and follows the stream again, with a dot when output came in while you read back. A screen away from the top, an arrow beside the messages takes you back to the first one (#183)

### Fixed

- **Orchestrator**: a worker whose conversation you closed no longer stays in the workers list next to the Orchestrator; reopening the conversation brings it back (#201)

## [0.0.22] - 2026-10-12

### Added

- **Plugins (MCP Apps)**: Settings › Plugins adds MCP servers that Relay starts on your Mac, by hand or imported from Claude Code's MCP config. A plugin that brings a view (an MCP Apps `ui://` resource) gets a row in the sidebar as soon as it is saved and opens in the main pane (a tab per view when it brings several), in a sandbox that cannot reach Relay and has no network unless the plugin declares it; it can only call the tools you switch on for it. Secrets go to the keychain. `packages/plugin-example` is a small one to start from (#189)
- **Settings › Updates**: a new page with Relay's update and the coding agents. It lists every release since your version with its notes (a skipped version's too), Check now looks again, and Install and restart shows the download's progress. The agents section shows each installed agent against npm's latest version, with a Changelog link and an Update button that runs npm, Homebrew or the agent's own updater, whichever installed it (#188)

### Changed

- **Reminders in the menu bar**: the icon is the Relay mark in one colour, which follows a light or dark menu bar, with one number for what is overdue or due today, red while something is overdue. It replaces the alarm clock emoji and the two numbers (#184)
- **Updates check quietly, twice a day**: Relay looks for an update at start and every 12 hours instead of once a day, and no longer pops a dialog. A dot on the settings button in the sidebar says there is one, and the button then opens Settings › Updates; so does Relay › Check for Updates (#188)
- **Forgotten projects show as Quiet**: in a vault Relay set up, a project marked Active with no work (`last`) for 30 days shows as Quiet in the project index, and Active again once work is logged. Relay rebuilds the index at start with its own copy of `build-index.py`, so vaults made by an older Relay get this too (#194)
- **Vault updates on close are written, not proposed**: closing a conversation has Claude write what belongs in the vault straight in, with the vault's own rules and hooks. Nothing lands on Today and nothing is asked; the vault's git history is the review. Settings › General still turns it off (#193)
- **Board pipeline: the review remembers its last round**: when Relay's review sends an agent's work back, the next round first checks each of those findings against the new code (fixed, or "Not fixed:" and blocking again) before it reviews the rest, instead of starting from scratch every round (#195)
- **Board pipeline: the review forms its own view first**: the reviewing agent reads the ticket and the diff before the agent's own account of what it did, and treats that account as a claim to check. It also lists what it checked and found right; that list goes in the PR under the review's notes, so you know what you need not check again (#196)
- **Board pipeline: agents settle small choices themselves**: when a ticket leaves something open, the agent follows the ticket, then how the repo already does it, then the smaller change that is easiest to undo, and lists those choices under Decisions in the PR. It only stops with questions when done is unclear or the change would touch auth, money, data or something others rely on (#197)
- **Board pipeline: unclear tickets go back before an agent starts**: before Relay gives a ticket from the pick column to an agent, one quick check without tools asks whether an agent could build it without guessing. When not, the ticket moves to the input column with up to three questions on it, instead of costing a whole run. Skipped in plan mode and for tickets you start yourself (#198)
- **Board pipeline: stops taking tickets when it should**: a pipeline takes no new tickets while the Claude plan is used up, and stops after three agent runs in a row ended without a PR (blocked, failed or nothing to push), with one message saying why. Tickets moved back and tickets you start yourself still run, and the next PR lifts the stop (#199)

## [0.0.21] - 2026-10-12

### Added

- **Join a team brain from Settings**: Settings › Integrations › Commonwealth has a Team brain field. Paste the brain's repository and Join runs `commonwealth join`, which clones it and routes the repositories of its projects to it; the report shows under the field. Needs Commonwealth 0.8 (#186)
- **Vault setup**: after Start, Relay offers to set up the new vault with Claude (or Skip). A first conversation interviews you about yourself, your contexts, people, projects and how Claude should think along, and writes the answers into the vault; Productive projects can become project notes. Run it again from Conversation › Set Up Vault (#182)

### Fixed

- **Commonwealth notes file under the conversation's project**: a conversation about a project that routes to a brain also passes the project's name (`COMMONWEALTH_PROJECT`). Commonwealth 0.7 matches it against the brain's project list, so notes from a vault conversation about o2o land in `o2o/` instead of under the first o2o repo, and a name the brain doesn't know falls back to the repo as before (#185)

### Fixed

- **Permission cards for Claude**: a tool call or question that needs the user shows its card again and waits for the answer. The desktop answered every request as unsupported, so a vault without allow rules or auto mode had every edit refused, on this Mac and on a work machine
- **Auto mode by default**: a conversation whose Claude Code settings set no `defaultMode` starts in auto, as a terminal window does, instead of `-p`'s manual mode that asks for every edit. A mode set in the user's or the vault's settings stays, and a work machine gets auto when this Mac sets none
- **Old Claude Code**: a conversation on a Claude Code older than 2.1.294 now stops with "run `claude update`" instead of failing every turn on `unknown option '--thinking-display'`

## [0.0.20] - 2026-10-12

### Changed

- **Brain graph**: the six most common kinds get a colour instead of three, and links within one kind take its colour. Hovering a note fades the rest back, lights its links in its colour and names it on a pill, with the note's card in the corner instead of under the pointer. Dots stay solid when faded, so links no longer show through them, and the hovered note is drawn on top in its colour. Names fade in as you zoom, a dot can be dragged and the graph follows, a fresh layout grows in and Fit glides there (#178)
- **Conversations**: the chat column grows with the window, from the old 680px up to 1200px, so a wide window no longer leaves the messages in a narrow strip (#177)
- **Pairing a phone starts with the camera**: Scan the code is the main button on the phone, pasting the line sits behind Paste the line instead. While it connects the button shows a spinner, and a failed pairing says why (#174)
- **Add phone keeps its code fresh**: a pairing works for 10 minutes, so the QR code and line in Settings › Machines are replaced by new ones every 9 minutes while they show (#174)

### Fixed

- **Scanning the pairing code crashed the Android app**: the release build stripped what the barcode scanner needs to start (#174)
- **The phone could not reach a machine on Android 17**: the app now asks for access to devices on the local network (Android shows it as nearby devices); without it every connection timed out (#174)
- **The phone app froze while it talked to the machine**: those requests no longer run on the app's main thread (#174)
- **The phone app has Relay's icon** instead of Tauri's (#174)
- **Conversations the phone starts show on this Mac too**: Relay looks for them on each machine every 5 seconds and adds them to the list, with their history and live replies, and you can carry on in them from here. While this Mac follows one, the phone gets no notification for it (#175)
- **A Mac that runs conversations for other devices no longer shows them as open in the terminal**: those belong to the other device (its laptop or phone) and stay hidden on the machine itself (#175)
- **Conversations on a machine could not edit or run anything**: they started in Claude Code's default mode, so every tool call outside the allow rules asked for a permission the machine could not show. They now start in the same mode as a window on this Mac (`defaultMode` in `~/.claude/settings.json`, auto for most) (#176)
- **Reviewing your own PRs together**: Review together on your own PRs of a ticket still opened "This pull request no longer waits on you" when nobody else had a PR on that ticket. Today now knows the ticket of your own PRs too

## [0.0.19] - 2026-10-09

### Added

- **Add phone, per machine in Settings › Machines**: a QR code and a line that pair a phone with the machine as a device of this Mac. The phone sees this Mac's conversations and cards there, and can open the mirror with the key in the line while this Mac is closed. It may only work with conversations (no mirror files, no updates of the server, no further devices), and forgetting this Mac on the machine (`relay-server revoke`) unpairs its phones too. The phone app itself is not released yet (`mobile/`, a first Tauri build for Android and iOS) (#161)
- **A phone can start a conversation on a machine while this Mac is closed**: Relay tells each machine how this Mac starts Claude there (its Claude settings without mail and accounts, and the mirror's context, plugins and permissions), and relay-server builds the same command for the phone, in the mirrored vault (#161)
- **Relay for Android with each release** (`Relay_<version>_android.apk`): the phone app, signed with Relay's own key so a new version installs over the old one. Pair it by scanning the code from Settings › Machines › Add phone (or pasting the line); its key and the mirror's are sealed with the Android Keystore. Tapping a notification opens its conversation (#161)
- **Phone notifications through ntfy**: a machine notifies when Claude waits for an answer or finished a turn in a conversation no device follows, on an ntfy topic made from the mirror's key. Add phone shows the topic to subscribe to in the ntfy app. The notification only says that Claude waits or finished on which machine, nothing of the conversation (ntfy.sh is a public server) (#161)

### Changed

- **Several devices follow one conversation on a machine**: this Mac and its phone both get every line of a conversation there, and each gets what it missed when it comes back, without taking the conversation from the other. The protocol between Relay and relay-server changes with it: update every machine to this version (Settings › Machines › Update) (#161)

### Fixed

- **Reviewing your own PRs**: Review together on your own PRs opened "This pull request no longer waits on you". The review now finds its PRs in the PR list when Today does not queue them (your own PRs with green checks) (#171)

## [0.0.18] - 2026-10-09

### Fixed

- **PR tickets in the Pull requests view**: the PR detail shows the ticket a PR is about, or the way to one (link its repo to a project, link the project's board, pick a card), as Today does. PRs get their ticket as soon as the list loads, so PRs of a newly linked repo group under their ticket without waiting for Today to reload its cards (#168)
- **Review your own PRs together**: the PRs of one ticket under Yours get Review together too, not only the ones waiting for your review (#169)

## [0.0.17] - 2026-10-09

### Changed

- **Orchestrator permissions**: the coordinator and its workers run with the same permissions as any other conversation. Push, PR create, merge and comment no longer always ask, and workers are no longer denied the vault-wide files or a checkout of main: the role prompts still tell them what not to do
- **Meeting actions on Today**: Join and Record are their own icon buttons on a meeting instead of living under "…", and a meeting can no longer be snoozed (#166)

## [0.0.16] - 2026-10-09

### Added

- **Board pipeline**: Settings › Projects › a project with a linked board can pick tickets up by itself. Relay takes the tickets in one column (optionally only those with a label), moves each to a "building" column, and starts an orchestrator worker on it in its own worktree, with the ticket and its comments as the brief. When the worker reports done, Relay pushes the branch, opens the PR and moves the ticket to review with the link as a comment; questions, no PR or a failed run move it to a column for a person, with why. Review comments on the PR go back to the same worker, a merged PR moves the ticket on, and a ticket moved back to the pick column continues with its worker. Checked every 5 minutes while Relay runs, and right when a worker reports. The workers board shows each one's ticket and PR. It picks up automatically from the column, or only the tickets you hand-pick with Build with agent in the ticket window (that button also starts one right away in an automatic pipeline). Before it pushes, Relay validates the agent's done itself: everything committed, the pipeline's check command (lint, static analysis, tests) in the worktree, then a review by another agent that starts from the diff and can read the rest of the worktree (read-only: files and git, nothing written); a failure goes back to the agent as its next task, and after the last round (3 by default) the ticket goes to a person with what failed. Non-blocking review notes go in the PR. With Plan first on, the agent puts its plan on the ticket before writing code and builds once you send the ticket back. The reviewing agent gets the ticket's text, so it checks the change against what was asked. A bug ticket starts with a test that fails on the bug. A ticket in the pick column with no description, comments or files goes to a person instead of an agent. Each project has its own switch, and on Productive Relay's comments are hidden from the client unless you turn that off (#160)
- New users start with an empty vault: Start on the welcome screen creates one in `~/Relay` with the rules, skills, hooks and templates that give Claude a memory of your projects. "I have a vault" still lets you pick your own (#162)

### Changed

- **PRs grouped by ticket everywhere**: the Pull requests view puts the PRs of one ticket together under it, in both lists, by the same rule as Today, and a ticket's PRs waiting on your review have Review together there too, opening the same review as Today's item. Today also groups your own PRs that need a fix, and Fix with Claude on such a group takes all of them in one conversation. A group across repos names each repo in its subtitle (#164)

## [0.0.15] - 2026-10-08

### Added

- **The Brain view browses the vault and every Commonwealth brain**: Brain is always in the sidebar now. With Commonwealth on, a tab per brain sits next to the vault, otherwise you only see the vault. Each tab has Browse (folder tree, full-text search, the note with its tags and linked notes, `[[links]]` that stay inside that brain, and "Ask about it" to start a conversation with the note's path), Graph (every note as a dot coloured by kind, links as lines, zoom with a pinch, drag to pan, click to open, index notes hidden by default) and, on a brain, Review (the staged notes, as before) (#158)
- **Conversation glow**: in the Brain graph, the notes Relay's conversations read and wrote in the last 7 days light up, brighter the more recent, with reads and writes in their own colour. Hover a note to see which conversations touched it, or pick one conversation from the list. Browse has the same filter as "Touched". A conversation's title bar has a Brain button that opens the graph with only its notes lit. It reads Claude Code conversations only, and notes found with Grep or a shell command don't count (#158)
- **Permissions in Settings › General**: whether Relay has Full Disk Access, the microphone and Accessibility, with a button to each pane of System Settings (also for System Audio Recording and Notifications, which macOS does not report). Full Disk Access stops the separate prompts for Documents, Photos, Music and so on. A build not signed by Apple loses these grants with every update, and this is where that shows (#153)

### Changed

- **Booking time reads every source of the Antenna timesheet skill**: the "Time <date>" conversation still starts from your Relay conversations, and the agent now adds the day's meetings (`relay calendar.meetings` takes a `date`), your Slack messages, your git commits, Claude Code sessions outside Relay (terminal, other repos), and what you edited in Google Drive, Jira, Notion and Figma, the same sources as weareantenna/antenna-tools' timesheet. It skips a source that isn't connected and says so, never counts a meeting twice, and ends with how much of an 8-hour day is still uncovered. A day without Relay conversations is no longer stopped right away (#157)

### Fixed

- **A meeting recording that fails can be tried again**: Try again on the error transcribes the kept recording once more, after downloading the speech model say, and names the files by when the meeting started. Recording no longer starts without the meeting's speech model, so you don't find out after the meeting. A missing model now says so instead of "model", the audio only lands in the vault once the transcript worked (a retry gives no second copy), and a long error wraps so its close button stays in view (#152)
- **Changes shows only what the conversation wrote**: in a checkout the conversation did not make (the vault, a shared repo) the drawer lists only the files its tools edited, no longer every uncommitted change in it. A worktree it made still shows everything. Files it changed only through shell commands don't show in a shared checkout (#149)
- **A large paste no longer takes over the conversation**: the composer stops growing at 40% of the window and scrolls inside, so the messages and the send button stay in view (#151)
- **Banners no longer eat memory**: the process behind each unclicked banner grew by a few MB a minute (up to ~5 GB) and stayed alive after Relay quit, 46 of them held ~129 GB. The click wait in mac-notification-sys leaked a copy of the delivered banners 10 times a second; Relay now builds a patched copy (`src-tauri/vendor/mac-notification-sys`) and a banner stays at ~9 MB. A banner's process also exits once Relay quits (#150)

## [0.0.14] - 2026-10-07

### Added

- **A conversation's changes, from git**: the new Changes button in a conversation's title bar opens its changed files in the drawer, per repo it wrote in (the repos of the files it edited and the worktrees it made), against where its branch left the default branch, so committed and uncommitted work both show. A file opens its diff in a window over the app (‹ › step through the files, Esc closes it); click a line to comment on it, and the comments go to the composer together as one message for the agent. Files outside a git repo don't show, and in a shared checkout the diff holds every change in it, not only the agent's (#142)
- **Pick the agent for a PR review, and add a second one**: the PR detail has an agent picker next to Review, remembered for the next review and used by Today's review too. On the review screen, "Also review with …" lets another agent read the same diff: its findings join the list with its icon, and a line both agents flagged says so. Codex can now do these one-call reviews (`codex exec` with your config, rules and every tool off). The PR detail lists the conversations that reviewed it, and once one is done, "Second opinion with …" starts the picked agent on its own conversation: it gets the first review, reads the PR itself and says where it agrees, where not and what was missed (#146)

### Changed

- **⌘K answers faster and finds meetings**: cards from boards you already opened (and the ones Today reads) show while you type, each tracker's results show as soon as that tracker answers instead of after the slowest one, and a query you typed before shows its results at once. Today's meetings match on title, organizer or guest and open under Today (#141)

### Fixed

- **The composer shows line breaks**: text with newlines (Shift-Enter, or text put in from elsewhere) showed as one run-on paragraph (#142)
- **A running meeting opens under Today**: clicking a meeting while it runs opens it with its briefing; before, nothing opened between its start and its end (#140)
- **Commonwealth notes file under their project**: a conversation about a project whose repos route to a brain now tells Commonwealth that repo (`COMMONWEALTH_SOURCE`), so its captured notes no longer all land in the brain's `vault/` folder. Needs Commonwealth with kristoffeys/commonwealth#323 (#139)

## [0.0.13] - 2026-10-07

### Added

- **The briefing shows under Today**: a meeting you prepared shows its briefing (the answer to the prep question) when you open it under Today, with a button to the conversation. Prepare opens that conversation again instead of starting a second one. **Edit** rewrites the briefing in place (⌘↵ saves); saving it empty goes back to Claude's answer (#137)

## [0.0.12] - 2026-10-07

### Added

- Agents can search and read tickets: `relay productive.search`, `productive.task` and `productive.comments`; `relay trello.search` and `trello.card` (with its comments); `relay linear.search` and `linear.issue` (with its comments). Reads, so they run without a card unless Settings says otherwise (#134)

### Changed

- **Cmd-K finds open tickets only**: closed Productive tasks, archived Trello cards and completed or canceled Linear issues no longer show, and a spinner next to the hint says the trackers are still being searched (#135)

## [0.0.11] - 2026-10-07

### Added

- **Time from sessions**: from 16:00 Today offers "Book today's time", built from when you wrote in your Claude Code conversations that day (10 minutes around each message, rounded to 15 per project). Relay opens a conversation that subtracts what Productive already has and proposes one time entry per project, each one approved on its card. Settings › General switches it off: then the item goes and the transcripts are not read for it (#112)
- Commonwealth, the team brain, works without setup. When its Claude Code plugin is installed (Settings › Integrations › Commonwealth installs it, no fields to fill in, and its switch turns it off again), a conversation about a project whose GitHub repositories your own Commonwealth rules route to a brain reads that brain and stages what it learns; personal projects and projects no rule matches never touch one. The new Brain view lists the notes waiting for review, per brain, with Promote and Reject. Reading the brain runs without a permission card, staging a note with `remember` still asks (#47)
- **Cmd-K finds tickets**: type three letters and Cmd-K also lists the matching tickets from Productive, Trello and Linear (the ones set up in Settings › Integrations), under the projects. ↑↓ and Enter open the ticket over its tracker's board. A tracker that doesn't answer is left out, the others still show (#132)

## [0.0.10] - 2026-10-07

### Added

- **Relay updates itself**: at start and once a day Relay checks for a new release and offers to install it and restart; Relay › Check for Updates… looks right away. It downloads with your gh login, so you need gh signed in with access to the repo. This version still has to be installed by hand, once. (#129)
- **Closing a conversation proposes what it leaves for the vault**: Claude reads it once more for decisions, project state and follow-ups, and puts what is missing on Today as one item, with a toast to review it. Nothing is written until you press Apply, which makes the changes in a new conversation where you allow each edit; leave out what you don't want, or Skip all of it. Quick questions (fewer than 3 messages) and conversations about mail are skipped. Off in Settings › General. (#130)

## [0.0.9] - 2026-10-06

### Added

- **Whisper as a speech model**: Settings › Voice offers OpenAI's Whisper Large v3 Turbo (574 MB, about 100 languages including Dutch) next to Parakeet, Canary, Cohere and Moonshine, for dictation and meetings. It runs on this Mac's GPU via whisper.cpp. Building Relay now needs `cmake` (`brew install cmake`)

### Fixed

- **Mail that waits on you stays on Today, however old**: unanswered mail from a person dropped off Today after two days without being archived (a Friday mail was gone by Monday). It now stays until it is answered or archived. (#124)
- **A work machine keeps its own Claude settings**: a conversation started from the laptop sent Claude on relay-server to `~/.claude.json` outside the volume, so its settings were missing and gone with every new container. The server now always uses its own Claude config folder.
- **The spinner stops when Claude is done, and a message sent mid-turn shows where Claude read it**: a message you send while Claude works waits, dimmed, below the conversation until Claude takes it up, then moves into the conversation at that point. Claude often answers it in the turn already running; Relay used to wait for a second turn that never came, so the spinner kept spinning.
- **No more empty Thinking blocks**: when Claude keeps its reasoning to itself, Relay no longer shows a Thinking line that opens to nothing. (#126)

## [0.0.8] - 2026-10-06

### Added

- **Drag column edges to make them wider or smaller**: the sidebar, the right drawer, the lists in Today, Mail and Pull requests, the file tree and Claude panel of a PR review, and the side panel of a ticket. Each keeps its width across restarts; double-click an edge to reset it. (#121)
- **"Always allow" on a permission card**: when Claude offers to remember a choice (this command, the folder, edits for the session), the card has a third button next to Deny and Allow that allows it and keeps it, so the same ask doesn't come back. Enter still allows once. (#118)
- **Make ticket from a mail**: a button next to the draft-reply ones (and in a mail's … menu in Today, shortcut T) starts a conversation that reads the mail and its thread, finds the board (the one linked to the mail's project, else it picks one), and creates one task in the intake list with a short title and a summary, with the full mail as a comment on it. You approve the create before anything is made, and Relay never sends mail (#111)
- **Claude shows when it compacts a conversation and how full its context is**: a "Compacting conversation…" line turns into "Conversation compacted" with the size before and after, your history stays, and a small "42% context" next to the model pick shows how much of the window is used. (#115)
- **Claude's to-do list shows as a checklist above the field**: while a turn runs you see what is done, what Claude is on now and what is next, and it goes away when the turn ends with everything done. The step in the conversation now says "Todos · 2/5 done".  (#117)
- **Claude replies and thinking stream in live**: the answer appears word by word instead of all at once, and what Claude reasons shows above it as a dim, folded "Thinking" line you can open. (#113)

### Changed

- **Claude asks permission over the same connection as everything else**: permission cards and questions no longer go through a separate helper process polling a folder, so they appear without delay, and one that came up while Relay was closed or on a work machine is still there to answer when you are back. (#118)

### Fixed

- **Claude's thinking shows again**: the "Thinking" fold was always empty because the `claude` CLI now leaves thinking out unless asked; Relay asks for the summarized thinking. (#120)
- **Switching model or effort no longer kills a running reply**: a new model applies at once to what you send next without restarting Claude, and a new effort waits until the reply is done. (#114)
- **Claude starts when your login shell isn't zsh**: Relay read the PATH from zsh, so with fish or bash a `claude` installed through npm or Homebrew wasn't found and starting a conversation failed with "claude start: No such file or directory". It now asks your own login shell. (#123)

## [0.0.7] - 2026-10-05

### Added

- **Today: a detail per kind of item** (design "Relay Overview", Today turn 6). Every item opens with a chip saying what it is, its two main actions as buttons and the rest under "…", Snooze (tomorrow, Monday, next week), Later and Done (Archive for a mail, Prepared for a meeting, Mark reviewed for a review), under the title its status and assignee as small pickers and what the header doesn't say yet (a mail's recipients, a ticket's due date and labels, a meeting's organizer), and at the end what it connects to in your queue. There is no When: Snooze moves an item. A **mail** shows its thread with the earlier mails folded, the mail itself and Claude's quick replies; Reply, Reply all and Forward open a composer under it with Claude's draft, to edit or make shorter, more formal, Dutch or English, then Save to Drafts (⌘↵) and archive the mail: Relay still never sends mail. Recipients, subject and threading follow Keel. A **pull request** has Overview, Files, Checks and Conversation tabs, a **ticket** Details, Activity (comment from Today) and Connected, with every status of its workflow to move it to, and Start working sets it in progress and opens a conversation. A **meeting** shows who is in it and the agenda from the invite. Keys: J K, Enter, Backspace, E done, S snooze, L later, P in progress, and for a mail R A F U #
- **Review a pull request in Today**: Review with Claude opens a review screen with the changed files as a tree on the left like GitHub's (folders to fold, + and − per file, a count of Claude's findings), the diff per file with Claude's findings under their line (numbered, a bar in the finding's colour down the line, Add as comment or Dismiss right there; the panel on the right lists them, a click jumps to the line) with the open threads from GitHub, and Claude's findings (it reads the diff and the description) to add as a comment or dismiss. Click a line to comment on it or to ask Claude about it. Write a summary, pick Comment, Approve or Request changes, and Submit: a dialog says who will see it before the review is posted on GitHub, the one thing Relay posts there
- An agent's question under Today answers with the number keys: 1 to 9 pick an option, Enter sends the answer
- **Today per context**: chips next to the progress show All, each context of your vault (with its colour and how many items it has today) and No project; picking one shows and plans only that context's items, and the progress counts only those. The choice stays
- What an agent asks you to decide is always on top of Today ("Waiting on your decision"), above the meetings, and first for Enter and J K
- A meeting in Today's day track, or in the list, opens its prep before it and its note after it (back to All when the context filter hides it)
- **A pull request knows its ticket**: Today matches each open PR to a card on its project's linked board, by a ticket number in its title or branch (#212, 212-…, ENG-12, feature/212-…), else by a title like one card's, else Claude picks one from the board (a few PRs per round, one call without tools). The answer is kept in Relay's own store, so a PR is matched once (one without a ticket is tried again after three days). The PR shows its ticket at the top of its overview (how it was found, a click opens it, the cross says it is not this one), and the ticket lists its PRs under Connected. "Find the ticket again" under a PR's "…" forgets what was found (or unlinked) and looks again, Claude included. When a PR has no ticket, its overview says why and offers the fix right there: choose the ticket from the board (search by number or title), find again, link the repo to a vault project, or link the project to its board (every tracker, Productive project by project, the board named like the project first)
- Everything an agent needs you for is on top of Today: a decision, a blocked session, and a finished result to read
- **Work in progress shows in the sidebar** under its project, like a conversation: a review you started, a reply you are drafting, a meeting that runs or is being recorded. A click brings Today back on it (the review screen, the mail with its draft, the meeting's prep or note); closing a review or a draft discards it. A started review and a draft are kept when Relay restarts. A meeting's prep, note and transcript conversations now start under the meeting's project instead of General
- The review screen's diff scrolls: down with the rest of the review, and sideways for long lines
- A pull request review is a view of its own: from Today or from its row in the sidebar it opens the review screen alone, with its name in the title bar and its sidebar row selected; Back or Esc returns to Today. When the PR no longer waits on you it says so, with Discard and Back
- **@-mention people in a ticket's comments**: typing @ in the comment box (on Today and in the ticket window) offers the ticket's people; in Productive the pick becomes a real mention, so that person is notified, and mentions in Productive comments now read as @Name instead of their raw code
- A ticket on Today can be reassigned from its panel (Productive, Linear), next to its statuses
- Today shows every item's project: under its title in the queue, with its context's colour, and as a chip in the detail
- **Review the PRs of one ticket together**: when a PR waiting on your review shares its ticket with other PRs waiting on you (a frontend and a backend PR, say), they are one item in the queue ("#312 Two-factor setup · 2 PRs", planned for the time of all of them), and Review together opens one review over all of them: their files in a tree per PR, Claude reading them as one change (every PR gets an equal share of what Claude reads, and the panel says when files didn't fit), comments on any of them, and on Submit one review per PR with the same summary and verdict

### Added

- The notes drawer (the notes icon in the title bar) lists **Related** notes: the vault notes closest to what the open conversation is about, from a full-text index of the vault that Relay keeps up to date on its own. A click opens the note in the panel (#49)
- While Relay records, a row above the sidebar's footer says what (a meeting, dictation in a conversation, or dictation in another app) with the time, and a click goes to where it happens. Dictation you started in one conversation now lands there, also when you switched to another one before stopping (#103)
- **Record a meeting** from its card in Today: your microphone and what the Mac plays (so people on a call are in it, also on headphones), transcribed on this Mac with "Me" and "Others" as speakers; on speakers instead of headphones, what the microphone hears of the others is left out so their words don't show twice. Stop puts the audio (.m4a) and the transcript in Obsidian's attachment folder, and a conversation makes the meeting note and summarises it. Settings › Voice › Meetings picks the model for meetings and whether the audio is kept and the note written. macOS asks once for Screen & System Audio Recording (#95)
- **Dictate from any app** (Settings › Voice): next to dictating in the composer, two ways that work in every app, also with Relay in the background, each switched on with its own shortcut. **New conversation** brings Relay forward and starts a conversation with what you said; **Paste** puts the text where the cursor is and gives your clipboard back afterwards (needs Accessibility, without it the text is left on the clipboard). Set a shortcut by clicking it and pressing the keys. A small pill at the bottom of the screen shows it listening and transcribing (#95)
- **Dictation in the composer**: the microphone button or a shortcut (⌥Space by default) turns what you say into text at the cursor, on this Mac without sending audio anywhere. **Settings › Voice** switches it on or off, picks the speech model (Parakeet V3 by default for 25 European languages including Dutch; Parakeet V2, Canary, Cohere and Moonshine to download or remove there), the spoken language, the shortcut and whether you hold it, tap it or either. Escape throws a recording away (#95)

### Changed

- **Today is calmer** (design "Today Calm", 6a / 6c): one header line (the date, the next meeting and the one after, how much is done, a project filter) instead of the day strip, progress dots and filter pills. The queue has plain headings per free slot (Now, Before Sprint planning · 12 min free, Between meetings, This afternoon, Tomorrow), meetings as cards at their time with Join only in the last 15 minutes, and rows with one icon, the title, and the project and how long; three or more mails or PRs in a slot are one row that opens. The detail says what it is in one quiet line, then the title, the ticket's status and assignee as text, one main button and one secondary, and the rest, snooze and later under "…"; the tabs are links under the content. Colour only where something needs you. Times are on the 24-hour clock everywhere
- **The sidebar is calmer too**: the views are a row of icons by default (the list stays a setting), with a small dot instead of a number: blue for something new, red for something late, the count in the tooltip. A conversation's glyph is faint, and a project without an icon gets its initial on a small tile in its context's colour
- **A mail shows as it was written**, on Today and in Mail: its HTML (with the footer and the images in it) at its own height instead of a plain-text version with hard line breaks, or a box that scrolls. Pictures from the web stay blocked until "Load images" for that mail (they are tracking pixels as often as logos); inline images always show. Plain text is one click away
- **A mail on Today without the clutter**: no cards or borders around it, the sender with their address and the time on one line, the text larger, earlier mails as quiet lines, attachments and quick replies as flat chips
- The sidebar is less cramped: rows are 32px high (30px nested, was 28/26), section headers 28px
- **Waiting is now Today**: one queue of everything that needs you today, planned into the free time between your meetings. A track across the top shows the day: meetings, now, and how much is planned in each free slot. On the left the queue per slot, with how full each slot is and the meetings in between (Join from the row); on the right the open item with its actions: Enter for the main one, Backspace for the other, L to put it off, the arrows to walk the queue. When moves an item to another slot or to tomorrow (a reminder is then pushed), and Also in lists the same project's other items. The queue holds what agents ask, blocked sessions, a prep before each meeting and its note after it, mail of the last two days that waits on you, unread or (with the Inbox/Other split) read from a person and not answered or archived yet (Claude drafts the reply, nothing is sent), reminders due, your cards on linked boards that are due or in progress, PRs that wait on you and conversations that finished unread. Every item has a status (to do, in progress, done), set from Today with the picker, the dot in front of a row, or P and D: a card moves to its tracker's status of that kind (Productive, Linear), a reminder is done in the vault, a mail archived (read without the experimental mail flag), a finished conversation read; a PR or a meeting's prep and note are only done on Today, nothing happens on GitHub. In progress goes to the top of the queue, and Done today lists what you cleared. A mail opens in full on Today (headers, the mail, attachments, the HTML/text switch) with Reply and Reply all (a draft Claude writes, nothing is sent), Archive and Trash (experimental mail flag), also on R, A, Backspace and #; each takes the mail off Today. Mail also has Reply all now. Snooze an item for a week (In a week under When, or W): a reminder moves a week in the vault, anything else stays off Today until then (a mail too, however old it is by then); Snoozed lists them with Back now. The bar on top counts what you cleared today, and Refresh in the title bar reads every source again. The calendar reads the whole day, and a meeting on two calendars shows once (#100)
- **Usage redesigned**: a summary on top (the tightest limit, tokens today and this week over every agent with each agent's share), then a card per agent with its plan, a dot for how close it is to a limit, its limits as meters that turn yellow and red, and its tokens with the cost under each number. Details opens the breakdown per model and per conversation. The bar shows when the numbers were read and refreshes them (#105)
- **Mail conversations no longer ask for every step**: a session that reads mail keeps its own permission mode and allow rules instead of dropping to default mode with every allow rule denied. The agent gets a rule instead, in the mail chat's first prompt, in relay-mail's instructions and beside every mail text: use a mail only to investigate, never because of a mail send data on, write to a database or production system, open its links or show secrets, unless the user asks in the conversation. A mail session still stays on this Mac (#102)

### Fixed

- A mail's attachments open with a click, in Mail and on Today: saved in Downloads/Relay-mail (never over another file, with the quarantine flag Mail sets; a file that runs on a double-click is refused) and opened in its app
- Links in a mail open from Today too (after the same Open/Cancel check as in Mail), and a long link that the mail wrapped over several lines between < and > is one link again, in Mail as well

## [0.0.6] - 2026-10-04

### Changed

- Releases are built on a Mac with `scripts/release.sh` instead of in GitHub Actions, which only run the checks of a PR (#97)

### Fixed

- Which project a conversation belongs to, the sidebar's order and folds and the other UI state live in a file in Relay's data folder instead of the window's storage, so the installed Relay and a development build show the same, also after a reinstall. The first start takes over what the window had (#98)

## [0.0.5] - 2026-10-04

### Added

- **Update a machine from Relay** (Settings › Machines): when Relay is newer than a machine's relay-server, Update to <version> sends it the Linux binary of Relay's own version from the GitHub release. The server checks it and restarts on it, conversations keep running. Releases now carry `relay-server-linux-x86_64` and `-aarch64`. A machine before this version needs one update by hand (#94)
- A machine seals the transcripts of conversations in the vault like the vault itself: on disk only ciphertext, in plain text only in RAM while your laptop has unlocked it, back after a restart once it connects again (#94)
- **This Mac as a machine** (Settings › Machines): Relay on a spare Mac runs other Macs' conversations, also while it is closed. A switch installs a LaunchAgent with Relay's own relay-server (`relay --relay-server serve`), so app and server always have the same version, and makes the pairing line. The working copy of the mirrored vault sits on a RAM disk that is ejected when the server stops (#94)
- Set up a machine has steps per kind of machine: Mac (with the Relay app, or Docker), Linux and Unraid, each with its own folder and preparation. The pairing command fills in the machine's LAN address itself (#94)
- **Retry when a usage limit resets** (Settings › General, off by default): a conversation refused because the provider's usage limit is reached, with no other account to switch to, shows "Retrying at …" with a Cancel button and goes on by itself once the limit resets, also after an app restart. A refused message that never started is sent again, otherwise the agent is asked to continue. It retries once; the Mac stays awake for it while Keep Mac awake is on (#92)
- Views you switch off in the sidebar stay reachable under "…" after the views, a dropdown with their icons; turn the "…" off in Settings › General or from the views' right-click menu (#93)
- The Mac stays awake while a conversation has a turn running, so you can leave it working; closing the lid still sleeps it. Switch it off in Settings › General (#91)
- New task on the board, from the title bar or a lane's +, for Productive, Linear and Trello: the card shows at once and is made in the tracker (#87)
- The ticket window shows a preview of a Productive ticket's pictures, in its files and in the comments. A click opens the picture at full size in Relay's own viewer window: log in to Productive there once, after that it shows the picture right away (#87)
- The ticket window lists the conversations started from it and the pull requests that name its number, and a Productive ticket takes new labels (#87)
- Code in conversations is coloured by language (TypeScript, JSON, shell, PHP, Python, Rust, CSS, HTML, SQL, YAML), the command on a permission card too (#87)
- An edit in a Claude Code conversation shows its diff with line numbers and the surrounding lines, also when the conversation is reopened (#87)
- A group of steps says how long it took ("3 steps · 4 s"), and Waiting for you says how long a request has waited (#87)
- Enter allows a permission card when it is the only one waiting and nothing is typed, the Allow button shows ↵ then (#87)

### Fixed

- A machine in Settings › Machines shows the Relay version it runs (0.0.5 and later), instead of a fixed 0.1.0 (#94)
- Cmd-K always starts a general conversation and sends at once: a question that named several projects waited on a hidden "Which project?" and was lost when another conversation opened. The projects it names are offered once in the conversation afterwards (#89)
- A new conversation shows at the top of General and of its project, also after the list was reordered by dragging (#89)
- Settings › Machines › Set up a machine in a development build of Relay uses relay-server:latest: it gave the build's own version, which has no image

### Changed

- The Relay redesign: view title bars show an icon and a summary ("3 waiting", "2 due · 7 total", "2 to review", "21 unread"), the board's project and board pickers, its last sync, New task and refresh moved into the title bar, lanes and cards have the new look with a status ring per workflow status and both initials on avatars (#87)
- The agent picker in the composer is a menu with each agent's icon, the ticket window's status and assignee open a menu, due dates read Yesterday, Today or Tomorrow, Reminders show "Fri 2/10" and undo as a compact chip, pull requests show their project and "Review with Claude" (#87)
- Settings opens at 900 x 660 with hairline rows, and Agents and Integrations list every item with an on/off switch, switched-off ones stay visible, dimmed (#87)
- Smaller polish from the redesign: the sidebar search reads "Search", step lines start with a capital, Answer stays disabled until you pick an answer, darker raised surfaces in dark mode (#87)
- Every paired work machine mirrors this Mac: the vault, its memory, your Claude context and plugins always go along, Settings › Machines no longer has a switch for it. A conversation on a machine starts in the mirrored vault there. Where a conversation runs is the composer's pick, or the default in Settings › Machines. Forget removes the copy on the machine (#88)
- The machine pick in the composer is Relay's own menu, with a green or red dot per machine for whether it is reachable (#88)

### Removed

- The Working/Ready pill in the conversation title bar: the sidebar already shows whether a turn runs (#87)
- Project folders and the default folder per machine, and "Remove the copy on this machine": a conversation on a machine starts in the mirrored vault, Forget removes the copy (#88)

## [0.0.4] - 2026-10-03

### Added
- Drop files from Finder anywhere on the window, pick them with +, or paste them after Cmd-C in Finder: the agent gets their path and reads them where they are, nothing is copied. They wait as chips next to the pictures, and in the conversation a click opens the file in its own app (Option-click shows it in Finder). Reading a file you attached needs no permission card in that conversation, anything else still asks. Pictures still go inline (#86)

- Work machines: run a project's conversations on another computer in your network (a home server, a spare Mac), so they keep going while this Mac is closed. Run `relay-server` there (Settings › Machines › Set up a machine has the commands), pair it with the line `relay-server pair` prints, then pick per conversation where it runs, or link a project to its folder on that machine. The connection is mutual TLS with pinned certificates: a device that is not paired never gets past the handshake. Permission cards from there show up here as usual, the composer says where a conversation runs, and a conversation that lost its connection is taken back when the machine answers again. Mail stays on this Mac (#82)
- Work machines can mirror this Mac: Settings › Machines › Mirror this Mac keeps your Claude context (CLAUDE.md, skills, agents, commands), your plugins, the vault and its memory in sync on the machine, so a conversation there knows what Claude knows here, also while this Mac is closed. What it writes in the vault comes back here, a file changed on both sides keeps both versions. On the machine the copy is encrypted with a key only this Mac holds, and lives in RAM while unlocked. Files go to the machine 500 at a time, and Settings › Machines shows a progress bar while a round runs. (#82)
- A conversation can move between this Mac and a work machine between two turns: pick another place in the composer. Its history goes along and the next message goes on there. (#82)
- relay-server is released as an image, `ghcr.io/laurentme/relay-server` for amd64 and arm64 with the same version as Relay. Claude Code is not in the image: the first start installs it into a volume, where its updates stay. (#82)
- Settings › Machines › Set up a machine: the commands to run relay-server in Docker on a home server, for the image of this Relay's version and the folder you type, each with a copy button. A machine that speaks an older protocol says so in its row, with the commands to update it. (#82)

### Changed

- Relay no longer needs Python: reading the vault, project icons, permission prompts, slash commands and the Codex and OpenCode bridges are built into the app, so Macs without the Xcode Command Line Tools no longer get an install prompt (#79)

### Fixed

- The released app works again: it looked for its scripts in the checkout of the machine that built it, so reading the vault, permission prompts, Codex and OpenCode all failed (#79)

## [0.0.3] - 2026-10-02

### Added

- Right-click a conversation and pick "Copy session ID" to copy the agent's session ID, so you can point another conversation at it (#72)
- Agents can read your calendar with `relay calendar.meetings` (an hour ago to 12 hours ahead), with an Agent access section on Settings › Integrations › Calendar
- Claude Code can run on more than one account: Settings › Agents › Claude Code › Accounts adds a login as its own config folder (sign in once with `CLAUDE_CONFIG_DIR=<folder> claude /login`) and picks the one new conversations use. Each conversation stays on its account. Switch on **Switch accounts automatically** and a conversation whose account hit its plan limit moves to the next account with room on your next message, history included (#45)
- A project conversation that commits to a repo no project has asks whether to link it to the project (the PRs and the GitHub button pick it up); "Not now" is remembered in the vault's `.relay/config.json` so it is not asked again. (#70)
- Scratch notes per project: paste or write plain text, saved as you type in the vault's `.relay/notes` folder, with undo when you delete one. (#70)
- Terminals per project: one or more shells in tabs, in the project's checkout, that keep running while you look at another project. (#70)
- Slash-command completion for Codex, OpenCode and Pi, with provider-specific commands and skills that execute through their native APIs. (#64)
- The agent can now do what the extensions do: create tasks, comments and time entries in Productive, cards in Trello, issues in Linear, add or move vault reminders and save mail drafts, through a `relay` command in its conversation (`relay help` lists what is set up). Reads run on their own, anything that changes something asks first on a card. Each extension's settings page has an Agent access section: switch the extension off for agents, or pick per action whether it runs, asks first or never runs. It is saved in the vault's `.relay/config.json`, so it travels with the vault and can be edited by hand (#52)
- The views on top of the sidebar can be set up: right-click one to hide it, show it as a row of icons instead of a list, bring hidden ones back or reset the order, and drag them to reorder. Settings › General › Sidebar has the same switches. Trello, Linear and Productive now draw a monochrome icon there, like the rest of the sidebar (#53)
- A conversation under a project now tells the agent which project it is about, in front of its first message and again after you move it to another project, so it no longer has to guess from what you typed. The line stays out of the conversation view (#50)
- Pi joins Claude Code, Codex and OpenCode as an agent: Settings › Agents › Pi turns it on once `pi` is installed and has a login or key. Pick its models and thinking levels, paste images, resume, fork or continue a session in the terminal, and see its tokens and cost in Usage. Pi never asks before it edits files or runs commands, so there are no permission cards (#46)
- A conversation you close greys out and pulses in the sidebar until it is gone, so a slow close (stopping the agent, removing its worktrees) shows that it is working. Close all greys out every conversation it closes at once (#48)
- Meetings from Google Calendar show at the top of Waiting from half an hour before they start, with a banner 5 minutes before. Each has **Join**, **Meeting note** (a conversation that makes the meeting's note in the vault) and **Prepare** (a briefing from what the vault knows about the people and the topic). Add a calendar under Settings › Integrations › Calendar with its secret iCal address, which stays in the keychain. Meetings you declined, marked free or are alone in are left out (#54)
- Relay opens `relay://` links, so Raycast, Alfred or a browser can reach Cmd-K from outside the app: `relay://ask` opens Cmd-K, `relay://ask?q=…` asks a quick question, `relay://open?q=…` opens the best matching project. The window comes forward either way (#65)
- The model and effort pickers name the CLI's own defaults, for example "claude-opus-5-5 (default)", once a new conversation ran without a pick. Relay shows what the CLI reports it runs on instead of guessing from its settings. Claude Code doesn't report its effort, so that picker keeps "Default effort" (#63)
- Linear issues open in Relay with descriptions, activity, comments, status and assignee changes, file attachments, and ticket conversations (#62).
- Trello cards open in Relay with descriptions, activity, comments, list and member changes, file attachments, and ticket conversations (#60).
- Mail can archive and delete, as an experimental switch in Settings › Mail: archive (E) or delete (#) the open mail or a selection (Cmd- or Shift-click, Cmd-A for all), mark a selection read or unread, and the list splits into Inbox and Other, where newsletters and notifications from people you never wrote to go. Archived mails go to the Archive folder (Gmail: All Mail), deleted ones to the Trash, for Gmail and other IMAP servers alike; Claude still cannot move or delete mail (#61)
- Cmd-K can find projects by name, label, alias or context. Choose a result with the arrow keys and Enter, or click it, to open the project; Enter without a selection still asks a quick question (#58)

### Removed

- The right panel's tabs (open items, status, reminders, pull requests), its "today" list and the ⌥⌘I shortcut. (#70)

### Changed

- Usage shows the totals only: the breakdowns by model and by conversation sit under "Details" and open when you click it
- Settings › Integrations › Calendar works like Mail: your calendars in a list with a "+ Add calendar" button that opens the steps in place of the list. Every integration page now ends with its own "Remove" section, so Remove no longer sits under the last calendar or account as if it removed that one
- The interface is rebuilt on React with domain-driven layers: it looks and behaves as before, a streaming answer only redraws itself, text typed while a turn runs outside Relay is no longer lost, a language switch redraws everything, a note created during a turn turns the links in earlier answers into links, links in a mail reach the confirmation bar again, and a relay://ask link fills in Cmd-K instead of sending on its own
- The fixed right panel is gone. A project's board, pull requests, terminal and notes are now icons at the top right of the title bar, and a drawer opens on the right only when you ask for it or open a card or note. The board and pull requests open as the project's, with the same icon, the project name or Esc to go back to the conversation. The button that resumes the conversation in iTerm or WezTerm moved next to its title. (#70)

### Fixed
- Banners no longer leave a Relay process running for every one you didn't click: each conversation keeps only its latest banner's process, a new banner ends the previous one (#51)
- The Remove button on an integration's page works again (#54)
- Open in Terminal works without iTerm: Settings › General › Terminal picks iTerm, WezTerm or Terminal, and Automatic (the default) takes the first one installed. A terminal that fails to open now shows an error instead of doing nothing (#67)
- Cmd-K questions use the model and effort saved for their own agent, even when a conversation with a different agent is open (#56)
- Repeated drags of a board card are saved in order. A failed move restores its last saved position, and late replies cannot change a different board after you switch views (#57)
- The first message of a project conversation (and the first one after a move) no longer disappears when Relay reopens the conversation after a restart or reload
- Codex, Pi and OpenCode now hear about the `relay` actions too, as Claude already did (the hint goes into each CLI's system prompt)
- Settings › Integrations › Mail, Agents and Projects have even spacing again. Mail lists your accounts with a "+ Add account" button (Gmail, another mail server, or a password already in the keychain) that opens the steps in place of the list, instead of showing them under it all the time (#68)
- Working animations recover active conversations after a reload for every provider and identify the agent that is running. (#64)

## [0.0.2] - 2026-10-01

### Added
- Mail works with any IMAP mail server, not only Gmail: Settings › Integrations › Mail › Other mail server (IMAP) takes the address, server, port and password (stored in the macOS keychain). All accounts show in one inbox, newest first, with the account on each row. Claude searches the inbox of such an account and saves replies as drafts in its Drafts folder; nothing is ever sent (#41)
- A Productive board's Presets menu also lists the project's saved views from Productive (read only), above the presets you keep in Relay; picking one applies its filters, grouping and layout (kanban or list). A view that uses a filter Relay can't apply shows greyed out (#42)
- Boards get a toolbar: search with a task count, a Kanban/List toggle, Group lanes by, Filters (state, status, assignee, folder, task list, labels, each with its count) shown as removable chips, and Presets, filter sets you save under a name per board. The list view has foldable lanes, and done lanes start folded (#39)
- Opening a Productive task shows it in a window over the board, with previous/next, status and assignee pickers, comments, files and "Start conversation" (#39)
- Every version is a GitHub release with the macOS app to download and that version's changes as its notes (#36)
- Productive's task panel shows a thumbnail of every picture attached to the task or a comment; a click opens the original in your browser. **Discuss** starts a conversation about the task: Claude reads the task and its comments itself and posts nothing in Productive unless you ask (#40)
- Right-click on Algemeen or a project › Close all conversations closes every conversation and terminal session under it; one undo brings them all back (#38)
- Closing a conversation removes the git worktrees it made in your `~/projects` repos; the branches stay, and a worktree with uncommitted changes or unsaved commits is kept. The undo bar says how many went (#37)
- Settings › General › Appearance picks light or dark mode, or System (the default) to follow macOS; both windows switch right away (#27)
- Typing `/` in the composer lists Claude Code's slash commands and skills for the vault, with their descriptions; arrows pick, Tab or Enter completes, Escape closes. Relay asks Claude Code for the list when it starts (#26)
- A copy button on an answer when you hover it, and on each code block, in conversations and in the right panel (#26)
- The Productive board catches up with the bb plugin: group the columns by task list or by status (dragging a card then changes its status), search the cards, filter them by assignee and fold columns away. A task's panel shows its attachments and those on comments, takes new files (Add files, or drop them on the panel), posts comments and changes the status and assignee in place. Search, the assignee filter and folding work on the Trello and Linear boards too (#28)
- Trello and Linear can take their credentials from Claude Code's MCP config too, like Productive. When Claude Code has them for an integration that is not set up yet, Relay says so and offers to import them; otherwise the import sits under the integration's "…" menu, next to Clear token
- Vault notes named in a conversation open in the right panel: `[[wikilinks]]`, markdown links and `path.md` in code are clickable, and so is a Read/Edit line on a note. Links inside the opened note work too, so you can click through; only notes that exist in the vault become links (#22)
- A macOS notification when a turn ends, a turn stops or something waits for you while Relay is in the background; clicking it opens that conversation (#18)

### Changed
- Mail is laid out like the Pull requests view: the inbox on the left with search, read state and project filters, the mail you pick on the right at full width instead of in the side panel, so you can step through the inbox without closing anything (#39)
- Pull requests get the new look, laid out like Mail: the list on the left (waiting for your review, yours) with state-coloured icons and CI and review status, the PR you pick on the right with its branch, checks, conversation, code comments and files, Open on GitHub and AI review. "Updated N min ago" with a refresh button sits in the title bar; a PR in the right panel opens there too (#39)
- Waiting for you follows the redesign: each item has a header with the agent, project and conversation plus an "Open conversation" link, questions and blocked terminal sessions get the new cards, and the empty state is centered (#39)
- Reminders get the new look: a New reminder button in the title bar opens the form as a card with date, project and repeat pills, groups have coloured headers, rows have a round done button, and finishing or moving a reminder shows an Undo bar (#39)
- The right panel follows the redesign: it sits on the main background, the tabs span the full width, open items get round checkboxes, reminder dates colour by urgency, and pull requests show a state-coloured icon with the CI result as a dot (#39)

- The settings window follows the redesign: a nav with ⌘1 to ⌘4 hints, Appearance as a segmented control, Accent as two swatches, and lists with icon tiles and chevrons (#39)

- The conversation follows the new design: tool calls fold into a "N steps" line with icons and small diffs, code blocks get a header with a copy button, permission cards stand out, and the composer has an attach button and round send button (#39)
- Board cards are redrawn: number, assignee, status ring, folder › task list, labels, due day and last update. Trello and Linear show the fields they have (labels, last update, Linear's state) (#39)
- The sidebar follows the redesign: section headers with their context's colour and a chevron, a blue tint on the selected row, conversations nested under their project, and a footer with the Relay mark, usage, a light/dark switch and settings. The title bar shows project / conversation and whether the agent is working (#39)
- The redesign's palette: Relay blue for selection, primary buttons and what waits for you, cooler greys, raised cards with a soft shadow and 8px corners on buttons and fields. Settings › General › Accent switches to Graphite (the text colour) instead. The settings window uses the same palette as the main window now (#39)
- Each integration in Settings › Integrations opens a page of its own instead of folding open in the list, with its connection on top and, for board integrations, the boards per vault project below. That part now lists only the vault projects that have a board, suggests boards whose name matches a project (one click, or Link all), and adds one with a project and a board picker instead of a dropdown for every project. Boards are grouped by workspace (#33)
- Setting up Linear walks you through creating the API key in three steps, with a link to Linear's Security & access page and a Create key button next to the field; a pasted value that isn't a personal API key (lin_api_…) is caught before saving (#35)
- A conversation in the sidebar shows its agent's own mark (Claude, Codex, OpenCode) in one colour instead of a speech bubble; the composer's agent picker only shows on a new conversation, where you can still switch (#31)
- A calmer look: warm off-white panels, charcoal text and buttons instead of blue, hairline borders, barely-there shadows, smaller corner radius on buttons and fields, and status pills (CI, review, conflict) in pale green, red or grey. Dark mode follows the same palette (#27)
- Quitting Relay no longer cuts a running turn loose: the agent keeps working under a small broker process (about 2 MB), and Relay picks the conversation back up when you reopen it within 15 minutes, so you can keep typing instead of seeing "handled outside the app". Idle agents stop when Relay quits; the next message resumes them (#17)
- Each vault keeps its own Relay settings in `.relay/config.json`: the folder mapping (moved out of the app's settings), the headings it uses for open items and status in its own language, its contexts, the folders to skip and which GitHub repo belongs to which project. Relay creates the file from what it detects the first time it opens a vault, so English, Dutch, French and German vaults all work (#19)
- PRs per project now find their repos: checkouts in the usual code folders are matched to projects by name
- Settings › Projects is one list of all projects; each opens to its name in Relay, its icon on one line (emoji or website in one field, upload, none, guess again) and its GitHub repositories, which you can add or remove
- Project icons live in the vault: `.relay/config.json` (`icons`) says per project whether it is an image in `.relay/icons/`, an emoji, or a website whose favicon Relay fetches. Every project without one gets its favicon right away when Relay first opens the vault, and icons set before move there once. Settings › Projects › Project icons overrides any of them (emoji, website, upload, none, guess again), and **Find icons** lets Claude look up a website for every project without an icon (web search only): the client, else the project's own product, else the tool it is about (plesk.com for a Plesk server, n8n.io for n8n automations), so its favicon follows. Icons are also found via apple-touch-icon, /favicon.png and DuckDuckGo's favicon service when a site's page declares none
- Favicons and the "this conversation is about" suggestion work wherever a vault keeps its project notes, not only under `Projects/` or `Portfolio/`; a project with a short name like o2o gets its site too (only a domain that is exactly its name, o2o.be)

### Fixed
- `/clear` in a Claude Code conversation now empties it in Relay too; before, the old messages stayed on screen even though Claude had started over (#34)
- Connecting Trello no longer sends you looking for OAuth: Settings › Integrations › Trello walks you through it in three steps, with a link to create the Power-Up, the API key field first and a Get token button that opens Trello's allow page for that key. Pasting the Secret or something that isn't a token now says so before saving (#30)
- The Trello steps name the tab where Trello now keeps the API key, Authorization › Trello Auth, instead of the old API key tab (#32)
- A long URL or path in a conversation wraps instead of pushing the whole chat sideways under a horizontal scrollbar (#29)
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

[Unreleased]: https://github.com/Relay-inc/relay-app/compare/v0.0.35...HEAD
[0.0.35]: https://github.com/Relay-inc/relay-app/compare/v0.0.34...v0.0.35
[0.0.34]: https://github.com/Relay-inc/relay-app/compare/v0.0.33...v0.0.34
[0.0.33]: https://github.com/Relay-inc/relay-app/compare/v0.0.32...v0.0.33
[0.0.32]: https://github.com/Relay-inc/relay-app/compare/v0.0.31...v0.0.32
[0.0.31]: https://github.com/Relay-inc/relay-app/compare/v0.0.30...v0.0.31
[0.0.30]: https://github.com/Relay-inc/relay-app/compare/v0.0.29...v0.0.30
[0.0.29]: https://github.com/Relay-inc/relay-app/compare/v0.0.28...v0.0.29
[0.0.28]: https://github.com/Relay-inc/relay-app/compare/v0.0.27...v0.0.28
[0.0.27]: https://github.com/Relay-inc/relay-app/compare/v0.0.26...v0.0.27
[0.0.26]: https://github.com/Relay-inc/relay-app/compare/v0.0.25...v0.0.26
[0.0.25]: https://github.com/Relay-inc/relay-app/compare/v0.0.24...v0.0.25
[0.0.24]: https://github.com/Relay-inc/relay-app/compare/v0.0.23...v0.0.24
[0.0.23]: https://github.com/Relay-inc/relay-app/compare/v0.0.22...v0.0.23
[0.0.22]: https://github.com/Relay-inc/relay-app/compare/v0.0.21...v0.0.22
[0.0.21]: https://github.com/Relay-inc/relay-app/compare/v0.0.20...v0.0.21
[0.0.20]: https://github.com/Relay-inc/relay-app/compare/v0.0.19...v0.0.20
[0.0.19]: https://github.com/Relay-inc/relay-app/compare/v0.0.18...v0.0.19
[0.0.18]: https://github.com/Relay-inc/relay-app/compare/v0.0.17...v0.0.18
[0.0.17]: https://github.com/Relay-inc/relay-app/compare/v0.0.16...v0.0.17
[0.0.16]: https://github.com/Relay-inc/relay-app/compare/v0.0.15...v0.0.16
[0.0.15]: https://github.com/Relay-inc/relay-app/compare/v0.0.14...v0.0.15
[0.0.14]: https://github.com/Relay-inc/relay-app/compare/v0.0.13...v0.0.14
[0.0.13]: https://github.com/Relay-inc/relay-app/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/Relay-inc/relay-app/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/Relay-inc/relay-app/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/Relay-inc/relay-app/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/Relay-inc/relay-app/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/Relay-inc/relay-app/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/Relay-inc/relay-app/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Relay-inc/relay-app/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Relay-inc/relay-app/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/LaurentMe/vault-app/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/LaurentMe/vault-app/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/LaurentMe/vault-app/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/LaurentMe/vault-app/releases/tag/v0.0.1
