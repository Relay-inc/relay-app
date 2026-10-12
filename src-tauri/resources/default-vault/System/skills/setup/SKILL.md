---
name: setup
description: "Personalize this vault through a short interview: who the user is, their contexts, people, projects and how Claude should think with them. Use when the user says 'set up', 'setup', 'set up my vault', 'personalize', 'onboarding', 'start the interview', or when user-profile.md still holds its 'Fill this in' placeholder and the user asks what to do first."
---

Interview the user and turn the answers into the files Claude reads every session. It is a conversation, not a form: one question at a time, short, in the language the user writes in. Answers may be dictated, so expect run-on sentences and filler; clean them up when writing, never change what they mean.

## Rules
- **Only write what the user said.** No invented dates, milestones, numbers or project details. A field nobody answered stays empty.
- **Skippable everywhere.** Every phase can be skipped ("skip", "later", "next"). The user can stop at any time; write what you have so far and say how to continue ("ask me to run setup again").
- **Re-run safe.** When a file was already filled in (no "Fill this in" / "Describe this context" placeholder), show what is there and ask what to change. Edit, don't overwrite.
- **Ask, then write per phase.** Write the files of a phase as soon as it is done, so stopping halfway loses nothing.

## Start
Say in two or three lines what this does (about ten minutes, six short parts, everything can be skipped or changed later), then start phase 1. Don't ask for permission to start; the user already chose to.

## Phase 1: You
Ask: name and what they do, the kind of work (roles, how many projects run at once), what a good day looks like, how direct Claude should be and what to skip, working days and tools (mail, chat, project management, code).
Write `System/rules/core/user-profile.md` under its five headings (Who, Role and work, What a good day looks like, How to give feedback, Environment). Remove the "Fill this in." line.

## Phase 2: Contexts
The vault has two contexts, `Work` and `Personal`. Ask which areas of their life and work they want to keep apart (one employer, own clients, a side project, personal). Most people need two or three.
For each context:
- **Rename or create.** `Work` is renamed when the user names their work context differently: move `Contexts/Work/` to `Contexts/<Name>/` and `Contexts/<Name>/Work.md` to `<Name>.md`, move `System/rules/work/` to `System/rules/<name-lowercase>/`, and fix its `paths:` frontmatter. A new context gets `Contexts/<Name>/<Name>.md` (`type: Context`) and `System/rules/<name>/context.md`. Drop a context the user doesn't want only when it has no notes in it.
- **Update `.relay/config.json`** `contexts` to the final list, nothing else in that file.
- **Describe it.** Ask what belongs in it, who the main organizations are, which tone and habits apply, and what Claude should never do there. Write the context note's body (a few lines) and `System/rules/<name>/context.md` (replace the placeholder questions with the answers).

## Phase 3: People
Per context: the five to ten people they deal with most (name, organization, role, how they work with them). Create `Contexts/<ctx>/People/<Name>.md` from `Resources/Templates/Person.md` with `context: "[[<ctx>]]"`, `company`, `title`, and one or two lines in the body on the working relationship. Skip people the user only mentions in passing.

## Phase 4: Projects
Per context: what they are working on now. Per project: name, one line on what it is, its state (Active, Blocked, Quiet, Paused), and local repo paths if it is code.
**From a board:** run `relay help`. When it lists `productive.projects`, offer to pull the active Productive projects (`relay productive.projects`) and let the user pick which ones become project notes and in which context. Do the same for another board integration with a projects or boards read. Never import everything unasked.
Create each project as `Contexts/<ctx>/Projects/<Project>/<Project>.md` from `Resources/Templates/Project.md`: `context: "[[<ctx>]]"`, `status`, `index` (the one line, max 160 characters), `last` today, `repos` when given. `## Status` gets one line with today's date and what the user said; leave `## Open` and `## Decisions` empty. No `Log.md` yet.
Then run `python3 System/scripts/build-index.py`. Never edit `System/rules/core/work-state.md` by hand.

## Phase 5: Thinking partner
Ask what they want from Claude beyond doing tasks: what decisions they struggle with, where they want pushback (scope, timelines, people, money), what they tend to avoid or over-research, and what kind of help annoys them.
Rewrite `System/rules/core/thinking-partner.md` around the answers: keep its structure (core stance, when the big picture gets lost, thinking behaviors, decision support, when to push back), replace the generic lines with ones specific to this person. Write it as a coherent rule file, not filled-in brackets.

## Phase 6: Writing
Ask for one or two things they wrote themselves (a mail, a message) or how they want to sound, and which phrases they never want to see. Add a short "Voice" section to `System/rules/core/writing-style.md` with what you learned. Keep the rest of that file.

## Finish
1. Run `python3 System/scripts/vault-health.py --quiet` and fix what it reports in files you wrote.
2. Summarize in a few lines what was created (contexts, number of people and projects, which rule files).
3. Name one first thing to try, tied to their answers (for example "ask me where a project stands" or "paste a meeting transcript").
