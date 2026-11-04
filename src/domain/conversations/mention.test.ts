import { test } from "node:test";
import assert from "node:assert/strict";
import { matchNotes, mentionAt, noteLabel } from "./mention.ts";
import { splitFiles, withFiles } from "./files.ts";

test("mentionAt finds an @name at the caret, not inside an address", () => {
  assert.deepEqual(mentionAt("see @bea", 8), { from: 4, query: "bea" });
  assert.deepEqual(mentionAt("@", 1), { from: 0, query: "" });
  assert.equal(mentionAt("mail me@example.com", 19), null);
  assert.equal(mentionAt("@bea and more", 13), null);
});

test("matchNotes ranks names that start with the query first", () => {
  const paths = ["Notes/Notes on Bea.md", "Notes/Beacon.md", "Projects/Bea Plan.md", "Other/x.md"];
  assert.deepEqual(matchNotes(paths, "bea"), ["Projects/Bea Plan.md", "Notes/Beacon.md", "Notes/Notes on Bea.md"]);
  assert.equal(noteLabel("Projects/Bea Plan.md"), "Bea Plan");
});

test("the sent message carries the vault-relative path", () => {
  const sent = withFiles("what changed?", ["Projects/Bea Plan.md"]);
  assert.match(sent, /\nProjects\/Bea Plan\.md\n/);
  assert.deepEqual(splitFiles(sent), { text: "what changed?", files: ["Projects/Bea Plan.md"] });
});
