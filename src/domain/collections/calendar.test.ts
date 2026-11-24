// Brussels: at 00:30 local the UTC date is still yesterday (node --test runs each file in its own process)
process.env.TZ = "Europe/Brussels";
import test from "node:test";
import assert from "node:assert/strict";
import { byDay, dayOf, leadingDays, monthWeeks, shift, weekOf } from "./calendar.ts";
import { localToday, stageOf, type Row } from "./rules.ts";

const row = (date: string, extra: Partial<Row> = {}): Row => ({
  p: `Calendar/Meetings/${date || "undated"}.md`,
  t: date,
  k: "Meeting",
  at: 0,
  date: "",
  stage: "",
  props: date ? { date: [date] } : {},
  ...extra,
});

test("localToday is the local date, not UTC's, just after midnight", () => {
  const night = new Date(2026, 9, 2, 0, 30); // 2 October 00:30 in Brussels, 1 October 22:30 UTC
  assert.equal(night.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(localToday(night), "2026-10-02");
  // a planned meeting of 1 October is over at 00:30 on the 2nd
  const meeting = row("2026-10-01", { date: "2026-10-01", stage: "planned" });
  assert.equal(stageOf(meeting, localToday(night)), "unwrapped");
});

test("a month that starts on a Sunday takes six weeks, Monday first", () => {
  // November 2026 starts on a Sunday
  assert.equal(leadingDays(2026, 10), 6);
  const weeks = monthWeeks(2026, 10);
  assert.equal(weeks.length, 6);
  assert.deepEqual(weeks[0], [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ]);
  assert.deepEqual(weeks[5], [
    "2026-11-30",
    "2026-12-01",
    "2026-12-02",
    "2026-12-03",
    "2026-12-04",
    "2026-12-05",
    "2026-12-06",
  ]);
  assert.ok(weeks.every(w => w.length === 7));
});

test("a month that starts on a Monday has no days before it, and February fits leap years", () => {
  // June 2026 starts on a Monday
  assert.equal(leadingDays(2026, 5), 0);
  assert.equal(monthWeeks(2026, 5)[0][0], "2026-06-01");
  // February 2021: 1st a Monday, 28 days, four weeks exactly
  assert.equal(monthWeeks(2021, 1).length, 4);
  // February 2028 is a leap month: the 29th is in it, on a Tuesday
  const leap = monthWeeks(2028, 1).flat();
  assert.ok(leap.includes("2028-02-29"));
  assert.equal(leap[leap.indexOf("2028-02-29") + 1], "2028-03-01");
  assert.equal(monthWeeks(2028, 1).at(-1)![1], "2028-02-29");
});

test("weekOf is Monday to Sunday, across a month and a daylight saving change", () => {
  assert.deepEqual(weekOf("2026-10-01"), [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
  assert.equal(weekOf("2026-10-04")[0], "2026-09-28");
  assert.equal(weekOf("2026-10-25").at(-1), "2026-10-25"); // the clocks go back that Sunday
  assert.equal(shift("2026-10-25", "week", 1), "2026-11-01");
  assert.equal(shift("2026-10-01", "week", -1), "2026-09-24");
  assert.equal(shift("2026-01-31", "month", 1), "2026-02-01");
  assert.equal(shift("2026-01-15", "month", -1), "2025-12-01");
});

test("a row without a real ISO date goes to undated", () => {
  assert.equal(dayOf(row("2026-10-08")), "2026-10-08");
  assert.equal(dayOf(row("2026-10-08T10:00")), "2026-10-08");
  assert.equal(dayOf(row("")), "");
  assert.equal(dayOf(row("next week")), "");
  assert.equal(dayOf(row("2026-02-30")), "");
  assert.equal(dayOf(row("8/10/2026")), "");
  // the date the file name starts with counts when there is no date:
  assert.equal(dayOf(row("", { date: "2026-09-30" })), "2026-09-30");
  const { days, undated } = byDay([row("2026-10-08"), row("soon"), row("2026-10-08T09:00"), row("")]);
  assert.deepEqual([...days.keys()], ["2026-10-08"]);
  assert.equal(days.get("2026-10-08")!.length, 2);
  assert.equal(undated.length, 2);
});
