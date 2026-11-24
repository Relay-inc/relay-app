import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "../../shared/locales/en.ts";
import nl from "../../shared/locales/nl.ts";
import de from "../../shared/locales/de.ts";
import fr from "../../shared/locales/fr.ts";
import type { Card, CardView } from "../board/types.ts";
import type { Worker } from "../orchestrator/types.ts";
import {
  askedIn,
  bare,
  briefOf,
  byRelay,
  RELAY_COMMENTS,
  RELAY_OPENINGS,
  checksOf,
  picturesOf,
  withPictures,
  buildState,
  EMPTY_PIPELINE,
  htmlText,
  inReview,
  picks,
  pipelineAt,
  preflightOf,
  prsOf,
  ready,
  reposFor,
  retask,
  review,
  reviewAll,
  stalled,
  step,
  usedUp,
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
  assert.equal(ready({ ...P, repo: "" }), true, "the repos are the project's own, found when it runs");
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
  url: "https://github.com/acme/web/pull/1",
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
  const old = { author: { login: "alex" }, body: "old", state: "COMMENTED", submittedAt: at(50) };
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
      inline: [{ user: { login: "alex" }, body: "typo", path: "a.ts", line: 3, created_at: at(201) }],
    }),
    100,
  );
  assert.equal(r?.kind, "feedback");
  assert.ok(
    r?.kind === "feedback" && r.text.includes("rename it") && r.text.includes("On a.ts:3, by alex:\ntypo"),
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

test("picturesOf: the ticket's and its comments' pictures; withPictures: their paths in the brief", () => {
  const f = (name: string, url = "https://t/" + name) => ({ id: name, name, size: 1, url });
  const v = {
    files: [f("spec.pdf"), f("shot.PNG")],
    feed: [{ at: at(1), who: "Ann", html: "", change: "", files: [f("b.jpeg"), f("c.webp", "")] }],
  } as unknown as CardView;
  assert.deepEqual(picturesOf(v), [
    ["shot.PNG", "https://t/shot.PNG"],
    ["b.jpeg", "https://t/b.jpeg"],
  ]);
  assert.equal(withPictures("brief", []), "brief");
  assert.match(withPictures("brief", ["/tmp/a.png"]), /^brief\n\n.*Read.*\n- \/tmp\/a\.png$/);
});

test("retask: the ticket as it reads now only when it or what people wrote on it changed since the start", () => {
  const c = (ms: number, who: string, html: string) => ({ at: at(ms), who, html, change: "", files: [] });
  const relay = c(150, "Ann", "<p>PR opened: https://g/pr/1</p><p>all done</p>");
  const answer = c(170, "Ann", "<p>Pears, not apples</p>");
  const asked = c(
    160,
    "Ann",
    "<p>The agent needs input:</p><p>Apples or pears?</p><p>Answer here and move the ticket back to Todo to continue.</p>",
  );
  const v = (description: string, ...later: ReturnType<typeof c>[]) =>
    ({
      title: "Orchard",
      number: "7",
      url: "https://t/7",
      description,
      feed: [c(50, "Ann", "<p>north side first</p>"), ...later],
      files: [],
    }) as unknown as CardView;
  const task = withPictures(briefOf(v("<p>Plant the apple trees</p>")), ["/tmp/a.png"]);
  assert.equal(retask(task, v("<p>Plant the apple trees</p>"), 100), null, "unchanged: the task stays");
  assert.equal(retask(task, v("<p>Plant the apple trees</p>", relay), 100), null, "Relay's own comment is no change");
  const b = retask(task, v("<p>Plant the apple trees</p>", relay, answer), 100);
  assert.ok(
    b?.includes("Questions and answers on the ticket since the agent started") && b.includes("Pears, not apples"),
    b ?? "",
  );
  assert.ok(!b.includes("all done") && b.endsWith("- /tmp/a.png"), "Relay's comment stays out, the pictures stay in");
  assert.equal(
    retask(b, v("<p>Plant the apple trees</p>", relay, answer), 100),
    null,
    "an answer folded in counts once",
  );
  const d = retask(b, v("<p>Plant the pear trees</p>", relay, answer), 100);
  assert.ok(d?.includes("Plant the pear trees") && d.includes("north side first") && d.includes("Pears, not apples"));
  // what the agent asked comes with the answer, in time order, without Relay's fixed text around it
  assert.equal(
    retask(task, v("<p>Plant the apple trees</p>", relay, asked), 100),
    null,
    "a question alone is no change",
  );
  const q = retask(task, v("<p>Plant the apple trees</p>", relay, asked, answer), 100);
  const i = q?.indexOf(`- The agent asked (${at(160)}): Apples or pears?`) ?? -1;
  assert.ok(i > 0 && q!.indexOf("Pears, not apples") > i, q ?? "");
  assert.ok(!q!.includes("Answer here") && !q!.includes("needs input") && !q!.includes("all done"), q!);
  assert.equal(retask(q!, v("<p>Plant the apple trees</p>", relay, asked, answer), 100), null, "a second pass");
  const later = c(180, "Ann", "<p>The agent needs input:</p><p>Which row?</p>");
  assert.equal(
    retask(q!, v("<p>Plant the apple trees</p>", relay, asked, answer, later), 100),
    null,
    "a new question alone",
  );
});

test("byRelay: every comment Relay puts on a ticket, in every language; a person's comment is kept", () => {
  for (const l of [en, nl, de, fr])
    for (const k of RELAY_COMMENTS) {
      const text = l[k].replace(/\{\w+\}/g, "x");
      assert.ok(byRelay(text), `${k}: ${text}`);
    }
  assert.ok(
    RELAY_OPENINGS.every(o => o.length >= 4),
    "an opening that is all placeholder would take every comment",
  );
  assert.ok(!byRelay("Pears, not apples") && !byRelay("PR looks fine to me"));
  // the questions out of each language's Blocked comments, a person's comment is none
  for (const l of [en, nl, de, fr])
    for (const k of ["pl.blocked", "pl.blockedManual"] as const) {
      const text = l[k].replace("{questions}", "- Apples or pears?\n- Which row?").replace(/\{\w+\}/g, "Todo");
      assert.equal(askedIn(text), "- Apples or pears?\n- Which row?", `${k}: ${text}`);
    }
  assert.equal(askedIn("Pears, not apples"), null);
  assert.equal(askedIn(en["pl.picked"]), null);
  // a new comment in the runner must be added to RELAY_COMMENTS (the others are toasts and errors)
  const runner = readFileSync(new URL("../../application/pipeline/runner.ts", import.meta.url), "utf8");
  const toasts = ["pl.error", "pl.full", "pl.noBoard", "pl.noColumn", "pl.noRepos", "pl.usedUp", "pl.stalled"];
  for (const k of new Set(runner.match(/"pl\.\w+"/g)!.map(m => m.slice(1, -1))))
    assert.ok([...RELAY_COMMENTS, ...toasts].includes(k), k);
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

test("preflight: clear, unclear with its questions, or no verdict", () => {
  assert.deepEqual(preflightOf('```json\n{"clear": true}\n```'), { clear: true });
  assert.deepEqual(preflightOf('{"clear": false, "questions": [" Which page? ", "", 3, "b", "c", "d"]}'), {
    clear: false,
    questions: ["Which page?", "b", "c"],
  });
  assert.equal(preflightOf('{"clear": false, "questions": []}'), null, "unclear without a question holds nothing");
  assert.equal(preflightOf("looks fine"), null);
  assert.equal(preflightOf('{"clear": "yes"}'), null);
});

test("stalled: the last three ended runs all without a PR", () => {
  const at = (w: Worker, ended: number) => ({ ...w, ended });
  const miss = [at(worker("a", "failed"), 1), at(worker("b", "blocked"), 2), at(worker("c", "done"), 3)];
  assert.equal(stalled(miss), true, "a done without a PR is a miss too");
  assert.equal(stalled(miss.slice(1)), false, "fewer than three runs");
  assert.equal(stalled([...miss, at(worker("d", "done", { pr: "https://x/1" }), 4)]), false, "a PR goes on");
  assert.equal(
    stalled([at(worker("d", "done", { pr: "https://x/1" }), 0), ...miss]),
    true,
    "only the last three count",
  );
  const plan = at(
    worker("e", "blocked", {
      report: { status: "blocked", summary: "", questions: "Plan for approval: x" } as Worker["report"],
    }),
    5,
  );
  assert.equal(stalled([...miss, plan]), false, "a plan sent for approval is no miss");
  assert.equal(stalled([...miss, at(worker("f", "stopped"), 6)]), true, "a run you stopped does not count either way");
  assert.equal(stalled([...miss, worker("g", "running")]), true);
});

test("usedUp: a general window at 100%, on every account", () => {
  const w = (pct: number, name: string | null = null) => ({ id: "x", label: "x", name, pct, resets: null });
  const lim = (...windows: ReturnType<typeof w>[]) => ({ ok: true as const, windows });
  assert.equal(usedUp([{ provider: "claude", limits: lim(w(100)) }], "claude"), true);
  assert.equal(
    usedUp([{ provider: "claude", limits: lim(w(100, "opus"), w(40)) }], "claude"),
    false,
    "one model's window",
  );
  assert.equal(usedUp([{ provider: "claude", limits: { ok: false, reason: "no-login" } }], "claude"), false, "unread");
  assert.equal(usedUp([{ provider: "codex", limits: lim(w(100)) }], "claude"), false);
  const accounts = [
    { dir: "", limits: lim(w(100)) },
    { dir: "/b", limits: lim(w(20)) },
  ];
  assert.equal(
    usedUp([{ provider: "claude", limits: lim(w(100)), accounts }], "claude"),
    false,
    "another account has room",
  );
  accounts[1].limits = lim(w(100));
  assert.equal(usedUp([{ provider: "claude", limits: lim(w(100)), accounts }], "claude"), true);
});

const tree = (repo: string, pr: string | null, pr_error: string | null = null) => ({
  repo,
  worktree: `${repo}-relay-1`,
  start: "abc",
  base: "main",
  checks: "",
  pr,
  pr_error,
});

test("a ticket over several repos: a PR each, review once all are in, merged once all are", () => {
  const two = { trees: [tree("/c/api", "https://x/api/pull/1"), tree("/c/web", "https://x/web/pull/2")] };
  assert.deepEqual(prsOf({ pr: "https://x/api/pull/1", ...two }), ["https://x/api/pull/1", "https://x/web/pull/2"]);
  assert.deepEqual(prsOf({ pr: "p", trees: [] }), ["p"], "a worker from before trees");
  assert.deepEqual(prsOf({ pr: null, trees: [tree("/c/api", null)] }), []);
  assert.equal(step(worker("a", "done", two))?.kind, "pr");
  // one repo it changed got no PR: in front of a person, and its PRs are not followed as if all were in review
  const half = { trees: [tree("/c/api", "https://x/api/pull/1"), tree("/c/web", null, "git push of b failed")] };
  const partial = worker("a", "done", { ...half, pr: "https://x/api/pull/1", pr_error: "web: git push of b failed" });
  assert.deepEqual(step(partial), { mark: "done:100", to: "input", kind: "partial" });
  assert.equal(inReview({ ...partial, board: "done:100" }), false);
  assert.equal(inReview(worker("a", "done", { ...two, board: "done:100" })), true);
  assert.equal(
    stalled([1, 2, 3].map(i => ({ ...worker(`x${i}`, "done", two), ended: i }))),
    false,
    "PRs in trees count",
  );

  const api = pr({ url: "https://x/api/pull/1" });
  const web = pr({ url: "https://x/web/pull/2" });
  assert.equal(reviewAll([{ ...api, state: "MERGED" }, web], 0), null, "one merged waits for the other");
  assert.deepEqual(
    reviewAll(
      [
        { ...api, state: "MERGED" },
        { ...web, state: "MERGED" },
      ],
      0,
    ),
    { kind: "merged" },
  );
  assert.deepEqual(
    reviewAll(
      [
        { ...api, state: "MERGED" },
        { ...web, state: "CLOSED" },
      ],
      0,
    ),
    { kind: "closed" },
  );
  const said = reviewAll(
    [api, pr({ ...web, comments: [{ author: { login: "alex" }, body: "typo", createdAt: at(200) }] })],
    100,
  );
  assert.ok(said?.kind === "feedback" && said.text.startsWith("On https://x/web/pull/2:\n"), JSON.stringify(said));
  assert.equal(reviewAll([], 0), null);
});

test("reposFor: the project's checkouts but the ones switched off, each with its checks", () => {
  const found = [
    { slug: "acme/api", path: "/c/api" },
    { slug: "acme/infra", path: "/c/infra" },
    { slug: "acme/web", path: "/c/web" },
  ];
  const p = {
    ...P,
    repo: "/c/api",
    checks: "make test",
    repos: { "acme/infra": { off: true }, "acme/web": { checks: " pnpm test " } },
  };
  assert.deepEqual(reposFor(found, p), [
    { path: "/c/api", checks: "make test" },
    { path: "/c/web", checks: "pnpm test" },
  ]);
  assert.equal(
    checksOf({ ...p, repos: { "acme/api": { checks: "" } } }, found[0]),
    "",
    "its own checks, also empty, win over the old command",
  );
  assert.equal(checksOf({ ...P, checks: "make test" }, found[2]), "", "the old command was for its one checkout only");
});
