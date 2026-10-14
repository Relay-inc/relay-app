import { fill, prompts } from "../../shared/prompts";
import type { BoardProvider, BoardRef, Card, Column } from "../../domain/board/types";
import { colOf } from "../../domain/board/rules";
import type { Worker } from "../../domain/orchestrator/types";
import {
  bare,
  briefOf,
  buildState,
  inReview,
  manual,
  picks,
  pipelineAt,
  PREFLIGHT_PROMPT,
  preflightOf,
  ready,
  review,
  stalled,
  step,
  usedUp,
  ticketOf,
  workersOf,
} from "../../domain/pipeline/rules";
import type { Pipeline, Step, Ticket } from "../../domain/pipeline/types";
import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { provider as providerOf } from "../../shared/plugins";
import { ctxOf } from "../board/ctx";
import { toast } from "../navigation/navigation";
import { onOrchEvent } from "../orchestrator/orchestrator";
import { useOrchestratorStore } from "../orchestrator/store";
import { settings } from "../settings/settings";

// The board pipeline, while the app runs: every few minutes and when a pipeline worker changes, per switched-on
// pipeline (settings.pipelines): put ended runs on the board, follow the PRs in review, start on the tickets in the
// pick column (unless it is hand-picked: then only the tickets started from the ticket window, see buildTicket). The
// board is the record: a ticket is claimed by moving it, so a second runner never takes it too.

// passes and hand-picked starts run one after the other, so a ticket is never claimed by both
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
};
let queued = false;
const lastError: Record<string, string> = {};
// why a pipeline takes no new tickets right now, so it is said once and not every five minutes
const holding: Record<string, string> = {};
function hold(project: string, why: "" | "pl.usedUp" | "pl.stalled") {
  if (why && holding[project] !== why) toast(t(why, { project }));
  holding[project] = why;
}

/** One pass over every pipeline. Calls while one waits to start make no second one. */
export function runPipelines() {
  if (queued) return;
  queued = true;
  return serial(async () => {
    queued = false;
    for (const [project, p] of Object.entries(settings().pipelines ?? {})) {
      if (!ready(p)) continue;
      try {
        await runOne(project, p);
        delete lastError[project];
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        // once per new error, not every five minutes
        if (lastError[project] !== msg) toast(t("pl.error", { project, error: msg }));
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

/** The backend's `orch` event: a pipeline worker that stopped running is put on the board right away. */
export function onPipelineWorker(w: Worker) {
  if (ticketOf(w) && w.state !== "running") runPipelines();
}

/** A ticket's or a PR's page, from a pipeline worker on the workers board. */
export const openPipelineLink = (url: string) => url.startsWith("https://") && backend.openUrl(url);

// what the backend answered, in the store now: its `orch` event comes later, and the next pass must not count a new
// worker as missing (a second claim) or a worker sent feedback as still in review (the feedback twice)
const adopt = (w: Worker | null) => w && onOrchEvent({ type: "worker", worker: w });
async function sendWorker(w: Worker, text: string) {
  await backend.orchMessage(w.key, text);
  adopt({ ...w, state: "running", ended: null });
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
    const pr = await backend.orchPr(w.key).catch(() => null);
    const r = pr && review(pr, w.ended ?? 0);
    if (!r) continue;
    const id = ticketOf(w)!.card;
    if (r.kind === "merged") {
      if (p.merged) await move(b, id, p.merged);
      await comment(b, id, t("pl.merged", { pr: w.pr ?? "" }));
      adopt(await backend.orchBoard(w.key, "merged"));
    } else if (r.kind === "closed") {
      await move(b, id, p.input);
      await comment(b, id, t("pl.closed", { pr: w.pr ?? "" }));
      adopt(await backend.orchBoard(w.key, "closed"));
    } else {
      await sendWorker(w, fill(prompts.pipeline.reviewComments, { pr: String(w.pr), text: r.text }));
      await move(b, id, p.busy);
      await comment(b, id, t("pl.feedback"));
    }
  }
  // the pick column: tickets moved back go to their worker again, new ones get a worker while there is room
  if (manual(p)) return;
  const cards = await prov.cards(ctx, ref);
  const mine = workersOf(allWorkers(), project);
  const { fresh, resume: back } = picks(cards, card => colOf(prov, { group }, card), p, mine);
  let room = Math.max(1, p.parallel) - mine.filter(w => w.state === "running").length;
  if (room <= 0 || (!fresh.length && !back.length)) return;
  // a run on a spent plan would only stall: wait until the limits read again
  if (usedUp(await backend.usageLimits().catch(() => []), "claude")) return hold(project, "pl.usedUp");
  for (const { card, worker } of back) {
    if (room-- <= 0) return;
    await resume(b, card.id, worker, "The ticket was moved back to the pick column on the board.");
  }
  // runs keep ending without a PR: tickets moved back still go on (a person looked at them), new ones wait
  if (stalled(workersOf(allWorkers(), project))) return hold(project, "pl.stalled");
  hold(project, "");
  for (const card of fresh) {
    if (room-- <= 0) return;
    await claim(b, project, card);
  }
}

/** A ticket an agent ran on before: back to building, the agent gets what is new on it since. */
async function resume(b: Board, id: string, worker: Worker, why: string) {
  await move(b, id, b.p.busy);
  const view = b.prov.detail ? b.prov.detail.view(await b.prov.detail.fetch(ctxOf(b.prov), b.ref, id)) : null;
  const news = view ? briefOf(view, worker.ended ?? 0) : "";
  await sendWorker(worker, fill(prompts.pipeline.resume, { why, news }));
  await comment(b, id, t("pl.resumed"));
}

/** A new ticket: moved to busy first (the claim), then a worker with the ticket as its brief. A ticket from the pick
 *  column with nothing in it, or that the pre-flight finds unclear, goes to a person instead; one you start yourself
 *  (`hand`) is your call. */
async function claim(b: Board, project: string, card: Card, hand = false) {
  const ctx = ctxOf(b.prov);
  await move(b, card.id, b.p.busy);
  try {
    const view = b.prov.detail ? b.prov.detail.view(await b.prov.detail.fetch(ctx, b.ref, card.id)) : null;
    if (!hand && view && bare(view)) {
      await move(b, card.id, b.p.input);
      return await comment(b, card.id, t("pl.notReady", { column: nameOf(b, b.p.pick) }));
    }
    // plan mode asks its questions with the plan, and a ticket you start yourself is your call
    if (!hand && view && !b.p.plan) {
      const verdict = preflightOf(await backend.aiWrite(PREFLIGHT_PROMPT, briefOf(view)).catch(() => ""));
      if (verdict && !verdict.clear) {
        await move(b, card.id, b.p.input);
        const questions = verdict.questions.map(q => `- ${q}`).join("\n");
        return await comment(b, card.id, t("pl.unclear", { questions, column: nameOf(b, b.p.pick) }));
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
    const task = view ? briefOf(view) : `Ticket #${card.number} "${card.title}"\n${url}`;
    const w = await backend.orchDispatchTicket({
      title: card.title,
      task,
      project,
      repo: b.p.repo,
      base: b.p.base,
      ticket,
      validate: { checks: b.p.checks ?? "", review: b.p.reviewer ?? "", rounds: b.p.rounds ?? 3 },
      plan: !!b.p.plan,
    });
    adopt(w);
    await comment(b, card.id, t("pl.picked", { branch: w.branch ?? "" }));
  } catch (e) {
    // back in front of a person, with why: the pick column would only try it again
    await move(b, card.id, b.p.input);
    await comment(b, card.id, t("pl.startFailed", { error: String((e as Error)?.message ?? e) }));
  }
}

/** An ended run on the board: the move, a comment with what happened, and the mark so it happens once. */
async function land(b: Board, w: Worker, s: Step) {
  const id = ticketOf(w)!.card;
  const summary = (w.report?.summary ?? "").slice(0, 3000);
  const text = {
    // a later done on the same PR: the branch was pushed again
    pr: () => t(w.board?.startsWith("done:") ? "pl.prUpdated" : "pl.pr", { pr: w.pr ?? "", summary }),
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

const nameOf = (b: Board, id: string) => b.columns.find(c => c.id === id)?.name ?? id;
// the providers move and comment by the card's id alone
const move = (b: Board, id: string, to: string) => b.prov.move(ctxOf(b.prov), b.ref, { id } as Card, to, b.group);
async function comment(b: Board, id: string, value: string) {
  if (value && b.prov.detail?.act)
    await b.prov.detail.act(ctxOf(b.prov), b.ref, id, "comment", { value, files: [], hidden: b.p.hidden !== false });
}
