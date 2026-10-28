import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote } from "./comments.ts";

test("a comment's quote is found again after edits around it, the nearest occurrence wins", () => {
  const body = "one plan\ntwo\nthe plan here\n";
  const at = body.indexOf("the plan");
  assert.deepEqual(findQuote(body, "the plan", at), { from: at, to: at + 8 });
  const edited = "zero\n" + body.replace("two", "two and a half");
  const now = edited.indexOf("the plan");
  assert.deepEqual(findQuote(edited, "the plan", at), { from: now, to: now + 8 });
  // "plan" twice: the one nearest where it was
  assert.deepEqual(findQuote(body, "plan", 15), { from: body.lastIndexOf("plan"), to: body.lastIndexOf("plan") + 4 });
});

test("a comment whose text is gone has no place", () => {
  assert.equal(findQuote("nothing left", "the plan", 3), null);
  assert.equal(findQuote("anything", "", 0), null);
});
