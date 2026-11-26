import type { Worker } from "../orchestrator/types";
import { digestRows, type DigestIn } from "./digest.ts";
import { fresh, inReview, ticketOf } from "./rules.ts";
import type { PrCheck, PrStatus } from "./types.ts";

// The stage strip above a pipeline's conversation (ui/features/pipeline/PipeStrip.tsx): the panel's tickets sorted into
// lanes, what the collapsed bar says about them, and what a PR's checks and new comments come to. It reads the same
// rows the digest does (digest.ts digestRows), so what waits on the user is the same list in both.

/** A ticket sent back before it started, as far as the strip needs it. */
type BouncedIn = DigestIn["bounced"][number] & { id: string; at: number };
/** The pipeline as the panel has it (runner.ts pipelinePanel), with since when each row is in its state and what the
 *  pick column holds. */
export type StripIn<B extends BouncedIn = BouncedIn> = Omit<DigestIn, "bounced"> & {
  bounced: B[];
  since: Record<string, number>;
  waiting: { tickets: { id: string; number: string; title: string; url: string }[] } | null;
};

/** ask: a question (also a pre-flight's). plan: a plan to approve. failed: a run that ended without a PR, or a ticket
 *  that could not start. moved: a person moved it on the board, Relay holds it. */
export type NeedKind = "ask" | "plan" | "failed" | "moved";
export type Need<B extends BouncedIn = BouncedIn> = {
  kind: NeedKind;
  /** the worker's key, else the ticket's card id */
  id: string;
  ref: string;
  title: string;
  url: string;
  /** the column it is in on the board, "" while the board was not read (and for a ticket sent back before it started) */
  column: string;
  /** since when it waits, ms: the oldest comes first */
  at: number;
  question: string;
  options: string[];
  worker: Worker | null;
  /** a ticket sent back before an agent started on it */
  card: B | null;
};
export type NextUp = { id: string; ref: string; title: string; url: string };
export type Strip<B extends BouncedIn = BouncedIn> = {
  need: Need<B>[];
  building: Worker[];
  review: Worker[];
  next: NextUp[];
};

/** The panel's tickets in lanes. Needs you: what waits on the user (the digest's "waits"), a run that went nowhere, a
 *  ticket a person moved on, oldest first. Building: running agents (a stuck one stays here, flagged). In review: PRs
 *  waiting for review. Up next: the pick column, and answered tickets waiting there for their agent. */
export function stripOf<B extends BouncedIn>(d: StripIn<B>): Strip<B> {
  const rows = digestRows(d);
  const need: Need<B>[] = [];
  const building: Worker[] = [];
  const review: Worker[] = [];
  const next: NextUp[] = [];
  d.tickets.forEach((w, i) => {
    const row = rows[i];
    const ticket = ticketOf(w)!;
    const base = {
      id: w.key,
      ref: row.ref,
      title: row.title,
      url: row.url,
      column: d.places[w.key]?.name ?? "",
      at: d.since[w.key] ?? w.at,
      question: row.question,
      options: row.options,
      worker: w,
      card: null,
    };
    if (w.state === "running") return void building.push(w);
    if (d.toPick.includes(w.key))
      return void next.push({ id: ticket.card, ref: row.ref, title: row.title, url: row.url });
    if (d.places[w.key]?.moved) return void need.push({ ...base, kind: "moved" });
    if (row.group === "waits") return void need.push({ ...base, kind: row.plan ? "plan" : "ask" });
    if (row.group === "stuck") return void need.push({ ...base, kind: "failed" });
    if (inReview(w)) review.push(w);
  });
  d.bounced.forEach((b, i) => {
    const row = rows[d.tickets.length + i];
    need.push({
      kind: b.why === "failed" ? "failed" : "ask",
      id: b.id,
      ref: row.ref,
      title: b.title,
      url: row.url,
      column: "",
      at: b.at,
      question: row.question,
      options: [],
      worker: null,
      card: b,
    });
  });
  for (const x of d.waiting?.tickets ?? []) next.push({ id: x.id, ref: x.number, title: x.title, url: x.url });
  need.sort((a, b) => a.at - b.at);
  return { need, building, review, next };
}

/** One running agent in the collapsed bar: its mark and tiny progress bar. `done` of `total` segments are filled: its
 *  steps, or the validation round it is on. */
export type BarAgent = {
  key: string;
  ref: string;
  stuck: boolean;
  kind: "step" | "checks" | "review" | "plain";
  done: number;
  total: number;
};
/** What the collapsed bar says: a count per lane and one mark per running agent. `rounds`: the pipeline's validation
 *  rounds before a person gets the ticket. */
export function barOf(s: Strip, rounds: number) {
  return {
    counts: { need: s.need.length, building: s.building.length, review: s.review.length, next: s.next.length },
    agents: s.building.map(w => agentOf(w, rounds)),
  };
}
export function agentOf(w: Worker, rounds: number): BarAgent {
  const base = { key: w.key, ref: ticketOf(w)?.number ?? "", stuck: !!w.stalled };
  if (w.phase === "review" || w.phase === "checks")
    return { ...base, kind: w.phase, done: Math.min((w.rounds ?? 0) + 1, rounds), total: rounds };
  if (w.step && w.step.total > 0)
    return { ...base, kind: "step", done: Math.min(w.step.done, w.step.total), total: w.step.total };
  return { ...base, kind: "plain", done: 0, total: 0 };
}

export type Ci = "passed" | "running" | "failed" | "none";
const BAD = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR"]);
/** A PR's checks as one word, from gh's statusCheckRollup: failed when any check failed, running while any has not
 *  ended, passed when all ended well, none when there are no checks. */
export function ciOf(checks: PrCheck[] | null | undefined): Ci {
  if (!checks?.length) return "none";
  if (checks.some(c => BAD.has(c.conclusion ?? "") || BAD.has(c.state ?? ""))) return "failed";
  if (checks.some(c => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED"))
    return "running";
  return "passed";
}

/** What reviewers wrote on a worker's PRs since its run ended, counted: reviews with words, comments, line comments. */
export const newComments = (prs: PrStatus[], since: number) =>
  prs.reduce((n, pr) => {
    const f = fresh(pr, since);
    return n + f.reviews.filter(r => r.body.trim()).length + f.comments.length + f.lines.length;
  }, 0);

/** A PR url as its card names it: the repo and the number ("northwind-api", "#31"); the url itself when it is neither. */
export function prName(url: string) {
  const m = /\/([^/]+)\/pull\/(\d+)\/?$/.exec(url);
  return m ? { repo: m[1], n: `#${m[2]}` } : { repo: url, n: "" };
}
