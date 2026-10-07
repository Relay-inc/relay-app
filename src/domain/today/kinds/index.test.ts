import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, SUBJECTS, actionsFor, entries, isAgentItem, kindLabelKey, queueOf, rankOf } from "./index.ts";
import { NOW, TODAY, at, flags, iso, mail, meeting, pr, reminder, snap, words } from "./fixtures.ts";
import type { Kind } from "../plan.ts";
import type { Pending } from "../../conversations/types";
import type { Entry } from "./types.ts";

const ALL: Kind[] = [
  "ask",
  "blocked",
  "prep",
  "mail",
  "reminder",
  "card",
  "note",
  "review",
  "fix",
  "time",
  "finished",
  "capture",
];

test("every kind is registered once, with its subject", () => {
  assert.deepEqual(Object.keys(KINDS).sort(), [...ALL].sort());
  assert.deepEqual(Object.keys(SUBJECTS).sort(), [
    "ask",
    "blocked",
    "capture",
    "card",
    "chat",
    "mail",
    "meeting",
    "pr",
    "reminder",
    "time",
  ]);
  assert.deepEqual(
    [KINDS.prep.type, KINDS.note.type, KINDS.review.type, KINDS.fix.type, KINDS.finished.type],
    ["meeting", "meeting", "pr", "pr", "chat"],
  );
});

test("how long and how urgent: the ranks and estimates the queue was planned with", () => {
  assert.deepEqual(Object.fromEntries(ALL.map(kind => [kind, [KINDS[kind].rank, KINDS[kind].est]])), {
    ask: [0, 2],
    blocked: [3, 2],
    prep: [1, 10],
    mail: [2, 5],
    reminder: [4, 15],
    card: [4, 30],
    note: [5, 10],
    review: [6, 15],
    fix: [7, 20],
    time: [7, 5],
    finished: [8, 5],
    capture: [5, 3],
  });
  assert.equal(rankOf("reminder", true), 1.5, "overdue: two and a half steps earlier");
  assert.equal(rankOf("card"), 4);
});

const request = { id: "p1", project: "c1", tool_name: "Bash", input: {} } as unknown as Pending;
const day = (over = {}) =>
  snap({
    pending: [request],
    chats: {
      c1: { label: "Chat", project: null, projectLabel: "General" },
      c2: { label: "Done", project: null, projectLabel: "General" },
    },
    unseen: ["c2"],
    mails: [mail()],
    reminders: [reminder({ id: "late", days: -1 }), reminder({ id: "today" })],
    meetings: [meeting()],
    prs: { review: [pr()], mine: [] },
    ...over,
  });

test("the queue: agents first, then by rank with overdue reminders ahead, the oldest first within a rank", () => {
  const all = entries(day(), words, NOW);
  const queue = queueOf(all, []);
  assert.deepEqual(
    queue.map(e => e.id),
    ["ask:p1", "chat:c2", "prep:m1@9", "rem:late", "mail:mail:a:1", "rem:today", `review:${pr().url}`].map(id => id),
  );
  assert.ok(queue.slice(0, 2).every(isAgentItem));
});

test("what the user put off goes last, what is in progress first (after the agents)", () => {
  const all = entries(day({ doing: ["rem:today"] }), words, NOW);
  assert.deepEqual(
    queueOf(all, ["prep:m1@9"]).map(e => e.id),
    ["ask:p1", "chat:c2", "rem:today", "rem:late", "mail:mail:a:1", `review:${pr().url}`, "prep:m1@9"],
  );
});

test("an item taken off Today, or snoozed until a later day, is not in it", () => {
  const ids = (snapshot: ReturnType<typeof day>) => entries(snapshot, words, NOW).map(e => e.id);
  assert.ok(ids(day()).includes("rem:today"));
  assert.ok(!ids(day({ dismissed: ["rem:today"] })).includes("rem:today"));
  assert.ok(!ids(day({ snoozed: { "rem:today": { until: "2026-10-06" } } })).includes("rem:today"));
  assert.ok(ids(day({ snoozed: { "rem:today": { until: TODAY } } })).includes("rem:today"), "its day is today");
});

test("an estimate counts per kind, a status from where the item lives", () => {
  const all = entries(day({ doing: ["rem:today"] }), words, NOW);
  const byId = Object.fromEntries(all.map(e => [e.id, e]));
  assert.equal(byId["rem:today"].est, 15);
  assert.equal(byId["rem:today"].status, "doing");
  assert.equal(byId["rem:late"].status, "todo");
  assert.equal(byId["rem:late"].rank, 1.5);
});

test("the kind chip, and the actions of whichever kind an entry is", () => {
  const all = entries(day(), words, NOW);
  const get = (id: string) => all.find(e => e.id === id) as Entry;
  assert.equal(kindLabelKey(get("ask:p1")), "today.kind.ask");
  assert.equal(kindLabelKey(get("rem:today")), "today.kind.reminder");
  assert.equal(kindLabelKey(get("prep:m1@9")), "today.kind.prep");
  assert.deepEqual(
    actionsFor(get("rem:today"), flags, words).acts.map(a => a.id),
    ["done", "tomorrow", "week", "chat"],
  );
  void [at, iso];
});
