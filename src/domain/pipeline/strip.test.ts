import { test } from "node:test";
import assert from "node:assert/strict";
import type { Worker } from "../orchestrator/types.ts";
import { barOf, ciOf, newComments, prName, stripOf, type StripIn } from "./strip.ts";
import type { PrStatus } from "./types.ts";

const worker = (n: string, extra: Partial<Worker>): Worker => ({
  key: `c:orch-w-${n}`,
  project: "Acme",
  title: `Ticket ${n}`,
  task: "",
  repo: "/r",
  worktree: null,
  branch: `relay/${n}`,
  state: "running",
  at: 1000,
  ended: null,
  report: null,
  ticket: {
    pipeline: "Acme",
    provider: "productive",
    project: "p",
    board: "b",
    card: `card${n}`,
    number: n,
    title: `Ticket ${n}`,
    url: `https://tracker.example/${n}`,
  },
  ...extra,
});
const report = (questions: string | null, status: "blocked" | "failed" | "done" = "blocked") => ({
  status,
  summary: "",
  questions,
  diff: null,
  flags: [],
});
const asks = worker("12", { state: "blocked", ended: 500, board: "blocked:500", report: report("Stack or replace?") });
const plan = worker("13", {
  state: "blocked",
  ended: 400,
  board: "blocked:400",
  report: report("Plan for approval:\n1. one"),
});
const failed = worker("14", { state: "failed", ended: 300, board: "failed:300", report: report(null, "failed") });
const moved = worker("15", { state: "done", ended: 200, board: "done:200", pr: "https://github.com/acme/web/pull/3" });
const inReview = worker("16", {
  state: "done",
  ended: 100,
  board: "done:100",
  pr: "https://github.com/acme/web/pull/4",
});
const building = worker("17", { step: { done: 3, total: 7, note: "migration" } });
const stuck = worker("18", { stalled: "no output for 23 min" });
const answered = worker("19", { state: "blocked", ended: 50, board: "blocked:50", report: report("Which one?") });

const place = (col: "busy" | "review" | "input", isMoved = false) => ({ col, moved: isMoved, name: "" });
const panel = (extra: Partial<StripIn> = {}): StripIn => ({
  tickets: [asks, plan, failed, moved, inReview, building, stuck, answered],
  places: {
    [asks.key]: place("input"),
    [plan.key]: place("input"),
    [failed.key]: place("input"),
    [moved.key]: place("review", true),
    [inReview.key]: place("review"),
    [building.key]: place("busy"),
    [stuck.key]: place("busy"),
    [answered.key]: place("input"),
  },
  since: { [asks.key]: 900, [plan.key]: 800, [failed.key]: 700 },
  toPick: [answered.key],
  bounced: [],
  holding: "",
  paused: false,
  waiting: { tickets: [{ id: "x1", number: "30", title: "Sort orders", url: "u" }] },
  ...extra,
});

test("strip: tickets fall into lanes, the oldest thing waiting on the user first", () => {
  const s = stripOf(panel());
  // by since: 700, 800, 900, then the moved one without an entry, from its start (1000)
  assert.deepEqual(
    s.need.map(n => [n.ref, n.kind]),
    [
      ["14", "failed"],
      ["13", "plan"],
      ["12", "ask"],
      ["15", "moved"],
    ],
  );
  assert.deepEqual(
    s.building.map(w => ticketRef(w)),
    ["17", "18"],
  );
  assert.deepEqual(
    s.review.map(w => ticketRef(w)),
    ["16"],
  );
  // the pick column and an answered ticket waiting there for its agent
  assert.deepEqual(
    s.next.map(n => n.ref),
    ["19", "30"],
  );
  assert.equal(s.need[3].options.length, 0);
});

const ticketRef = (w: Worker) => (w.ticket as { number: string }).number;

test("strip: a ticket sent back before it started asks, one that could not start failed", () => {
  const bounced = [
    {
      id: "b1",
      number: "20",
      title: "Rate limits",
      url: "u",
      why: "unclear" as const,
      questions: ["Which?"],
      reason: "",
      at: 10,
    },
    {
      id: "b2",
      number: "21",
      title: "Docs",
      url: "u",
      why: "failed" as const,
      questions: [],
      reason: "no checkout",
      at: 20,
    },
  ];
  const s = stripOf(panel({ tickets: [], bounced, waiting: null }));
  assert.deepEqual(
    s.need.map(n => [n.ref, n.kind, n.card?.id, n.question]),
    [
      ["20", "ask", "b1", "Which?"],
      ["21", "failed", "b2", ""],
    ],
  );
});

test("bar: counts per lane and a mark per running agent", () => {
  const bar = barOf(stripOf(panel()), 3);
  assert.deepEqual(bar.counts, { need: 4, building: 2, review: 1, next: 2 });
  assert.deepEqual(
    bar.agents.map(a => [a.ref, a.kind, a.done, a.total, a.stuck]),
    [
      ["17", "step", 3, 7, false],
      ["18", "plain", 0, 0, true],
    ],
  );
  // the validation round it is on, never past the last
  const checking = worker("21", { phase: "review", rounds: 1 });
  const last = worker("22", { phase: "checks", rounds: 5 });
  assert.deepEqual(
    barOf(stripOf(panel({ tickets: [checking, last], places: {}, toPick: [], waiting: null })), 3).agents.map(a => [
      a.kind,
      a.done,
      a.total,
    ]),
    [
      ["review", 2, 3],
      ["checks", 3, 3],
    ],
  );
});

test("ci: failed beats running beats passed, no checks is none", () => {
  assert.equal(ciOf(undefined), "none");
  assert.equal(ciOf([]), "none");
  assert.equal(ciOf([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "passed");
  assert.equal(
    ciOf([
      { status: "COMPLETED", conclusion: "SKIPPED" },
      { status: "COMPLETED", conclusion: "NEUTRAL" },
    ]),
    "passed",
  );
  assert.equal(
    ciOf([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "IN_PROGRESS", conclusion: "" },
    ]),
    "running",
  );
  assert.equal(ciOf([{ state: "PENDING" }]), "running");
  assert.equal(ciOf([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }]), "failed");
  assert.equal(ciOf([{ state: "ERROR" }]), "failed");
});

test("comments: what people wrote since the run ended, bots and approvals left out", () => {
  const pr: PrStatus = {
    url: "u",
    state: "OPEN",
    reviewDecision: null,
    reviews: [
      {
        author: { login: "sam" },
        body: "Please rename",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-11-01T10:00:00Z",
      },
      { author: { login: "sam" }, body: "", state: "APPROVED", submittedAt: "2026-11-01T11:00:00Z" },
      { author: { login: "ci[bot]" }, body: "Report", state: "COMMENTED", submittedAt: "2026-11-01T10:00:00Z" },
    ],
    comments: [
      { author: { login: "alex" }, body: "Nit", createdAt: "2026-11-01T10:30:00Z" },
      { author: { login: "alex" }, body: "Old", createdAt: "2026-10-01T10:30:00Z" },
    ],
    inline: [{ user: { login: "alex" }, body: "Here", path: "a.ts", line: 3, created_at: "2026-11-01T12:00:00Z" }],
  };
  const since = Date.parse("2026-10-31T00:00:00Z");
  assert.equal(newComments([pr], since), 3);
  assert.equal(newComments([pr, pr], since), 6);
  assert.equal(newComments([pr], Date.parse("2026-12-01T00:00:00Z")), 0);
});

test("pr name: the repo and number of a PR url", () => {
  assert.deepEqual(prName("https://github.com/acme/northwind-api/pull/31"), { repo: "northwind-api", n: "#31" });
  assert.deepEqual(prName("https://example.com/x"), { repo: "https://example.com/x", n: "" });
});
