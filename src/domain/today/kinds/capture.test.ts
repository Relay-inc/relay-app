import { test } from "node:test";
import assert from "node:assert/strict";
import { capture as kind } from "./capture.ts";
import { NOW, at, flags, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";

const proposal = { title: "Add to project note", file: "Projects/App.md", change: "- decided X" };

test("what a closed conversation proposes is an item until applied or skipped", () => {
  const [draft] = kind.entries(
    snap({
      captures: [{ key: "c1", title: "Fix login", project: "app", at: at(9), proposals: [proposal, proposal] }],
    }),
    words,
    NOW,
  );
  assert.equal(draft.id, "capture:c1");
  assert.equal(draft.at, at(9));
  assert.equal(draft.title, "Fix login");
  assert.equal(draft.why, "capture.why#2");
  assert.equal(draft.project, "app");
  const set = kind.actions(draft as EntryOf<"capture">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["apply", "skip"],
  );
  assert.deepEqual([set.primary, set.secondary], [0, 1]);
});
