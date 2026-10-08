# File Management

## Structure
The folder map is in `CLAUDE.md`. Every project is a folder `Contexts/<ctx>/Projects/<Project>/` with `<Project>.md` (card plus current state, under ~15 KB) and, once something goes in them, `Documents/` (analyses, specs, estimates), `Communication/` (one note per meeting, mail or chat thread, full transcripts in `Communication/transcripts/`), `Attachments/`, `Log.md` and `_archive/` (superseded material, moved, not deleted). No empty folder skeletons. `Contexts/<ctx>/Documents/` is only for what spans projects, always with `about:`. Closed projects move to `Archive/<year>/`. A new context is a new folder under `Contexts/` with its own `<Context>.md`.

## Note types
Context, Project, Document, Meeting, Thread, Person, Reference, Framework. Read the template in `Resources/Templates/` before creating a new note.

## Soft walls
- Prefer editing existing notes over creating new ones.
- Clean filenames, the folder provides context. Internal codes go in `aliases:`.
- Long fixed sections of a project note become their own Document.
- Attachments per project, named `YYYY-MM-DD topic.ext`. Large or confidential files stay outside the vault, with a link.
- Mail, chat and tickets are never mirrored: a conversation note with a link or id to the original.

## Project state
`## Status` starts with `*Status, last updated YYYY-MM-DD.*`. Card fields and the update steps: `rules/core/session-protocol.md`.

## Content patterns
- Conversations: the meeting-notes skill. Without one project they stay in `Calendar/` with `about:`.
- Reminders: only when a next step needs a future nudge, through `relay reminders.add`, with `repeat` when recurring.
- H1 headings: Meeting, Person, Thread and Document notes include an H1, other types skip it.
- Research with numbers: confidence tags per `System/reference/confidence-convention.md`.

## Proactive behaviour
Generally proactive, but for code changes: discuss the approach before writing. Suggest rule updates when context seems stale. Flag blockers and dependencies.
