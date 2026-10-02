import { test } from "node:test";
import assert from "node:assert/strict";
import { mailParts, prose } from "./text.ts";

test("a reply folds the quote under its attribution line", () =>
  assert.deepEqual(mailParts("Thanks!\n\nOn Mon, Ann wrote:\n> first\n> second\n\n-- \nBob"), [
    { kind: "block", text: "Thanks!", quoted: false },
    {
      kind: "fold",
      label: "On Mon, Ann wrote:",
      open: false,
      quote: [{ kind: "block", text: "first\nsecond", quoted: true }],
    },
    { kind: "block", text: "-- \nBob", quoted: false },
  ]));

test("an Outlook header starts the earlier mail", () =>
  assert.deepEqual(mailParts("New\nFrom: Ann\nSent: today\nold"), [
    { kind: "block", text: "New", quoted: false },
    {
      kind: "fold",
      label: null,
      open: false,
      quote: [{ kind: "block", text: "From: Ann\nSent: today\nold", quoted: true }],
    },
  ]));

test("links lose their brackets, images become placeholders", () =>
  assert.deepEqual(prose("see <https://x.example/a>. [image: logo]"), [
    { kind: "text", text: "see <" },
    { kind: "link", text: "https://x.example/a" },
    { kind: "text", text: ">. " },
    { kind: "image", text: "logo" },
    { kind: "text", text: "" },
  ]));
