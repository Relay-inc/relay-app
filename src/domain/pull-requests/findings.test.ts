import { test } from "node:test";
import assert from "node:assert/strict";
import { agreed, replaceBy } from "./findings.ts";

const f = (id: string, agent: string | undefined, line = 1, severity = "bug") => ({
  id,
  pr: "u1",
  path: "a.ts",
  line,
  side: "RIGHT",
  severity,
  agent,
});

test("a new pass replaces only that agent's findings", () => {
  const all = [f("1", undefined), f("2", "codex"), f("3", "claude", 4, "answer")];
  assert.deepEqual(
    replaceBy(all, "claude", [f("4", "claude")]).map(x => x.id),
    ["2", "3", "4"],
  );
  assert.deepEqual(
    replaceBy(all, "codex", []).map(x => x.id),
    ["1", "3"],
  );
});

test("two agents on the same line agree, one agent twice or an answer does not", () => {
  const all = [
    f("1", "claude"),
    f("2", "codex"),
    f("3", "claude", 2),
    f("4", "claude", 2),
    f("5", "codex", 2, "answer"),
  ];
  assert.ok(agreed(all, all[0]));
  assert.ok(agreed(all, all[1]));
  assert.ok(!agreed(all, all[2]));
  assert.ok(!agreed(all, all[4]));
});
