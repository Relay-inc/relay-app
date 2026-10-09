import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card, CardView } from "../board/types.ts";
import type { Worker } from "../orchestrator/types.ts";
import {
  bare,
  briefOf,
  buildState,
  EMPTY_PIPELINE,
  htmlText,
  inReview,
  picks,
  pipelineAt,
  ready,
  review,
  step,
} from "./rules.ts";
import type { PrStatus } from "./types.ts";

const P = {
  ...EMPTY_PIPELINE,
  on: true,
  repo: "/r",
  pick: "todo",
  busy: "doing",
  review: "rev",
  input: "help",
  label: "",
};
const card = (id: string, column: string, placement: number, labels: string[] = []): Card => ({
  id,
  title: id,
  number: id,
  column,
  placement,
  due: null,
  who: "",
  labels,
});
const worker = (card: string, state: Worker["state"], extra: Partial<Worker> = {}): Worker => ({
  key: `w-${card}-${state}`,
  project: "Acme",
  title: card,
  task: "",
  repo: "/r",
  worktree: null,
  branch: "b",
  state,
  at: 1,
  ended: state === "running" ? null : 100,
  report: null,
  ticket: { pipeline: "Acme", card },
  ...extra,
});

test("ready needs the switch and the four columns", () => {
  assert.equal(ready(P), true);
  assert.equal(ready({ ...P, on: false }), false);
  assert.equal(ready({ ...P, input: "" }), false);
  assert.equal(ready(undefined), false);
});

test("picks: the pick column in board order, the label, running ones left alone, ended ones resumed", () => {
  const cards = [
    card("b", "todo", 2),
    card("a", "todo", 1),
    card("c", "doing", 0),
    card("d", "todo", 3),
    card("e", "todo", 4),
  ];
  const ws = [worker("d", "running"), worker("e", "blocked")];
  const { fresh, resume } = picks(cards, c => c.column, P, ws);
  assert.deepEqual(
    fresh.map(c => c.id),
    ["a", "b"],
  );
  assert.deepEqual(
    resume.map(r => r.card.id),
    ["e"],
  );
  const labelled = picks(
    [card("a", "todo", 1, ["Agent"]), card("b", "todo", 2)],
    c => c.column,
    { ...P, label: "agent" },
    [],
  );
  assert.deepEqual(
    labelled.fresh.map(c => c.id),
    ["a"],
    "the label matches without case",
  );
  assert.deepEqual(
    picks([card("a", "todo", 1)], c => c.column, P, [worker("a", "done", { board: "merged" })]).fresh.map(c => c.id),
    ["a"],
    "a merged ticket put back is new work",
  );
});

test("step: each end once, done with a PR to review, the rest to a person", () => {
  assert.equal(step(worker("a", "running")), null);
  assert.deepEqual(step(worker("a", "done", { pr: "https://x/pull/1" })), {
    mark: "done:100",
    to: "review",
    kind: "pr",
  });
  assert.deepEqual(step(worker("a", "done")), { mark: "done:100", to: "input", kind: "nopr" });
  assert.deepEqual(step(worker("a", "blocked")), { mark: "blocked:100", to: "input", kind: "blocked" });
  assert.equal(step(worker("a", "silent"))?.kind, "failed");
  assert.equal(step(worker("a", "done", { pr: "p", board: "done:100" })), null, "already on the board");
  assert.notEqual(
    step(worker("a", "done", { pr: "p", board: "done:50", ended: 100 })),
    null,
    "a later end counts again",
  );
  assert.equal(step({ ...worker("a", "done"), ticket: undefined }), null, "not a pipeline worker");
  assert.equal(inReview(worker("a", "done", { pr: "p", board: "done:100" })), true);
  assert.equal(inReview(worker("a", "running", { pr: "p", board: "done:100" })), false);
});

const pr = (x: Partial<PrStatus>): PrStatus => ({
  state: "OPEN",
  reviewDecision: null,
  reviews: [],
  comments: [],
  inline: [],
  ...x,
});
const at = (ms: number) => new Date(ms).toISOString();

test("review: merged, closed, people's words after the run, bots and approvals left out", () => {
  assert.deepEqual(review(pr({ state: "MERGED" }), 0), { kind: "merged" });
  assert.deepEqual(review(pr({ state: "CLOSED" }), 0), { kind: "closed" });
  assert.equal(review(pr({}), 0), null);
  const old = { author: { login: "kristof" }, body: "old", state: "COMMENTED", submittedAt: at(50) };
  assert.equal(review(pr({ reviews: [old] }), 100), null, "before the run ended");
  assert.equal(review(pr({ reviews: [{ ...old, submittedAt: at(200), state: "APPROVED", body: "lgtm" }] }), 100), null);
  assert.equal(
    review(
      pr({ comments: [{ author: { login: "copilot-pull-request-reviewer" }, body: "x", createdAt: at(200) }] }),
      100,
    ),
    null,
  );
  assert.equal(review(pr({ comments: [{ author: { login: "ci[bot]" }, body: "x", createdAt: at(200) }] }), 100), null);
  const r = review(
    pr({
      reviews: [{ ...old, submittedAt: at(200), state: "CHANGES_REQUESTED", body: "rename it" }],
      inline: [{ user: { login: "kristof" }, body: "typo", path: "a.ts", line: 3, created_at: at(201) }],
    }),
    100,
  );
  assert.equal(r?.kind, "feedback");
  assert.ok(
    r?.kind === "feedback" && r.text.includes("rename it") && r.text.includes("On a.ts:3, by kristof:\ntypo"),
    JSON.stringify(r),
  );
});

test("briefOf: the whole ticket at the start, only what is new for a resume", () => {
  const v = {
    title: "Fix login",
    number: "12",
    url: "https://t/12",
    description: "<p>When <b>x</b> &amp; y</p><ul><li>one</li></ul>",
    feed: [
      { at: at(50), who: "Ann", html: "<p>first</p>", change: "", files: [] },
      { at: at(150), who: "Bob", html: "<p>answer</p>", change: "", files: [] },
      { at: at(160), who: "Bob", html: "", change: "moved", files: [] },
    ],
    files: [{ id: "1", name: "spec.pdf", size: 1, url: "https://t/f" }],
  } as unknown as CardView;
  const full = briefOf(v);
  assert.ok(
    full.includes('Ticket #12 "Fix login"') &&
      full.includes("When x & y") &&
      full.includes("- one") &&
      full.includes("Ann") &&
      full.includes("spec.pdf: https://t/f"),
    full,
  );
  assert.ok(!full.includes("moved"), "activity without text is left out");
  const news = briefOf(v, 100);
  assert.ok(news.includes("answer") && !news.includes("first") && !news.includes("Description"), news);
  assert.equal(htmlText("a<br>b&nbsp;c"), "a\nb c");
});

test("hand-picked: no pick column needed; the board's pipeline; what the ticket window offers", () => {
  assert.equal(ready({ ...P, pick: "" }), false);
  assert.equal(ready({ ...P, pick: "", mode: "manual" }), true);
  const ref = { provider: "productive", project: "p1", board: "f1" };
  const boards = { Acme: ref, Other: { ...ref, board: "f2" } };
  assert.equal(pipelineAt(boards, { Acme: P }, ref), "Acme");
  assert.equal(pipelineAt(boards, { Acme: { ...P, on: false } }, ref), undefined, "switched off");
  assert.equal(pipelineAt(boards, { Other: P }, ref), undefined, "another board's pipeline");
  assert.equal(buildState([], "a"), "build");
  assert.equal(buildState([worker("a", "running")], "a"), "running");
  assert.equal(buildState([worker("a", "blocked")], "a"), "continue");
  assert.equal(buildState([worker("a", "done", { board: "merged" })], "a"), "build", "merged: a new run");
});

test("bare: a ticket with nothing but a title", () => {
  const v = (description: string, feed: CardView["feed"] = [], files: CardView["files"] = []) =>
    ({ description, feed, files }) as unknown as CardView;
  const note = (html: string, files: CardView["feed"][number]["files"] = []) => ({
    at: "",
    who: "",
    html,
    change: "",
    files,
  });
  assert.equal(bare(v("")), true);
  assert.equal(bare(v("<p>&nbsp;</p>", [note("")])), true);
  assert.equal(bare(v("<p>Fix it</p>")), false);
  assert.equal(bare(v("", [note("<p>see the screenshot</p>")])), false);
  assert.equal(bare(v("", [], [{ id: "1", name: "a.png", size: 1, url: "u" }])), false);
  assert.equal(bare(v("", [note("", [{ id: "1", name: "a.png", size: 1, url: "u" }])])), false);
});
