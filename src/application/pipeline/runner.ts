import { fill, prompts, untrusted } from "../../shared/prompts";
import type { BoardProvider, BoardRef, Card, Column } from "../../domain/board/types";
import { colOf } from "../../domain/board/rules";
import type { Worker } from "../../domain/orchestrator/types";
import {
  afterAnswer,
  answerWhy,
  bare,
  briefOf,
  picturesOf,
  withPictures,
  buildState,
  inReview,
  manual,
  panelTickets,
  pausedOf,
  picks,
  pipelineAt,
  PREFLIGHT_PROMPT,
  preflightOf,
  prsOf,
  ready,
  reposFor,
  retask,
  reviewAll,
  runnable,
  stalled,
  startsNow,
  stateSince,
  step,
  usedUp,
  ticketOf,
  waitingIn,
  workersOf,
  pickedOf,
} from "../../domain/pipeline/rules";
import type { Pipeline, Step, Ticket } from "../../domain/pipeline/types";
import type { AnswerKind } from "../../domain/pipeline/rules";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { isPrimary } from "../../infrastructure/window";
import { t } from "../../shared/i18n";
import { provider as providerOf } from "../../shared/plugins";
import { ctxOf } from "../board/ctx";
import { toast } from "../navigation/navigation";
import { onOrchEvent, stopWorker } from "../orchestrator/orchestrator";
import { useOrchestratorStore } from "../orchestrator/store";
import { saveMainSettings, settings } from "../settings/settings";
import { projectName } from "../workspace/vault";
import { usePipelineStore, type BouncedTicket } from "./store";

// The board pipeline, while the app runs: every few minutes and when a pipeline worker changes, per switched-on
// pipeline (settings.pipelines): put ended runs on the board, follow the PRs in review (one per repo a ticket changed),
// start on the tickets in the
// pick column (unless it is hand-picked: then only the tickets started from the ticket window, see buildTicket). The
// board is the record: a ticket is claimed by moving it, so a second runner never takes it too. A paused pipeline
// (its own pause or the global one) still lands ended runs and follows merges and closes, but starts no worker.

// passes and hand-picked starts run one after the other, so a ticket is never claimed by both
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
};
let queued = false;
const lastError: Record<string, string> = {};
// why a pipeline takes no new tickets right now, so it is said once and not every five minutes, and the pipeline
// panel shows it as long as it holds
function hold(project: string, why: "" | "pl.usedUp" | "pl.stalled") {
  const { holding } = usePipelineStore.getState();
  if (why && holding[project] !== why) toast(t(why, { project: projectName(project) }));
  if (holding[project] !== why)
    usePipelineStore.setState(draft => {
      draft.holding[project] = why;
    });
}

/** One pass over every pipeline. Calls while one waits to start make no second one. */
export function runPipelines() {
  if (queued || !isPrimary()) return; // the main window runs them, once for the app
  queued = true;
  return serial(async () => {
    queued = false;
    for (const [project, p] of runnable(settings().pipelines, settings().pipelinesPaused)) {
      try {
        await runOne(project, p);
        delete lastError[project];
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        // once per new error, not every five minutes
        if (lastError[project] !== msg) toast(t("pl.error", { project: projectName(project), error: msg }));
        lastError[project] = msg;
      }
    }
  });
}

/** The vault project whose pipeline runs on a board, for the ticket window's button. */
export const pipelineOfBoard = (ref: BoardRef) => pipelineAt(settings().boards, settings().pipelines, ref);
/** What that button offers for a ticket. */
export const ticketBuildState = (card: string) => buildState(allWorkers(), card);

/** The ticket window's "Build with agent": this ticket now, in whatever column it is, also in an automatic pipeline.
 *  A ticket an agent already ran on continues with that agent. Within the pipeline's limit of agents at once. */
export function buildTicket(ref: BoardRef, card: Pick<Card, "id" | "title" | "number">) {
  return serial(async () => {
    const project = pipelineOfBoard(ref);
    if (!project) return;
    if (pausedOf(settings().pipelines?.[project], settings().pipelinesPaused))
      return toast(t("pl.pausedStart", { project: projectName(project) }));
    const b = await open(project, settings().pipelines![project]);
    const mine = workersOf(allWorkers(), project);
    const running = mine.filter(w => w.state === "running").length;
    if (running >= Math.max(1, b.p.parallel)) return toast(t("pl.full", { n: running }));
    const last = mine.filter(w => ticketOf(w)?.card === card.id).pop();
    if (last?.state === "running") return;
    if (last && last.board !== "merged") await resume(b, card.id, last, "You were asked to continue on this ticket.");
    else await claim(b, project, card as Card, true);
  }).catch(e => toast(t("pl.error", { project: "", error: String((e as Error)?.message ?? e) })));
}

/** What the pipeline panel shows for a project: its pipeline (undefined without one) and whether it runs, its own and
 *  the global pause, its workers running against its maximum, why it holds, and its tickets. */
export function pipelinePanel(project: string) {
  const s = settings();
  const p = s.pipelines?.[project];
  const tickets = panelTickets(allWorkers(), project);
  const { waiting: allWaiting, answered } = usePipelineStore.getState();
  const waiting = allWaiting[project];
  return {
    linked: !!p && !!s.boards?.[project],
    on: ready(p),
    paused: !!p?.paused,
    all: !!s.pipelinesPaused,
    running: workersOf(allWorkers(), project).filter(w => w.state === "running").length,
    parallel: Math.max(1, p?.parallel ?? 1),
    holding: usePipelineStore.getState().holding[project] ?? "",
    tickets,
    // since when each row is in its state: a run started by an answer in this session since that answer
    since: Object.fromEntries(tickets.map(w => [w.key, stateSince(w, answered[ticketOf(w)!.card])])),
    // answered and moved to the pick column, until the worker runs again: the panel shows them waiting there
    toPick: tickets
      .filter(w => w.state !== "running" && (answered[ticketOf(w)!.card] ?? 0) > (w.ended ?? 0))
      .map(w => w.key),
    // sent back before they started, the ones that got a worker since left out
    bounced: p && !manual(p) ? bouncedOf(project).filter(e => !tickets.some(w => ticketOf(w)?.card === e.id)) : [],
    // a hand-picked pipeline reads no pick column. A ticket claimed since the board was read shows with its worker
    waiting:
      p && ready(p) && !manual(p) && waiting
        ? { at: waiting.at, tickets: waiting.tickets.filter(x => !tickets.some(w => ticketOf(w)?.card === x.id)) }
        : null,
  };
}

// what an answer without words puts on the ticket, so the ticket still shows what happened
const NO_WORDS = { answer: "", changes: "", approve: "pp.approvedLine", retry: "pp.retryLine" } as const;
// the comment already on a ticket, by card id, when what came after it failed: sending the same again skips the post
const posted: Record<string, string> = {};

/** An answer from the pipeline panel: the person's words as a comment on the ticket (the board stays the record),
 *  then the ticket going again: its worker picks it up now when it may start and there is room, else the ticket
 *  waits in the pick column (a hand-picked pipeline has none: it stays, Build with agent continues it). A ticket sent
 *  back before it started (`card`) goes to the pick column for the pre-flight again. Resolves true when the comment
 *  is on the ticket. On a failure it says why and resolves false, so the panel keeps what was typed. */
export function answerTicket(
  project: string,
  to: { worker: Worker } | { card: BouncedTicket },
  kind: AnswerKind,
  text: string,
): Promise<boolean> {
  return serial(async () => {
    const p = settings().pipelines?.[project];
    if (!p) return false;
    const b = await open(project, p);
    if (!b.prov.detail?.act) throw new Error(t("pp.noComment"));
    const worker = "worker" in to ? (useOrchestratorStore.getState().workers[to.worker.key] ?? to.worker) : null;
    const id = worker ? ticketOf(worker)!.card : (to as { card: BouncedTicket }).card.id;
    const words = text.trim() || (NO_WORDS[kind] ? t(NO_WORDS[kind]) : "");
    if (!words) return false;
    if (posted[id] !== words) {
      await b.prov.detail.act(ctxOf(b.prov), b.ref, id, "comment", {
        value: words,
        files: [],
        hidden: p.hidden !== false,
      });
      posted[id] = words;
    }
    const busy = workersOf(allWorkers(), project).filter(w => w.state === "running").length;
    const spent = !!worker && usedUp(await backend.usageLimits().catch(() => []), "claude");
    const next = afterAnswer({
      worker: !!worker,
      running: worker?.state === "running",
      starts: startsNow(settings(), project),
      room: busy < Math.max(1, p.parallel) && !spent,
      manual: manual(p),
    });
    const name = projectName(project);
    // the row's time and its "waiting in the pick column" count from this answer
    const mark = () =>
      usePipelineStore.setState(draft => {
        draft.answered[id] = Date.now();
      });
    if (next === "resume") {
      // the user's words go in the message itself: the tracker may not show the comment yet
      await resume(b, id, worker!, answerWhy(kind, text));
      mark();
    } else if (next === "pick" && p.pick) {
      await move(b, id, p.pick);
      if (worker) mark();
      toast(
        t(!worker ? "pp.toPick" : startsNow(settings(), project) ? "pp.toPickFull" : "pp.toPickPaused", {
          project: name,
        }),
      );
    } else if (next === "stay") toast(t("pp.stayManual", { project: name }));
    if (!worker) {
      setBounced(
        project,
        bouncedOf(project).filter(e => e.id !== id),
      );
      if (next === "pick") runPipelines();
    }
    delete posted[id];
    return true;
  }).catch(e => {
    toast(t("pl.error", { project: projectName(project), error: String((e as Error)?.message ?? e) }));
    return false;
  });
}

/** Pause a project's pipeline from its panel, or go on. `stop`: its running workers stop too (their tickets land with
 *  a person), else they finish their step. Going on starts a pass at once. */
export async function pausePipeline(project: string, paused: boolean, stop = false) {
  const s = settings();
  const p = s.pipelines?.[project];
  if (!p) return;
  const failed = await saveMainSettings({ ...s, pipelines: { ...s.pipelines, [project]: { ...p, paused } } });
  if (failed) return toast(failed);
  if (stop)
    await Promise.all(
      workersOf(allWorkers(), project)
        .filter(w => w.state === "running")
        .map(w => takeOver(w)),
    );
  if (!paused) runPipelines();
}

/** Pause every pipeline at once, or go on (each one's own pause stays as it was). */
export async function pauseAllPipelines(paused: boolean) {
  const failed = await saveMainSettings({ ...settings(), pipelinesPaused: paused });
  if (failed) return toast(failed);
  if (!paused) runPipelines();
}

/** A person takes a ticket over from its worker: the worker stops, and its stopped run lands the ticket in the input
 *  column like any run that ended without a PR (runOne, paused or not). */
export const takeOver = (w: Worker) => stopWorker(w.key);

/** The backend's `orch` event: a pipeline worker that stopped running is put on the board right away. */
export function onPipelineWorker(w: Worker) {
  if (ticketOf(w) && w.state !== "running") runPipelines();
}

/** A ticket's or a PR's page, from a pipeline worker on the workers board. */
export const openPipelineLink = (url: string) => url.startsWith("https://") && backend.openUrl(url);

// what the backend answered, in the store now: its `orch` event comes later, and the next pass must not count a new
// worker as missing (a second claim) or a worker sent feedback as still in review (the feedback twice)
const adopt = (w: Worker | null) => w && onOrchEvent({ type: "worker", worker: w });
async function sendWorker(w: Worker, text: string, task: string | null = null) {
  await backend.orchMessage(w.key, text, task);
  adopt({ ...w, task: task ?? w.task, state: "running", ended: null });
}

const allWorkers = () => Object.values(useOrchestratorStore.getState().workers).sort((a, b) => a.at - b.at);

type Board = { prov: BoardProvider; ref: BoardRef; group: string; columns: Column[]; p: Pipeline };

/** A pipeline's board, its columns checked. */
async function open(project: string, p: Pipeline): Promise<Board> {
  const ref = settings().boards?.[project];
  if (!ref) throw new Error(t("pl.noBoard"));
  const prov = providerOf(ref.provider);
  if (!prov) throw new Error(ref.provider);
  const ctx = ctxOf(prov);
  const group = p.group || prov.groupings?.[0].id || "";
  const columns = await prov.columns(ctx, ref, group);
  for (const id of [p.pick, p.busy, p.review, p.input, p.merged].filter(Boolean))
    if (!columns.some(c => c.id === id)) throw new Error(t("pl.noColumn"));
  return { prov, ref, group, columns, p };
}

async function runOne(project: string, p: Pipeline) {
  const b = await open(project, p);
  const { prov, ref, group } = b;
  const ctx = ctxOf(prov);

  // runs that ended: their ticket to review or to a person
  for (const w of workersOf(allWorkers(), project)) {
    const s = step(w);
    if (s) await land(b, w, s);
  }
  // PRs in review: merged, closed, or comments for the worker
  for (const w of workersOf(allWorkers(), project).filter(inReview)) {
    const prs = await backend.orchPr(w.key).catch(() => null);
    const r = prs && reviewAll(prs, w.ended ?? 0);
    if (!r) continue;
    const id = ticketOf(w)!.card;
    const links = prsOf(w).join("\n");
    if (r.kind === "merged") {
      if (p.merged) await move(b, id, p.merged);
      await comment(b, id, t("pl.merged", { pr: links }));
      adopt(await backend.orchBoard(w.key, "merged"));
    } else if (r.kind === "closed") {
      await move(b, id, p.input);
      await comment(b, id, t("pl.closed", { pr: links }));
      adopt(await backend.orchBoard(w.key, "closed"));
    } else if (startsNow(settings(), project)) {
      // review comments start the worker again: that waits while paused (also when paused during this pass), the
      // comments are read again from the run's end once the pipeline goes on. The ticket text stays, unless someone
      // changed the ticket meanwhile (a ticket that cannot be read stays too)
      const view = await viewOf(b, id).catch(() => null);
      const text = fill(prompts.pipeline.reviewComments, { pr: prsOf(w).join(", "), text: r.text });
      await sendWorker(w, text, view && retask(w.task, view, w.at));
      await move(b, id, p.busy);
      await comment(b, id, t("pl.feedback"));
    }
  }
  // the pick column: tickets moved back go to their worker again, new ones get a worker while there is room
  if (manual(p)) return;
  const cards = await prov.cards(ctx, ref);
  const mine = workersOf(allWorkers(), project);
  const col = (card: Card) => colOf(prov, { group }, card);
  await keepWaiting(b, project, waitingIn(cards, col, p, mine));
  // a ticket sent back before it started is the panel's until it leaves the input column (answered, moved, closed)
  const kept = bouncedOf(project).filter(e => cards.some(c => c.id === e.id && col(c) === p.input));
  if (kept.length !== bouncedOf(project).length) setBounced(project, kept);
  const { fresh, resume: back } = picks(cards, col, p, mine);
  let room = Math.max(1, p.parallel) - mine.filter(w => w.state === "running").length;
  if (room <= 0 || (!fresh.length && !back.length)) return;
  // a run on a spent plan would only stall: wait until the limits read again
  if (usedUp(await backend.usageLimits().catch(() => []), "claude")) return hold(project, "pl.usedUp");
  // the pause as it is now, before every start: one pressed while this pass runs stops it here
  for (const { card, worker } of back) {
    if (room-- <= 0 || !startsNow(settings(), project)) return;
    await resume(b, card.id, worker, "The ticket was moved back to the pick column on the board.");
  }
  // runs keep ending without a PR: tickets moved back still go on (a person looked at them), new ones wait
  if (stalled(workersOf(allWorkers(), project))) return hold(project, "pl.stalled");
  hold(project, "");
  // no repo to build in: said once, the tickets stay where they are
  if (fresh.length && !reposFor(await backend.pipelineRepos(project, pickedOf(p)), p).length)
    throw new Error(t("pl.noRepos"));
  for (const card of fresh) {
    if (room-- <= 0 || !startsNow(settings(), project)) return;
    await claim(b, project, card);
  }
}

/** A ticket an agent ran on before: back to building, the agent gets what is new on it since. */
async function resume(b: Board, id: string, worker: Worker, why: string) {
  await move(b, id, b.p.busy);
  const view = await viewOf(b, id);
  const news = view ? briefOf(view, worker.ended ?? 0) : "";
  // a changed ticket becomes its task, so the review judges the work against what is asked now
  const task = view && retask(worker.task, view, worker.at);
  await sendWorker(worker, fill(prompts.pipeline.resume, { why, news: news && untrusted("ticket", news) }), task);
  await comment(b, id, t("pl.resumed"));
}

/** A new ticket: moved to busy first (the claim), then a worker with the ticket as its brief. A ticket from the pick
 *  column with nothing in it, or that the pre-flight finds unclear, goes to a person instead; one you start yourself
 *  (`hand`) is your call. */
async function claim(b: Board, project: string, card: Card, hand = false) {
  const ctx = ctxOf(b.prov);
  await move(b, card.id, b.p.busy);
  try {
    const view = await viewOf(b, card.id);
    if (!hand && view && bare(view)) {
      await move(b, card.id, b.p.input);
      await comment(b, card.id, t("pl.notReady", { column: nameOf(b, b.p.pick) }));
      return bounce(project, card, view.url, { why: "bare" });
    }
    // plan mode asks its questions with the plan, a skill judges the ticket itself, and a ticket you start yourself
    // is your call
    if (!hand && view && !b.p.plan && !b.p.skill?.trim()) {
      const verdict = preflightOf(
        await backend.aiWrite(PREFLIGHT_PROMPT, untrusted("ticket", briefOf(view))).catch(() => ""),
      );
      if (verdict && !verdict.clear) {
        await move(b, card.id, b.p.input);
        const questions = verdict.questions.map(q => `- ${q}`).join("\n");
        await comment(b, card.id, t("pl.unclear", { questions, column: nameOf(b, b.p.pick) }));
        return bounce(project, card, view.url, { why: "unclear", questions: verdict.questions });
      }
    }
    const url = view?.url || (await b.prov.url(ctx, b.ref, card.id));
    const ticket: Ticket = {
      pipeline: project,
      provider: b.prov.id,
      project: b.ref.project,
      board: b.ref.board,
      card: card.id,
      number: card.number,
      title: card.title,
      url,
    };
    // ponytail: only at the start; a picture added later reaches a resumed worker as a link
    const pictures = view ? await backend.ticketPictures(b.prov.id, picturesOf(view)).catch(() => []) : [];
    const task = view ? withPictures(briefOf(view), pictures) : `Ticket #${card.number} "${card.title}"\n${url}`;
    const repos = reposFor(await backend.pipelineRepos(project, pickedOf(b.p)), b.p);
    if (!repos.length) throw new Error(t("pl.noRepos"));
    // paused while the ticket was read and judged: back to the pick column for when it goes on, one started by hand
    // to a person with why
    if (!startsNow(settings(), project)) {
      if (!hand && b.p.pick) return await move(b, card.id, b.p.pick);
      await move(b, card.id, b.p.input);
      return await comment(b, card.id, t("pl.pausedBack"));
    }
    const w = await backend.orchDispatchTicket({
      title: card.title,
      task,
      project,
      repos,
      base: b.p.base,
      into: b.p.into ?? "",
      ticket,
      // the checks are per repo now, in `repos`
      validate: { checks: "", review: b.p.reviewer ?? "", rounds: b.p.rounds ?? 3 },
      // with a skill, the skill decides per ticket whether a plan needs approval
      plan: !!b.p.plan && !b.p.skill?.trim(),
      skill: b.p.skill?.trim() ?? "",
    });
    adopt(w);
    await comment(b, card.id, t("pl.picked", { branch: w.branch ?? "" }));
  } catch (e) {
    // back in front of a person, with why: the pick column would only try it again
    const error = String((e as Error)?.message ?? e);
    await move(b, card.id, b.p.input);
    await comment(b, card.id, t("pl.startFailed", { error }));
    // one you started yourself you see go wrong, and a hand-picked pipeline reads no input column to clear it from
    if (!hand)
      bounce(project, card, await b.prov.url(ctx, b.ref, card.id).catch(() => ""), { why: "failed", reason: error });
  }
}

/** The tickets a pipeline sent back before they started, for the panel, saved so they outlive a restart. */
function setBounced(project: string, list: BouncedTicket[]) {
  usePipelineStore.setState(draft => {
    draft.bounced[project] = list;
  });
  storage.set("pipelineBounced", usePipelineStore.getState().bounced);
}
const bouncedOf = (project: string) => usePipelineStore.getState().bounced[project] ?? [];
function bounce(
  project: string,
  card: Card,
  url: string,
  x: Partial<Pick<BouncedTicket, "why" | "questions" | "reason">>,
) {
  const entry: BouncedTicket = {
    id: card.id,
    number: card.number,
    title: card.title,
    url,
    why: x.why ?? "failed",
    questions: x.questions ?? [],
    reason: x.reason ?? "",
    at: Date.now(),
  };
  setBounced(project, [...bouncedOf(project).filter(e => e.id !== card.id), entry]);
}

/** An ended run on the board: the move, a comment with what happened, and the mark so it happens once. */
async function land(b: Board, w: Worker, s: Step) {
  const id = ticketOf(w)!.card;
  const summary = (w.report?.summary ?? "").slice(0, 3000);
  const text = {
    // a later done on the same PR: the branch was pushed again
    pr: () => t(w.board?.startsWith("done:") ? "pl.prUpdated" : "pl.pr", { pr: prsOf(w).join("\n"), summary }),
    partial: () => t("pl.prPartial", { pr: prsOf(w).join("\n"), reason: w.pr_error ?? "", summary }),
    nopr: () => t("pl.noPr", { reason: w.pr_error ?? "", summary }),
    blocked: () =>
      manual(b.p)
        ? t("pl.blockedManual", { questions: w.report?.questions ?? summary })
        : t("pl.blocked", { questions: w.report?.questions ?? summary, column: nameOf(b, b.p.pick) }),
    failed: () => t("pl.failed", { state: w.state, summary }),
    merged: () => "",
    closed: () => "",
  }[s.kind]();
  await move(b, id, s.to === "review" ? b.p.review : s.to === "merged" ? b.p.merged : b.p.input);
  await comment(b, id, text.trim());
  adopt(await backend.orchBoard(w.key, s.mark));
}

/** The pick column's tickets without a worker, for the pipeline panel, each with its link (the providers keep the
 *  links of the cards they just listed, so this asks the tracker nothing new for most). */
async function keepWaiting(b: Board, project: string, cards: Card[]) {
  const ctx = ctxOf(b.prov);
  const tickets = await Promise.all(
    cards.map(async c => ({
      id: c.id,
      number: c.number,
      title: c.title,
      url: await b.prov.url(ctx, b.ref, c.id).catch(() => ""),
    })),
  );
  usePipelineStore.setState(draft => {
    draft.waiting[project] = { at: Date.now(), tickets };
  });
}

/** The ticket's detail as the ticket window shows it, null for a provider without one. */
const viewOf = async (b: Board, id: string) =>
  b.prov.detail ? b.prov.detail.view(await b.prov.detail.fetch(ctxOf(b.prov), b.ref, id)) : null;
const nameOf = (b: Board, id: string) => b.columns.find(c => c.id === id)?.name ?? id;
// the providers move and comment by the card's id alone
const move = (b: Board, id: string, to: string) => b.prov.move(ctxOf(b.prov), b.ref, { id } as Card, to, b.group);
async function comment(b: Board, id: string, value: string) {
  if (value && b.prov.detail?.act)
    await b.prov.detail.act(ctxOf(b.prov), b.ref, id, "comment", { value, files: [], hidden: b.p.hidden !== false });
}
