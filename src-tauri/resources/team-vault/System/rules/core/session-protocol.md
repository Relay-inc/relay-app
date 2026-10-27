# Session Protocol

## Where state lives
The four memory layers are in `CLAUDE.md`. Per project, the **card** (frontmatter of `<Project>.md`) is for machines: `status` (Active, Blocked, Quiet, Paused or Closed), `phase`, `next`, `index` (max 160 characters), `last`, `repos`, `systems`, `people`, `aliases`. The body (`## Status`, `## Open`, `## Decisions`) is for people. `Log.md` holds what was done, `Communication/` what was discussed.

## At session start
- Scan the index for Active and Blocked rows.
- When the first request names a project ("where are we on X", "status"): read the card and `## Status`, then `## Open`, the newest `Log.md` entry and the reminders for that project. Answer with state, open items and next step in 3 to 5 lines, then ask what to do.

## When to update
Update **as soon as a piece of work is finished** (a document written, a decision taken, a mail drafted, a status reconstructed) and on explicit signals (the update-memory skill). Nobody says "done", and the next member to pick the project up only has what was written down.

**Scan every exchange, not just finished work.** Before closing a reply, check what was just said or shown: a new fact about a project or person, a decision, a correction of something the workspace got wrong, a date, a commitment. If a future session needs it, write it down in its home right away, without asking. A one-line addition beats a lost detail, but never as another paragraph on the Status.

## Update process

> **Date source:** always the current date from the system context. Never infer today's date from file contents.

### 1. Project note: overwrite, never append

| Content | Home |
|---|---|
| Current state: phase, what runs, biggest risk, next step | `## Status`, **rewritten as a whole**, 10 to 15 lines, ~2,000 characters, first line `*Status, last updated YYYY-MM-DD.*` |
| Every open loop (merge, deploy, send, ask, waiting on someone) | `## Open`, one checkbox with the date it opened: `- [ ] Send the estimate (since 2026-01-05)`. Remove when closed. |
| Decisions that govern future work | `## Decisions`, dated, with the rationale |
| What was done or investigated | `Log.md` (step 5) |
| What was discussed with someone | a note in `Communication/` (meeting-notes skill) |
| Specs, build plans, analyses | their own Document in `Documents/`, linked, never repeated |

Test before writing to Status: "does a future session need this to know where the project stands today?" If it only records what happened, it goes to `Log.md`.

### 2. Card and index
- On the card: `last` today, `index` rewritten (one line, max 160 characters), `status`, `next` and `phase` when they changed. A new repo goes into `repos:`.
- Then run `python3 System/scripts/build-index.py`.
- 30 days without activity (`last`) shows an Active project as Quiet in the index; `build-index.py` does that, leave the card on Active. Closed projects move with their folder to `Archive/<year>/` after a last Status (what is still open and where it goes), with `status: Closed` and `closed:` on the card.
- New project: create `Projects/<Project>/<Project>.md` from the template with a full card first.

### 3. Reminders (only when something changed)
The team's reminders are rows in `System/reminders.md`, edited directly (`relay reminders.*` reaches only the member's own vault). Add reminders with a future trigger date, remove completed ones.

### 4. `memory.md` (only when something changed)
- New decision: rationale in `## Decisions` of the project note, a full row in `System/archive/decisions.md`, one line (max ~160 characters, linked to the project) on top of Recent Decisions. Keep ten.
- New open thread without a date: one line with a link. Resolved: remove.
- How the team works together goes to `team.md`, `thinking-partner.md` or `writing-style.md`. How one member likes to work goes to their own vault, not here.

### 5. `Log.md` (always, without asking)
Every session that did project work gets an entry, skip only pure Q&A. Prepend under `# Session Log` (create the file as `type: Document`, `document-type: Session Log`, `context:`, `about:` if missing):

```markdown
### YYYY-MM-DD
**Intent:** what the member came in to do (with their name)
**Outcome:** what actually happened
**Findings:** learnings, paths ruled out and why
**Next:** explicit handoff for the next session
```

3 to 5 lines per field max.

## Confirmation
Two or three lines: "Updated: [project] (Status, card, index), reminder [x] added, decision [y] noted." or "Nothing new to record."
