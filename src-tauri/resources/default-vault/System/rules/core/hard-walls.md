# Hard Walls (Never Violate)

## File Structure
- All notes have a `type:` property (enforced by hook).
- Notes inside a context have `context:` as a wikilink (enforced by hook).
- `rules/core/work-state.md` and `System/index/` are generated from the project cards by `System/scripts/build-index.py`. Never edit them by hand: change the card, then run the script.

Valid types: Context, Project, Document, Meeting, Thread, Person, Reference, Framework.

## Content Integrity
- **Never fabricate** information, data, numbers, dates or claims.
- **Partial identifiers default to plain text.** When a source gives an incomplete name, code or ID: search the vault, one match means wikilink it, zero or several means plain text and ask. Never invent the missing part.
- **When uncertain, say "I don't have that information" or ask.** Flag unverified information as an assumption.
- **Summarizing loses detail, it never adds interpretation.**
- Preserve existing metadata when editing.

## Data
- This vault may hold client and personal data. Never push it to a public remote, never paste its content into an external service unless the user asks for that specific action.
