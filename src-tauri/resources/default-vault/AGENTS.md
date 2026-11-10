# Agent instructions

This vault is driven by AI agents. The rules live in one place, shared by every agent, so this file only points there.

Before you do anything else, read these and follow them as if they were written here:

1. `CLAUDE.md` in this folder: what lives where, the memory layers, the standing agreements.
2. Every file in `System/rules/core/` and `System/rules/vault/`: always in force.
3. A file in `System/rules/<context>/` when you work on notes of that context (its `paths:` frontmatter says which).
4. `System/skills/<name>/SKILL.md` when a task matches the skill's description.

`.claude` is a link to `System`. Agents that do not follow it find the same files under `System/`. Do not copy rules into this file: change them in `CLAUDE.md` or `System/rules/` so every agent keeps reading the same text.
