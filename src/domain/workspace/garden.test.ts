import { test } from "node:test";
import assert from "node:assert/strict";
import { brokenLink, bytes, commonFolder, gardenRows, gardenTotal } from "./garden.ts";

const f = (kind: string, paths: string[], path = "") => ({ kind, context: "", path, paths });

test("every kind counts by its notes, in the tab's order, and a finding of Health's is no garden row", () => {
  const found = [
    f("orphan", ["a.md", "b.md"]),
    f("outside_home", ["x.md"], "Meeting"),
    f("outside_home", ["y.md", "z.md"], "Daily"),
    f("missing_file", [], "CLAUDE.md"),
  ];
  assert.deepEqual(
    gardenRows(found).map(r => [r.kind, r.n]),
    [
      ["outside_home", 3],
      ["orphan", 2],
    ],
  );
  assert.equal(gardenTotal(found), 5);
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
