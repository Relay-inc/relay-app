import assert from "node:assert/strict";
import { test } from "node:test";
import { noteKnown, noteLinks, noteProperties, noteTitle, notesIndex } from "./rules.ts";

test("noteProperties: values, lists, inline lists and quotes, empty keys left out", () => {
  const yaml = [
    "type: Initiative",
    'context: "[[Personal]]"',
    "parent:",
    "aliases:",
    '  - "claude-ui"',
    "  - relay",
    "tags: [a, 'b']",
    "cover:",
    "laatst: 2026-10-15",
    "fase: dagelijks: in gebruik",
  ].join("\n");
  assert.deepEqual(noteProperties(yaml), [
    ["type", ["Initiative"]],
    ["context", ["[[Personal]]"]],
    ["aliases", ["claude-ui", "relay"]],
    ["tags", ["a", "b"]],
    ["laatst", ["2026-10-15"]],
    ["fase", ["dagelijks: in gebruik"]],
  ]);
});

test("noteTitle: a leading heading is the title, else the file name made readable", () => {
  assert.deepEqual(noteTitle("Contexts/Relay/Relay.md", "# Relay\n\nBody"), { title: "Relay", body: "\nBody" });
  assert.equal(
    noteTitle("o2o/route-middleware-sees-rendered-refusals.md", "Body").title,
    "Route middleware sees rendered refusals",
  );
  assert.equal(noteTitle("Calendar/Plan - Brain view.md", "Body").title, "Plan - Brain view");
});

test("noteLinks: existing notes once, by path or name, not the note itself", () => {
  const index = notesIndex("/v", ["A/Docs/Spec.md", "B/Plan.md", "Self.md"]);
  const text = "[[Spec]] and [[Spec|the spec]], [[B/Plan]], [[Missing]], [[Self]]";
  assert.deepEqual(noteLinks(index, "/v", "Self.md", text), [
    { target: "Spec", label: "Spec", folder: "Docs" },
    { target: "B/Plan", label: "B/Plan", folder: "B" },
  ]);
});

test("a shared vault's notes: known by name, by its path and by a path inside it", () => {
  const index = notesIndex("/v", ["Mine.md", "/team/Contexts/Work/Projects/Spardex.md", "/team/Calendar/Standup.md"]);
  assert.ok(noteKnown(index, "/v", "Spardex"));
  assert.ok(noteKnown(index, "/v", "/team/Calendar/Standup.md"));
  assert.ok(noteKnown(index, "/v", "Contexts/Work/Projects/Spardex"), "a path-style link in a team note");
  assert.ok(!noteKnown(index, "/v", "Contexts/Work/Projects/Other"));
  assert.deepEqual(
    noteLinks(index, "/v", "Mine.md", "[[Calendar/Standup]] and [[Spardex|the project]]").map(link => link.label),
    ["Calendar/Standup", "the project"],
  );
});
