import type { BoardRef, Card, CardView, Column } from "../board/types";
import type { Worker } from "../orchestrator/types";
import type { Limits } from "../agents/types";
import type { ProvLimits } from "../usage/types";
import type { Pipeline, PipelineRepo, PrStatus, Step, Ticket } from "./types";
import { fill, prompts, untrustedNote } from "../../shared/prompts.ts";
import en from "../../shared/locales/en.ts";
import nl from "../../shared/locales/nl.ts";
import de from "../../shared/locales/de.ts";
import fr from "../../shared/locales/fr.ts";

export const EMPTY_PIPELINE: Pipeline = {
  on: false,
  repo: "",
  base: "",
  group: "",
  pick: "",
  busy: "",
  review: "",
  input: "",
  merged: "",
  label: "",
  parallel: 1,
};

/** You start each ticket yourself, nothing is picked up from a column. */
export const manual = (p: Pipeline) => p.mode === "manual";

/** Switched on and every column it cannot run without filled in (the pick column only when it picks by itself). The
 *  repos are found when it runs (see reposFor). */
export const ready = (p: Pipeline | undefined): p is Pipeline =>
  !!p?.on && (manual(p) || !!p.pick) && !!p.busy && !!p.review && !!p.input;

/** Paused, by its own pause or by the one for every pipeline (settings.pipelinesPaused). */
export const pausedOf = (p: Pipeline | undefined, all?: boolean) => !!all || !!p?.paused;

/** The pipelines a pass runs: the ready ones, each paused as it counts now, by its own pause or the global one. */
export const runnable = (pipelines: Record<string, Pipeline> | undefined, all?: boolean): [string, Pipeline][] =>
  Object.entries(pipelines ?? {}).flatMap(([project, p]) =>
    ready(p) ? [[project, { ...p, paused: pausedOf(p, all) }] as [string, Pipeline]] : [],
  );

/** Whether a pass may start something for a project right now (claim a ticket, pick one up again, send review
 *  comments): its pipeline still ready and not paused, read from the settings at that moment, so a pause pressed
 *  while a pass runs stops it before its next start. */
export const startsNow = (s: { pipelines?: Record<string, Pipeline>; pipelinesPaused?: boolean }, project: string) =>
  ready(s.pipelines?.[project]) && !pausedOf(s.pipelines?.[project], s.pipelinesPaused);

/** What an answer from the pipeline panel does with its ticket once the comment is on it: its worker picks it up
 *  again now (it may start, there is room, it is not running), the ticket goes to the pick column for the pipeline to
 *  take when it can (paused, full, or no worker yet), or it stays where it is (a hand-picked pipeline has no pick
 *  column: Build with agent continues it). */
export function afterAnswer(o: {
  worker: boolean;
  running: boolean;
  starts: boolean;
  room: boolean;
  manual: boolean;
}): "resume" | "pick" | "stay" {
  if (o.running) return "stay";
  if (o.worker && o.starts && o.room) return "resume";
  return o.manual ? "stay" : "pick";
}

/** What the user can do from the panel's answer box: answer a question, approve a plan (with or without a note), ask
 *  for changes to it, or have a run tried again. */
export type AnswerKind = "answer" | "approve" | "changes" | "retry";
const ANSWER_WHY: Record<AnswerKind, string> = {
  answer: "The user answered your question.",
  approve: "The user approved your plan: build it, with their note in mind when there is one.",
  changes:
    'The user asked for changes to your plan: rework the plan and report it for approval again (blocked, questions starting with "Plan for approval:"), do not build yet.',
  retry: "The user asked you to try again.",
};
/** The `why` a worker gets when the user answered from the pipeline panel: what it means for the work, and the
 *  user's own words as typed in Relay (not ticket text, so not marked untrusted), so they reach the worker even when
 *  the tracker has not shown the comment yet. */
export function answerWhy(kind: AnswerKind, text: string) {
  const said = text.trim();
  return said ? `${ANSWER_WHY[kind]}\n\nThe user answered in Relay, in their own words:\n${said}` : ANSWER_WHY[kind];
}

/** Since when a panel row is in its state: a run that ended since its end, one running since the user answered it in
 *  this session since that answer, else since it started. */
export const stateSince = (w: Pick<Worker, "state" | "at" | "ended">, answered = 0) =>
  w.state === "running" ? Math.max(w.at, answered) : (w.ended ?? w.at);

/** A plan the agent sent for approval (plan-first.md, skill.md): its questions start with this. */
export const isPlan = (questions: string | null | undefined) => !!questions?.startsWith("Plan for approval:");

/** Settings › Projects' Needs setup: a repo of the project without a checkout on this Mac, or a pipeline switched on
 *  that misses a column it cannot run without. */
export const needsSetup = (repos: string[], found: PipelineRepo[], p: Pipeline | undefined) =>
  repos.some(slug => !found.some(r => r.slug === slug)) || (!!p?.on && !ready(p));

/** A repo's checks: its own, else the pipeline's one command from before for the one checkout it had. */
export const checksOf = (p: Pipeline, r: PipelineRepo) =>
  (p.repos?.[r.slug]?.checks ?? (r.path === p.repo ? p.checks : "") ?? "").trim();

/** The checkouts picked by hand: `repo` from before, then the rest; a later one wins for the same repo. */
export const pickedOf = (p: Pick<Pipeline, "repo" | "checkouts"> | undefined) =>
  [p?.repo ?? "", ...(p?.checkouts ?? [])].filter(Boolean);

/** The repos a worker gets, of the checkouts found for the project: the ones not left out, each with its checks. */
export const reposFor = (found: PipelineRepo[], p: Pipeline) =>
  found.filter(r => !p.repos?.[r.slug]?.off).map(r => ({ path: r.path, checks: checksOf(p, r) }));

/** A worker's PRs, one per repo it opened one in. */
export const prsOf = (w: Pick<Worker, "pr" | "trees">) =>
  w.trees?.length ? w.trees.flatMap(t => (t.pr ? [t.pr] : [])) : w.pr ? [w.pr] : [];

/** The vault project whose ready pipeline runs on this board, if any. */
export function pipelineAt(
  boards: Record<string, BoardRef> | undefined,
  pipelines: Record<string, Pipeline> | undefined,
  ref: BoardRef,
) {
  return Object.entries(boards ?? {}).find(
    ([project, b]) =>
      b.provider === ref.provider && b.project === ref.project && b.board === ref.board && ready(pipelines?.[project]),
  )?.[0];
}

/** What the ticket window offers for a ticket: start an agent, continue with the one that ran on it, or nothing while
 *  one runs. A merged ticket starts over. */
export function buildState(workers: Worker[], card: string): "build" | "continue" | "running" {
  const w = lastWorker(workers, card);
  if (!w || w.board === "merged") return "build";
  return w.state === "running" ? "running" : "continue";
}

export const ticketOf = (w: Pick<Worker, "ticket">) => (w.ticket ?? null) as Ticket | null;

/** The pipeline's workers of a project, newest last (orch.json's order). */
export const workersOf = (workers: Worker[], project: string) => workers.filter(w => ticketOf(w)?.pipeline === project);

/** A ticket's last worker. */
export const lastWorker = (workers: Worker[], card: string) => workers.filter(w => ticketOf(w)?.card === card).pop();

/** The tickets to start on, best first: the ones in the pick column (with the label, when set) that have no running
 *  worker. `resume`: a ticket moved back after a worker ran on it, which that worker picks up again with its worktree.
 *  None while the pipeline is paused. */
export function picks(cards: Card[], col: (c: Card) => string, p: Pipeline, workers: Worker[]) {
  return p.paused ? { fresh: [], resume: [] } : pickColumn(cards, col, p, workers);
}

/** The tickets waiting in the pick column with no worker yet, in pick order: what the pipeline starts on next, paused
 *  or not (the pipeline panel lists them). */
export const waitingIn = (cards: Card[], col: (c: Card) => string, p: Pipeline, workers: Worker[]) =>
  pickColumn(cards, col, p, workers).fresh;

function pickColumn(cards: Card[], col: (c: Card) => string, p: Pipeline, workers: Worker[]) {
  const label = p.label.trim().toLowerCase();
  const fresh: Card[] = [];
  const resume: { card: Card; worker: Worker }[] = [];
  const waiting = cards
    .filter(c => col(c) === p.pick && (!label || (c.labels ?? []).some(l => l.toLowerCase() === label)))
    .sort((a, b) => a.placement - b.placement);
  for (const card of waiting) {
    const w = lastWorker(workers, card.id);
    if (!w || w.board === "merged") fresh.push(card);
    else if (w.state !== "running") resume.push({ card, worker: w });
  }
  return { fresh, resume };
}

/** What the board still needs for a worker whose run ended: each end once, by its time. Null while it runs or when
 *  done. A done worker with its PR waits in review (see review). */
export function step(w: Worker): Step | null {
  if (!ticketOf(w) || w.state === "running" || !w.ended || w.board === "merged" || w.board === "closed") return null;
  const mark = `${w.state}:${w.ended}`;
  if (w.board === mark) return null;
  // a repo it changed without a PR: a person first, half of a change is not for review
  if (w.state === "done")
    return !prsOf(w).length
      ? { mark, to: "input", kind: "nopr" }
      : w.pr_error
        ? { mark, to: "input", kind: "partial" }
        : { mark, to: "review", kind: "pr" };
  if (w.state === "blocked") return { mark, to: "input", kind: "blocked" };
  return { mark, to: "input", kind: "failed" };
}

/** A done whose push or PR failed on something passing (the network, GitHub): worth one more try. Not one that fails
 *  for a reason a retry does not change: nothing committed or to push, a protected branch moved, no worktree, no
 *  GitHub origin. */
export const pushAgain = (w: Worker) =>
  w.state === "done" &&
  !!w.pr_error &&
  !/nothing committed|nothing to push|not pushed|no worktree|no GitHub origin/i.test(w.pr_error);

/** A worker whose PRs wait for review: its done was put on the board, nothing came after. */
export const inReview = (w: Worker) =>
  !!prsOf(w).length && !w.pr_error && w.state === "done" && w.board === `done:${w.ended}`;

/** The ticket a pipeline's conversation means (`ref`: its agent's worker key, or its number with or without "#"),
 *  among the tickets the pipeline has a worker for and the ones it sent back before they started. Undefined when no
 *  ticket or more than one matches: the conversation acts on one ticket it can name. */
export function ticketByRef<B extends { number: string }>(workers: Worker[], bounced: B[], ref: string) {
  const r = ref.trim().replace(/^#/, "");
  const hits = [
    ...workers.filter(w => w.key === r || ticketOf(w)?.number === r).map(worker => ({ worker })),
    ...bounced.filter(b => b.number === r).map(card => ({ card })),
  ];
  return hits.length === 1 ? hits[0] : undefined;
}

/** The pipeline panel's tickets: each ticket's last worker, newest first, the merged and closed ones left out. */
export function panelTickets(workers: Worker[], project: string) {
  const last = new Map<string, Worker>();
  for (const w of workersOf(workers, project)) last.set(ticketOf(w)!.card, w);
  return [...last.values()].filter(w => w.board !== "merged" && w.board !== "closed").sort((a, b) => b.at - a.at);
}

/** Where a worker's ticket is on the board, by what the pipeline last did with it: a run that ended stays in busy
 *  until it lands. */
export const columnOf = (w: Worker): "busy" | "review" | "input" =>
  w.state === "running" || step(w) ? "busy" : inReview(w) ? "review" : "input";

/** Where a worker's ticket shows in the pipeline panel: the column the pipeline put it in (columnOf), and whether a
 *  person moved it since, by the board as the runner last read it (`column`: its id there, "" when the ticket was not
 *  on the board). Undefined while the board was not read yet: then only the worker tells. */
export function placeOf(w: Worker, p: Pick<Pipeline, "busy" | "review" | "input">, column?: string) {
  const col = columnOf(w);
  return { col, moved: column != null && column !== p[col] };
}

/** The panel's answer box, options, Approve and Try again: only for a ticket in the input column where the pipeline
 *  put it. Answering one a person moved on would start an agent on a ticket that is already done. */
export const answerable = (place: ReturnType<typeof placeOf>) => place.col === "input" && !place.moved;

/** What a person's move on the board means for a worker that is not running and whose end is on the board (`column`:
 *  where its ticket is now). In the merged column, or a done column the pipeline does not use: "merged", it leaves
 *  the panel and is not picked up again. In the review column without Relay following a PR there (blocked, failed,
 *  done without a PR or with one missing): "adopt", the PR the person pushed or opened on its branch is followed from
 *  now on. Null otherwise. */
export function boardMove(w: Worker, p: Pipeline, column: Column | undefined): "merged" | "adopt" | null {
  if (!column || w.state === "running" || step(w) || w.board === "merged" || w.board === "closed") return null;
  const own = [p.pick, p.busy, p.review, p.input].includes(column.id);
  if ((p.merged && column.id === p.merged) || (column.state === "done" && !own)) return "merged";
  return column.id === p.review && !inReview(w) ? "adopt" : null;
}

/** A move Relay must not make by itself: a person moved the ticket from where the pipeline put it (`own`) to `now`, and
 *  `to` is back from there. Further on: a done column, else a later one on the board. A ticket not on the board, or in
 *  a column Relay does not know, is not held. Confirming is the person's: Build with agent, or the pick column. */
export function movedOn(columns: Column[], own: string, now: string | undefined, to: string) {
  if (!now || now === own || now === to) return false;
  const rank = (id: string) => {
    const c = columns.find(x => x.id === id);
    return c && ([c.state === "done" ? 1 : 0, c.placement] as const);
  };
  const [a, b] = [rank(now), rank(to)];
  return !!a && !!b && (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
}

/** How long a ticket a person took to review waits before its branch is asked for a PR again, after a lookup found
 *  none: each lookup is a gh call per repo. */
export const ADOPT_EVERY = 30 * 60_000;
/** Whether to look for that PR now: never looked (this session), or the last empty lookup is ADOPT_EVERY ago. */
export const adoptDue = (last: number | undefined, now: number) => last == null || now - last >= ADOPT_EVERY;

const bot = (login: string | undefined) => !login || login.endsWith("[bot]") || login.toLowerCase().includes("copilot");
const after = (iso: string, since: number) => Date.parse(iso) > since;

type Review = { kind: "merged" } | { kind: "closed" } | { kind: "feedback"; text: string } | null;

/** What happened to a worker's PRs in review: merged once every one is, closed once one is (a ticket over several
 *  repos goes back to a person), else what people wrote on any of them as the next brief, each under its PR. */
export function reviewAll(prs: PrStatus[], since: number): Review {
  const each = prs.map(pr => ({ url: pr.url, r: review(pr, since) }));
  if (!each.length) return null;
  if (each.every(x => x.r?.kind === "merged")) return { kind: "merged" };
  if (each.some(x => x.r?.kind === "closed")) return { kind: "closed" };
  const said = each.flatMap(x =>
    x.r?.kind === "feedback" ? [prs.length > 1 ? `On ${x.url}:\n${x.r.text}` : x.r.text] : [],
  );
  return said.length ? { kind: "feedback", text: said.join("\n\n") } : null;
}

/** What people wrote on a PR since `since` (the worker's run ended): reviews that are not an approval, comments, line
 *  comments; bots left out, they would start a loop. */
export function fresh(pr: PrStatus, since: number) {
  return {
    reviews: pr.reviews.filter(
      r => after(r.submittedAt, since) && r.state !== "APPROVED" && r.state !== "DISMISSED" && !bot(r.author?.login),
    ),
    comments: pr.comments.filter(c => after(c.createdAt, since) && !bot(c.author?.login)),
    lines: pr.inline.filter(c => after(c.created_at, since) && !bot(c.user?.login)),
  };
}

/** What happened to a PR in review: merged, closed, or what people wrote on it since the worker's run ended as the
 *  next brief. */
export function review(pr: PrStatus, since: number): Review {
  if (pr.state === "MERGED") return { kind: "merged" };
  if (pr.state === "CLOSED") return { kind: "closed" };
  const { reviews, comments, lines } = fresh(pr, since);
  if (!reviews.some(r => r.body.trim()) && !comments.length && !lines.length) return null;
  const parts = [
    ...reviews.filter(r => r.body.trim()).map(r => `Review by ${r.author?.login} (${r.state}):\n${r.body.trim()}`),
    ...comments.map(c => `Comment by ${c.author?.login}:\n${c.body.trim()}`),
    ...lines.map(c => `On ${c.path}${c.line ? `:${c.line}` : ""}, by ${c.user?.login}:\n${c.body.trim()}`),
  ];
  return { kind: "feedback", text: parts.join("\n\n") };
}

/** HTML as plain text, for a brief: the tracker's description and comments are sanitised HTML. */
export function htmlText(html: string) {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A ticket with nothing to build from: no description, no comment with text, no file. The pick column hands it to
 *  a person instead of an agent. */
export const bare = (v: CardView) =>
  !htmlText(v.description || "") &&
  !v.feed.some(f => htmlText(f.html)) &&
  !(v.files?.length || v.feed.some(f => f.files.length));

/** A comment as a line of a brief. */
const commentLine = (f: CardView["feed"][number]) => `- ${f.who} (${f.at}): ${htmlText(f.html)}`;

/** The ticket as a brief: title, link, description, the comments (only the ones after `since`, for a worker that picks
 *  it up again) and the files' links. */
export function briefOf(v: CardView, since?: number) {
  const out = [`Ticket ${v.number ? `#${v.number} ` : ""}"${v.title}"`, v.url];
  const description = htmlText(v.description || "");
  if (since == null) out.push("", "Description:", description || "(none)");
  const feed = v.feed.filter(f => f.html && (since == null || Date.parse(f.at) > since));
  if (feed.length)
    out.push("", since == null ? "Comments, oldest first:" : "New on the ticket:", ...feed.map(commentLine));
  const files = [...(v.files ?? []), ...v.feed.flatMap(f => f.files)];
  if (files.length && since == null) out.push("", "Files:", ...files.map(f => `- ${f.name}: ${f.url}`));
  return out.join("\n");
}

/** The ticket's pictures, on the ticket and on its comments, as [name, url]: what an agent gets as files. */
export const picturesOf = (v: CardView): [string, string][] =>
  [...(v.files ?? []), ...v.feed.flatMap(f => f.files)]
    .filter(f => f.url && /\.(png|jpe?g|gif|webp)$/i.test(f.name))
    .map(f => [f.name, f.url]);

const PICTURES = "\n\nThe ticket's pictures, saved on this Mac (open them with Read):\n";
/** The brief with where the ticket's pictures were saved: the agent cannot open the tracker's links. */
export const withPictures = (brief: string, paths: string[]) =>
  paths.length ? `${brief}${PICTURES}${paths.map(p => `- ${p}`).join("\n")}` : brief;

/** The comments Relay itself puts on a ticket (runner.ts, comment()). */
export const RELAY_COMMENTS = [
  "pl.picked",
  "pl.resumed",
  "pl.startFailed",
  "pl.notReady",
  "pl.unclear",
  "pl.pr",
  "pl.prUpdated",
  "pl.prPartial",
  "pl.noPr",
  "pl.blocked",
  "pl.blockedManual",
  "pl.failed",
  "pl.feedback",
  "pl.merged",
  "pl.closed",
  "pl.pausedBack",
] as const;
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
/** How each of them opens, in every language (the user may have switched since): its text up to the first
 *  placeholder, taken from the strings themselves so a reworded one is still recognised. */
export const RELAY_OPENINGS = [en, nl, de, fr].flatMap(l => RELAY_COMMENTS.map(k => flat(l[k].split("{")[0])));
/** A comment Relay wrote: it is posted under the user's own account, so only its text tells. */
export const byRelay = (text: string) => RELAY_OPENINGS.some(o => flat(text).startsWith(o));

// spaces as one, line breaks kept: the questions are often a list
const spaced = (s: string) => s.replace(/[^\S\n]+/g, " ").trim();
// each language's Blocked comments as [opening, closing], the fixed text around {questions}, the closing up to its
// first placeholder
const BLOCKED = [en, nl, de, fr].flatMap(l =>
  (["pl.blocked", "pl.blockedManual"] as const).map(k => {
    const [open, close = ""] = l[k].split("{questions}");
    return [spaced(open), spaced(close.split("{")[0])] as const;
  }),
);
/** What the agent asked, out of Relay's Blocked comment: the text between its fixed opening and closing (all after
 *  the opening when no closing is found). Null for any other comment. */
export function askedIn(text: string) {
  const t = spaced(text);
  const mine = BLOCKED.filter(([open]) => t.startsWith(open));
  if (!mine.length) return null;
  // the two Blocked comments open the same way: the one whose closing is there
  const [open, close] = mine.find(([o, c]) => c && t.lastIndexOf(c) > o.length) ?? mine[0];
  const end = close ? t.lastIndexOf(close) : -1;
  return t.slice(open.length, end > open.length ? end : undefined).trim();
}

/** The ticket as it reads now, for a worker that started on `task` at `since`: null when nothing changed. Built the
 *  same way each time, so a pass with nothing new gives the same text and an answer already folded in counts once:
 *  the brief with the comments from before the start, as at the start, then in a block of their own what people
 *  wrote since (an answer on Blocked, a correction), with the questions of Relay's Blocked comments they answer. A
 *  question nobody answered yet is no change. Relay's other comments stay out, they carry the agent's summary, which
 *  the review must not read as what was asked. The pictures saved at the start stay. */
export function retask(task: string, v: CardView, since: number) {
  const lines = v.feed
    .filter(f => Date.parse(f.at) > since && htmlText(f.html))
    .flatMap(f => {
      const text = htmlText(f.html);
      const asked = askedIn(text);
      if (asked != null) return [{ person: false, line: `- The agent asked (${f.at}): ${asked}` }];
      return byRelay(text) ? [] : [{ person: true, line: commentLine(f) }];
    });
  const said = lines.slice(0, lines.map(l => l.person).lastIndexOf(true) + 1).map(l => l.line);
  const at = task.lastIndexOf(PICTURES);
  const now =
    briefOf({ ...v, feed: v.feed.filter(f => Date.parse(f.at) <= since) }) +
    (said.length
      ? `\n\nQuestions and answers on the ticket since the agent started, oldest first:\n${said.join("\n")}`
      : "") +
    (at < 0 ? "" : task.slice(at));
  return now === task ? null : now;
}

/** Before a ticket from the pick column gets a worker: one call without tools judges whether an agent can build it
 *  without asking anyone, so an unclear ticket goes back with questions instead of costing a whole run. */
export const PREFLIGHT_PROMPT = fill(prompts.pipeline.preflight, { untrusted: untrustedNote("en", ["ticket"]) });

/** The pre-flight's answer: clear, or the questions to put on the ticket. Null when it gave no usable answer: a check
 *  that could not judge does not hold the ticket. */
export function preflightOf(answer: string): { clear: true } | { clear: false; questions: string[] } | null {
  const a = answer.indexOf("{");
  const b = answer.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    const v = JSON.parse(answer.slice(a, b + 1)) as { clear?: unknown; questions?: unknown };
    if (v.clear === true) return { clear: true };
    if (v.clear !== false) return null;
    const questions = (Array.isArray(v.questions) ? v.questions : [])
      .filter((q): q is string => typeof q === "string" && !!q.trim())
      .map(q => q.trim())
      .slice(0, 3);
    return questions.length ? { clear: false, questions } : null;
  } catch {
    return null;
  }
}

/** Ended runs in a row without a PR (blocked, failed, silent, done with nothing to push) after which the pipeline stops
 *  taking new tickets. A plan sent for approval and a run you stopped are not misses. */
export const MISSES = 3;
const missed = (w: Worker) =>
  w.state === "done" ? !prsOf(w).length : w.state !== "stopped" && !isPlan(w.report?.questions);

/** The pipeline's last MISSES ended runs all missed: something is off (the tickets, the repo, the checks) and new
 *  tickets would only fail the same way. A run that opens a PR, a ticket moved back or one you start yourself goes on. */
export function stalled(workers: Worker[]) {
  const last = workers
    .filter(w => w.state !== "running" && w.ended && w.state !== "stopped")
    .sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0))
    .slice(0, MISSES);
  return last.length === MISSES && last.every(missed);
}

const spent = (l: Limits) => l.ok && l.windows.some(w => !w.name && w.pct >= 100);
/** The provider's plan has no room for a new run: its limits (or, with several accounts, every account's) have a
 *  window at 100% that applies to every model. Limits that could not be read do not stop anything. */
export function usedUp(limits: ProvLimits[], provider: string) {
  const p = limits.find(l => l.provider === provider);
  if (!p) return false;
  // ponytail: all accounts spent, not the one a run would get; a spent active account with auto-switch off still claims
  return p.accounts?.length ? p.accounts.every(a => spent(a.limits)) : spent(p.limits);
}
