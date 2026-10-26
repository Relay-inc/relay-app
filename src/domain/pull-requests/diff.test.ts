import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorOf, inPatch, parsePatch, splitRows } from "./diff.ts";

const patch = "@@ -10,4 +10,5 @@ fn main\n a\n-b\n+B\n+C\n c\n\\ No newline at end of file";

test("a patch as lines with their old and new numbers", () => {
  const lines = parsePatch(patch);
  assert.deepEqual(
    lines.map(l => (l.kind === "hunk" ? "@" : `${l.kind}:${l.old ?? "-"}:${l.new ?? "-"}:${l.text}`)),
    ["@", "ctx:10:10:a", "del:11:-:b", "add:-:11:B", "add:-:12:C", "ctx:12:13:c"],
  );
  assert.deepEqual(parsePatch(null), []);
});

test("a comment goes on the new line, or the old one for a removed line; only lines in the patch", () => {
  const lines = parsePatch(patch);
  assert.deepEqual(anchorOf(lines[2]), { line: 11, side: "LEFT" });
  assert.deepEqual(anchorOf(lines[3]), { line: 11, side: "RIGHT" });
  assert.equal(anchorOf(lines[0]), null);
  assert.ok(inPatch(lines, 12, "RIGHT"));
  assert.ok(!inPatch(lines, 40, "RIGHT"));
  assert.ok(inPatch(lines, 11, "LEFT"));
});

test("side by side: a removed run pairs with the added run after it, the rest against nothing", () => {
  const rows = splitRows(parsePatch("@@ -1,4 +1,4 @@\n a\n-b\n+B\n+C\n c\n-d\n+e"));
  const side = (l: ReturnType<typeof parsePatch>[number] | null) => (l && l.kind !== "hunk" ? l.text : "_");
  assert.deepEqual(
    rows.map(r => (r.kind === "hunk" ? "@" : `${side(r.left)}|${side(r.right)}`)),
    ["@", "a|a", "b|B", "_|C", "c|c", "d|e"],
  );
});
