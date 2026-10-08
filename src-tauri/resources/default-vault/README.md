# Starter vault

An empty, ready-to-use vault that ships with Relay. It gives Claude Code a memory: rules, skills, hooks, templates and project cards, so work carries over from one session to the next.

## Use it
1. Open the folder in Relay. Relay links `.claude` to `System` for you.
2. Tell Claude about your work. Fill in `System/rules/core/user-profile.md` and the two context notes in `Contexts/`.
3. Start a project: ask Claude to create one from the template.

Optional: open the same folder in Obsidian to browse and edit the notes by hand.

## Requirements
- Claude Code
- python3
- jq

Based on the context-management-starter-kit by Anthony Taglianetti (GPL-3): https://github.com/ataglianetti/context-management-starter-kit
