import { test } from "node:test";
import assert from "node:assert/strict";
import { myCardToday, meetingsToday, prsForMe, byDue, type TodayCard } from "./rules.ts";
import type { Card } from "../board/types";
import type { Meeting } from "../calendar/types";
import type { PR } from "../pull-requests/types";

const card = (over: Partial<Card>): Card => ({
  id: "1",
  title: "t",
  number: "1",
  column: "c",
  placement: 0,
  due: null,
  who: "Kristof",
  me: true,
  ...over,
});

test("a card is mine today when it is due today or earlier, or in progress", () => {
  const today = "2026-10-05";
  assert.ok(myCardToday(card({ due: "2026-10-05" }), today));
  assert.ok(myCardToday(card({ due: "2026-09-30" }), today), "overdue");
  assert.ok(myCardToday(card({ state: "doing" }), today), "in progress without a due date");
  assert.ok(!myCardToday(card({ due: "2026-10-06" }), today), "tomorrow");
  assert.ok(!myCardToday(card({}), today), "backlog");
  assert.ok(!myCardToday(card({ due: "2026-10-01", state: "done" }), today), "finished");
  assert.ok(!myCardToday(card({ due: "2026-10-01", me: false }), today), "someone else's");
});

test("cards sort overdue first, those without a due date last", () => {
  const at = (id: string, due: string | null): TodayCard => ({
    provider: "p",
    ref: { provider: "p", project: "", board: "" },
    project: "",
    card: card({ id, due }),
  });
  const sorted = [at("none", null), at("today", "2026-10-05"), at("late", "2026-10-01")].sort(byDue);
  assert.deepEqual(
    sorted.map(x => x.card.id),
    ["late", "today", "none"],
  );
});

test("today's meetings: only the local day, ended ones apart, Now's left out", () => {
  const day = new Date(2026, 9, 5, 0, 0).getTime();
  const now = day + 10 * 3600e3; // 10:00 local
  const meeting = (id: string, startH: number, hours = 1): Meeting => ({
    id,
    feed: "",
    title: id,
    start: new Date(day + startH * 3600e3).toISOString(),
    end: new Date(day + (startH + hours) * 3600e3).toISOString(),
    location: "",
    join: "",
    organizer: "",
    people: [],
  });
  const list = [
    meeting("yesterday", -2),
    meeting("morning", 8),
    meeting("running", 9.5),
    meeting("soon", 10.25),
    meeting("evening", 19),
    meeting("tomorrow", 25),
  ];
  const { coming, past } = meetingsToday(list, now, new Set(["soon"]));
  assert.deepEqual(
    coming.map(m => m.id),
    ["running", "evening"],
  );
  assert.deepEqual(
    past.map(m => m.id),
    ["morning"],
  );
});

test("PRs for me: every review asked, my own only with changes requested or failing CI", () => {
  const pr = (number: number, over: Partial<PR>): PR => ({
    number,
    title: "",
    url: "",
    repo: "o/r",
    draft: false,
    created: "",
    updated: "",
    author: "me",
    review: null,
    ci: null,
    project: null,
    ...over,
  });
  const mine = [
    pr(1, {}),
    pr(2, { review: "CHANGES_REQUESTED" }),
    pr(3, { ci: "FAILURE" }),
    pr(4, { ci: "SUCCESS", review: "APPROVED" }),
  ];
  const got = prsForMe({ mine, review: [pr(9, {})] });
  assert.deepEqual(
    got.mine.map(x => x.number),
    [2, 3],
  );
  assert.deepEqual(
    got.review.map(x => x.number),
    [9],
  );
  assert.deepEqual(prsForMe(null), { review: [], mine: [] });
});
