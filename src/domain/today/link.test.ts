import { test } from "node:test";
import assert from "node:assert/strict";
import { byNumber, byTitle, numbersIn } from "./link.ts";

const cards = [
  { id: "a", number: "212", title: "Update the estimate in the contract appendix" },
  { id: "b", number: "214", title: "Rate sign-off from finance" },
  { id: "c", number: "ENG-12", title: "Invoice export per sprint" },
];

test("the numbers a title or branch names", () => {
  assert.deepEqual(numbersIn("#212 Update appendix").sort(), ["212"]);
  assert.deepEqual(numbersIn("212: Update appendix"), ["212"]);
  assert.deepEqual(numbersIn("[212] Update appendix"), ["212"]);
  assert.deepEqual(numbersIn("ENG-12 export"), ["eng-12"]);
  assert.deepEqual(numbersIn("feature/212-appendix"), ["212"]);
  assert.deepEqual(numbersIn("Upgrade to PHP 8.5"), [], "a version is no ticket");
  assert.deepEqual(numbersIn("Holiday banner for 2026 season"), [], "a number in the middle of a title is no ticket");
});

test("a PR on a card by number: title or branch, one card only", () => {
  assert.equal(byNumber({ title: "#212 Update appendix" }, cards)?.id, "a");
  assert.equal(byNumber({ title: "Appendix", branch: "feature/214-rate" }, cards)?.id, "b");
  assert.equal(byNumber({ title: "eng-12: export" }, cards)?.id, "c");
  assert.equal(byNumber({ title: "#212 and #214" }, cards), null, "two cards: no guess");
  assert.equal(byNumber({ title: "#999 Something" }, cards), null);
});

test("a PR on a card by title: most words shared and clearly the closest", () => {
  assert.equal(byTitle("Update estimate in contract appendix", cards)?.id, "a");
  assert.equal(byTitle("Invoice export per sprint", cards)?.id, "c");
  assert.equal(byTitle("Refactor the login", cards), null);
  assert.equal(byTitle("Fix", cards), null, "too few words to say");
});
