import { test } from "node:test";
import assert from "node:assert/strict";
import { attachedIn, fileName, readsAttached, splitFiles, withFiles } from "./files.ts";
import type { Pending } from "./types";

test("attached paths go after the text and come back out of it", () => {
  const sent = withFiles("look at this", ["/Users/l/Downloads/a b.pdf", "/Users/l/notes"]);
  assert.deepEqual(splitFiles(sent), { text: "look at this", files: ["/Users/l/Downloads/a b.pdf", "/Users/l/notes"] });
  assert.deepEqual(splitFiles(withFiles("", ["/x.csv"])), { text: "", files: ["/x.csv"] });
  assert.equal(withFiles("hi", []), "hi");
  assert.deepEqual(splitFiles("no files here"), { text: "no files here", files: [] });
});

test("a file's name is its last part", () => {
  assert.equal(fileName("/Users/l/a.pdf"), "a.pdf");
  assert.equal(fileName("/Users/l/folder/"), "folder");
});

const card = (tool_name: string, input: Pending["input"]): Pending => ({ id: "1", project: "c:1", tool_name, input });
test("reading an attached file or inside an attached folder needs no card, anything else does", () => {
  const attached = attachedIn([
    { kind: "me", text: "", files: ["/Users/l/a.pdf", "/Users/l/docs"] },
    { kind: "ai", text: "" },
  ]);
  assert.ok(readsAttached(card("Read", { file_path: "/Users/l/a.pdf" }), attached));
  assert.ok(readsAttached(card("Read", { file_path: "/Users/l/docs/x/y.md" }), attached));
  assert.ok(readsAttached(card("Grep", { path: "/Users/l/docs" }), attached));
  assert.ok(!readsAttached(card("Read", { file_path: "/Users/l/a.pdf.bak" }), attached));
  assert.ok(!readsAttached(card("Read", { file_path: "/Users/l/docsecret" }), attached));
  assert.ok(!readsAttached(card("Read", { file_path: "/Users/l/docs/../.ssh/id_rsa" }), attached));
  assert.ok(!readsAttached(card("Edit", { file_path: "/Users/l/a.pdf" }), attached));
  assert.ok(!readsAttached(card("Glob", { pattern: "**" }), attached));
});
