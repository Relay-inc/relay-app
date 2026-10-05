import { test } from "node:test";
import assert from "node:assert/strict";
import { doingFirst, ordered, plan, rankOf, slots, statusOf, type Item } from "./plan.ts";

const H = 3_600_000;
const M = 60_000;
const day = Date.UTC(2026, 9, 5); // midnight; only differences matter here
const at = (h: number) => day + h * H;

test("free slots run between the meetings that are not over, to the end of the day", () => {
  const meetings = [
    { id: "standup", start: at(9), end: at(9.25) },
    { id: "planning", start: at(11.5), end: at(12.25) },
    { id: "lunch", start: at(12.5), end: at(13.5) },
  ];
  const free = slots(meetings, at(11), at(18));
  assert.deepEqual(
    free.map(s => [s.key, (s.start - day) / H, (s.end - day) / H]),
    [
      ["now", 11, 11.5],
      ["planning", 12.25, 12.5],
      ["lunch", 13.5, 18],
    ],
  );
  assert.deepEqual(
    slots(meetings, at(12), at(18)).map(s => s.key),
    ["planning", "lunch"],
    "in a meeting, the first slot starts when it ends",
  );
  assert.deepEqual(
    slots([], at(20), at(18)).map(s => (s.end - s.start) / H),
    [1],
    "an evening still has an hour",
  );
});

const item = (id: string, est: number, over: Partial<Item> = {}): Item => ({
  id,
  kind: "card",
  rank: 4,
  at: 0,
  est,
  ...over,
});

test("the queue: by rank, oldest first, what was put off at the end", () => {
  const items = [
    item("card", 30),
    item("ask", 2, { rank: rankOf("ask") }),
    item("late", 15, { rank: rankOf("reminder", true) }),
  ];
  assert.deepEqual(
    ordered(items, []).map(x => x.id),
    ["ask", "late", "card"],
  );
  assert.deepEqual(
    ordered(items, ["ask"]).map(x => x.id),
    ["late", "card", "ask"],
  );
});

test("the plan fills slots in order, keeps a prep before its meeting, and follows pins", () => {
  const free = [
    { key: "now", start: at(11), end: at(11.5), after: null },
    { key: "planning", start: at(12.25), end: at(12.5), after: "planning" },
    { key: "lunch", start: at(13.5), end: at(18), after: "lunch" },
  ];
  const queue = [
    item("a", 20),
    item("b", 15), // no room left before planning: in the 15 min after it
    item("prep", 10, { by: at(11.5) }), // fits the 10 min left now, before its meeting
    item("big", 60),
    item("pinned", 5),
    item("off", 5),
  ];
  const { placed, tomorrow, used } = plan(queue, free, { pinned: "lunch", off: "tomorrow" });
  assert.equal(placed.a.slot, "now");
  assert.equal(placed.b.slot, "planning");
  assert.deepEqual(placed.prep, { slot: "now", start: at(11) + 20 * M });
  assert.equal(placed.big.slot, "lunch");
  assert.equal(placed.pinned.slot, "lunch");
  assert.deepEqual(tomorrow, ["off"]);
  assert.equal(used.now, 30 * M);

  const tooLate = plan([item("x", 25), item("prep", 10, { by: at(11.5) })], free, {});
  assert.deepEqual(tooLate.tomorrow, ["prep"], "a prep that no longer fits before its meeting is not planned after it");
});

test("an item's status: the tracker's when there is one, else started on Today or not; in progress goes first", () => {
  assert.equal(statusOf("a", "doing", []), "doing");
  assert.equal(statusOf("a", "todo", ["a"]), "todo", "the tracker wins");
  assert.equal(statusOf("a", undefined, ["a"]), "doing");
  assert.equal(statusOf("b", undefined, ["a"]), "todo");
  const queue = [{ id: "x" }, { id: "y" }, { id: "z" }];
  assert.deepEqual(
    doingFirst(queue, item => (item.id === "z" ? "doing" : "todo")).map(item => item.id),
    ["z", "x", "y"],
  );
});
