import { test } from "node:test";
import assert from "node:assert/strict";
import { reminder as kind } from "./reminder.ts";
import { NOW, flags, reminder, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";

test("a reminder is an item from its day on; an overdue one says how late and ranks earlier", () => {
  const entries = kind.entries(
    snap({
      reminders: [reminder(), reminder({ id: "r2", days: -3 }), reminder({ id: "r3", days: 2 })],
    }),
    words,
    NOW,
  );
  assert.deepEqual(
    entries.map(e => [e.id, e.late ?? false, e.tone]),
    [
      ["rem:r1", false, "soon"],
      ["rem:r2", true, "late"],
    ],
  );
  assert.equal(entries[0].why, "rem.today");
  assert.equal(entries[1].why, 'today.daysLate {"n":3}');
});

test("done, tomorrow, a week, or ask Claude", () => {
  const [draft] = kind.entries(snap({ reminders: [reminder()] }), words, NOW);
  const set = kind.actions(draft as EntryOf<"reminder">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["done", "tomorrow", "week", "chat"],
  );
  assert.deepEqual([set.primary, set.secondary], [0, 1]);
});
