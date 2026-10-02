import type { State, Tone } from "./types.ts";

// A workflow status' ring colour from what every tracker has: its kind, its name, and whether it is the first status
// of its kind (a workflow's backlog). Names are matched in English and Dutch.
const BLOCKED = /blo(c)?k|paus|on hold|wait|wacht|stuck/i;
const REVIEW = /review|test|\bpr\b|\bqa\b|nakijk|controle/i;

export function toneOf(state: State, name: string, first: boolean): Tone {
  if (state === "done") return "done";
  if (state === "doing") return BLOCKED.test(name) ? "blocked" : REVIEW.test(name) ? "review" : "active";
  return first ? "idle" : "planned";
}
