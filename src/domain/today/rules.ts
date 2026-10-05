import type { BoardRef, Card } from "../board/types";
import type { Meeting } from "../calendar/types";
import type { PR, PRs } from "../pull-requests/types";

// The Today view: what needs the user (or someone waiting on them) today. The clock is an argument (`now`, epoch ms)
// and `today` a local yyyy-mm-dd, so the rules hold at any moment.

/** A card on one of the boards linked to a vault project, with where it came from. */
export type TodayCard = { provider: string; ref: BoardRef; project: string; card: Card };

/** Mine and not finished, and due today or earlier, or in progress (a card without a due date that is being worked on
 *  needs the user as much). */
export const myCardToday = (card: Card, today: string) =>
  !!card.me && card.state !== "done" && ((!!card.due && card.due <= today) || card.state === "doing");
/** Overdue first, then by due date (none last), then in board order. */
export const byDue = (a: TodayCard, b: TodayCard) =>
  (a.card.due ?? "9999").localeCompare(b.card.due ?? "9999") || a.card.placement - b.card.placement;

/** The meetings of the local day `now` falls in, split into the ones still to come (or running) and the ones that
 *  ended. `except` leaves out the ones already shown under Now. */
export function meetingsToday(list: Meeting[], now: number, except: ReadonlySet<string> = new Set()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const day = list.filter(meeting => {
    const at = Date.parse(meeting.start);
    return at >= start.getTime() && at < end.getTime() && !except.has(meeting.id);
  });
  const ended = (meeting: Meeting) => Date.parse(meeting.end) <= now;
  return { coming: day.filter(meeting => !ended(meeting)), past: day.filter(ended) };
}

const FAILED = new Set(["FAILURE", "ERROR"]);
/** The PRs waiting on the user: every review asked of them, and their own PRs with changes requested or failing CI.
 *  Their own PRs waiting on someone else's review are not here, the ball is with the reviewer. */
export function prsForMe(list: PRs | null): { review: PR[]; mine: PR[] } {
  if (!list) return { review: [], mine: [] };
  return {
    review: list.review,
    mine: list.mine.filter(pr => pr.review === "CHANGES_REQUESTED" || (!!pr.ci && FAILED.has(pr.ci))),
  };
}
