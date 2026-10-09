import { provider } from "../../shared/plugins";
import { byDue, myCardToday, type TodayCard } from "../../domain/today/rules";
import { NO_PROJECT, inContext, plan, slots, type Kind } from "../../domain/today/plan";
import { entries as deriveEntries, queueOf, KINDS } from "../../domain/today/kinds";
import { DAY, startOfDay } from "../../domain/today/kinds/common";
import type { Entry } from "../../domain/today/kinds/types";
import { todayIso } from "../../domain/reminders/rules";
import { WAIT } from "../../domain/navigation/views";
import { select } from "../navigation/navigation";
import type { Reminder } from "../../domain/reminders/types";
import type { PR } from "../../domain/pull-requests/types";
import { settings } from "../settings/settings";
import { useBoardStore } from "../board/store";
import { ctxOf } from "../board/ctx";
import { openCard } from "../navigation/panel";
import { contextTint } from "../navigation/sidebar";
import { contexts, project as projectOf, projectLabel, loadSnapshot } from "../workspace/vault";
import { useWorkspaceStore } from "../workspace/store";
import { useCalendarStore } from "../calendar/store";
import { loadMeetings } from "../calendar/calendar";
import { loadPrs } from "../pull-requests/prs";
import { usePullRequestsStore } from "../pull-requests/store";
import { useReviewStore } from "./review";
import { loadMails } from "../mail/mail";
import { mailOn, timeFromSessionsOn } from "../settings/settings";
import { loadTodayTime } from "../time/time";
import { forgetDetails } from "./load";
import { reminderAction } from "../reminders/reminders";
import { changeDay, setContext, setSnooze, useTodayStore, type TodayState } from "./store";
import { linkPrs, ticketOf } from "./links";
import { snapshot, words } from "./snapshot";

// Today: one queue of everything that needs the user, planned into the free time between today's meetings
// (domain/today/plan.ts). The kinds of item are modules in domain/today/kinds; this module reads the stores into a
// snapshot for them (snapshot.ts), orders and plans what they give, and keeps what the user did with the queue. What
// an item does when it is run is in actions.ts.
// ---------- the cards, read from every board linked to a vault project (settings.boards): on boot, every 5 minutes,
// when Today opens and when a ticket closes.
// ponytail: one cards() call per linked board, and a board no vault project links to is not read. A provider's own
// "my tasks" call (Productive has one) would make it one call per tracker.
let gen = 0;
export async function loadTodayCards() {
  const mine = ++gen;
  const ready = useBoardStore.getState().ready;
  const today = todayIso();
  const errors: string[] = [];
  const open: TodayState["boards"] = {};
  const lists = await Promise.all(
    Object.entries(settings().boards || {}).map(async ([project, ref]): Promise<TodayCard[]> => {
      const tracker = provider(ref.provider);
      if (!tracker || !ready.includes(tracker.id)) return [];
      try {
        const cards = await tracker.cards(ctxOf(tracker), ref);
        open[project] = { provider: tracker.id, ref, cards };
        return cards
          .filter(card => myCardToday(card, today))
          .map(card => ({ provider: tracker.id, ref, project, card }));
      } catch (error) {
        errors.push(`${projectLabel(project)}: ${String(error).slice(0, 120)}`);
        return [];
      }
    }),
  );
  if (mine !== gen) return; // a later load is on its way
  useTodayStore.setState(draft => {
    // one card once, also when two vault projects point at the same board (older settings)
    draft.cards = [...new Map(lists.flat().map(item => [`${item.provider}:${item.card.id}`, item])).values()].sort(
      byDue,
    );
    draft.boards = open;
    draft.errors = errors;
    draft.at = Date.now();
  });
  linkPrs(); // the boards' cards are in: which ticket each PR is about
}

/** Refresh: every source Today reads, at once (they also refresh by themselves every few minutes). */
export async function refreshToday() {
  if (useTodayStore.getState().reloading) return;
  useTodayStore.setState(draft => {
    draft.reloading = true;
  });
  forgetDetails();
  await Promise.allSettled([
    loadTodayCards(),
    loadMeetings(),
    loadPrs(),
    loadSnapshot(),
    loadTodayTime(),
    mailOn() ? loadMails() : null,
  ]);
  useTodayStore.setState(draft => {
    draft.reloading = false;
  });
  linkPrs();
}

// ---------- snooze: an item off Today until a later day, kept across days
const asleep = (id: string) => {
  const snooze = useTodayStore.getState().snoozed[id];
  return !!snooze && snooze.until > todayIso();
};
/** Snooze for `days` (a week by default): a reminder is pushed in the vault, anything else stays off Today until then. */
export async function snooze(entry: Entry, days = 7) {
  // a reminder moves in the vault; it is kept as snoozed too, so Today lists it and does not count it as cleared
  const reminder = entry.subject.type === "reminder" ? entry.subject.reminder : null;
  setSnooze(entry.id, {
    until: todayIso(days),
    title: entry.title,
    kind: entry.kind,
    project: entry.project,
    ...(reminder ? { reminder: reminder.text } : {}),
  });
  if (reminder) await reminderAction(reminder, "push", days === 7 ? "+1w" : todayIso(days));
  useTodayStore.setState(draft => {
    draft.selected = "";
  });
}
/** The snooze menu: tomorrow, next Monday, a week from now, as days from today. */
export function snoozeOptions(now = Date.now()) {
  const day = new Date(now).getDay(); // 0 Sunday
  return [
    { id: "tomorrow", days: 1 },
    { id: "monday", days: (8 - day) % 7 || 7 },
    { id: "week", days: 7 },
  ] as const;
}
/** Back on Today now. */
export async function wake(id: string) {
  const text = useTodayStore.getState().snoozed[id]?.reminder;
  setSnooze(id, null);
  // a snoozed reminder is back today in the vault too
  const reminder = text
    ? (useWorkspaceStore.getState().snap.reminders as Reminder[]).find(r => r.text === text)
    : undefined;
  if (reminder) await reminderAction(reminder, "push", todayIso());
}

// ---------- the items
export type { Entry, Subject } from "../../domain/today/kinds/types";

/** Everything that needs the user today, unordered. `now` in ms. */
export const entries = (now = Date.now()): Entry[] => deriveEntries(snapshot(), words, now);

/** An item's project as Today shows it: its label (with its icon) and its context's tint; null without a project. */
export function projectChip(project: string | null) {
  if (!project) return null;
  const context = projectOf(project)?.context;
  return { label: projectLabel(project), tint: context ? contextTint(context) : "" };
}

/** Today's meetings, for the timeline and between the slots (the queue shows the ones not over). */
export function meetingsOfToday(now = Date.now()) {
  const midnight = startOfDay(now);
  return useCalendarStore
    .getState()
    .list.filter(meeting => Date.parse(meeting.start) < midnight + DAY && Date.parse(meeting.end) > midnight);
}

/** Today as a whole: the queue in order, the slots, where each item is planned, and how far the day got. */
export function todayModel(now = Date.now()) {
  const state = useTodayStore.getState();
  // the context filter decides what is planned too: Antenna's queue fills the day on its own
  const every = entries(now);
  const contextOf = (entry: Entry) => projectOf(entry.project)?.context;
  const all = every.filter(entry => inContext(state.context, contextOf(entry)));
  const counts = new Map<string, number>();
  for (const entry of every) {
    const id = contextOf(entry) ?? NO_PROJECT;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const queue = queueOf(all, state.later);
  const meetings = meetingsOfToday(now);
  const dayEnd = new Date(now).setHours(18, 0, 0, 0);
  const free = slots(
    meetings.map(meeting => ({ id: meeting.id, start: Date.parse(meeting.start), end: Date.parse(meeting.end) })),
    now,
    dayEnd,
  );
  const { placed, tomorrow, used } = plan(queue, free, state.pins);
  const current = new Set(queue.map(entry => entry.id));
  // cleared: in the queue earlier today and gone since, not snoozed (it comes back), not hidden by the context filter
  const everyId = new Set(every.map(entry => entry.id));
  const gone = state.seen.filter(
    id =>
      !current.has(id) &&
      !everyId.has(id) &&
      !asleep(id) &&
      // the day's time to book left because Time from sessions was switched off, not because it was booked
      !(id.startsWith("time:") && !timeFromSessionsOn()) &&
      inContext(state.context, projectOf(state.log[id]?.project ?? null)?.context),
  );
  const cleared = gone.length;
  // what left the queue today, newest first: by hand (it can come back) or because it was done where it lives
  const done = gone.reverse().map(id => ({
    id,
    title: state.log[id]?.title ?? id,
    kind: state.log[id]?.kind,
    reopen: state.dismissed.includes(id),
  }));
  const selected = queue.find(entry => entry.id === state.selected) ?? queue[0];
  return {
    queue,
    meetings,
    slots: free,
    placed,
    tomorrow,
    used,
    selected,
    cleared,
    done,
    // the filter's chips: every context of the vault and the items without a project, with how many each has
    contexts: [
      { id: "", n: every.length },
      ...contexts().map(id => ({ id, n: counts.get(id) ?? 0 })),
      { id: NO_PROJECT, n: counts.get(NO_PROJECT) ?? 0 },
    ],
    context: state.context,
    // per meeting the item a click on it opens: its prep before it, its note after it (filter or not)
    meetingItems: Object.fromEntries(
      every.flatMap(entry => (entry.subject.type === "meeting" ? [[entry.subject.meeting.id, entry.id] as const] : [])),
    ) as Record<string, string>,
    // snoozed and not back yet, soonest first
    snoozed: Object.entries(state.snoozed)
      .filter(
        ([, item]) => item.until > todayIso() && inContext(state.context, projectOf(item.project ?? null)?.context),
      )
      .sort((a, b) => a[1].until.localeCompare(b[1].until))
      .map(([id, item]) => ({ id, ...item })),
    total: cleared + queue.length,
    planned: queue.reduce((sum, entry) => sum + (placed[entry.id] ? entry.est : 0), 0),
    now,
  };
}
export type TodayModel = ReturnType<typeof todayModel>;

/** Remember what is in the queue now, and what it is called, so what leaves it today counts as cleared and Done
 *  today can still name it. */
export function noteSeen(items: { id: string; title: string; kind: Kind; project: string | null }[]) {
  const { seen, log } = useTodayStore.getState();
  const fresh = items.filter(item => !seen.includes(item.id) || log[item.id]?.title !== item.title);
  if (fresh.length)
    changeDay(day => {
      for (const item of fresh) {
        if (!day.seen.includes(item.id)) day.seen.push(item.id);
        day.log[item.id] = { title: item.title, kind: item.kind, project: item.project };
      }
    });
}
/** Back in the queue: something taken off by hand on Today. */
export const reopen = (id: string) =>
  changeDay(day => {
    day.dismissed = day.dismissed.filter(x => x !== id);
  });

/** The ticket a PR is about: its item when it is under Today (switching the filter back to All when it hides it),
 *  else the ticket window on it. */
export function openTicketOf(pr: PR) {
  const link = ticketOf(pr.url);
  if (!link?.card || !link.provider) return;
  const id = `card:${link.provider}:${link.card}`;
  const item = entries().find(entry => entry.id === id);
  if (item) {
    if (!inContext(useTodayStore.getState().context, projectOf(item.project)?.context)) setContext("");
    return selectEntry(id);
  }
  const board = pr.project ? useTodayStore.getState().boards[pr.project] : undefined;
  const tracker = provider(link.provider);
  if (board && tracker) openCard(tracker, board.ref, link.card);
}
/** A meeting clicked in the day's track or the queue: its prep before it, its note after it. When the context filter
 *  hides that item, Today shows all again. False when the meeting has neither (running, or its note was skipped). */
export function openMeeting(meetingId: string) {
  const item = entries().find(entry => entry.subject.type === "meeting" && entry.subject.meeting.id === meetingId);
  if (!item) return false;
  if (!inContext(useTodayStore.getState().context, projectOf(item.project)?.context)) setContext("");
  selectEntry(item.id);
  return true;
}
/** Cmd-K picked a meeting: Today, with its prep or note open when it has one. */
export async function openFoundMeeting(meetingId: string) {
  await select(WAIT);
  openMeeting(meetingId);
}
/** The Today item a review covers (a group's id is its item's id). */
export function reviewItemsOf(id: string): Entry[] {
  const queued = entries().filter(entry => entry.id === id);
  if (queued.length) return queued;
  // a review of PRs Today does not queue (your own, with green checks): the same item, made from the open PRs it was
  // started on
  const urls = new Set(useReviewStore.getState().reviews[id]?.prs.map(pr => pr.url));
  const list = usePullRequestsStore.getState().list;
  const prs = [...(list?.review ?? []), ...(list?.mine ?? [])].filter(pr => urls.delete(pr.url));
  if (!prs.length) return [];
  return deriveEntries({ ...snapshot(), prs: { review: prs, mine: [] } }, words, Date.now()).filter(
    entry => entry.id === id,
  );
}
/** Open an item under Today, also when the context filter hides it (it goes back to All). */
export function focusEntry(id: string) {
  const item = entries().find(entry => entry.id === id);
  if (item && !inContext(useTodayStore.getState().context, projectOf(item.project)?.context)) setContext("");
  selectEntry(id);
}
export const selectEntry = (id: string) =>
  useTodayStore.setState(draft => {
    draft.selected = id;
  });
export const dismiss = (id: string) =>
  changeDay(day => {
    if (!day.dismissed.includes(id)) day.dismissed.push(id);
  });
/** Later: to the end of the queue. */
export const putOff = (id: string) =>
  changeDay(day => {
    day.later = [...day.later.filter(x => x !== id), id];
    useTodayStore.setState(draft => {
      draft.selected = "";
    });
  });
/** When: plan the item in another slot ("tomorrow" for tomorrow). A reminder moved to tomorrow is pushed in the vault. */
export async function moveTo(entry: Entry, slot: string) {
  if (slot === "tomorrow" && entry.subject.type === "reminder")
    return reminderAction(entry.subject.reminder, "push", "morgen");
  changeDay(day => {
    day.pins[entry.id] = slot;
  });
}

/** The line in the title bar and the sidebar's count: what is in the queue besides agents and sessions waiting. */
export const todayRest = (now = Date.now()) => entries(now).filter(entry => !KINDS[entry.kind].waits).length;
