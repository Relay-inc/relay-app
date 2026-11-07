import assert from "node:assert/strict";
import { test } from "node:test";
import { counts, diffOf, isOpen, undoMerge, type Change } from "./changes.ts";

const entry = (states: ("open" | "kept")[]): Change => ({
  id: "1-a",
  at: 1,
  source: "capture",
  subject: "x",
  reason: "",
  files: states.map((state, i) => ({ path: `${i}.md`, before: "a", after: "b", state })),
});

test("an entry is open while a note is", () => {
  assert.equal(isOpen(entry(["kept", "open"])), true);
  assert.equal(isOpen(entry(["kept", "kept"])), false);
});

test("the diff shows the changed lines with their neighbours", () => {
  const lines = diffOf(
    "## Status\nGo live in sprint 24.\n",
    "## Status\nDry run in sprint 24.\nLive once confirmed.\n",
  );
  assert.deepEqual(lines, [
    { sign: " ", text: "## Status" },
    { sign: "-", text: "Go live in sprint 24." },
    { sign: "+", text: "Dry run in sprint 24." },
    { sign: "+", text: "Live once confirmed." },
  ]);
  assert.deepEqual(counts(lines), { add: 2, del: 1 });
  // a new note is all additions, a long untouched stretch is cut
  assert.deepEqual(counts(diffOf(null, "a\nb\n")), { add: 2, del: 0 });
  const long = Array.from({ length: 20 }, (_, i) => `l${i}`);
  assert.equal(diffOf(long.join("\n"), [...long, "new"].join("\n")).length, 2);
});

test("undo after an edit keeps the user's line and takes the job's out", () => {
  const before = "## Status\nGo live.\n";
  const after = "## Status\nGo live.\nDry run first.\n";
  const edited = "# Title\n## Status\nGo live.\nDry run first.\n";
  assert.equal(undoMerge({ current: edited, before, after }), "# Title\n## Status\nGo live.\n");
});

test("undo over the same lines changes nothing", () => {
  const merge = {
    current: "## Status\nMy rewrite.\n",
    before: "## Status\nGo live.\n",
    after: "## Status\nDry run.\n",
  };
  assert.equal(undoMerge(merge), null);
  assert.equal(undoMerge({ ...merge, current: null }), null);
});
