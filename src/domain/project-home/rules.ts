import type { Card } from "../board/types";
import type { Tone } from "../buddy/rules";
import type { Kind } from "../today/plan";
import type { PRs } from "../pull-requests/types";
import { prsForMe } from "../today/rules.ts";

// What a project's home (an empty conversation) picks out of what the stores already hold: which items go in which
// card, in which order, how many. Pure: the application layer reads the stores and hands the lists in.

/** Rows a card shows at most. */
export const MAX_ROWS = 3;

/** The Today kinds that wait on the user for this project. Cards are not here: the Tickets card has them. */
const WAITING: Kind[] = ["ask", "blocked", "review", "fix"];

/** What waits on the user in this project, agents first (the queue's order), and how many there are in all. */
export function waitingOf<E extends { kind: Kind; project: string | null; rank: number; at: number }>(
  entries: E[],
  project: string,
) {
  const mine = entries
    .filter(entry => entry.project === project && WAITING.includes(entry.kind))
    .sort((a, b) => a.rank - b.rank || a.at - b.at);
  return { rows: mine.slice(0, MAX_ROWS), total: mine.length };
}

/** The user's open tickets on the project's board, the ones in progress first, then by due date, then board order. */
export function ticketsOf(cards: Card[]) {
  const mine = cards
    .filter(card => card.me && card.state !== "done")
    .sort(
      (a, b) =>
        Number(b.state === "doing") - Number(a.state === "doing") ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        a.placement - b.placement,
    );
  return { rows: mine.slice(0, MAX_ROWS), total: mine.length };
}

/** The builds that call for a look: failed ones, then running ones (the list comes failed first already). */
export const buildsToShow = <B extends { tone: Tone }>(builds: B[]) =>
  builds.filter(build => build.tone === "fail" || build.tone === "busy").slice(0, MAX_ROWS);

/** The project's open PRs (the ones to review and the user's own) and how many of them wait on the user. */
export function prsOf(list: PRs | null, project: string) {
  if (!list) return { open: 0, waiting: 0 };
  const mine = {
    review: list.review.filter(pr => pr.project === project),
    mine: list.mine.filter(pr => pr.project === project),
  };
  const waiting = prsForMe(mine);
  return { open: mine.review.length + mine.mine.length, waiting: waiting.review.length + waiting.mine.length };
}
