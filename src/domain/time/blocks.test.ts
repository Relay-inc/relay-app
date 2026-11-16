import { test } from "node:test";
import assert from "node:assert/strict";
import { timeLines, timePrompt } from "./blocks.ts";

const M = 60_000;
const t0 = Date.UTC(2026, 9, 5, 8, 0);
const ev = (project: string, min: number, title = project) => ({ project, title, at: t0 + min * M });

test("one message is 20 minutes, rounded to 15", () => {
  assert.deepEqual(timeLines([ev("a", 0)]), [{ project: "a", minutes: 15, titles: ["a"] }]);
});

test("messages within 15 minutes are one block, a longer pause is two", () => {
  // 0 and 14: one block of 34 min -> 30; 0 and 40: two blocks of 20 min = 40 -> 45
  assert.equal(timeLines([ev("a", 0), ev("a", 14)])[0].minutes, 30);
  assert.equal(timeLines([ev("a", 0), ev("a", 40)])[0].minutes, 45);
});

test("messages 18 minutes apart overlap and are not counted twice", () => {
  assert.equal(timeLines([ev("a", 0), ev("a", 18)])[0].minutes, 45); // 38 min
});

test("time in two projects at once is split evenly", () => {
  // a: -10..10, b: 0..20 -> a alone 10 + half of 10 = 15, b the same
  const lines = timeLines([ev("a", 0), ev("b", 10)]);
  assert.deepEqual(
    lines.map(l => [l.project, l.minutes]),
    [
      ["a", 15],
      ["b", 15],
    ],
  );
});

test("a project under 15 minutes is dropped, titles are unique and in order", () => {
  // b overlaps a for 20 min (half each) and has 1 min of its own: 11 min -> dropped
  const lines = timeLines([ev("a", 0, "x"), ev("a", 30, "y"), ev("a", 40, "x"), ev("b", 1, "z")]);
  assert.equal(
    lines.find(l => l.project === "b"),
    undefined,
  );
  assert.deepEqual(lines[0].titles, ["x", "y"]);
});

test("the prompt names every project once with its board", () => {
  const p = timePrompt("2026-10-05", [{ label: "Northwind", minutes: 90, titles: ["API"], board: "12" }]);
  assert.match(p, /Northwind: 90 min \(Productive-project 12\)/);
  assert.match(p, /productive\.add_time/);
});

test("the prompt names every source and leaves out the sessions already counted", () => {
  const p = timePrompt("2026-10-08", [{ label: "Northwind", minutes: 30, titles: ["DMS"] }], ["abc"]);
  for (const s of [
    "calendar.meetings date=2026-10-08",
    "Slack",
    "git log",
    "~/.claude/projects",
    "Drive",
    "Jira",
    "Notion",
    "Figma",
    "abc",
  ])
    assert.ok(p.includes(s), s);
  assert.ok(timePrompt("2026-10-08", []).includes("geen activiteit"));
});

const sheet = {
  services: [
    { id: "101", label: "Northwind support", billable: true, keywords: ["northwind", "api"] },
    { id: "102", label: "Internal", billable: false, keywords: [] },
  ],
  placeholderServiceId: "101",
  targetHoursPerDay: 7.5,
  granularityMinutes: 30,
  noteLanguage: "nl",
  gitRepoParents: ["~/code"],
};

test("the timesheet's granularity replaces the 15 minutes", () => {
  // one message is 20 minutes: under a step of 30 it is dropped, 40 minutes rounds to 30
  assert.deepEqual(timeLines([ev("a", 0)], 30), []);
  assert.equal(timeLines([ev("a", 0), ev("a", 40)], 30)[0].minutes, 30);
});

test("the prompt follows the timesheet config: services, placeholder, step, hours, note style, git", () => {
  const p = timePrompt("2026-10-05", [{ label: "Northwind", minutes: 90, titles: ["API"] }], [], sheet);
  for (const s of [
    "101 | Northwind support | billable | northwind, api",
    "102 | Internal | niet billable",
    "placeholder-entry op service 101 (Northwind support)",
    "op 30 minuten",
    "werkdag van 7.5 uur",
    'code "nl"',
    "geen streepjes",
    "billable=false",
    "~/code",
  ])
    assert.ok(p.includes(s), s);
});

test("without the config the prompt is as it was: 15 minutes, 8 hours, no timesheet rules", () => {
  const p = timePrompt("2026-10-05", [{ label: "Northwind", minutes: 90, titles: ["API"] }]);
  assert.match(p, /afgerond op 15 minuten/);
  assert.match(p, /werkdag van 8 uur/);
  assert.ok(!p.includes("timesheet"));
});
