import { test } from "node:test";
import assert from "node:assert/strict";
import { time as kind } from "./time.ts";
import { TODAY, at, flags, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";

const on = { timeFromSessions: true, timeMin: 45 };

test("from 16:00, when the day's conversations show 15 minutes or more, and the setting is on", () => {
  assert.equal(kind.entries(snap(on), words, at(16)).length, 1);
  assert.equal(kind.entries(snap(on), words, at(15, 59)).length, 0, "too early");
  assert.equal(kind.entries(snap({ ...on, timeMin: 14 }), words, at(17)).length, 0, "too little");
  assert.equal(kind.entries(snap({ ...on, timeFromSessions: false }), words, at(17)).length, 0, "switched off");
});

test("the item is the day's, with its minutes", () => {
  const [draft] = kind.entries(snap(on), words, at(17));
  assert.equal(draft.id, `time:${TODAY}`);
  assert.equal(draft.why, 'today.timeWhy {"n":45}');
  assert.deepEqual(draft.subject, { type: "time", date: TODAY, minutes: 45 });
  const set = kind.actions(draft as EntryOf<"time">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["book"],
  );
  assert.equal(set.done?.id, "done");
});
