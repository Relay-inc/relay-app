import { test } from "node:test";
import assert from "node:assert/strict";
import {
  digestOf,
  freeTime,
  glyphOf,
  owedFrom,
  lanes,
  lengthOf,
  nowCard,
  pct,
  scale,
  timed,
  wrapUps,
  type Owed,
} from "./day.ts";
import type { Meeting } from "../calendar/types";

const NOW0 = new Date(2026, 10, 4).getTime(); // local midnight
const at = (h: number, m = 0, day = 0) => NOW0 + day * 86_400_000 + (h * 60 + m) * 60_000;
const meeting = (id: string, from: number, to: number, extra: Partial<Meeting> = {}): Meeting => ({
  id,
  feed: "x",
  title: id,
  start: new Date(from).toISOString(),
  end: new Date(to).toISOString(),
  location: "",
  join: "",
  organizer: "",
  people: [],
  ...extra,
});
const day = [
  meeting("a", at(9, 30), at(10)),
  meeting("b", at(11), at(12)),
  meeting("c", at(14), at(15, 30)),
  meeting("d", at(16, 30), at(17)),
];

test("the strip is 08:00 to 18:00, widened to whole hours by a meeting outside it", () => {
  assert.deepEqual(scale(day.map(timed), at(8, 40)), { from: 8, to: 18 });
  assert.deepEqual(scale([timed(meeting("e", at(7, 15), at(8)))], at(9)), { from: 7, to: 18 });
  assert.deepEqual(scale([timed(meeting("f", at(17), at(19, 30)))], at(9)), { from: 8, to: 20 });
  assert.equal(pct(at(13), { from: 8, to: 18 }, at(9)), 50);
  assert.equal(pct(at(6), { from: 8, to: 18 }, at(9)), 0);
});

test("free time is the gaps of the working day, from now once inside it", () => {
  // the design's morning: 08:40, four meetings
  const morning = freeTime(day.map(timed), at(8, 40));
  assert.equal(morning.minutes, 50 + 60 + 120 + 60 + 60, "08:40-09:30, 10-11, 12-14, 15:30-16:30, 17-18");
  assert.equal(lengthOf(morning.minutes), "5h 50");
  assert.deepEqual(morning.largest, { start: at(12), end: at(14) });
  // a meeting running: the gaps after it
  assert.equal(freeTime(day.map(timed), at(14, 42)).minutes, 60 + 60);
  // before the day starts, it starts at 08:00; after it ends, nothing
  assert.equal(freeTime([], at(6)).minutes, 600);
  assert.equal(freeTime([], at(19)).minutes, 0);
  assert.equal(freeTime([], at(19)).largest, null);
  // overlapping meetings are busy once
  assert.equal(
    freeTime([timed(meeting("x", at(9), at(11))), timed(meeting("y", at(10), at(12)))], at(8)).minutes,
    60 + 360,
  );
  assert.equal(lengthOf(45), "45 min");
  assert.equal(lengthOf(120), "2h");
});

test("meetings that overlap stack in lanes, the others share the first", () => {
  assert.deepEqual(lanes(day.map(timed)), { lane: { a: 0, b: 0, c: 0, d: 0 }, lanes: 1 });
  const overlap = [meeting("x", at(9), at(10)), meeting("y", at(9, 30), at(10, 30)), meeting("z", at(10), at(11))].map(
    timed,
  );
  assert.deepEqual(lanes(overlap), { lane: { x: 0, y: 1, z: 0 }, lanes: 2 });
  assert.equal(lanes([]).lanes, 1);
});

test("a meeting's glyph: planned, briefed, live, wrapped, with a mail when followed up, dashed when over and not wrapped", () => {
  assert.deepEqual(glyphOf("planned", false, false), { stage: "planned", followed: false, dashed: false });
  assert.deepEqual(glyphOf("briefed", false, true), { stage: "briefed", followed: false, dashed: true });
  assert.deepEqual(glyphOf("live", false, false), { stage: "live", followed: false, dashed: false });
  assert.deepEqual(glyphOf("live", false, true).dashed, false, "recording past its end is still live");
  assert.deepEqual(glyphOf("wrapped", true, true), { stage: "wrapped", followed: true, dashed: false });
  assert.equal(glyphOf("briefed", true, false).followed, false, "only a wrapped meeting is followed up");
});

test("the card above the queue follows the clock", () => {
  const stages = { a: "briefed", b: "planned", c: "planned", d: "planned" } as const;
  assert.deepEqual(nowCard([], {}, at(9)), { kind: "none" });
  assert.deepEqual(nowCard(day, stages, at(17, 30)), { kind: "none" }, "nothing left today");
  // more than 30 minutes before: one line
  const next = nowCard(day, stages, at(8, 40));
  assert.equal(next.kind === "next" && next.minutes, 50);
  assert.equal(next.kind === "next" && next.stage, "briefed");
  // within 30 minutes: expanded
  const soon = nowCard(day, stages, at(9, 10));
  assert.equal(soon.kind === "soon" && soon.minutes, 20);
  assert.equal(soon.kind === "soon" && soon.running, false);
  assert.equal(nowCard(day, stages, at(9, 0)).kind, "soon", "exactly 30 minutes is soon");
  assert.equal(nowCard(day, stages, at(8, 59)).kind, "next");
  // running without a recording: expanded, started already
  const running = nowCard(day, stages, at(9, 40));
  assert.equal(running.kind === "soon" && running.running, true);
  // a joinable link makes Join first
  const withLink = [meeting("a", at(9, 30), at(10), { join: "https://meet.google.com/abc-defg-hij" })];
  assert.equal(
    nowCard(withLink, {}, at(9, 10)).kind === "soon" &&
      (nowCard(withLink, {}, at(9, 10)) as { joinFirst: boolean }).joinFirst,
    true,
  );
  // the recorded one wins, with the minutes it has run
  const live = nowCard(day, { ...stages, c: "live" }, at(14, 42));
  assert.equal(live.kind === "live" && live.meeting.id, "c");
  assert.equal(live.kind === "live" && live.minutes, 42);
});

test("the wrap-ups owed: ended in the last three days, with something to wrap and no summary", () => {
  const now = at(15);
  const notes = {
    a: { stage: "briefed" as const, content: true },
    b: { stage: "wrapped" as const, content: true },
    c: { stage: "briefed" as const, content: true }, // still running at 15:00
    d: { stage: "planned" as const, content: false },
  };
  const earlier: Owed[] = [
    { id: "old1", title: "Monday", start: new Date(at(10, 0, -2)).toISOString() },
    { id: "old2", title: "Too old", start: new Date(at(10, 0, -3)).toISOString() },
    { id: "a", title: "dup of today's", start: new Date(at(9, 30)).toISOString() },
  ];
  const owed = wrapUps(day, notes, earlier, now);
  assert.deepEqual(
    owed.map(o => o.id),
    ["old1", "a"],
    "oldest first; a wrapped one, a running one, one without notes and a too old one are not",
  );
  assert.deepEqual(
    wrapUps(day, notes, [], at(8)).map(o => o.id),
    [],
    "nothing has ended yet",
  );
});

test("what a meeting's note says for Today: its stage, whether there is something to wrap up, whether it was followed up", () => {
  assert.deepEqual(digestOf(null), { stage: "planned", content: false, followed: false });
  const noted = "---\ntype: Meeting\n---\n# T\n\n## Notes\n- [09:31] a\n";
  assert.deepEqual(digestOf(noted), { stage: "planned", content: true, followed: false });
  assert.equal(digestOf("# T\n\n## Briefing\nG\n\n## Notes\n- \n").stage, "briefed");
  assert.equal(digestOf("# T\nTranscript: [[A/x]]\n\n## Notes\n").content, true, "a recording counts");
  const done = "---\nfollowed-up: true\n---\n# T\n\n## Summary\nS\n";
  assert.deepEqual(digestOf(done), { stage: "wrapped", content: false, followed: true });
});

test("an earlier day's meeting note is owed when it has notes and no summary", () => {
  const note = '---\ntype: Meeting\nevent: "abc@100"\n---\n# Northwind sync\n\n## Notes\n- [09:31] a\n';
  const owed = owedFrom("Calendar/2026-11-02 Northwind sync.md", note, "2026-11-02")!;
  assert.equal(owed.id, "abc@100");
  assert.equal(owed.title, "Northwind sync");
  assert.equal(new Date(owed.start).getDate(), 2);
  assert.equal(
    owedFrom("Calendar/2026-11-02 X.md", note.replace("type: Meeting", "type: Document"), "2026-11-02"),
    null,
  );
  assert.equal(owedFrom("Calendar/2026-11-02 X.md", note + "\n## Summary\nS\n", "2026-11-02"), null);
  assert.equal(
    owedFrom("Calendar/2026-11-02 X.md", note.replace("- [09:31] a", ""), "2026-11-02"),
    null,
    "nothing to wrap up",
  );
  assert.equal(
    owedFrom(
      "Calendar/2026-11-02 Plain.md",
      note.replace('event: "abc@100"\n', "").replace("# Northwind sync\n", ""),
      "2026-11-02",
    )!.id,
    "note:Calendar/2026-11-02 Plain.md",
  );
});
