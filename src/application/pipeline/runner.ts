import { fill, prompts, untrusted } from "../../shared/prompts";
import type { BoardProvider, BoardRef, Card, Column } from "../../domain/board/types";
import { colOf } from "../../domain/board/rules";
import type { Worker } from "../../domain/orchestrator/types";
import {
  afterAnswer,
  answerWhy,
  bare,
  adoptDue,
  boardMove,
  EMPTY_PIPELINE,
  placeOf,
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
  pushAgain,
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
import { t, tn } from "../../shared/i18n";
import { digestRows, digestSig, digestText, waiting } from "../../domain/pipeline/digest";
import { pipeKey } from "../../domain/orchestrator/rules";
import { notify } from "../conversations/events";
import { provider as providerOf } from "../../shared/plugins";
import { ctxOf } from "../board/ctx";
import { ensurePipeChats } from "../conversations/chats";
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
// when a ticket a person took to review was last looked up without finding its PR, by worker key. In memory: a
// restart may ask once more
const lookedUp: Record<string, number> = {};
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

// Relay's own steps in the current pass, per project, for its digest; and the self-steps already taken, once per worker
// ponytail: in memory, a restart may retry a push or ask for a report once more
const did: Record<string, string[]> = {};
const tried = new Set<string>();
const note = (project: string, line: string) => (did[project] ??= []).push(line);
const refOf = (w: Worker) => (ticketOf(w)?.number ? `#${ticketOf(w)!.number}` : w.key);
// what the last digest per project said (digestSig) and what waited on the user in it, kept so a restart sends nothing
// that is not new
const said = storage.get<Record<string, { sig: string; waits: string[] }>>("pipelineDigest", {});

/** After a pass: the pipeline's facts to its conversation when something changed or Relay did a step of its own, and
 *  a banner when a ticket waits on the user that did not before. */
async function digest(project: string) {
  const panel = pipelinePanel(project);
  const lines = did[project] ?? [];
  delete did[project];
  const d = { ...panel, paused: panel.paused || panel.all };
  const rows = digestRows(d);
  const sig = digestSig(rows, d);
  const last = said[project];
  // the first pass of a pipeline without tickets is no news
  if (!lines.length && (sig === last?.sig || (!last && !rows.length))) return;
  await backend.orchPipeSay(project, digestText(projectName(project), rows, lines, d));
  const waits = waiting(rows);
  said[project] = { sig, waits: waits.map(r => r.ref) };
  storage.set("pipelineDigest", said);
  if (waits.some(r => !last?.waits.includes(r.ref))) void notify(pipeKey(project), tn("pc.waits", waits.length));
}
/** The pipeline's facts as they are now, for its conversation's `tickets` tool. */
export function pipelineFacts(project: string) {
  const panel = pipelinePanel(project);
  const d = { ...panel, paused: panel.paused || panel.all };
  return digestText(projectName(project), digestRows(d), [], d);
}

/** One pass over every pipeline. Calls while one waits to start make no second one. */
export function runPipelines() {
  if (queued || !isPrimary()) return; // the main window runs them, once for the app
  queued = true;
  return serial(async () => {
    queued = false;
    const pipelines = runnable(settings().pipelines, settings().pipelinesPaused);
    // each pipeline's conversation, where the user follows it, made once its pipeline runs
    ensurePipeChats(pipelines.map(([project]) => project));
    for (const [project, p] of pipelines) {
      try {
        await runOne(project, p);
        delete lastError[project];
        await digest(project);
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
  const { waiting: allWaiting, answered, columns } = usePipelineStore.getState();
  const waiting = allWaiting[project];
  const board = columns[project];
  return {
    linked: !!p && !!s.boards?.[project],
    on: ready(p),
    paused: !!p?.paused,
    all: !!s.pipelinesPaused,
    running: workersOf(allWorkers(), project).filter(w => w.state === "running").length,
    parallel: Math.max(1, p?.parallel ?? 1),
    holding: usePipelineStore.getState().holding[project] ?? "",
    tickets,
    // where each row's ticket is: the column the pipeline put it in, whether a person moved it since and the name of
    // the column it is in on the board ("" while the board was not read yet, or when it is not on the board)
    places: Object.fromEntries(
      tickets.map(w => {
        const column = board?.of[ticketOf(w)!.card];
        return [w.key, { ...placeOf(w, p ?? EMPTY_PIPELINE, column), name: board?.names[column ?? ""] ?? "" }];
      }),
    ),
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
/** What an answer puts on its ticket: the person's words, else the line that says what happened ("" when it needs words). */
export const postedWords = (kind: AnswerKind, text: string) => text.trim() || (NO_WORDS[kind] ? t(NO_WORDS[kind]) : "");
// the comment already on a ticket, by card id, when what came after it failed: sending the same again skips the post
const posted: Record<string, string> = {};

/** An answer from the pipeline panel: the person's words as a comment on the ticket (the board stays the record),
 *  then the ticket going again: its worker picks it up now when it may start and there is room, else the ticket
 *  waits in the pick column (a hand-picked pipeline has none: it stays, Build with agent continues it). A ticket sent
 *  back before it started (`card`) goes to the pick column for the pre-flight again. Resolves true when the comment
 *  is on the ticket. On a failure it says why and resolves false, so the panel keeps what was typed. `say`: where
 *  what happened is said, a toast for the panel, the tool's answer for the pipeline's conversation. */
export function answerTicket(
  project: string,
  to: { worker: Worker } | { card: BouncedTicket },
  kind: AnswerKind,
  text: string,
  say: (text: string) => void = toast,
): Promise<boolean> {
  return serial(async () => {
    const p = settings().pipelines?.[project];
    if (!p) return false;
    const b = await open(project, p);
    if (!b.prov.detail?.act) throw new Error(t("pp.noComment"));
    const worker = "worker" in to ? (useOrchestratorStore.getState().workers[to.worker.key] ?? to.worker) : null;
    const id = worker ? ticketOf(worker)!.card : (to as { card: BouncedTicket }).card.id;
    const words = postedWords(kind, text);
    if (!words) return false;
    // read fresh, the panel's board can be minutes old: an answer on a ticket a person moved on (reviewed, merged)
    // would start an agent on work that is done
    const card = (await b.prov.cards(ctxOf(b.prov), b.ref)).find(c => c.id === id);
    const now = card ? colOf(b.prov, { group: b.group }, card) : "";
    placed(b, id, now);
    if (now !== p.input) {
      say(t("pp.movedOn", { column: nameOf(b, p.input) }));
      return false;
    }
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
      say(
        t(!worker ? "pp.toPick" : startsNow(settings(), project) ? "pp.toPickFull" : "pp.toPickPaused", {
          project: name,
        }),
      );
    } else if (next === "stay") say(t("pp.stayManual", { project: name }));
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
    say(t("pl.error", { project: projectName(project), error: String((e as Error)?.message ?? e) }));
    return false;
  });
}

/** Pause a project's pipeline from its panel, or go on. `stop`: its running workers stop too (their tickets land with
 *  a person), else they finish their step. Going on starts a pass at once. Resolves with why it failed, else "". */
export async function pausePipeline(project: string, paused: boolean, stop = false) {
  const s = settings();
  const p = s.pipelines?.[project];
  if (!p) return "no pipeline";
  const failed = await saveMainSettings({ ...s, pipelines: { ...s.pipelines, [project]: { ...p, paused } } });
  if (failed) {
    toast(failed);
    return failed;
  }
  if (stop)
    await Promise.all(
      workersOf(allWorkers(), project)
        .filter(w => w.state === "running")
        .map(w => takeOver(w)),
    );
  if (!paused) runPipelines();
  return "";
}

/** Pause every pipeline at once, or go on (each one's own pause stays as it was). */
export async function pauseAllPipelines(paused: boolean) {
  const failed = await saveMainSettings({ ...settings(), pipelinesPaused: paused });
  if (failed) return toast(failed);
  if (!paused) runPipelines();
}

/** A new ticket on a pipeline's board, asked for in its conversation: in the pick column when `start` (an agent builds
 *  it, a hand-picked pipeline has none), else in the board's first column. Its number, link and column. */
export function createTicket(project: string, title: string, description: string, start: boolean) {
  return serial(async () => {
    const p = settings().pipelines?.[project];
    if (!p) throw new Error("this project has no pipeline");
    const b = await open(project, p);
    if (!b.prov.create) throw new Error(`${b.prov.name} boards cannot get a new ticket from Relay`);
    const column = start && !manual(p) ? p.pick : (b.columns[0]?.id ?? p.pick);
    const card = await b.prov.create(ctxOf(b.prov), b.ref, { title, description, column, group: b.group || undefined });
    const url = await b.prov.url(ctxOf(b.prov), b.ref, card.id).catch(() => "");
    return { number: card.number, url, column: nameOf(b, column) };
  });
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

type Board = { project: string; prov: BoardProvider; ref: BoardRef; group: string; columns: Column[]; p: Pipeline };

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
  return { project, prov, ref, group, columns, p };
}

async function runOne(project: string, p: Pipeline) {
  const b = await open(project, p);
  const { prov, ref, group } = b;
  const ctx = ctxOf(prov);

  // runs that ended: their ticket to review or to a person. First Relay's own steps on a fact it found itself, once
  // per worker: a push that failed on something passing goes once more, an agent that ended its turn without a report
  // is asked for one
  for (const w of workersOf(allWorkers(), project)) {
    const s = step(w);
    if (!s) continue;
    if (pushAgain(w) && !tried.has(`push:${w.key}`)) {
      tried.add(`push:${w.key}`);
      const again = await backend.orchRepublish(w.key).catch(() => null);
      note(
        project,
        `${refOf(w)}: its push failed (${w.pr_error}), Relay tried once more: ${again ? "it went through" : "it failed again"}`,
      );
      const next = again && step(again);
      if (next) {
        adopt(again);
        await land(b, again, next);
        continue;
      }
    }
    if (w.state === "silent" && !tried.has(`report:${w.key}`)) {
      tried.add(`report:${w.key}`);
      await backend.orchAskReport(w.key);
      adopt({ ...w, state: "running", ended: null });
      note(project, `${refOf(w)}: its agent ended its turn without a report, Relay asked it for one`);
      continue;
    }
    await land(b, w, s);
  }
  // the board once per pass, also for a hand-picked pipeline: where each worker's ticket really is, for the panel and
  // for what a person did with it. The runner's own moves after this read are kept in the store too (move), so the
  // pick column below reads a ticket it just moved where it put it
  const cards = await prov.cards(ctx, ref);
  const read = (card: Card) => colOf(prov, { group }, card);
  keepColumns(b, cards, read);
  const col = (card: Card) => usePipelineStore.getState().columns[project]?.of[card.id] ?? read(card);
  // tickets a person took on from the agent: merged or done, the worker is through; in review, its PR is followed
  for (const w of panelTickets(allWorkers(), project)) {
    const column = b.columns.find(c => c.id === usePipelineStore.getState().columns[project]?.of[ticketOf(w)!.card]);
    const what = boardMove(w, p, column);
    if (what === "merged") {
      adopt(await backend.orchBoard(w.key, "merged"));
      note(project, `${refOf(w)}: a person moved it to ${column!.name}, Relay closed it in the pipeline`);
    } else if (what === "adopt" && adoptDue(lookedUp[w.key], Date.now())) {
      const found = await backend.orchAdopt(w.key).catch(() => null);
      // no PR on its branch yet: asked again after a while, not every pass
      if (found) delete lookedUp[w.key];
      else lookedUp[w.key] = Date.now();
      adopt(found);
      if (found)
        note(
          project,
          `${refOf(w)}: a person moved it to ${column!.name}, Relay follows its PR now (${prsOf(found).join(", ")})`,
        );
    }
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
      note(project, `${refOf(w)}: its PR was merged${p.merged ? `, Relay moved it to ${nameOf(b, p.merged)}` : ""}`);
    } else if (r.kind === "closed") {
      await move(b, id, p.input);
      await comment(b, id, t("pl.closed", { pr: links }));
      adopt(await backend.orchBoard(w.key, "closed"));
      note(project, `${refOf(w)}: its PR was closed without a merge, Relay moved it to ${nameOf(b, p.input)}`);
    } else if (startsNow(settings(), project)) {
      // review comments start the worker again: that waits while paused (also when paused during this pass), the
      // comments are read again from the run's end once the pipeline goes on. The ticket text stays, unless someone
      // changed the ticket meanwhile (a ticket that cannot be read stays too)
      const view = await viewOf(b, id).catch(() => null);
      const text = fill(prompts.pipeline.reviewComments, { pr: prsOf(w).join(", "), text: r.text });
      await sendWorker(w, text, view && retask(w.task, view, w.at));
      await move(b, id, p.busy);
      await comment(b, id, t("pl.feedback"));
      note(project, `${refOf(w)}: review comments on its PR, Relay sent them to its agent`);
    }
  }
  // the pick column: tickets moved back go to their worker again, new ones get a worker while there is room
  if (manual(p)) return;
  const mine = workersOf(allWorkers(), project);
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
    note(project, `${refOf(worker)}: moved back to the pick column, its agent picks it up again`);
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
    if (!hand) note(project, `${refOf(w)}: picked up from ${nameOf(b, b.p.pick)}, an agent started on it`);
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

/** Where each ticket with a pipeline worker is on the board, for the panel: "" for one that is not on it. */
function keepColumns(b: Board, cards: Card[], col: (c: Card) => string) {
  const at = new Map(cards.map(c => [c.id, col(c)]));
  const of = Object.fromEntries(
    workersOf(allWorkers(), b.project).map(w => [ticketOf(w)!.card, at.get(ticketOf(w)!.card) ?? ""]),
  );
  const names = Object.fromEntries(b.columns.map(c => [c.id, c.name]));
  usePipelineStore.setState(draft => {
    draft.columns[b.project] = { at: Date.now(), of, names };
  });
}
/** A ticket's column as Relay just found or put it, once the board was read for the panel. */
function placed(b: Board, id: string, column: string) {
  if (usePipelineStore.getState().columns[b.project])
    usePipelineStore.setState(draft => {
      draft.columns[b.project].of[id] = column;
    });
}

/** The ticket's detail as the ticket window shows it, null for a provider without one. */
const viewOf = async (b: Board, id: string) =>
  b.prov.detail ? b.prov.detail.view(await b.prov.detail.fetch(ctxOf(b.prov), b.ref, id)) : null;
const nameOf = (b: Board, id: string) => b.columns.find(c => c.id === id)?.name ?? id;
// the providers move and comment by the card's id alone
async function move(b: Board, id: string, to: string) {
  await b.prov.move(ctxOf(b.prov), b.ref, { id } as Card, to, b.group);
  placed(b, id, to);
}
async function comment(b: Board, id: string, value: string) {
  if (value && b.prov.detail?.act)
    await b.prov.detail.act(ctxOf(b.prov), b.ref, id, "comment", { value, files: [], hidden: b.p.hidden !== false });
}
