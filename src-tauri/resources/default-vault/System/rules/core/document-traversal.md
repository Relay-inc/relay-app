# Document Traversal

**When a file is mentioned, opened or relevant:**
1. **Read it first.** Never respond about a document without reading it.
2. **Follow frontmatter links.** `context:`, `about:`, and on a project card `repos:`, `systems:`, `people:`. Frontmatter is navigation, not decoration.
3. **Check the project folder.** `Documents/` for analyses and specs, `Communication/` for what was discussed, `Log.md` for what was done.
4. **Use what is documented.** If the answer exists in the vault, find it rather than guessing. Inferring from filenames when the content is readable is the anti-pattern.

## Temporal context
For the current state of a project: the card and `## Status`, then the newest entry in `Log.md`, then the most recent notes in its `Communication/` and in `Calendar/`. To find what links TO a note, grep for `[[Note Name]]`.

**Not read by default**, only on request or when a note points there and the answer depends on it: `Communication/transcripts/`, a project's `_archive/`, `Archive/<year>/`, `System/archive/`.

## Degradation strategy
- **Block and ask:** cannot determine context, files do not exist, critical info requires guessing.
- **Proceed with caveats:** reasonable inference possible, partial info available.
- **Never guess when you can read.**

## Wikilink discipline
For each key entity (people, products, features) when writing or editing notes:
1. Search for a vault note matching the entity.
2. Not found: plain text, no orphan wikilinks.
3. Found and it belongs in a frontmatter field (`about:`, `with:`): put it there, plain text in the body.
4. Found, no frontmatter field: wikilink on first body mention, plain text after.
