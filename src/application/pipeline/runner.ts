import type { BoardProvider, BoardRef, Card, Column } from "../../domain/board/types";
import { colOf } from "../../domain/board/rules";
import type { Worker } from "../../domain/orchestrator/types";
import { briefOf, inReview, picks, ready, review, step, ticketOf, workersOf } from "../../domain/pipeline/rules";
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
// pick column. The board is the record: a ticket is claimed by moving it, so a second runner never takes it too.

let busy = false;
let again = false;
const lastError: Record<string, string> = {};

/** One pass over every pipeline. A call while one runs makes it run once more after. */
export async function runPipelines() {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
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
    } while (again);
  } finally {
    busy = false;
  }
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

async function runOne(project: string, p: Pipeline) {
  const ref = settings().boards?.[project];
  if (!ref) throw new Error(t("pl.noBoard"));
  const prov = providerOf(ref.provider);
  if (!prov) throw new Error(ref.provider);
  const ctx = ctxOf(prov);
  const group = p.group || prov.groupings?.[0].id || "";
  const columns = await prov.columns(ctx, ref, group);
  for (const id of [p.pick, p.busy, p.review, p.input, p.merged].filter(Boolean))
    if (!columns.some(c => c.id === id)) throw new Error(t("pl.noColumn"));
  const b: Board = { prov, ref, group, columns, p };

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
      await sendWorker(
        w,
        `Review comments on your PR ${w.pr}:\n\n${r.text}\n\nWork them in, commit on the same branch and report again: Relay pushes, the PR follows.`,
      );
      await move(b, id, p.busy);
      await comment(b, id, t("pl.feedback"));
    }
  }
  // the pick column: tickets moved back go to their worker again, new ones get a worker while there is room
  const cards = await prov.cards(ctx, ref);
  const mine = workersOf(allWorkers(), project);
  const { fresh, resume } = picks(cards, card => colOf(prov, { group }, card), p, mine);
  let room = Math.max(1, p.parallel) - mine.filter(w => w.state === "running").length;
  for (const { card, worker } of resume) {
    if (room-- <= 0) return;
    await move(b, card.id, p.busy);
    const view = prov.detail ? prov.detail.view(await prov.detail.fetch(ctx, ref, card.id)) : null;
    const news = view ? briefOf(view, worker.ended ?? 0) : "";
    await sendWorker(
      worker,
      `The ticket was moved back to the pick column on the board.\n\n${news}\n\nContinue from where you are, on the same branch, and report again.`,
    );
    await comment(b, card.id, t("pl.resumed"));
  }
  for (const card of fresh) {
    if (room-- <= 0) return;
    await claim(b, project, card);
  }
}

/** A new ticket: moved to busy first (the claim), then a worker with the ticket as its brief. */
async function claim(b: Board, project: string, card: Card) {
  const ctx = ctxOf(b.prov);
  await move(b, card.id, b.p.busy);
  try {
    const view = b.prov.detail ? b.prov.detail.view(await b.prov.detail.fetch(ctx, b.ref, card.id)) : null;
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
    blocked: () => t("pl.blocked", { questions: w.report?.questions ?? summary, column: nameOf(b, b.p.pick) }),
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
  if (value && b.prov.detail?.act) await b.prov.detail.act(ctxOf(b.prov), b.ref, id, "comment", { value, files: [] });
}
