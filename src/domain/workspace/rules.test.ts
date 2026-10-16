import assert from "node:assert/strict";
import { test } from "node:test";
import { noteProperties } from "./rules.ts";

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
