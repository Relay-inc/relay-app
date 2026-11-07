import { test } from "node:test";
import assert from "node:assert/strict";
import { matchNotes, mentionAt, noteLabel } from "./mention.ts";
import { noteIn, splitFiles, withFiles } from "./files.ts";

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

test("a markdown file under a workspace root is a note, any other file is not", () => {
  const roots = ["/Users/demo/Vault", "/Users/demo/Side vault"];
  assert.deepEqual(noteIn("/Users/demo/Vault/Projects/Bea Plan.md", roots), {
    root: "/Users/demo/Vault",
    path: "Projects/Bea Plan.md",
  });
  assert.equal(noteIn("/Users/demo/Vault/Attachments/scan.pdf", roots), null);
  assert.equal(noteIn("/Users/demo/Downloads/Bea Plan.md", roots), null);
  assert.equal(noteIn("/Users/demo/Vault2/x.md", roots), null);
});

test("the sent message carries the note's absolute path", () => {
  const file = "/Users/demo/Vault/Projects/Bea Plan.md";
  const sent = withFiles("what changed?", [file]);
  assert.match(sent, /\n\/Users\/demo\/Vault\/Projects\/Bea Plan\.md\n/);
  assert.deepEqual(splitFiles(sent), { text: "what changed?", files: [file] });
});
