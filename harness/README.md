# Relay test harness

Runs the real frontend in a browser against a mocked Tauri backend, to screenshot every view and measure performance.
It mocks only the boundary: Tauri IPC (`invoke`), the event plugin and the window. It never imports app code, so the same
harness measures the Lit frontend and a rewrite that keeps the same commands, events and localStorage keys.

## Files

| File | What |
|---|---|
| `vite.config.ts` | The root `vite.config.ts` plus a plugin that puts `<script type="module" src="/harness/mock-backend.ts">` first in `index.html` and `settings.html`. Port 1430 (dev), 1431 (preview of a production build in `harness/dist`). |
| `mock-backend.ts` | `mockIPC` + `mockWindows`: answers every command in `src-tauri/src/lib.rs`'s `generate_handler!` plus `plugin:event|*`, `plugin:window|*`, `plugin:opener|open_url`. Exposes `window.__harness`. |
| `fixtures/` | Deterministic data, all fictional: 12 projects, 60 conversations (one with 300 items), a permission card and a question, subagents, two terminal sessions and a blocked background one, 60 mails (plain and HTML), PRs with checks, a Productive board (JSON:API), reminders, usage, agents. Dates are relative to `NOW` = 2026-10-01 09:30 Brussels. |
| `lib.mjs` | Server (dev or production build), browser launch, page helpers that only use the DOM. |
| `screens.mjs` | Screenshots of every view. |
| `diff.mjs` | Pixel diff of two screenshot sets. |
| `perf.mjs` | Performance scenarios. |

## Run

```sh
node harness/screens.mjs --label lit                      # harness/screens/lit/<view>.png (Chromium, dev server)
node harness/screens.mjs --label lit --only waiting,usage # a subset
node harness/diff.mjs lit react                           # harness/screens/diff-lit-react/ + report.md
node harness/perf.mjs --label lit --browser chromium      # harness/results/lit-chromium.json
node harness/perf.mjs --label lit --browser webkit        # WebKit, closest to the WKWebView Tauri uses on macOS
pnpm exec vite --config harness/vite.config.ts            # the app with the mock, to click around: http://127.0.0.1:1430/?fixture=dark
```

Options: `--browser chromium|webkit` (both scripts), `--runs N` and `--only a,b` (perf), `--dev` (perf on the dev
server instead of a production build), `--url http://…` (use a server that already runs).
Browsers: Playwright's Chromium and WebKit (`pnpm exec playwright-core install chromium webkit`); Chromium falls back to
the installed Google Chrome.

## The mock

URL query: `?fixture=default|dark|onboarding` (dark: settings theme dark; onboarding: `vault_status` not ok, no vault),
`?sel=<key>` the view or conversation the window opens on. On every load the mock resets localStorage to the fixture:
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
| `liveTail(key?)` | Live events on the long conversation: a running tool, a failed one, an error, a draft note. |
| `autoReply` | `send` answers with a short stream (on by default, perf turns it off). |
| `keys`, `titles`, `markers` | The fixture's special conversations and texts to wait for. |
| `nextTask()`, `nextPaint()` | A task after the current one; a task after the next animation frame (the frame has painted). |

Commands answered with stubs (no real effect): `pick_folder`/`pick_path` (cancelled), `mail_connect`, `mail_test`,
`integration_token`, `integration_import`, `favicons`, `find_icon_sites` (nothing found), `set_project_icon`,
`set_project_repos`, `reminder`/`reminder_add` (the snapshot does not change), `ai_title` (first five words), `stop`,
`bg`, `open_terminal`, `notify`, `open_settings_window`, `reset`, `move_chat`, `plugin:opener|open_url`.
`set_settings` keeps the settings in memory but emits no `settings-changed`. `integration_call` serves Productive only
(Trello and Linear throw). Productive writes (move, status, comment) patch the in-memory tasks loosely.

## Views (`screens.mjs`)

waiting, conversation-long-top, conversation-long-bottom (after `liveTail`), conversation-permission,
conversation-question, new-general-draft (the menu event `new-general`, Cmd-T), terminal, mail-list, mail-plain,
mail-html, prs-list, pr-detail, board, card-detail, reminders, reminders-datepicker, usage, cmd-k, panel-open,
panel-status, panel-reminders, panel-prs, settings-general, settings-projects, settings-agents, settings-integrations
(settings.html at 900x700), onboarding, dark-waiting, dark-conversation, dark-mail.

1440x900 at device scale 2, page clock fixed to `NOW`, reduced motion, animations disabled, caret hidden. Navigation
uses only visible text, roles, keys (Meta+K), `?sel=` and the backend's menu event. Two runs of the same build diff
at 0.00 %.

What a rewrite has to keep for the screens to navigate: the visible labels (English), the `chats`/`sel`/`pv*`
localStorage keys, one visible `textarea` as the composer, the reminder date button named "Pick a date", the usage
button's accessible name starting with "Usage" or "Claude Code", and an HTML mail shown in an `iframe` whose `srcdoc`
holds the mail (mail-html waits for it).

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
