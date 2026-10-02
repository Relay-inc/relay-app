// The ring colours of Productive's workflow statuses, by kind, name and order: `pnpm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toneOf } from "@relay/board-core/tone";

test("a workflow's statuses get the board's ring colours", () => {
  assert.equal(toneOf("todo", "Backlog", true), "idle");
  assert.equal(toneOf("todo", "Sprint backlog", false), "planned");
  assert.equal(toneOf("doing", "In progress", false), "active");
  for (const name of ["Blocked", "Paused", "Geblokkeerd", "Wacht op klant"]) assert.equal(toneOf("doing", name, false), "blocked", name);
  for (const name of ["Dev review (PR)", "Ready for testing", "QA"]) assert.equal(toneOf("doing", name, false), "review", name);
  assert.equal(toneOf("done", "Closed", true), "done");
});
