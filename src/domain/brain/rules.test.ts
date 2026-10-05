import assert from "node:assert/strict";
import { test } from "node:test";
import { brainKey, brainName, byBrain } from "./rules.ts";
import type { BrainNote } from "./types.ts";

const note = (brain: string, id: string): BrainNote => ({
  brain,
  id,
  kind: "memory",
  title: id,
  created: "2026-10-01",
  author: "k",
  source: "",
  body: "",
});

test("a brain is named by its last folder", () => {
  assert.equal(brainName("/Users/k/brains/team/"), "team");
  assert.equal(brainName("/"), "/");
});

test("the same id in two brains gives two keys", () => {
  assert.notEqual(brainKey(note("/a", "1")), brainKey(note("/b", "1")));
});

test("notes are grouped per brain in order of appearance", () => {
  const groups = byBrain([note("/b", "1"), note("/a", "2"), note("/b", "3")]);
  assert.deepEqual(
    groups.map(([brain, rows]) => [brain, rows.map(row => row.id)]),
    [
      ["/b", ["1", "3"]],
      ["/a", ["2"]],
    ],
  );
});
