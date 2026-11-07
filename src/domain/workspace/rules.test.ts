import assert from "node:assert/strict";
import { test } from "node:test";
import { noteKnown, noteTitle, notesIndex, resolveNote } from "./rules.ts";

test("noteTitle: a leading heading is the title, else the file name made readable", () => {
  assert.deepEqual(noteTitle("Contexts/Relay/Relay.md", "# Relay\n\nBody"), { title: "Relay", body: "\nBody" });
  assert.equal(
    noteTitle("a2a/route-middleware-sees-rendered-refusals.md", "Body").title,
    "Route middleware sees rendered refusals",
  );
  assert.equal(noteTitle("Calendar/Plan - Brain view.md", "Body").title, "Plan - Brain view");
});

test("resolveNote: a link's note by path, by name in any workspace (the one shown first), else nothing", () => {
  const index = notesIndex("/v", ["A/Docs/Spec.md", "B/Plan.md", "/team/Docs/Spec.md", "/team/People/Sofie Claes.md"]);
  assert.equal(resolveNote(index, "/v", "B/Plan"), "B/Plan.md");
  assert.equal(resolveNote(index, "/v", "/v/B/Plan.md"), "B/Plan.md", "an absolute path in the main vault");
  assert.equal(resolveNote(index, "/v", "Spec"), "A/Docs/Spec.md", "the main vault shown: its note");
  assert.equal(resolveNote(index, "/v", "Spec", "/team"), "/team/Docs/Spec.md", "another workspace shown: its note");
  assert.equal(resolveNote(index, "/v", "Sofie Claes"), "/team/People/Sofie Claes.md", "only in another workspace");
  assert.equal(resolveNote(index, "/v", "sofie claes.md"), "/team/People/Sofie Claes.md", "case aside");
  assert.equal(resolveNote(index, "/v", "People/Sofie Claes"), "/team/People/Sofie Claes.md", "a path inside it");
  assert.equal(resolveNote(index, "/v", "Missing"), "");
  assert.equal(resolveNote(index, "/v", "Docs/Spec"), "A/Docs/Spec.md", "the end of a path");
  assert.equal(resolveNote(index, "/v", "C/Plan"), "");
  assert.equal(resolveNote(index, "/v", "/elsewhere/Plan.md"), "", "an absolute path outside the workspaces");
});

test("a shared vault's notes: known by name, by its path and by a path inside it", () => {
  const index = notesIndex("/v", ["Mine.md", "/team/Contexts/Work/Projects/Northwind.md", "/team/Calendar/Standup.md"]);
  assert.ok(noteKnown(index, "/v", "Northwind"));
  assert.ok(noteKnown(index, "/v", "/team/Calendar/Standup.md"));
  assert.ok(noteKnown(index, "/v", "Contexts/Work/Projects/Northwind"), "a path-style link in a team note");
  assert.ok(!noteKnown(index, "/v", "Contexts/Work/Projects/Other"));
});
