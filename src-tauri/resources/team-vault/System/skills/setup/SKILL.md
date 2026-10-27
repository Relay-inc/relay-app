---
name: setup
description: "Set up this team workspace through a short interview: what the workspace is for, who works in it, the team's contexts, conventions, people and projects. Use when a member says 'set up', 'setup', 'set up the workspace', 'set up the team workspace', 'onboarding', 'start the interview', or when team.md still holds its 'Fill this in' placeholder and a member asks what to do first. Also converts a workspace that was started as a personal vault (user-profile.md or a Personal context in it)."
---

Interview whoever runs this about the TEAM and turn the answers into the files every member's Claude reads each session. This is a team workspace: it is about the team and its work, never about the person answering. It is a conversation, not a form: one question at a time, short, in the language the member writes in. Answers may be dictated, so expect run-on sentences and filler. Clean them up when writing, never change what they mean.

## Rules
- **Only write what was said.** No invented dates, members, roles, numbers or project details. A field nobody answered stays empty.
- **Skippable everywhere.** Every phase can be skipped ("skip", "later", "next"). The member can stop at any time: write what you have so far and say how to continue ("ask me to run setup again").
- **Re-run safe.** When a file was already filled in (no "Fill this in" / "Describe this context" placeholder), show what is there and ask what to change. Edit, don't overwrite. Another member may have written it.
- **Ask, then write per phase.** Write the files of a phase as soon as it is done, so stopping halfway loses nothing.
- **Everything written here is visible to every member.** Nothing about the person answering beyond their name and role in the team. No secrets, no private data. When an answer holds something like that, say it belongs in their own vault and leave it out.

## Start
First check whether this workspace was started as a personal vault: `System/rules/core/user-profile.md`, a `Contexts/Personal/` folder, a `System/rules/personal/` folder, or `"Personal"` in the `contexts` of `.relay/config.json`. Any of those: run **Convert** first. Otherwise say in two or three lines what this does (about ten minutes, six short parts, everything can be skipped or changed later), then start phase 1. Don't ask for permission to start, the member already chose to.

## Convert (only for a workspace started as a personal vault)
Say in two lines what was found and that this workspace is shared, so personal files do not belong here. Then, one step at a time:
1. **The profile.** Read `user-profile.md`. Anything in it about the team (what the team does, roles, how it works together, tools the team uses) goes into `System/rules/core/team.md` (create it from the headings in phase 1 when missing), after the member confirms it. Anything personal stays out. Ask before deleting `user-profile.md`. When it still holds only its placeholder, say so and ask once.
2. **The Personal context.** List what is in `Contexts/Personal/`. A folder with only its placeholder note (`Personal.md` with "Describe this context") and `System/rules/personal/context.md` with only its placeholder questions may go after one question. A folder with notes of its own: ask per note, or ask whether to move them to another context. Never delete a note with content without a yes for that note. Remove `"Personal"` from `contexts` in `.relay/config.json` once the folder is gone, nothing else in that file.
3. **The rules that point at the profile.** In `System/rules/core/thinking-partner.md` and `session-protocol.md`, a mention of `user-profile.md` becomes `team.md`, and lines about one person (their evenings, their good day) go, after showing the member which ones.
4. Run `python3 System/scripts/build-index.py`, then continue with phase 1.

## Phase 1: The team
Ask: what the workspace is for (what the team keeps here, what it does not), who works in it (name and role per member, what each mostly works on), and how the team works together (who keeps what up to date, how a handover goes).
Write `System/rules/core/team.md` under its headings (What this workspace is for, Who works in it, How the team works together, People and organizations, Never write here). Fill the first three now. Remove the "Fill this in." line.

## Phase 2: Contexts
The workspace starts with one context, `Work`. Ask which areas the team keeps apart (for example Sales, one client, an internal project). Most teams need one to three.
For each context:
- **Rename or create.** `Work` is renamed when the team names it differently: move `Contexts/Work/` to `Contexts/<Name>/` and `Contexts/<Name>/Work.md` to `<Name>.md`, move `System/rules/work/` to `System/rules/<name-lowercase>/`, and fix its `paths:` frontmatter. A new context gets `Contexts/<Name>/<Name>.md` (`type: Context`) and `System/rules/<name>/context.md`. Drop a context the team doesn't want only when it has no notes in it.
- **Update `.relay/config.json`** `contexts` to the final list, nothing else in that file. That file does not sync: other members' Macs keep their own.
- **Describe it.** Ask what belongs in it, the main organizations, which tone and habits apply, and what Claude should never do there. Write the context note's body (a few lines) and `System/rules/<name>/context.md` (replace the placeholder questions with the answers).

## Phase 3: Conventions
Ask how the team wants notes kept: one note per company or per contact, a contact log (where, what goes in a line), who updates which notes or projects, naming of files and projects, anything the team does the same way every time.
Write them under "How the team works together" in `team.md`. A convention for one context only goes into that context's `System/rules/<name>/context.md`.

## Phase 4: People and organizations
Per context: the external people and organizations the team deals with most (name, organization, role, who on the team is their contact). Create `Contexts/<ctx>/People/<Name>.md` from `Resources/Templates/Person.md` with `context: "[[<ctx>]]"`, `company`, `title`, and one or two lines in the body on the working relationship. Only work facts: no private details about anyone. Add the organizations in one line each under "People and organizations" in `team.md`. Members of the team are already in `team.md`, they get no Person note unless the team asks.

## Phase 5: Projects
Per context: what the team is working on now. Per project: name, one line on what it is, its state (Active, Blocked, Quiet, Paused), who on the team leads it, and repo names if it is code.
**From a board:** run `relay help`. When it lists `productive.projects`, offer to pull the active Productive projects (`relay productive.projects`) and let the member pick which ones become project notes and in which context. Do the same for another board integration with a projects or boards read. Never import everything unasked.
Create each project as `Contexts/<ctx>/Projects/<Project>/<Project>.md` from `Resources/Templates/Project.md`: `context: "[[<ctx>]]"`, `status`, `index` (the one line, max 160 characters), `last` today, `repos` when given. `## Status` gets one line with today's date and what was said, with the lead's name. Leave `## Open` and `## Decisions` empty. No `Log.md` yet.
Then run `python3 System/scripts/build-index.py`. Never edit `System/rules/core/work-state.md` by hand.

## Phase 6: Never write here
Ask what Claude must keep out of this workspace beyond secrets and members' private data: topics that belong in another tool or in someone's own vault, clients whose details stay out, anything the team agreed not to keep in writing. Write the answers under "Never write here" in `team.md`. When nothing comes, write the two defaults: no secrets, nothing personal about members.

## Finish
1. When `System/scripts/vault-health.py` is there, run `python3 System/scripts/vault-health.py --quiet` and fix what it reports in files you wrote.
2. Summarize in a few lines what was created (contexts, number of people and projects, which rule files), and that every member sees it after their next sync.
3. Name one first thing to try, tied to the answers (for example "ask me where a project stands" or "paste the notes of the last team meeting").
