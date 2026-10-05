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

### Added

- **Time from sessions**: from 16:00 Today offers "Book today's time", built from when you wrote in your Claude Code conversations that day (10 minutes around each message, rounded to 15 per project). Relay opens a conversation that subtracts what Productive already has and proposes one time entry per project, each one approved on its card (#112)

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

[Unreleased]: https://github.com/Relay-inc/relay-app/compare/v0.0.7...HEAD
[0.0.7]: https://github.com/Relay-inc/relay-app/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Relay-inc/relay-app/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Relay-inc/relay-app/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/LaurentMe/vault-app/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/LaurentMe/vault-app/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/LaurentMe/vault-app/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/LaurentMe/vault-app/releases/tag/v0.0.1
