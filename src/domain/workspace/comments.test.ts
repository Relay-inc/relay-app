import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, membersFor, mentionQuery, mentionsIn } from "./comments.ts";

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

test("@ in a comment lists the members whose name starts with what is typed, and a sent text keeps who it names", () => {
  const members = [
    { fp: "aaaaaaaaaaaaaaaa", name: "Ann" },
    { fp: "bbbbbbbbbbbbbbbb", name: "Bob" },
    { fp: "cccccccccccccccc", name: "anna" },
  ];
  assert.equal(mentionQuery("Hi @an", 6), "an");
  assert.equal(mentionQuery("@", 1), "");
  assert.equal(mentionQuery("mail@an", 7), null); // an address, not a mention
  assert.equal(mentionQuery("Hi @Ann there", 13), null);
  assert.deepEqual(
    membersFor("an", members).map(m => m.name),
    ["Ann", "anna"],
  );
  assert.deepEqual(membersFor("", members).length, 3);
  assert.deepEqual(mentionsIn("@Ann look, @Bob", members), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  assert.deepEqual(mentionsIn("@Ann removed", members.slice(1)), []);
});
