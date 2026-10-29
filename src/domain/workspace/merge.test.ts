import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, headAfter, lineChanges, merge3, oneChange } from "./merge.ts";

const base = "# Title\n\none\ntwo\nthree\nfour\n";

test("edits in different places both land", () => {
  const ours = base.replace("one", "one, typed");
  const theirs = base.replace("four", "four, by Claude");
  assert.equal(merge3(base, ours, theirs), "# Title\n\none, typed\ntwo\nthree\nfour, by Claude\n");
});

test("the same line changed two ways is left to the user", () => {
  assert.equal(merge3(base, base.replace("two", "2"), base.replace("two", "II")), null);
});

test("the same change on both sides is fine", () => {
  const both = base.replace("two", "2");
  assert.equal(merge3(base, both, both), both);
});

test("an append at the end while typing above", () => {
  const ours = base.replace("one", "uno");
  const theirs = base + "five\n";
  assert.equal(merge3(base, ours, theirs), "# Title\n\nuno\ntwo\nthree\nfour\nfive\n");
});

test("two appends at the same place clash", () => {
  assert.equal(merge3(base, base + "mine\n", base + "theirs\n"), null);
});

test("the file emptied while typing elsewhere clashes, untouched it empties", () => {
  assert.equal(merge3(base, base.replace("one", "uno"), ""), null);
  assert.equal(merge3(base, base, ""), "");
});

test("CRLF lines merge and keep their endings", () => {
  const b = base.replace(/\n/g, "\r\n");
  const ours = b.replace("one", "uno");
  const theirs = b.replace("four", "vier");
  assert.equal(merge3(b, ours, theirs), "# Title\r\n\r\nuno\r\ntwo\r\nthree\r\nvier\r\n");
});

test("diffLines gives the changed runs only", () => {
  assert.deepEqual(diffLines(["a", "b", "c"], ["a", "x", "c", "d"]), [
    { from: 1, to: 2, lines: ["x"] },
    { from: 3, to: 3, lines: ["d"] },
  ]);
});

test("lineChanges applied in order give the new text", () => {
  const apply = (text: string, changes: ReturnType<typeof lineChanges>) =>
    changes.reduceRight((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);
  const cases: [string, string][] = [
    ["a\nb\nc\n", "a\nx\nc\nd\n"],
    ["a\nb\nc", "a\nb"],
    ["a\nb\nc", "a\nb\nc\nd"],
    ["a\nb", "x\ny"],
    ["", "new\n"],
    ["a\nb\n", ""],
    ["one\ntwo\nthree", "zero\none\nthree\nfour"],
  ];
  for (const [before, after] of cases)
    assert.equal(apply(before, lineChanges(before, after)), after, JSON.stringify(before));
});

test("oneChange keeps what both texts share at the start and the end", () => {
  assert.deepEqual(oneChange("one two three", "one 2 three"), { from: 4, to: 7, insert: "2" });
  assert.deepEqual(oneChange("aaa", "aaaa"), { from: 3, to: 3, insert: "a" });
  assert.deepEqual(oneChange("same", "same"), { from: 4, to: 4, insert: "" });
});

test("headAfter moves the head's end with what changed before it, not after it", () => {
  assert.equal(headAfter([{ retain: 2 }, { insert: "xy" }], 10), 12, "typed in the head");
  assert.equal(headAfter([{ retain: 10 }, { insert: "xy" }], 10), 10, "at the end: the body's");
  assert.equal(headAfter([{ retain: 8 }, { delete: 5 }], 10), 8, "a removal across the end");
  assert.equal(headAfter([{ retain: 12 }, { delete: 3 }], 10), 10, "in the body");
});
