# Team Workspace

A team workspace of markdown notes, synced through a relay-server. Several people work in it, each with their own Claude on their own Mac, so every session starts from the team's projects, people and decisions instead of a blank page. What the team is and who works here: `System/rules/core/team.md`.

## Shared, not personal
- **Everything written here is visible to every member.** Write it as you would for a colleague to read.
- **Personal things stay in each member's own vault:** their profile, private notes, how they like to work, their own reminders. Something about one member that is not team business does not go here.
- **No secrets.** No passwords, tokens, keys, bank or health data, not in a note, not in a code block.
- Never push this workspace to a public remote, never paste its content into an external service unless a member asks for that specific action.
- Reply in the language the member writes in.

## What lives where

```
System/          the brain (.claude -> System)
  rules/core/      always loaded, including the generated index (work-state.md), team.md and memory.md
  rules/vault/     always loaded: file management
  rules/<ctx>/     load only for files in that context (paths: frontmatter)
  skills/          procedures, loaded when the task matches (each Mac gets Relay's own, they do not sync)
  agents/ hooks/ scripts/ reference/ archive/
Contexts/<Work|...>/
  <Context>.md  People/  Documents/ (only what spans projects)
  Projects/<Project>/<Project>.md   card + Status + Open + Decisions
    Documents/  Communication/ (transcripts/ inside)  Attachments/  Log.md  _archive/
Calendar/        conversations without one project
Resources/       templates, frameworks, reference
Archive/<year>/  closed projects
```

Not read by default: `Communication/transcripts/`, `_archive/`, `Archive/`, `System/archive/`.

## Memory, four layers
1. **Index:** `rules/core/work-state.md`, one line per project, generated from the cards (`status`, `last`, `index`) by `python3 System/scripts/build-index.py`. Never edit by hand. Each Mac builds its own, it does not sync.
2. **Project note:** the card in the frontmatter plus `## Status`, the full state. "Where are we on X" and "status" mean this. `Log.md` holds what was done.
3. **`rules/core/memory.md`:** the team's last ten decisions and open threads, one line each. Full rows in `System/archive/decisions.md`.
4. **`System/reminders.md`:** the team's date-triggered nudges, a table edited directly so every member sees them. `relay reminders.*` reaches only the member's own vault: use it for a nudge that is theirs alone.

## Skills
Procedures live in `System/skills/`, only their description loads until the task matches. Claude picks the skill itself, nobody has to type `/name`. The setup skill interviews the team about this workspace.

## Standing agreements
- **After finished work** update the project note, the card, the index and `Log.md` right away (`rules/core/session-protocol.md`), without waiting for a closing signal. Another member may pick the project up tomorrow.
- **Two people may write the same note.** Keep edits small and in place, never rewrite a note someone else keeps up to date without a reason. A conflict copy shows up next to the note: merge it by hand, then delete the copy.
- **Code lives in repos, context lives in the workspace.** A project card links its repos through `repos:`.
- **Mail, calendar and tickets** are Relay features, reached through the `relay` shell command. Mail is drafts only.

## Checks
Conversations in a workspace run without hooks, so nothing checks frontmatter or dates on save: keep `type:`, `context:` and the `## Status` date right by hand. Health check, on a Mac where `System/scripts/vault-health.py` is there: `python3 System/scripts/vault-health.py --quiet`.

## Budgets
| Layer | Budget |
|---|---|
| Fixed load (`CLAUDE.md` + `rules/core` + `rules/vault`) | 20 KB |
| Index row | 160 characters |
| `memory.md` | 4 KB, ten decisions |
| Context rules | 6 KB per context |
| `## Status` | ~2,000 characters, the project note under ~15 KB |

Something new that applies to one context or one task goes into a context rule or a skill, never into `rules/core`.
