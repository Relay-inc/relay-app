import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchRanges, searchRows } from "./search.ts";

const row = (label: string, hint = "", section = "", extra = "") => ({ page: "p", section, label, hint, extra });

describe("searchRows", () => {
  const rows = [
    row("Retry", "Keep going after a limit", "Running"),
    row("Keep the Mac awake", "While a turn runs", "Running", "sleep"),
    row("Écran", "", "Keep"),
  ];
  it("ranks label matches before section and hint matches", () => {
    assert.deepEqual(
      searchRows(rows, "keep").map(h => h.row.label),
      ["Keep the Mac awake", "Écran", "Retry"],
    );
  });
  it("ignores case and accents", () => {
    assert.deepEqual(
      searchRows(rows, "ECRAN").map(h => h.row.label),
      ["Écran"],
    );
  });
  it("needs every word, in any field", () => {
    assert.deepEqual(
      searchRows(rows, "mac turn").map(h => h.row.label),
      ["Keep the Mac awake"],
    );
    assert.deepEqual(searchRows(rows, "mac nothing"), []);
  });
  it("finds synonyms and answers nothing for an empty query", () => {
    assert.equal(searchRows(rows, "sleep").length, 1);
    assert.deepEqual(searchRows(rows, "  "), []);
  });
});

describe("matchRanges", () => {
  it("finds every word, merged where they touch", () => {
    assert.deepEqual(matchRanges("Keep those changes; keep", ["keep"]), [
      [0, 4],
      [20, 24],
    ]);
    assert.deepEqual(matchRanges("Keepsake", ["keep", "keeps"]), [[0, 5]]);
    assert.deepEqual(matchRanges("École", ["ecole"]), [[0, 5]]);
  });
});
