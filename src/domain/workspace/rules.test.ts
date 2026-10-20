import assert from "node:assert/strict";
import { test } from "node:test";
import { noteLinks, noteProperties, noteTitle, notesIndex } from "./rules.ts";

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
