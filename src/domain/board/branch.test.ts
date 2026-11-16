import { test } from "node:test";
import assert from "node:assert/strict";
import { branchName, branchType } from "./branch.ts";

test("a branch is type/number-slug", () => {
  assert.equal(
    branchName("417", "Decimal quantities on invoice lines", ["Bug"]),
    "fix/417-decimal-quantities-on-invoice-lines",
  );
  assert.equal(branchName("#212", "Export orders to CSV"), "feat/212-export-orders-to-csv");
  assert.equal(branchName("ENG-12", "Add search"), "feat/eng-12-add-search");
});

test("the slug is lower case ascii of about 40 characters, cut at a word", () => {
  assert.equal(branchName("9", "Één café: dé “beste” prijs!"), "feat/9-een-cafe-de-beste-prijs");
  const long = branchName("5", "A very long ticket title that goes on and on and on forever");
  assert.equal(long, "feat/5-a-very-long-ticket-title-that-goes-on");
  assert.ok(long.length - "feat/5-".length <= 40);
});

test("a title without ascii or a missing number still gives a name", () => {
  assert.equal(branchName("3", ""), "feat/3");
  assert.equal(branchName("", "Add search"), "feat/add-search");
});

test("bug and fix in the title or the labels make a fix branch", () => {
  assert.equal(branchType("Fix the totals"), "fix");
  assert.equal(branchType("Totals are wrong", ["bug"]), "fix");
  assert.equal(branchType("Prefix handling"), "feat");
  assert.equal(branchType("Debugging panel"), "feat");
});
