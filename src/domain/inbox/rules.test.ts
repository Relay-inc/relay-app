import test from "node:test";
import assert from "node:assert/strict";
import { captureName, choices, folderList, keeps, rawText } from "./rules.ts";

test("a note's text is one line without its frontmatter", () => {
  assert.equal(
    rawText('---\nabout: "[[Beacon]]"\n---\n\nCall Eva\nabout the  tax rule\n'),
    "Call Eva about the tax rule",
  );
  assert.equal(rawText("x".repeat(200), 20), `${"x".repeat(19)}…`);
});

test("only folders that hold notes are offered, with the ones above them, never the Inbox or hidden ones", () => {
  const paths = [
    "Inbox/a.md",
    "Calendar/Meetings/2026/a.md",
    "People/Eva.md",
    "System/rules/x.md",
    ".trash/a.md",
    "Top.md",
  ];
  assert.deepEqual(folderList(paths), ["Calendar", "Calendar/Meetings", "Calendar/Meetings/2026", "People"]);
});

test("the picker lists the picked folder first, the type's home, then what matches", () => {
  const folders = ["Calendar/Meetings/2026", "Contexts/Studio/Beacon/Documents", "People"];
  const base = {
    current: "Calendar/Meetings/2026",
    kind: "Meeting",
    home: "Calendar/Meetings/2026",
    folders,
    query: "",
    all: false,
  };
  assert.deepEqual(choices(base), [
    { path: "Calendar/Meetings/2026", home: "Meeting" },
    { path: "Contexts/Studio/Beacon/Documents" },
    { path: "People" },
  ]);
  assert.deepEqual(choices({ ...base, current: "People", query: "docu" }), [
    { path: "People" },
    { path: "Calendar/Meetings/2026", home: "Meeting" },
    { path: "Contexts/Studio/Beacon/Documents" },
  ]);
  assert.equal(choices({ ...base, folders: Array.from({ length: 20 }, (_, i) => `F${i}`) }).length, 1 + 6);
  assert.equal(choices({ ...base, all: true, folders: Array.from({ length: 20 }, (_, i) => `F${i}`) }).length, 1 + 20);
});

test("Keep in Inbox is a destination that leaves the note", () => {
  assert.equal(keeps({ path: "Inbox/a.md", title: "a", type: "", dest: "Inbox", links: [] }), true);
  assert.equal(keeps({ path: "Inbox/a.md", title: "a", type: "", dest: "People", links: [] }), false);
});

test("a capture is named for the minute it is made", () => {
  assert.equal(captureName(new Date(2026, 10, 4, 14, 32)), "Inbox/2026-11-04 1432.md");
  assert.equal(captureName(new Date(2026, 0, 5, 7, 5)), "Inbox/2026-01-05 0705.md");
});
