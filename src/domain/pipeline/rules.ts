import type { Card, CardView } from "../board/types";
import type { Worker } from "../orchestrator/types";
import type { Pipeline, PrStatus, Step, Ticket } from "./types";

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

/** Switched on and every field it cannot run without filled in. */
export const ready = (p: Pipeline | undefined): p is Pipeline =>
  !!p?.on && !!p.repo && !!p.pick && !!p.busy && !!p.review && !!p.input;

export const ticketOf = (w: Pick<Worker, "ticket">) => (w.ticket ?? null) as Ticket | null;

/** The pipeline's workers of a project, newest last (orch.json's order). */
export const workersOf = (workers: Worker[], project: string) => workers.filter(w => ticketOf(w)?.pipeline === project);

/** A ticket's last worker. */
export const lastWorker = (workers: Worker[], card: string) => workers.filter(w => ticketOf(w)?.card === card).pop();

/** The tickets to start on, best first: the ones in the pick column (with the label, when set) that have no running
 *  worker. `resume`: a ticket moved back after a worker ran on it, which that worker picks up again with its worktree. */
export function picks(cards: Card[], col: (c: Card) => string, p: Pipeline, workers: Worker[]) {
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
  if (w.state === "done") return w.pr ? { mark, to: "review", kind: "pr" } : { mark, to: "input", kind: "nopr" };
  if (w.state === "blocked") return { mark, to: "input", kind: "blocked" };
  return { mark, to: "input", kind: "failed" };
}

/** A worker whose PR waits for review: its done was put on the board, nothing came after. */
export const inReview = (w: Worker) => !!w.pr && w.state === "done" && w.board === `done:${w.ended}`;

const bot = (login: string | undefined) => !login || login.endsWith("[bot]") || login.toLowerCase().includes("copilot");
const after = (iso: string, since: number) => Date.parse(iso) > since;

/** What happened to a PR in review: merged, closed, or what people wrote on it since the worker's run ended (reviews
 *  that are not an approval, comments, line comments; bots left out, they would start a loop) as the next brief. */
export function review(
  pr: PrStatus,
  since: number,
): { kind: "merged" } | { kind: "closed" } | { kind: "feedback"; text: string } | null {
  if (pr.state === "MERGED") return { kind: "merged" };
  if (pr.state === "CLOSED") return { kind: "closed" };
  const reviews = pr.reviews.filter(
    r => after(r.submittedAt, since) && r.state !== "APPROVED" && r.state !== "DISMISSED" && !bot(r.author?.login),
  );
  const comments = pr.comments.filter(c => after(c.createdAt, since) && !bot(c.author?.login));
  const lines = pr.inline.filter(c => after(c.created_at, since) && !bot(c.user?.login));
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

/** The ticket as a brief: title, link, description, the comments (only the ones after `since`, for a worker that picks
 *  it up again) and the files' links. */
export function briefOf(v: CardView, since?: number) {
  const out = [`Ticket ${v.number ? `#${v.number} ` : ""}"${v.title}"`, v.url];
  const description = htmlText(v.description || "");
  if (since == null) out.push("", "Description:", description || "(none)");
  const feed = v.feed.filter(f => f.html && (since == null || Date.parse(f.at) > since));
  if (feed.length)
    out.push(
      "",
      since == null ? "Comments, oldest first:" : "New on the ticket:",
      ...feed.map(f => `- ${f.who} (${f.at}): ${htmlText(f.html)}`),
    );
  const files = [...(v.files ?? []), ...v.feed.flatMap(f => f.files)];
  if (files.length && since == null) out.push("", "Files:", ...files.map(f => `- ${f.name}: ${f.url}`));
  return out.join("\n");
}
