---
name: update-memory
description: "Save the state of the session: project card and Status, Log.md, the generated index, reminders and memory. Use when the user says 'update memory', 'save this', 'done', 'wrap up', 'we're stopping', 'log this session', or when a session did real project work and nothing was saved yet."
---

Run the update process from `System/rules/core/session-protocol.md` for everything that happened in this session.

1. Determine which projects were touched.
2. Per project, in `Contexts/<ctx>/Projects/<Project>/<Project>.md`:
	- `## Status` rewritten as a whole (date line on top, current state only, under ~2,000 characters), open loops in `## Open` (checkbox with the date it opened), lasting decisions in `## Decisions` (dated, with rationale).
	- The card in the frontmatter: `last` today, `index` (one line, max 160 characters), `status` when it changed, `next` and `phase` when they changed.
	- New project without a note: create the folder and the note from `Resources/Templates/Project.md` first, with a full card.
3. Prepend an entry to the project's `Log.md` under `# Session Log` (create it when missing): `### YYYY-MM-DD` with **Intent:**, **Outcome:**, **Findings:**, **Next:**.
4. Run `python3 System/scripts/build-index.py`. It regenerates `System/rules/core/work-state.md` from the cards. Never edit `work-state.md` by hand.
5. Reminders: only when reminders were added, completed or pushed. Use `relay reminders.add`, `relay reminders.done id=...` or `relay reminders.push id=... date=...`. Dropping a reminder or adding a note to one has no Relay action: edit that one row in `System/reminders.md`, keep the table format.
6. `System/rules/core/memory.md`: only when a decision or open thread was added. One line per decision with a link to the project note, keep ten. The full row goes to `System/archive/decisions.md`, and the oldest line in `memory.md` is dropped (its row is already in the archive).
7. Confirm in two or three lines what changed.
