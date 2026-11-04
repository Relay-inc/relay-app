import { test } from "node:test";
import assert from "node:assert/strict";
import { outsideKinds, tidySample, type TidyMove } from "./tidy.ts";

const move = (from: string, renamed = false): TidyMove => ({
  kind: "Meeting",
  from,
  to: `Calendar/Meetings/2026/${from}`,
  renamed,
});

test("the sample lists the renamed moves first, then the rest in order, at most n", () => {
  const moves = [move("a.md"), move("b.md"), move("c 2.md", true), move("d.md")];
  assert.deepEqual(
    tidySample(moves, 3).map(m => m.from),
    ["c 2.md", "a.md", "b.md"],
  );
  assert.equal(tidySample(moves, 10).length, 4);
  assert.deepEqual(tidySample([], 6), []);
});

test("the kinds line counts the notes of each type", () => {
  assert.equal(
    outsideKinds([
      { path: "Meeting", paths: ["a", "b"] },
      { path: "Thread", paths: ["c"] },
    ]),
    "Meeting 2, Thread 1",
  );
});
