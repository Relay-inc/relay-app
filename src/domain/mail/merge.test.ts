import { test } from "node:test";
import assert from "node:assert/strict";
import { newestFirst, visible } from "./merge.ts";

const row = (account: string, date: string) => ({ account, date });

test("the merged list is newest first", () => {
  const rows = newestFirst([
    row("a", "2026-01-02T00:00:00Z"),
    row("b", "2026-01-03T00:00:00Z"),
    row("a", "2026-01-01T00:00:00Z"),
  ]);
  assert.deepEqual(
    rows.map(r => r.date.slice(8, 10)),
    ["03", "02", "01"],
  );
});

test("rows below the highest edge of an account with more pages are held back", () => {
  const rows = newestFirst([
    row("a", "2026-03-01T00:00:00Z"),
    row("a", "2026-02-01T00:00:00Z"), // a's edge: older mails of a are still unloaded
    row("b", "2026-01-15T00:00:00Z"), // b is complete, but below a's edge a mail of a could be missing
    row("b", "2026-01-01T00:00:00Z"),
  ]);
  assert.equal(visible(rows, { a: true }).length, 2);
  assert.equal(visible(rows, { a: true, b: true }).length, 2, "the highest edge wins");
  assert.equal(visible(rows, {}).length, 4, "everything loaded: nothing held back");
  assert.equal(visible(rows, { b: true }).length, 4, "b's own edge is its oldest row");
});
