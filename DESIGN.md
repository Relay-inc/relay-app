# Relay. Design system, v3

v1 (a personal-site house style on a dashboard) was rejected on 2026-09-29. v2 (system colours, one radius, no
shadows) was the first native pass. v3 is the Relay redesign (Claude Design project "Relay Overview", turn 2, built
on 2026-10-03): one token set for the main and the settings window, the accent from the logo, light and dark.

Projects on the left, the conversation in the middle, native macOS. It should feel like part of the Mac, next to Mail
and Notes, and teach nothing new. Adjectives: **native, direct, calm, informed.** A choice that cannot be traced to one
of them does not ship.

The tokens live in `src/ui/styles/base.css`, their Tailwind names in `src/ui/styles/tailwind.css`. This file says what
they are for, the CSS is the source of the values.

## Layout

Default window 1280 x 820, minimum 900 x 600. Two columns, plus a drawer on the right that exists only while it is
open. Every column starts with a 48px bar that is also the drag region.

```
┌────────────┬─────────────────────────────────────────────────┬────────────┐
│ ⌕ Search   │ ▢ Weemaes / Contract on story points    ▦ ⌥ ⌨ ▤ │ Notes    × │  48px
│            ├─────────────────────────────────────────────────┤            │
│ Waiting  3 │                          Where are we? (you)    │  drawer,   │
│ Reminders  │   ⌄ 3 steps · 4 s                               │  460px,    │
│ Productive │   │ Edited Weemaes.md +2 −1  (diff, line nrs)   │  on        │
│ PRs      2 │   The contract moves to story points ...        │  demand    │
│ GENERAL    │   ┌ Claude wants to use Bash ──────────────┐    │            │
│ ANTENNA    │   │ gh pr merge 741 --squash  Deny Allow ↵ │    │            │
│ ▢ Weemaes ●│   └────────────────────────────────────────┘    │            │
│   ✳ conv  ●│ ┌─────────────────────────────────────────────┐ │            │
│ ⌁  ☾  ⚙    │ │ Ask something about Weemaes…   + model  ↑ │ │            │
└────────────┴─┴─────────────────────────────────────────────┴─┴────────────┘
   240px                       flexible                          0 or 460px
```

- **Sidebar** (240px, macOS sidebar material in the app): search field, the view rows (Waiting for you, Reminders, the
  boards, Pull requests, Mail) with a badge or count, then GENERAL and one section per vault context with its tint.
  A section lists the projects with open work (conversations, sessions, the selection), each conversation nested
  under its project with the agent's glyph or a terminal icon. Footer: the Relay mark, usage, theme, settings.
- **Title bar**: a crumb. In a conversation "project / title" (the title is editable). In a view its icon, its name,
  "/" and a bold summary ("3 waiting", "2 due · 7 total", "2 to review", "21 unread", "/ Portal v2" with a menu on a
  board). A view's own quiet text and buttons on the right (Synced just now, New task, refresh), then the project's
  tools. There is no state pill: whether a turn runs shows in the sidebar and in the conversation (decided
  2026-10-03).
- **Conversation**: a column of at most 680px. The user's messages in a filled bubble on the right, Claude's as plain
  text. Tool calls fold into one "n steps · duration" group, edits show their diff with line numbers. A permission
  request is an inline card with the exact command, coloured, and Deny / Allow. The composer is the one card with a
  shadow in the conversation: the field, attach, the agent menu, model and effort, send (stop while a turn runs).
- **Drawer** (460px, Esc or × closes it): a card or note detail, the project terminal, the notes.
- **Settings** is its own native window, 900 x 660: a 208px nav, a 600px content column, cards with hairline rows.

## Colour

| Token | Role |
|---|---|
| `--bg`, `--sidebar`, `--raised`, `--well` | conversation and panels, sidebar and settings nav, cards and the composer, code and commands |
| `--label`, `--secondary`, `--tertiary` | text, meta and tool lines, hints and placeholders |
| `--separator`, `--separator-strong` | every divider, field and card borders |
| `--fill`, `--fill-2` | hover and columns, the user's bubble and fields |
| `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text`, `--focus` | Relay blue from the logo: selection, the primary button, badges. Soft for a selected row, text for links and note names |
| `--ctx-a`, `--ctx-m`, `--ctx-p` | the context tints in the sidebar, in index order |
| `--late`, `--soon`, `--ok` | overdue and urgent, today and in progress, done and green checks |
| `--add-*`, `--del-*` | diff rows |
| `--syn-*` | code: keyword, string, number, function, comment (italic), type or property |
| `--mark` | a search match |
| `--lane`, `--card-edge(-hover)`, `--card-shadow(-hover)` | board lanes and cards |

Graphite (Settings › Interface) swaps the accent tokens only. Dark `--tertiary` stays at `#8a8a92`, lighter than the
redesign's `#76767d`, for contrast on `#161618`. A pull request without a review decision keeps the accent glyph.

## Type

SF Pro, SF Mono for code, commands and paths.

| Size | Weight | Where |
|---|---|---|
| 11px | 600, caps, .06em | sidebar section heads, the one place with caps |
| 12px | 400 | secondary lines, hints, tool lines in a group |
| 12.5px mono | 400 | code blocks, commands, diffs |
| 13px | 400 / 500 / 600 | the UI: rows, the title bar crumb, buttons, settings |
| 15px | 400 | reading text: messages, the composer, card titles in Waiting |
| 18-20px | 600 | the title of a ticket or a pull request |

## Shape and depth

Radii: 6 for chips and inline code, 8 for rows, buttons and fields, 9 for board cards, 10 for popovers and code
blocks, 12 for cards and lanes, 14 for the composer and the ticket window. Depth comes from separators and fills.
Shadows: the composer (`--shadow`), board cards (`--card-shadow`), popovers and the ticket window.

## States

| Element | Rest | Hover | Selected or active | Needs you | Working |
|---|---|---|---|---|---|
| Sidebar row | label | `--fill` | `--accent-soft`, accent-text icon, weight 500 | accent dot | small spinner |
| Step group | "n steps", folded | label colour | unfolded with a rule | | open while a step runs |
| Permission card | | | | accent border and ring, Allow takes Enter when it is the only card | replaced by one "Allowed" line |
| Board card | `--card-edge`, `--card-shadow` | the hover pair | | | ring per workflow status |
| Composer | `--separator-strong` | | accent border on focus | | send becomes stop |

## Motion

150ms `ease-out` on hover and selection, columns 260ms. Nothing loops except the spinner. Reduced motion: no fades.

## Copy

Dutch by default (nl, en, fr, de). Literal verbs: Toestaan, Weigeren, Openen in Terminal, Nieuw gesprek. Every
string traces to the vault, to a session, or to Claude's own output.

## Ban list

- The v1 house style: paper, ink, marine, the cut. This app is not the website.
- Dashboard tiles and big numbers.
- Custom window chrome or a fake title bar. The app uses the native one.
- Status pills that repeat what the sidebar already says.
- Emoji. Icons are Hugeicons stroke-rounded, the agents' own marks for agents.
