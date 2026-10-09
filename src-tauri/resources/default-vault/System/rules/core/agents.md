# Agents and Models

Before any task with more than one part, decide whether parallel agents make it faster or better. Split the work by files so agents never edit the same file, and integrate the pieces in the main session. Pick the agent and model per part, never by default.

## Decide
1. **Split:** which parts are independent? Independent parts start in one message, in parallel.
2. **Inline or agent:** a single lookup stays inline. An agent pays off when a part reads a lot (keeps the dump out of the main context) or when several parts run at once.
3. **Model:** the cheapest one that can do the job.
4. **Show the choice** in one line before starting: "3 parallel: 2x web-researcher (Haiku), 1x sweeper (Sonnet)".

## Roles

| Job | Agent | Model |
|---|---|---|
| Look something up online, read a page, check links or stock | `web-researcher` | Haiku |
| Sweep many files or sources on a fixed recipe, extract data | `sweeper` | Sonnet |
| Check claims, numbers and sources against the original | `verifier` | Sonnet |
| Find code or files across a codebase, read-only | `Explore` | Haiku or Sonnet |
| Rewrite or restructure notes on a clear brief | `general-purpose` | Sonnet |
| Analysis, estimates, judgment, client-critical synthesis | main session or `general-purpose` | strongest model |

Research with numbers ends with a `verifier` pass. Agents never write to `work-state.md` or `memory.md` in parallel: they report back and the main session writes the shared files.
