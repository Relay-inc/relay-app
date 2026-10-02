# Frontend architecture

The Relay frontend is React 19 on a layered, domain-driven structure. This document is the contract every change follows.

## Goals, in order

1. **Looks exactly like before.** Same Tailwind classes, same markup structure, same spacing. The harness screenshots (`harness/`) of every view are the bar: a pixel diff against the baseline only differs where the Lit version had a bug.
2. **Performant.** A stream delta redraws the streaming message and nothing else. Measured with `harness/perf.mjs`, before and after.
3. **Maintainable.** Clear layers, one bounded context per folder, logic testable without a DOM.

## Layers and the dependency rule

```
src/
  domain/<context>/          pure: types, rules, reducers. No React, Zustand, Tauri, DOM, localStorage, i18n calls.
  application/<context>/     the store (Zustand + Immer) and the use cases: load, act, poll, react to backend events.
  infrastructure/            the only code that talks to the outside: backend.ts (every Tauri command and event,
                             typed), storage.ts (localStorage), window.ts (title, theme, focus), opener.
  ui/                        React. app/ (shell, entry), features/<context>/, components/ (shared), hooks/.
  shared/                    i18n + locales, markdown, icons, small pure helpers. Imports nothing above it.
```

Imports only point down this list: `ui → application → domain`, `application → infrastructure`, everything → `shared`.

- `ui` never imports `infrastructure`. A component never calls `invoke`.
- `domain` imports only `domain` and `shared`.
- `infrastructure` imports only `domain` types and `shared`.

ESLint enforces this with `no-restricted-imports` per folder (`eslint.config.js`).

## Bounded contexts

The folder names are the same in `domain/`, `application/` and `ui/features/`:

| Context         | What it holds                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations` | Chats, their items, sessions (app, terminal, outside, background), permission cards and questions, drafts, routing to a project, subagents, slash commands |
| `agents`        | Agent providers, model and effort picks                                                                                                                    |
| `workspace`     | Vault snapshot, projects, notes, project icons, vault setup                                                                                                |
| `navigation`    | The selection (`sel`), the right panel, the project panel, toasts, zoom, Cmd-K                                                                             |
| `mail`          | Accounts, list, filters, detail, link confirmation                                                                                                         |
| `board`         | Board providers, cards, card detail, card actions                                                                                                          |
| `reminders`     | Reminders, the draft form                                                                                                                                  |
| `pull-requests` | PR list and detail                                                                                                                                         |
| `usage`         | Plan limits and token usage                                                                                                                                |
| `settings`      | Settings, both windows                                                                                                                                     |

Ubiquitous language: the names in code follow the names in the app (conversation, card, reminder, project, vault).

## State

- One Zustand store per context, with the Immer middleware: `application/<context>/store.ts` exports `use<Context>Store`.
  The one exception: the composer's typed text and waiting images live in their own small store
  (`application/conversations/drafts.ts`, `useDraftsStore`), so a keystroke does not invalidate every read over the
  conversations. Typing only touches the conversations store for a draft, whose title follows what is typed.
- State is immutable from React's point of view (Immer gives structural sharing), so `memo` and selectors work.
- Components select the smallest slice they need: `useConversationsStore(s => s.items[key])`. They never select a whole store.
- Use cases are plain exported functions in `application/<context>/*.ts`. They read state with `getState()`, write with `setState(draft => …)`, call `infrastructure`, and may call another context's use cases. A context writes only its own store: to change another context's state it calls that context's use case (`startChat`, `hideToast`, `clearMailLink`, …). `boot.ts`, the composition root, is the one exception. Components call use cases, never `setState` (lint rejects `.setState(` under `src/ui`).
- Pure logic, the agent event reducer above all, lives in `domain/` and is unit tested (`node --test`). Node runs the
  tests without a bundler, so value imports inside `domain/` carry their `.ts` extension. A rule that writes text takes a
  translation as an argument (`Translate`); it never imports `t`.
- Reads that combine several stores (`sidebarModel()`, `label(key)`, `chatBar(key)`, `waitCount()`, `picks("model")`)
  are plain functions in `application/`; a component reads one through `useDerived(() => …)` (`ui/hooks`). It records
  which stores the read called `getState()` on (`makeStore` wraps it), runs the read again only when one of those
  changed, and redraws only when the result differs by value. A read returns plain data (objects, arrays, Sets, Maps, compared by content) and reads only store
  state. A read that runs for many rows caches what is expensive against the state it came from (`mailProject` per
  mail against the projects).
- The reminders are part of the vault snapshot (`useWorkspaceStore(s => s.snap.reminders)`); the reminders store holds
  the new-reminder form's draft, which must survive the view unmounting.
- Persisted state uses exactly the same localStorage keys and encodings as before (`chats`, `typed`, `sel`, `hiddenAgents`, `forkedTerms`, `collapsed`, `secOrder`, `projOrder`, `convOrder`, `mailFilter`, `noinsp`, `gens`, the model/effort pick keys, the CLI defaults seen per provider (`defaults.<id>`), `prefsTab`, `pvProject`, `pvBoard`, per board `<pv|id>Fold` (folded per column id, replaces `<pv|id>Folded`), `<pv|id>View` and `<pv|id>Presets:<board>`, …). Existing users keep their conversations.
- The Tauri commands, their arguments and the backend events are unchanged.

## Performance rules

- Agent `agent` events are applied through a pure reducer. Text deltas within one animation frame are coalesced into one
  store update. Any other event first applies what is buffered, then itself at once: a window in the background gets no
  frames, and its turn end must still give the banner.
- A conversation's items are append-only, or replaced as a whole when a transcript is read: messages are memoised
  components keyed by their index. Finished answers never re-parse their markdown: `Markdown` memoises on the text,
  the notes version (bumped only when the notes that exist changed) and the language.
- No virtualisation library. If a long conversation is slow, use `content-visibility: auto` first, and measure.
- Polls (`setInterval`) live in `application/`, started once at boot, and write only what changed. Nothing polls from a
  component. A display clock in a component (the seconds a subagent runs) is not a poll and is fine.

## UI rules

- Function components and hooks only. The React Compiler memoises, so hand-written `useMemo` and `useCallback` are only for a measured need.
- One component per file, named like the file (`ConversationLog.tsx`).
- Containers read stores: the `<Context>View.tsx` per feature, the panel details and the settings pages. A body inside
  a container may read its own slice. Rows and leaves take props. Typed text stays in local state unless it must
  survive the component unmounting (the reminder draft).
- Shared pieces: `ui/components` (`DetailFrame`, `Note`, `Html`, `Markdown`, `Icon`, `Glyph`, `ImageThumbs`,
  `PermissionCard`, `ToolLine`, …), `ui/hooks` (`useT`, `useDerived`, `useUiRequest`, `useDismiss`, `usePointerDrag`),
  `shared/format.ts` (dates and numbers, the Intl formatters made once per locale).
- Tailwind classes are copied from the Lit templates as they are. Styles a Lit component had in `static styles` move to `ui/styles/<context>.css`, scoped by a class on the component's root.
- Shadow DOM is gone. The `--tw-*` initial values workaround in the old `tailwind.css` is removed, because Tailwind's `@property` rules work in light DOM.
- Markdown renders through `shared/markdown.ts` (`marked` with escaped raw HTML, http(s) and mailto links only) into `dangerouslySetInnerHTML`, the same trust as Lit's `unsafeHTML`. Tracker HTML only after the integration's `clean()`. Besides these, `dangerouslySetInnerHTML` is used in two components only: `Html` for the app's own UI strings with markup (`th`, every parameter escaped) and `Glyph` for a package's static SVG.
- HTML mail stays in an `<iframe sandbox="">` with `srcdoc` and `referrerPolicy="no-referrer"`. Links go through the confirmation bar.
- Keyboard shortcuts register once in `ui/app/` (document level). Real `<button>`s for anything clickable.
- The language is part of the `settings` store, so a language switch redraws everything that translates: components
  take `t`, `th`, `tn` from `useT()`, which hands out a new bundle per language.

## Integrations

`packages/board-core` defines `CardDetail` as data: `view(d)` gives a `CardView` (title, status and assignee with their choices, due, labels, description HTML, files, feed). The integrations return that model (Markdown through `@relay/board-core/detail`, Productive's HTML after its `clean()`), and `ui/features/board` draws it as the ticket window over the board. Packages depend on no UI framework.

## Checks before a merge

`pnpm build`, `pnpm test`, `pnpm lint`, `pnpm check:compiler`, `pnpm format:check`, `cargo test`, `node harness/screens.mjs` plus the diff against the baseline, `node harness/perf.mjs`. CI runs the first five.

`pnpm check:compiler` (`scripts/compiler-check.cjs`) runs the React Compiler with the build's options over every file
in `src/ui` and fails when it skips a component or hook: lint does not report those, and a skipped component silently
loses its memoisation. The compiler needs Babel 7 (`@babel/core ^7.29`): on Babel 8 it skips every component with a
default prop value.
