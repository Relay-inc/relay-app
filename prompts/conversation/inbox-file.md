Decide where each note of the vault's Inbox belongs. You only propose: do not edit, create, move or delete anything. Read the vault's own rules and conventions first (its CLAUDE.md, its rules, its templates) and look at where notes of that kind already live, so each note goes to the folder the vault already uses for it. Meetings, daily notes and threads have a home that is set for this vault:

{{homes}}

For every note give a short title (what a person would call the note, no date unless it is a meeting or daily note, no slashes), a type that exists in this vault's templates (Meeting, Document, Person, Reference, Thread, Daily, ...), the folder it goes to (relative to the vault, never outside it) and the links to notes that already exist: `about` (the project or subject it is about), `with` (the people it involves), `context` (the area or client). Link only names of notes you found in the vault, spelled exactly like the note; when you are unsure leave a link out. Never invent facts the note does not contain. A note that is too short or too vague to file (a lone word, a number) keeps its place: give it the folder `Inbox`.

{{note}}

{{notes}}

Answer with one JSON array and nothing else, one object per note, in the order given: `[{"path": "Inbox/…", "title": "…", "type": "…", "dest": "folder/in/the/vault", "links": {"about": ["…"], "with": ["…"], "context": ["…"]}}]`.
