import { test } from "node:test";
import assert from "node:assert/strict";
import { withFirstPage } from "./rules.ts";
import type { Mail } from "./types";

const mail = (account: string, id: string, date: string): Mail => ({
  id,
  account,
  date,
  subject: "",
  unread: false,
  from: [],
  to: [],
  attachments: false,
});

test("one account's first page replaces its rows and keeps the other account's", () => {
  const list = [mail("a", "1", "2026-01-05T00:00:00Z"), mail("b", "2", "2026-01-02T00:00:00Z")];
  const next = withFirstPage(list, "a", [mail("a", "3", "2026-01-04T00:00:00Z")]);
  assert.deepEqual(
    next.map(m => m.id),
    ["3", "2"],
    "a row of a not in its newest page is gone (archived), b stays",
  );
  assert.deepEqual(
    withFirstPage(list, "a", []).map(m => m.id),
    ["2"],
    "an empty page empties only that account",
  );
});
