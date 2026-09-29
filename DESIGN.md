# Vault. Design system, v2

v1 (the laurentmeersman.com house style on a dashboard) was rejected on 2026-09-29: wrong style,
wrong layout, and the main task, talking to a project, was missing. v1 lives in git history only.

v2 follows Laurent's picks: **projects on the left, the conversation on the right, native macOS.**
It should feel like part of the Mac, next to Mail and Notes, and teach nothing new.

Adjectives: **native, direct, calm, informed.** A choice that cannot be traced to one of them does
not ship.

## Layout

Default window 1280 x 820, minimum 900 x 600. Three panes, the way Mail does it.

```
┌────────────┬──────────────────────────────────┬──────────────┐
│ ⌕ Zoek     │ Weemaes              Actief · 71 │ Stand   Open │  toolbar, 52px
│            ├──────────────────────────────────┤              │
│ Wacht op   │                                  │ Fase ...     │
│ jou      1 │   waar staan we?          (jij)  │              │
│ Algemeen   │                                  │ ☐ Mail aan   │
│            │   Contract op story points ...   │   De Groote  │
│ ANTENNA    │   ▸ Weemaes.md gelezen           │ ☐ Stukken    │
│ Weemaes  ● │                                  │              │
│ C-All   25 │   ┌ Toestemming ──────────────┐  │              │
│ Cloet   18 │   │ gh pr merge 741           │  │              │
│ MEERSMAN   │   │        Weigeren  Toestaan │  │              │
│ ...        │   └───────────────────────────┘  │              │
│            │ ┌──────────────────────────────┐ │              │
│            │ │ Vraag iets over Weemaes…     │ │              │
│            │ └                          ↑ ──┘ │              │
└────────────┴──────────────────────────────────┴──────────────┘
   240px              flexible                     300px, hideable
```

- **Sidebar** (240px): search field, then "Wacht op jou" and "Algemeen" as the two fixed rows, then
  the projects per context (Antenna, Meersman, Personal), Active and Blocked only. "Stil" folds the
  rest. A row shows the project name and one trailing indicator, see States.
- **Conversation** (flexible): the toolbar carries the project name and its state. Messages run
  top to bottom, Laurent's in a filled bubble on the right, Claude's as plain text on the left.
  Tool calls are one collapsed line each ("Weemaes.md gelezen"). A permission request is an inline
  card with the exact command and two buttons. The composer sits at the bottom, one field and a
  send button. There is no "background" switch: every conversation keeps running when Laurent
  clicks to another project, and the sidebar reports back (decided 2026-09-29).
- **Inspector** (300px, ⌘⌥I hides it): the project's Stand van zaken and its `## Open` as
  checkboxes, straight from the note. This is where "op de hoogte blijven" happens without asking.

## Color

System colors, so light and dark follow macOS and the accent follows the user's accent setting. In
the app's WKWebView the `-apple-system-*` keywords resolve natively. The values below are the
fallbacks for the mockup in a browser.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#1E1E1E` | conversation pane |
| `--sidebar` | `#EFEEED` | `#2A2A2A` | sidebar (vibrancy in the app) |
| `--inspector` | `#F7F6F5` | `#242424` | inspector |
| `--label` | `rgba(0,0,0,.85)` | `rgba(255,255,255,.85)` | text |
| `--secondary` | `rgba(0,0,0,.50)` | `rgba(255,255,255,.55)` | meta, tool lines |
| `--separator` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.10)` | every divider |
| `--fill` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.07)` | Laurent's bubble, cards, selected row at rest |
| `--accent` | `#007AFF` | `#0A84FF` | selection, primary button, the waiting badge |

The accent means "this needs you or is selected". Two more colour meanings, both asked for by Laurent on 2026-09-29: the context colours in the sidebar (Antenna indigo `#5856D6`, Meersman teal `#30B0C7`, Personal green `#34C759`), and reminder dates by urgency: overdue in system red `#FF3B30`, today and the next 2 days in system orange `#FF9500`, later in secondary grey. Nothing else is coloured.

## Type

System font (`-apple-system`, SF Pro), SF Mono for commands and paths.

| Size | Weight | Where |
|---|---|---|
| 11px | 600 | sidebar group headers (ANTENNA), the one place with caps, as macOS does |
| 13px | 400 / 500 | sidebar rows, toolbar subtitle, tool lines, inspector meta |
| 13px mono | 400 | commands in permission cards, paths |
| 15px | 600 | toolbar title, inspector headings |
| 16px | 400 | conversation text and the composer. Reading text never goes below 16px |

## Shape and depth

- One radius, 8px, on bubbles, cards, fields and buttons. Sidebar selection 6px, which is 8px minus
  its 2px inset (nested rule).
- Depth by separators and fills only. The one shadow is the composer's, the macOS field shadow
  (`0 0 0 .5px var(--separator), 0 1px 2px rgba(0,0,0,.06)`).

## States

| Element | Rest | Hover | Selected or active | Needs you | Working | Done since last look |
|---|---|---|---|---|---|---|
| Sidebar project row | name | `--fill` | accent background, white text | accent dot | small spinner | bold name |
| Tool line | secondary, collapsed | label color | expanded, shows input and output | | spinner in front | |
| Permission card | fill, command in mono | | | accent border 1px, "Toestaan" is the default button (Enter) | | replaced by one line "Toegestaan: ..." |
| Composer | field | | focus ring in accent | | send becomes stop | |

## Motion

System-like and short: 150ms `ease-out` on hover and selection, a new message fades in over 150ms.
Nothing loops except the working spinner. Reduced motion: no fades.

## Copy

Dutch. Literal verbs: Toestaan, Weigeren, Openen in Terminal, Nieuw gesprek. Every string traces to
the vault, to a session, or to Claude's own output.

## Ban list

- The v1 house style: paper, ink, marine, the cut. This app is not the website.
- Dashboard tiles, big numbers, an ink panel.
- Custom window chrome or a fake title bar. The app uses the native one.
- Emoji and decorative icons. SF Symbols only where macOS itself would put one (search, send).
