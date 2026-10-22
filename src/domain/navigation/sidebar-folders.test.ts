import { test } from "node:test";
import assert from "node:assert/strict";
import { byFolder, newFolderId } from "./sidebar-folders.ts";

const rows = [{ key: "a", folder: "f:1" }, { key: "b" }, { key: "c", folder: "f:gone" }, { key: "d", folder: "f:1" }];
const folders = [
  { id: "f:1", name: "Klant" },
  { id: "f:2", name: "Leeg" },
];

test("conversations go in their folder in order, the rest stays loose", () => {
  const { inside, loose } = byFolder(rows, row => row.folder, folders);
  assert.deepEqual(
    inside.get("f:1")!.map(row => row.key),
    ["a", "d"],
  );
  assert.deepEqual(inside.get("f:2"), []);
  // a folder that was deleted, or one of another project, leaves the conversation loose
  assert.deepEqual(
    loose.map(row => row.key),
    ["b", "c"],
  );
});
test("without folders everything is loose", () => {
  assert.equal(byFolder(rows, row => row.folder).loose.length, 4);
});
test("a folder id is never a project or section name", () => {
  assert.match(newFolderId(36), /^f:10$/);
});
