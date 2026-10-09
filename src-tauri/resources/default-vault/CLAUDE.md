# Vault

A vault of markdown notes driven through Claude Code. It holds your projects, people and decisions so every session starts with context instead of a blank page. Keep it private: nothing goes to a public remote or an external service unless the user asks for that specific action. Reply in the language the user writes in.

## What lives where

```
System/          the brain (.claude -> System)
  rules/core/      always loaded, including the generated index (work-state.md) and memory.md
  rules/vault/     always loaded: file management
  rules/<ctx>/     load only for files in that context (paths: frontmatter)
  skills/          procedures, loaded when the task matches
  agents/ hooks/ scripts/ reference/ archive/
Contexts/<Work|Personal|...>/
  <Context>.md  People/  Documents/ (only what spans projects)
  Projects/<Project>/<Project>.md   card + Status + Open + Decisions
    Documents/  Communication/ (transcripts/ inside)  Attachments/  Log.md  _archive/
Calendar/        conversations without one project
Resources/       templates, frameworks, reference
Archive/<year>/  closed projects
```

Not read by default: `Communication/transcripts/`, `_archive/`, `Archive/`, `System/archive/`.

## Memory, four layers
1. **Index:** `rules/core/work-state.md`, one line per project, generated from the cards (`status`, `last`, `index`) by `python3 System/scripts/build-index.py`. Never edit by hand.
2. **Project note:** the card in the frontmatter plus `## Status`, the full state. "Where are we on X" and "status" mean this. `Log.md` holds what was done.
3. **`rules/core/memory.md`:** last ten decisions and open threads, one line each. Full rows in `System/archive/decisions.md`.
4. **`System/reminders.md`:** date-triggered nudges, managed through `relay reminders.*` (`relay help` lists actions).

## Skills
Procedures live in `System/skills/`, only their description loads until the task matches. Claude picks the skill itself, the user never has to type `/name`.

## Standing agreements
- **After finished work** update the project note, the card, the index and `Log.md` right away (`rules/core/session-protocol.md`), without waiting for a closing signal.
- **Code lives in repos, context lives in the vault.** A project card links its repos through `repos:`.
- **Mail, calendar and tickets** are Relay features, reached through the `relay` shell command. Mail is drafts only.

## Hooks
On Write and Edit: frontmatter `type:` and `context:`, fresh dates, orphan wikilinks, length warnings (re-evaluate, do not rewrite blindly). Stop hook: project work must leave today's date on that project's `## Status`. Health check: `python3 System/scripts/vault-health.py --quiet`.

## Budgets
| Layer | Budget |
|---|---|
| Fixed load (`CLAUDE.md` + `rules/core` + `rules/vault`) | 20 KB |
| Index row | 160 characters |
| `memory.md` | 4 KB, ten decisions |
| Context rules | 6 KB per context |
| `## Status` | ~2,000 characters, the project note under ~15 KB |

Something new that applies to one context or one task goes into a context rule or a skill, never into `rules/core`.
