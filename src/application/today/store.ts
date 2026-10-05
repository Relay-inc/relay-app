import type { TodayCard } from "../../domain/today/rules";
import type { Kind } from "../../domain/today/plan";
import { todayIso } from "../../domain/reminders/rules";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** What the user did with today's queue, kept for the day: it starts empty the next morning. */
export type DayState = {
  day: string; // yyyy-mm-dd it is about
  seen: string[]; // every item that was in the queue today, so the ones gone since count as cleared
  dismissed: string[]; // taken off by hand: a meeting without a note, a prep skipped
  later: string[]; // put off with Later: at the end of the queue, in that order
  pins: Record<string, string>; // item → the slot it was moved to, or "tomorrow"
  doing: string[]; // set in progress on Today (a card's status lives in its tracker)
  log: Record<string, { title: string; kind: Kind; project?: string | null }>; // what each item was, so Done today names it and the context filter places it once it is gone
};
/** Snoozed items: until which day (yyyy-mm-dd) they stay off Today, and what they were, to list them. Kept across days. */
export type Snooze = { until: string; title: string; kind: Kind };
type TodayState = DayState & {
  snoozed: Record<string, Snooze>;
  cards: TodayCard[]; // the user's cards for today, from every board linked to a vault project
  errors: string[]; // per board that did not load
  at: number; // when the cards last arrived, ms; 0 before that
  reloading: boolean; // Refresh is reading every source again
  selected: string; // the item open in the detail, "" for the first in the queue
  context: string; // the context filter: "" all, "-" no project, else a context; kept across days
};

const fresh = (day: string): DayState => ({ day, seen: [], dismissed: [], later: [], pins: {}, doing: [], log: {} });
const stored = () => {
  const day = storage.get<DayState | null>("today", null);
  // a day kept by an older version lacks the newer fields
  return day && day.day === todayIso() ? { ...fresh(day.day), ...day } : fresh(todayIso());
};

export const useTodayStore = makeStore<TodayState>(() => ({
  ...stored(),
  // a snooze a month past its day is forgotten: the item came back long ago, or is gone
  snoozed: Object.fromEntries(
    Object.entries(storage.get<Record<string, Snooze>>("todaySnooze", {})).filter(
      ([, snooze]) => snooze.until > todayIso(-30),
    ),
  ),
  cards: [],
  errors: [],
  at: 0,
  reloading: false,
  selected: "",
  context: storage.getRaw("todayContext"),
}));

/** Change the day's state and keep it; past midnight it starts from an empty day first. */
export function changeDay(recipe: (day: DayState) => void) {
  useTodayStore.setState(draft => {
    if (draft.day !== todayIso()) Object.assign(draft, fresh(todayIso()));
    recipe(draft);
  });
  const { day, seen, dismissed, later, pins, doing, log } = useTodayStore.getState();
  storage.set("today", { day, seen, dismissed, later, pins, doing, log });
}

/** Snooze an item until a day, or wake it (null). */
export function setSnooze(id: string, snooze: Snooze | null) {
  useTodayStore.setState(draft => {
    if (snooze) draft.snoozed[id] = snooze;
    else delete draft.snoozed[id];
  });
  storage.set("todaySnooze", useTodayStore.getState().snoozed);
}

/** Show only one context's items under Today ("" all, "-" the ones without a project). */
export function setContext(context: string) {
  useTodayStore.setState(draft => {
    draft.context = context;
    draft.selected = "";
  });
  storage.setRaw("todayContext", context);
}
