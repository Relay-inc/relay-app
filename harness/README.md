# Relay test harness

Runs the real frontend in a browser against a mocked Tauri backend, to screenshot every view and measure performance.
It mocks only the boundary: Tauri IPC (`invoke`), the event plugin and the window. It never imports app code, so the same
harness measures the Lit frontend and a rewrite that keeps the same commands, events and localStorage keys.

## Files

| File | What |
|---|---|
| `vite.config.ts` | The root `vite.config.ts` plus a plugin that puts `<script type="module" src="/harness/mock-backend.ts">` first in `index.html` and `settings.html`. Port 1430 (dev), 1431 (preview of a production build in `harness/dist`). |
| `mock-backend.ts` | `mockIPC` + `mockWindows`: answers every command in `src-tauri/src/lib.rs`'s `generate_handler!` plus `plugin:event|*`, `plugin:window|*`, `plugin:opener|open_url`. Exposes `window.__harness`. |
| `fixtures/` | Deterministic data, all fictional: 12 projects, 60 conversations (one with 300 items), a permission card, a question and an agent-action card (`relay productive.create_task`), subagents, two terminal sessions and a blocked background one, two mail accounts (60 Gmail mails, plain and HTML, and 8 on a generic IMAP server), PRs with checks, a Productive board (JSON:API) with saved views and a picture attachment, reminders, calendar meetings, usage, agents (Claude, Codex, OpenCode, Pi), the agent actions and their policies. Dates are relative to `NOW` = 2026-10-01 09:30 Brussels. |
| `lib.mjs` | Server (dev or production build), browser launch, page helpers that only use the DOM. |
| `screens.mjs` | Screenshots of every view. |
| `diff.mjs` | Pixel diff of two screenshot sets. |
| `behaviour.mjs` | Behaviour parity: per scenario the backend calls a frontend makes, checks and facts. |
| `perf.mjs` | Performance scenarios. |

## Run

```sh
node harness/screens.mjs --label lit2                     # harness/screens/lit2/<view>.png (Chromium, dev server)
node harness/screens.mjs --label lit2 --only waiting,usage # a subset
node harness/diff.mjs lit2 react                          # harness/screens/diff-lit2-react/ + report.md
node harness/behaviour.mjs --url http://127.0.0.1:1432 --label lit2   # harness/results/behaviour-lit2.json
node harness/behaviour.mjs --compare lit2 react           # per-scenario diff of two behaviour results
node harness/perf.mjs --label lit --browser chromium      # harness/results/lit-chromium.json
node harness/perf.mjs --label lit --browser webkit        # WebKit, closest to the WKWebView Tauri uses on macOS
pnpm exec vite --config harness/vite.config.ts            # the app with the mock, to click around: http://127.0.0.1:1430/?fixture=dark
```

Options: `--browser chromium|webkit` (both scripts), `--runs N` and `--only a,b` (perf), `--dev` (perf on the dev
server instead of a production build), `--url http://…` (use a server that already runs; needed when :1430 is taken,
e.g. `pnpm exec vite --config harness/vite.config.ts --port 1432` and `--url http://127.0.0.1:1432`).
Browsers: Playwright's Chromium and WebKit (`pnpm exec playwright-core install chromium webkit`); Chromium falls back to
the installed Google Chrome.

## The mock

URL query: `?fixture=default|dark|graphite|icons|onboarding|calendar|accounts|mailexp|orch|plugins|plugins-dark` (orch: `orch_workers` gives three workers (running, done with a diff, silent), `c:orch` has a folded `[Relay]` report, `__harness.orchLive()` emits the live `orch` events; dark: settings theme dark; graphite: the graphite accent;
icons: the sidebar's views as a row of icons; onboarding: `vault_status` not ok, no vault; calendar: two calendars switched on, the second one failing; accounts: Claude Code
on two extra logins, the work one active, auto-switch on; mailexp: the experimental mail flag on, so archive, delete and the Inbox/Other split; plugins(-dark): the example plugin (packages/plugin-example) set up, so its view is in the sidebar and `?sel=__plugin:example` opens it), `?sel=<key>` the view or
conversation the window opens on, `?link=<relay:// url>` the deep link the app was launched with (`plugin:deep-link|get_current`). On every load the mock resets localStorage to the fixture:
the conversation list (`chats`), `sel`, and the Productive board choice (`pvProject`, `pvBoard`). The window is
transparent over the macOS sidebar material in Tauri; the mock gives `html` the `--sidebar` token as its stand-in.

`window.__harness`:

| Member | What |
|---|---|
| `ready` | Resolves after the window's start-up calls went quiet for 250 ms (polls excluded). |
| `calls` | Every invoked command with its args and `performance.now()`. |
| `unmocked` | Commands that got the default `null` (should stay empty). |
| `emit(event, payload)`, `emitAgent(key, event, provider?)` | Emit a backend event synchronously, like Tauri does (one task per event). |
| `stream({ key, deltas, tokensPerDelta, ratePerSecond })` | A turn as the backend sends it: `tool_call`, `tool_result`, text deltas, `turn_end`. `ratePerSecond: 0` sends each delta in the task after the previous one. Resolves with per-delta handling times and the total until painted. |
| `deepLink(url)` | A `relay://` link while the app runs (the `deep-link://new-url` event). |
| `resolved(key, model?, effort?)` | The `resolved` agent event: what a fresh session ran on when model and effort were left to the CLI. |
| `orchLive()` | The orchestrator's live `orch` events (fixture orch): a new worker, a worker that reports, the `sent` report into `c:orch`. |
| `liveTail(key?)` | Live events on the long conversation: a running tool, a failed one, an error, a draft note. |
| `pickFolder` | What `pick_folder` answers (null, the default, is cancelled). |
| `pickFiles`, `pastedFiles` | What `pick_files` (the + dialog) and `pasted_files` (Finder copy) answer; `[]` by default. |
| `dropPaths(paths)` | A Finder drop as Tauri sends it: `tauri://drag-enter`, then `tauri://drag-drop` with `{ paths, position }`. Emit `tauri://drag-leave` (no payload) to end a hover. |
| `addPending(request)` | Puts a permission card in the next `pending` poll. |
| `autoReply` | `send` answers with a short stream (on by default, perf turns it off). |
| `keys`, `titles`, `markers` | The fixture's special conversations and texts to wait for. |
| `nextTask()`, `nextPaint()` | A task after the current one; a task after the next animation frame (the frame has painted). |

`pty_*` is a fake shell that prints a prompt and echoes what is written to it, over the Channel the frontend passes; `scratch_*` keeps the notes in memory.

Commands answered with stubs (no real effect): `pick_folder` (`pickFolder`, cancelled by default), `pick_path` (cancelled), `open_file` (recorded in `calls`, rejects "not found" for a path containing `missing`), `read_image` (a small PNG for png/jpg/jpeg/gif/webp, rejects otherwise), `mail_connect`, `mail_test`,
`integration_token`, `integration_import`, `favicons`, `find_icon_sites` (nothing found), `set_project_icon`,
`set_project_repos`, `ignore_repo`, `ai_title` (first five words), `stop`, `bg`, `open_terminal`, `notify`, `open_settings_window`,
`reset`, `move_chat`, `plugin:opener|open_url`, `running` (`{}`: no process of the app runs a turn).
With state in memory: `reminder` (done drops a row or moves a repeating one on, push moves it) and `reminder_add`
change the snapshot, so undo works; reminder ids are 8 hex characters as the backend makes them. `set_settings` keeps
the settings but emits no `settings-changed`. `set_action_config` keeps the extension's entry, `action_config` returns
the actions and the entries. `drop_worktrees` removes one worktree for the switch-to conversation, none for the others.
`mail_list` answers per `account`, every row with `other` (true for the machine-sent senders, only with the experimental
flag). `mail_move` refuses with the flag off, as the backend does, and otherwise drops the mails from later `mail_list` pages. `calendar_meetings` gives five meetings around `NOW` (three under Waiting, the one in 4 minutes due a banner) while the calendar is on, `calendar_connect` refuses an address that is not a Google secret iCal one and counts 3 meetings otherwise. `agent_commands` per provider. `integration_thumb` returns a PNG for the fixture's
thumb URL. `plugins_list`, `plugin_*`: the one example plugin, its view served from a blob (the app uses the `relay-plugin://` scheme, which a browser cannot load), `plugin_call` rolls a fixed 4 and refuses a tool the settings do not allow. `integration_call` serves Productive only (Trello and Linear throw); writes (move, status, comment, labels) patch the
in-memory tasks loosely, and a new task (`POST /tasks`) is added to them.

## Screenshots for a pull request

A PR that changes what someone sees in the app shows it in its description: the new or changed state, and where it
helps the before. The screenshots come from this harness, not from a running Relay (that one holds port 1420 and your
own data).

1. **A view per state.** Add a view to `VIEWS` in `screens.mjs` that opens the fixture and clicks to the state, with a
   comment saying what it shows and the PR number. Navigate the way a user would (visible text, roles, keys); for what
   only the backend causes, use a lever of `window.__harness` (`emit`, `recordingTick`, `dictationLevel`, `addPending`,
   …), or add one to `mock-backend.ts`. `recording-meeting` and `recording-dictation` are small examples.
2. **Run only those:** `node harness/screens.mjs --label pr<number> --only <view>,<view>` writes
   `harness/screens/pr<number>/<view>.png` (git ignores `harness/screens/`). Add `--browser webkit` when layout is the
   point: WebKit is what the app runs in, Chromium hides some overflow. A close-up is a `page.screenshot({ clip })` in a
   one-off script on `lib.mjs` (`startServer`, `launch`, `newPage`, `open`).
3. **Look at them** before you upload: the state you meant, no `[harness] unmocked command` warnings, no error toast.
4. **Upload:** `scripts/pr-screenshots.sh <number> harness/screens/pr<number>/*.png` puts them on the `pr-assets`
   branch (never merged, so main carries no images) and prints an `<img>` line per file. Paste those under a
   `## Screenshots` heading in the PR description, with a line on what each shows. Running it again for the same PR
   replaces its folder, so pass all of its screenshots. The repo is private: the images show to whoever can see it.

A command the app calls that the mock does not answer shows as `unmocked command` and usually breaks the screen. So a
new Tauri command (`generate_handler!` in `src-tauri/src/lib.rs`) gets its answer in `mock-backend.ts` in the same PR.

## Views (`screens.mjs`)

86 views. Conversation: waiting, waiting-calendar (meetings about to start and a calendar that failed), conversation-long-top, conversation-long-bottom (after `liveTail`),
conversation-permission, conversation-action (an agent action's card), conversation-code (a code block and its header),
conversation-steps (a tool group unfolded), composer-slash (`/` completion), composer-resolved (the pickers name the CLI's
defaults), composer-files (a picture and two file chips waiting), conversation-files (a sent message with chips), conversation-unread (a message sent mid-turn, waiting for Claude), conversation-question, new-general-draft (the menu event `new-general`, Cmd-T), terminal. Mail and PRs:
mail-second-account, mail-list, mail-plain, mail-html, mail-experimental (Inbox/Other tabs, archive and delete in the
mail's bar), mail-other (the Other tab), mail-selection (three mails ticked, the bulk bar), prs-list, pr-detail (list and mail or PR side by side). Board:
board, card-detail (the ticket window), board-list, board-filters, board-presets, board-group, ticket-activity.
Reminders: reminders, reminders-datepicker, reminders-form, reminders-undo. Navigation: usage, usage-details (Details folded open), cmd-k, cmd-k-project, cmd-k-file (a dropped file chip in Cmd-K),
deep-link-ask, deep-link-open, sidebar-menu, closed-toast, project-tools (a project conversation's title bar), drawer-terminal, drawer-notes, tool-board, tool-prs (the project's board and PRs). Orchestrator: orchestrator (the coordinator with the worker board in the drawer), orchestrator-open (the report and a worker's details unfolded), orchestrator-live (a worker starts, another reports), orchestrator-worker (a worker under its project). Settings
(settings.html at 900x700): settings-general, settings-projects, settings-agents, settings-integrations,
settings-interface (appearance, accent, terminal), settings-sidebar, settings-permissions (Settings › General › Permissions, Full Disk Access missing), settings-plugins (Settings › Plugins, empty), settings-plugins-list and settings-plugin (the example plugin set up: its row, its page and its tools), plugin-view and plugin-view-dark (its view in the middle column after a roll through the bridge), settings-integration-productive,
settings-integration-github, settings-integration-mail, settings-integration-mail-experimental (the switch on),
settings-integration-calendar, settings-integration-commonwealth, settings-commonwealth-joined (Commonwealth's page, then the report after Join), settings-agent-access, settings-agent-claude (Claude Code's row
folded open, no extra account), settings-agent-accounts (two accounts, the account picker and auto-switch). Other: onboarding (the starter vault offered), onboarding-own (a vault of one's own), onboarding-setup (Start offers the setup interview or Skip), onboarding-setup-started (the setup conversation sent), dark-waiting,
dark-conversation, graphite-waiting, sidebar-icons, dark-board, dark-mail, dark-usage. Recording: recording-meeting (the bar in Waiting
for you and the sidebar's row), recording-dictation (dictation in a conversation, the row seen from Reminders).

1440x900 at device scale 2, page clock fixed to `NOW`, reduced motion, animations disabled, caret hidden. Navigation
uses only visible text, roles, keys (Meta+K), `?sel=` and the backend's menu event. Two runs of the same build diff
at 0.00 %.

What a rewrite has to keep for the screens to navigate: the visible labels (English), the `chats`/`sel`/`pv*`
localStorage keys, one visible `textarea` as the composer, the reminder date button named "Pick a date" and the done
button named "Done", the board's view buttons named "Kanban"/"List", the usage button's accessible name starting with
"Usage" or "Claude Code", the model picker as a `select` whose selected option reads "Opus (default)" after `resolved`,
the comment field's placeholder "Leave a comment…", and an HTML mail shown in an `iframe` whose `srcdoc` holds the mail
(mail-html waits for it).

## Behaviour (`behaviour.mjs`)

30 scenarios, each on fresh page loads, driven by visible text, roles, the composer, the keyboard and localStorage:
send, stop, cards (permission, question, agent action), attachFiles (+ picker, Finder drop, chips, the `<relay-files>` block, open and reveal, auto-allowed Reads of attached paths, Cmd-K takes the drop), cmdk, newGeneral, renameClose (with the worktree toast), sidebar,
mail (two accounts merged, read per account, load more, the link bar), mailTriage (experimental: Inbox/Other, E and #,
a held key acting once, Cmd- and Shift-click, Cmd-A, Esc, bulk read and delete, a reload keeps moved mails gone),
mailTriageFilter (mails a read filter hides after a bulk read leave the selection), mailTriageOff (without the flag: no
tabs, no checkboxes, E does nothing), prs (side by side, Review with Claude), board (ticket
window, comment, status, Start conversation), boardNewTask (New task in the title bar and a lane's +), boardTools (list view, filters, Productive's saved views, grouping),
reminders, reminderUndo, settings (theme, accent, GitHub owners, language), calendar (the meetings under Waiting, the banner, Join, Prepare and Meeting note as restricted conversations on Claude), calendarNoClaude (refused with Claude off), calendarSettings (add, a refused address, remove), agentAccess (policy and access per
extension), agentAccounts (add a folder, pick it for new conversations, auto-switch, rename, remove), cmdkProject, deepLinks (at launch and while running), resolvedDefaults, slashCommands, closeAll, typedDraft,
typingOutside. Calls are normalised (conversation keys as `chat:<project>/<title>`, new ones `new#n`, dates masked) and
split into effects and counted reads. `KNOWN` lists checks a Lit baseline fails on purpose: three Lit bugs (typingOutside,
the mail link bar, mailTriageFilter) and one intended difference (deepLinks: a `relay://ask?q=` link opens Cmd-K with the text and waits
for Enter, Lit sends it at once). The mock leaves sessionStorage alone, as a webview reload does: a launch link handled
once (React keeps them under `handledLinks`) is not handled again by a reload in the same page, a new page handles it. `DEBUG=1` prints the full error of a scenario. Two runs of the same build give identical files.

## Numbers (`perf.mjs`)

Every scenario starts from a fresh page load and runs 5 times; the table shows the median over the runs and the p95
over the runs. Production build by default. All times are `performance.now()` in the page.

| Scenario | Measures |
|---|---|
| Cold start | Navigation start until the first general conversation title ("What is on today") is in the sidebar, 60 conversations. Checked every animation frame. |
| Open the 300-item conversation | From a click on its sidebar row (from the waiting view) until its last line is in the DOM and the next frame painted. Includes `history`. |
| 1,000 deltas as fast as possible | On the open 300-item conversation. Total: first event until the frame after `turn_end` painted. Per delta: from emitting one text delta until the next task, so the handler and the microtasks it queued (a Lit render) are in it; p50 and p95 within a run. Long tasks: `PerformanceObserver` longtask entries (Chromium); WebKit has none, so there it counts deltas whose handling took over 50 ms. A framework that renders in a later task (React's scheduler) shows its render in the total, not per delta. |
| JS heap | Chromium only, after the 1,000-delta stream and a forced GC (CDP `Runtime.getHeapUsage`). |
| 60 deltas/s for 10 s | 600 deltas on the 300-item conversation. Animation-frame intervals during the stream: count over 20 ms, the longest, and p95. |
| Switch | Click the other conversation's row, until its last line shows and the next frame painted. 20 switches between the 300-item conversation and a short one, average per run. |
| Typing | 200 characters typed into the composer of the 300-item conversation. From each keydown's `timeStamp` until the next frame painted, p50 and p95 per run. |

Caveats: headless browsers; Playwright's WebKit is not the WKWebView Tauri runs in, but it is the same engine; WebKit's
`performance.now()` is rounded to 1 ms. The "until shown" checks walk the DOM through the shadow roots every frame,
which adds a little to the open and switch times, the same for every frontend.
