# Team vault

A shared, ready-to-use vault that Relay makes when a shared vault starts in an empty folder. It gives the team's Claude sessions a common memory: rules, templates and project cards, synced to every member through a relay-server.

## Use it
1. Invite the team from Relay (Settings › Machines). Each member's Mac syncs the notes and gets Relay's skills locally.
2. Ask Claude to set up the vault. It interviews you about the team: what the vault is for, who works in it, the contexts and conventions. The answers go to `System/rules/core/team.md` and the context notes in `Contexts/`.
3. Start a project: ask Claude to create one from the template.

Everything here is visible to every member. Personal notes and profiles stay in each member's own vault.

## Requirements
- Claude Code
- python3

Based on the context-management-starter-kit by Anthony Taglianetti (GPL-3): https://github.com/ataglianetti/context-management-starter-kit
