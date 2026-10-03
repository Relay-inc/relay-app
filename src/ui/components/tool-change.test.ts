import { test } from "node:test";
import assert from "node:assert/strict";
import { changeOf, hunkRows } from "./tool-change.ts";

test("changeOf: edits, writes and other tools", () => {
  assert.deepEqual(changeOf("Edit", { old_string: "a\nb", new_string: "c" }), { del: ["a", "b"], add: ["c"] });
  assert.deepEqual(
    changeOf("MultiEdit", {
      edits: [
        { old_string: "a", new_string: "" },
        { old_string: "x", new_string: "y" },
      ],
    }),
    { del: ["a", "x"], add: ["y"] },
  );
  assert.deepEqual(changeOf("Write", { content: "one\ntwo" }), { del: [], add: ["one", "two"] });
  assert.equal(changeOf("Write", {}), null);
  assert.equal(changeOf("Edit", { file_path: "x" }), null);
  assert.equal(changeOf("Read", { old_string: "a", new_string: "b" }), null);
});

test("hunkRows: line numbers, one context line around a change, a gap between hunks", () => {
  const rows = hunkRows([
    { oldStart: 39, newStart: 39, lines: [" a", " b", " ## Stand", "-hours", "+points", "+rate", " c", " d", " e"] },
    { oldStart: 90, newStart: 91, lines: [" x", "-y", "\\ No newline at end of file"] },
  ]);
  assert.deepEqual(rows, [
    { sign: " ", n: 41, text: "## Stand" },
    { sign: "-", n: 42, text: "hours" },
    { sign: "+", n: 42, text: "points" },
    { sign: "+", n: 43, text: "rate" },
    { sign: " ", n: 44, text: "c" },
    { gap: true },
    { sign: " ", n: 91, text: "x" },
    { sign: "-", n: 91, text: "y" },
  ]);
  assert.deepEqual(hunkRows([{ oldStart: 1, newStart: 1, lines: [" only context"] }]), []);
});
