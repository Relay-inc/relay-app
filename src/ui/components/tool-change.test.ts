import { test } from "node:test";
import assert from "node:assert/strict";
import { changeOf } from "./tool-change.ts";

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
