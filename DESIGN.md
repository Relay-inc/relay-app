# Vault, the control room. Design system

The app is Laurent's own, so it wears laurentmeersman.com (prototype E4 Panels, branch `e3-content`
in `~/Documents/LaurentMe/laurentmeersman-rebrand`). Nothing here is a new direction. Every token
below is the site's token, and the only decisions made here are the ones a desktop app needs and a
website does not.

Adjectives, from what the app is for: **calm, ordered, honest about state, made by hand.** Essence:
*a quiet control room.* A choice that cannot be traced to one of these four words does not ship.

## The one bold place

**Wacht op jou is the only ink field in the window.** It carries one number in display type, the
count of things that need Laurent, and next to it the list of those things. It is the waiting-room
panel from the MedQ mock on the site ("A 27" on ink), repurposed: there it said who is next, here it
says what is next. When the count is zero the panel stays, the number reads 0 and the list says
"Niets wacht op jou." The window never hides the one thing it exists to show.

Everything else stays paper, hairlines and text.

## Color

| Token | Value | Role |
|---|---|---|
| `--paper` | `#FAF9F5` | window ground, 60% |
| `--paper-2` | `#F0EEE7` | panels, the input bar, 30% |
| `--ink` | `#15130F` | text, the Wacht op jou panel |
| `--ink-muted` | `#6F6A60` | secondary text, meta, status words at rest |
| `--paper-muted` | `rgba(250,249,245,.58)` | secondary text on ink |
| `--hairline` | `rgba(21,19,15,.12)` | every rule and border on paper |
| `--hairline-dark` | `rgba(250,249,245,.18)` | rules on ink |
| `--marine` | `#234173` | the one accent, 10%: the status square of a session that works, the focused input, the selected row |
| `--marine-deep` | `#182D52` | pressed state of a marine control |

Color means "look here". A session at rest is ink-muted. An overdue reminder is not red: it is ink
at weight 600 with its age in mono. Red and orange do not exist in this app.

Light only for the first version. A dark theme, if it comes, is designed and not inverted, and gets
its own block here first.

## Type

- Display and text: `"neue-haas-grotesk-display"` / `"neue-haas-grotesk-text"`, falling back to
  `"Helvetica Neue"`. The app ships offline, so in practice it renders in Helvetica Neue, which is
  the site's own fallback and on every Mac.
- Data voice: `"Fragment Mono"` (OFL, bundled as woff2 in the app), falling back to Menlo. Used for
  times, dates, ages, counts, session ids and paths. Always `tabular-nums`, right-aligned when a
  column of them lines up.
- Ratio 1.2 for product UI, six steps:

| Step | Size | Weight | Where |
|---|---|---|---|
| `--t-13` | 13px | 400 mono | meta: ages, times, paths, counts |
| `--t-14` | 14px | 500 | labels ("Wacht op jou", "Gesprekken"), column heads |
| `--t-16` | 16px | 400 / 600 | reading text: rows, items, the input. Floor for anything read |
| `--t-20` | 20px | 500 | the item title inside Wacht op jou |
| `--t-28` | 28px | 600 | the window's one heading, the date |
| `--t-96` | 96px | 500 display | the count in Wacht op jou |

Hierarchy comes from size and weight. Never from colour alone.

## Shape

**The cut, one angle for the whole app.** From the housemark slash, 7.6 units of drop for every 1
of bite. `--cut` is the horizontal bite, the drop is always `--cut * 7.6`, the corner is always the
top right.

```css
clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% calc(var(--cut) * 7.6), 100% 100%, 0 100%);
```

| Token | Bite | Where |
|---|---|---|
| `--cut-l` | 18px | the Wacht op jou panel, the two side panels |
| `--cut-m` | 5.53px | 42px controls: the input bar, Vraag, Opdracht |
| `--cut-s` | 4.47px | 34px row actions (Open) |
| `--cut-xs` | 3.03px | 23px chips: the detected project |

No border-radius anywhere. The status square is a square. The site's round frames are for
photographs, and the app has none.

**Depth: hairlines only.** One weight, 1px, `--hairline` on paper and `--hairline-dark` on ink. No
shadow on anything. Rows are separated by a hairline, never by a box.

## Space

Base 8px: `--s1` 8, `--s2` 16, `--s3` 24, `--s4` 40, `--s5` 64.

- Window padding 40px. Column gap 40px. Panel padding 24px.
- Grouping law: rows inside a list sit 0px apart with a hairline, lists sit 40px apart. Space around
  a group is at least twice the space inside it.
- Density compresses in the session register (rows 44px) and breathes around Wacht op jou.

## Layout

Default window 1280 x 800, minimum 960 x 640.

```
┌──────────────────────────────────────────────────────────────┐
│ // Vault        [ Waarover wil je verder?        ] [Vraag]   │  top bar, 72px
│                  → Weemaes, gesprek stil          [Opdracht] │
├───────────────────────────────────────┬──────────────────────┤
│ ■ Wacht op jou                        │ ■ Vandaag            │
│  2    item, reden, sinds, Open        │  vervallen, vandaag, │
│       item, reden, sinds, Open        │  deze week           │
│ ■ Gesprekken                     21   ├──────────────────────┤
│  naam  project  toestand  sinds  ›    │ ■ Projecten          │
│  ...                                  │  per context, open   │
└───────────────────────────────────────┴──────────────────────┘
```

Columns 1.55fr and 1fr. The left column is what is happening, the right column is what is planned.

The label grammar is the site's: a 9px marine square, the label in ink at 14px, and a status or count
beside it in ink-muted.

## States

| Element | Default | Hover | Focus | Active or selected | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Input bar | paper-2, hairline | hairline darkens to ink at 30% | 2px marine outline outside the cut box | | | | hairline stays, message under it in ink |
| Vraag, Opdracht | ink text, paper, hairline | lifts 2px | 2px marine outline | marine ground, paper text | ink-muted, no lift | label reads "Bezig" | |
| Row | paper | paper-2 | 2px marine inset | marine 2px bar on the left edge of the row | | | |
| Status word | ink-muted | | | | | marine square before it ("werkt") | "fout" in ink 600 |

The focus outline is the only line thicker than 1px in the app.

## Motion

One curve, `cubic-bezier(0.22, 1, 0.36, 1)`. Hover and press 180ms. A new row fades in over 180ms,
opacity only. Nothing pulses, nothing loops, nothing enters on load. `prefers-reduced-motion`:
every duration goes to 0.

## Copy

Dutch, the vault's working language. Status words are short and literal: werkt, stil, wacht, klaar,
fout. No eyebrows, no icons above titles, no emoji. Every string in the window traces to a file on
disk or to `claude agents --json`. Empty states say what is true ("Niets wacht op jou.").

## Ban list for this project

- Everything in the fit-finish tell catalogue, tiers 1 to 4.
- Border-radius, pills, squircles, glass, blur, shadows of any kind.
- A second accent colour. Red, orange, green as status colours.
- A dashboard of stat tiles. The count in Wacht op jou is the only big number.
- Icons. The housemark is the only glyph.
- The median app skeleton: left sidebar with icon nav, top search, card grid. The window has no
  sidebar nav, because it has one screen.
