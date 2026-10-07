// The day under Today as one queue: everything that needs the user, in order of urgency, planned into the free time
// between today's meetings. Times are epoch ms; `now` is an argument so the rules hold at any moment.

/** What an item is, which decides its actions, its place in the queue and how long it takes. */
export type Kind =
  | "ask" // an agent asks a permission or a question
  | "blocked" // a background session in the terminal waits
  | "prep" // a meeting still to come: prepare it
  | "mail" // an unread mail from a person
  | "reminder"
  | "card" // a card of the user's on a linked board
  | "note" // a meeting that ended: its note
  | "review" // a pull request asks the user's review
  | "fix" // the user's own pull request: changes requested or checks red
  | "finished" // a conversation finished while the user was elsewhere
  | "capture"; // a closed conversation proposes updates to the vault

/** Minutes an item takes, per kind.
 *  ponytail: one guess per kind; a tracker's own estimate on the card would beat it once a provider gives one. */
export const EST: Record<Kind, number> = {
  ask: 2,
  blocked: 2,
  prep: 10,
  mail: 5,
  reminder: 15,
  card: 30,
  note: 10,
  review: 15,
  fix: 20,
  finished: 5,
  capture: 3,
};

/** An item in the queue. `rank` orders it (lower first), `by` is when it must be done (a meeting's prep: its start). */
export type Item = { id: string; kind: Kind; rank: number; at: number; est: number; by?: number };

// within a rank, the oldest or most overdue first (`at`), then by id so the order holds between reads
const RANK: Record<Kind, number> = {
  ask: 0,
  prep: 1,
  mail: 2,
  blocked: 3,
  reminder: 4,
  card: 4,
  note: 5,
  review: 6,
  fix: 7,
  finished: 8,
  capture: 5,
};
/** An item's rank: its kind's, and for a reminder or card that is overdue one step earlier than the rest. */
export const rankOf = (kind: Kind, late = false) => RANK[kind] - (late ? 2.5 : 0);

/** The queue: by rank, then oldest first; what the user put off (`later`) at the end, in the order they did it. */
export function ordered(items: Item[], later: string[]) {
  const sorted = [...items].sort((a, b) => a.rank - b.rank || a.at - b.at || a.id.localeCompare(b.id));
  const put = later.filter(id => sorted.some(item => item.id === id));
  return [...sorted.filter(item => !put.includes(item.id)), ...put.map(id => sorted.find(item => item.id === id)!)];
}

/** A meeting as the plan sees it: busy from start to end. */
export type Busy = { id: string; start: number; end: number };
/** Free time between meetings. `key` names it so a pin survives the clock moving on: "now" for the one the user is
 *  in, else the id of the meeting it follows. `after` is that meeting, null for the first. */
export type Slot = { key: string; start: number; end: number; after: string | null };

/** The free slots from now to the end of the day: between the meetings that are not over, and after the last one.
 *  The day ends at `dayEnd`, or an hour from now when that is later (an evening still has a slot). */
export function slots(meetings: Busy[], now: number, dayEnd: number): Slot[] {
  const end = Math.max(dayEnd, now + 3_600_000);
  const out: Slot[] = [];
  let cursor = now;
  let after: string | null = null;
  for (const meeting of [...meetings].filter(m => m.end > now).sort((a, b) => a.start - b.start)) {
    if (meeting.start > cursor) out.push({ key: after ?? "now", start: cursor, end: meeting.start, after });
    cursor = Math.max(cursor, meeting.end);
    after = meeting.id;
  }
  if (cursor < end) out.push({ key: after ?? "now", start: cursor, end, after });
  return out;
}

/** Where an item lands: its slot's key and its planned start. */
export type Placed = { slot: string; start: number };
/** The queue planned into the slots, in order: each item in the first slot from its pinned one on that still has
 *  room for it and ends before its `by` (a prep without that room: the first slot, late). An item pinned to
 *  "tomorrow" or that fits nowhere today is in `tomorrow`. */
export function plan(queue: Item[], free: Slot[], pins: Record<string, string>) {
  const used = free.map(slot => slot.start);
  const placed: Record<string, Placed> = {};
  const tomorrow: string[] = [];
  for (const item of queue) {
    const pin = pins[item.id];
    if (pin === "tomorrow") {
      tomorrow.push(item.id);
      continue;
    }
    const from = Math.max(
      0,
      free.findIndex(slot => slot.key === pin),
    );
    const est = item.est * 60_000;
    const j = free.findIndex(
      (slot, i) => i >= from && slot.end - used[i] >= est && (item.by === undefined || used[i] + est <= item.by),
    );
    // a prep with no room left before its meeting goes in the first slot anyway (late), never to tomorrow
    const at = j < 0 && item.by !== undefined && from < free.length ? from : j;
    if (at < 0) {
      tomorrow.push(item.id);
      continue;
    }
    placed[item.id] = { slot: free[at].key, start: used[at] };
    used[at] += est;
  }
  return { placed, tomorrow, used: Object.fromEntries(free.map((slot, i) => [slot.key, used[i] - slot.start])) };
}

/** Where an item stands. A card's comes from its tracker's workflow; the rest the user sets on Today. */
export type Status = "todo" | "doing" | "done";
/** An item's status: its tracker's state when it has one, else whether the user started it on Today. */
export const statusOf = (id: string, tracker: Status | undefined, doing: readonly string[]): Status =>
  tracker ?? (doing.includes(id) ? "doing" : "todo");
/** The queue with what is in progress first: that is what the user is on. */
export const doingFirst = <T extends { id: string }>(queue: T[], status: (item: T) => Status) => [
  ...queue.filter(item => status(item) === "doing"),
  ...queue.filter(item => status(item) !== "doing"),
];

/** The context filter: "" every item, NO_PROJECT the ones without a vault project, else the ones whose project is
 *  in that context. */
export const NO_PROJECT = "-";
export const inContext = (filter: string, context: string | undefined) =>
  !filter || (filter === NO_PROJECT ? !context : context === filter);
