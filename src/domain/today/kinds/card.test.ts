import { test } from "node:test";
import assert from "node:assert/strict";
import { card as kind } from "./card.ts";
import { NOW, TODAY, flags, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";
import type { TodayCard } from "../rules.ts";

const item = (card: Partial<TodayCard["card"]> = {}): TodayCard =>
  ({
    provider: "prod",
    ref: {},
    project: "app",
    card: { id: "9", number: "212", title: "Export", placement: 0, state: "doing", me: true, ...card },
  }) as unknown as TodayCard;

test("a card is numbered, from its tracker, due today or in progress", () => {
  const [draft] = kind.entries(snap({ cards: [item({ due: TODAY })] }), words, NOW);
  assert.equal(draft.id, "card:prod:9");
  assert.equal(draft.title, "#212 Export");
  assert.equal(draft.where, "Productive");
  assert.equal(draft.why, "rem.today");
  assert.equal(draft.late, false);
  assert.equal(draft.project, "app");
  assert.equal(kind.entries(snap({ cards: [item()] }), words, NOW)[0].why, "today.inProgress");
  assert.equal(kind.entries(snap({ cards: [item({ number: "ENG-3" })] }), words, NOW)[0].title, "ENG-3 Export");
});

test("an overdue card says how many days and is late", () => {
  const [draft] = kind.entries(snap({ cards: [item({ due: "2026-10-02" })] }), words, NOW);
  assert.equal(draft.late, true);
  assert.equal(draft.tone, "late");
  assert.equal(draft.why, 'today.daysLate {"n":3}');
});

test("its status is its tracker's", () => {
  assert.equal(kind.state?.({ type: "card", card: item({ state: "todo" }) }), "todo");
});

test("start working, open in its tracker, ask Claude, open the ticket; Done is its own", () => {
  const [draft] = kind.entries(snap({ cards: [item()] }), words, NOW);
  const set = kind.actions(draft as EntryOf<"card">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["start", "openIn", "chat", "open"],
  );
  assert.equal(set.acts[1].label, 'kb.openIn {"name":"Productive"}');
  assert.equal(set.done?.id, "done");
});
