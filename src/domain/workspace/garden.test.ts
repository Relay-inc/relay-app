import { test } from "node:test";
import assert from "node:assert/strict";
import { brokenLink, bytes, commonFolder, findingGroups } from "./garden.ts";

const f = (kind: string, paths: string[], path = "") => ({ kind, context: "", path, paths });

test("one group per kind: health first, then the garden, then a kind the app does not know", () => {
  const found = [
    f("orphan", ["a.md", "b.md"]),
    f("someday", [], "x.md"),
    f("outside_home", ["x.md"], "Meeting"),
    f("outside_home", ["y.md", "z.md"], "Daily"),
    f("missing_file", [], "CLAUDE.md"),
    f("missing_file", [], "System/rules/core/team.md"),
    f("orphan_rule", ["Contexts/Gone"], "System/rules/gone/context.md"),
  ];
  assert.deepEqual(
    findingGroups(found).map(r => [r.kind, r.n]),
    [
      ["missing_file", 2],
      ["orphan_rule", 1],
      ["outside_home", 3],
      ["orphan", 2],
      ["someday", 1],
    ],
  );
});

test("a broken link, the folder of some files and a size read as the tab shows them", () => {
  assert.deepEqual(brokenLink("Notes/A.md\t12\tPricewise API"), {
    note: "Notes/A.md",
    line: 12,
    target: "Pricewise API",
  });
  assert.equal(commonFolder(["Attachments/2026/a.png", "Attachments/2026/b.png"]), "Attachments/2026/");
  assert.equal(commonFolder(["Attachments/2026/a.png", "Attachments/2025/b.png"]), "Attachments/");
  assert.equal(commonFolder(["a.png"]), "");
  assert.equal(bytes(4_300_000, "en"), "4.1 MB");
  assert.equal(bytes(900, "en"), "900 B");
});
