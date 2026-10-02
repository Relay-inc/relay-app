# Relay test harness

Runs the real frontend in a browser against a mocked Tauri backend, to screenshot every view and measure performance.
It mocks only the boundary: Tauri IPC (`invoke`), the event plugin and the window. It never imports app code, so the same
harness measures the Lit frontend and a rewrite that keeps the same commands, events and localStorage keys.

## Files

| File | What |
|---|---|
| `vite.config.ts` | The root `vite.config.ts` plus a plugin that puts `<script type="module" src="/harness/mock-backend.ts">` first in `index.html` and `settings.html`. Port 1430 (dev), 1431 (preview of a production build in `harness/dist`). |
| `mock-backend.ts` | `mockIPC` + `mockWindows`: answers every command in `src-tauri/src/lib.rs`'s `generate_handler!` plus `plugin:event|*`, `plugin:window|*`, `plugin:opener|open_url`. Exposes `window.__harness`. |
| `fixtures/` | Deterministic data, all fictional: 12 projects, 60 conversations (one with 300 items), a permission card, a question and an agent-action card (`relay productive.create_task`), subagents, two terminal sessions and a blocked background one, two mail accounts (60 Gmail mails, plain and HTML, and 8 on a generic IMAP server), PRs with checks, a Productive board (JSON:API) with saved views and a picture attachment, reminders, usage, agents (Claude, Codex, OpenCode, Pi), the agent actions and their policies. Dates are relative to `NOW` = 2026-10-01 09:30 Brussels. |
| `lib.mjs` | Server (dev or production build), browser launch, page helpers that only use the DOM, `dropFiles` (a drop of files made in the page). |
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

URL query: `?fixture=default|dark|graphite|icons|onboarding` (dark: settings theme dark; graphite: the graphite accent;
icons: the sidebar's views as a row of icons; onboarding: `vault_status` not ok, no vault), `?sel=<key>` the view or
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
| `liveTail(key?)` | Live events on the long conversation: a running tool, a failed one, an error, a draft note. |
| `autoReply` | `send` answers with a short stream (on by default, perf turns it off). |
| `keys`, `titles`, `markers` | The fixture's special conversations and texts to wait for. |
| `nextTask()`, `nextPaint()` | A task after the current one; a task after the next animation frame (the frame has painted). |

Commands answered with stubs (no real effect): `pick_folder`/`pick_path` (cancelled), `mail_connect`, `mail_test`,
`integration_token`, `integration_import`, `favicons`, `find_icon_sites` (nothing found), `set_project_icon`,
`set_project_repos`, `ai_title` (first five words), `stop`, `bg`, `open_terminal`, `notify`, `open_settings_window`,
`reset`, `move_chat`, `plugin:opener|open_url`, `running` (`{}`: no process of the app runs a turn).
With state in memory: `reminder` (done drops a row or moves a repeating one on, push moves it) and `reminder_add`
change the snapshot, so undo works; reminder ids are 8 hex characters as the backend makes them. `set_settings` keeps
the settings but emits no `settings-changed`. `set_action_config` keeps the extension's entry, `action_config` returns
the actions and the entries. `drop_worktrees` removes one worktree for the switch-to conversation, none for the others.
`mail_list` answers per `account`. `agent_commands` per provider. `save_attachment` returns `/var/folders/T/relay-attachments/<1001…>/<name>` and refuses a name starting `too-big` (over 50 MB). `integration_thumb` returns a PNG for the fixture's
thumb URL. `integration_call` serves Productive only (Trello and Linear throw); writes (move, status, comment) patch the
in-memory tasks loosely.

## Views (`screens.mjs`)

59 views. Conversation: waiting, conversation-long-top, conversation-long-bottom (after `liveTail`),
conversation-permission, conversation-action (an agent action's card), conversation-code (a code block and its header),
conversation-steps (a tool group unfolded), composer-slash (`/` completion), composer-files (a picture, a PDF and a file too big dropped on the composer), composer-resolved (the pickers name the CLI's
defaults), conversation-question, new-general-draft (the menu event `new-general`, Cmd-T), terminal. Mail and PRs:
mail-second-account, mail-list, mail-plain, mail-html, prs-list, pr-detail (list and mail or PR side by side). Board:
board, card-detail (the ticket window), board-list, board-filters, board-presets, board-group, ticket-activity.
Reminders: reminders, reminders-datepicker, reminders-form, reminders-undo. Navigation: usage, cmd-k, cmd-k-project, cmd-k-file (a spreadsheet dropped on Cmd-K),
deep-link-ask, deep-link-open, sidebar-menu, closed-toast, panel-open, panel-status, panel-reminders, panel-prs. Settings
(settings.html at 900x700): settings-general, settings-projects, settings-agents, settings-integrations,
settings-interface (appearance, accent, terminal), settings-sidebar, settings-integration-productive,
settings-integration-github, settings-integration-mail, settings-agent-access. Other: onboarding, dark-waiting,
dark-conversation, graphite-waiting, sidebar-icons, dark-board, dark-mail.

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

23 scenarios, each on fresh page loads, driven by visible text, roles, the composer, the keyboard and localStorage:
send, stop, cards (permission, question, agent action), cmdk, newGeneral, renameClose (with the worktree toast), sidebar,
mail (two accounts merged, read per account, load more, the link bar), prs (side by side, AI review), board (ticket
window, comment, status, Start conversation), boardTools (list view, filters, Productive's saved views, grouping),
reminders, reminderUndo, settings (theme, accent, GitHub owners, language), agentAccess (policy and access per
extension), cmdkProject, deepLinks (at launch and while running), resolvedDefaults, slashCommands, closeAll, typedDraft,
typingOutside, attachFiles (+ picker, drop, the error, send, Cmd-K drop). Calls are normalised (conversation keys as `chat:<project>/<title>`, new ones `new#n`, dates masked) and
split into effects and counted reads. `KNOWN` lists checks a Lit baseline fails on purpose: two Lit bugs (typingOutside,
the mail link bar) and one intended difference (deepLinks: a `relay://ask?q=` link opens Cmd-K with the text and waits
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
