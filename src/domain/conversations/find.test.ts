import { test } from "node:test";
import assert from "node:assert/strict";
import { locate, occurrences } from "./find.ts";

test("occurrences in any case, regex characters taken literally", () => {
  assert.deepEqual(occurrences("Deploy, then deploy (again)", "DEPLOY"), [
    [0, 6],
    [13, 19],
  ]);
  assert.deepEqual(occurrences("a.b axb", "a.b"), [[0, 3]]);
  assert.deepEqual(occurrences("(again)", "(a"), [[0, 2]]);
  assert.deepEqual(occurrences("anything", ""), []);
});

test("an offset lands in its piece, an end on a seam in the piece before", () => {
  // "Hello " + "world" + "!"
  const starts = [0, 6, 11];
  assert.deepEqual(locate(starts, 0), [0, 0]);
  assert.deepEqual(locate(starts, 6), [1, 0]);
  assert.deepEqual(locate(starts, 8), [1, 2]);
  assert.deepEqual(locate(starts, 11, true), [1, 5]);
  assert.deepEqual(locate(starts, 12, true), [2, 1]);
});
