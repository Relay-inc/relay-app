import type { Key } from "../../../shared/i18n";
import { doingFirst, ordered, statusOf, type Kind } from "../plan.ts";
import { ask } from "./ask.ts";
import { blocked } from "./blocked.ts";
import { card } from "./card.ts";
import { chat } from "./chat.ts";
import { mail } from "./mail.ts";
import { meeting } from "./meeting.ts";
import { pr } from "./pr.ts";
import { reminder } from "./reminder.ts";
import { time } from "./time.ts";
import type {
  ActionSet,
  Draft,
  Entry,
  EntryOf,
  Flags,
  KindInfo,
  Snapshot,
  SubjectDef,
  SubjectType,
  Words,
} from "./types.ts";

// The registry: one module per subject, in the order their entries are collected. A new kind is a module here, a
// line in `SUBJECTS`, its name in `Kind` (domain/today/plan.ts) and, in the layers above, its actions' runner
// (application/today/actions.ts) and its detail section (ui/features/today/sections).

export const SUBJECTS: { [T in SubjectType]: SubjectDef<T> } = {
  ask,
  blocked,
  meeting,
  reminder,
  card,
  pr,
  mail,
  chat,
  time,
};
type Def = SubjectDef<SubjectType>;
const defs = Object.entries(SUBJECTS) as [SubjectType, Def][];

/** Every kind with what the queue knows about it, and the subject it belongs to. */
export const KINDS = Object.fromEntries(
  defs.flatMap(([type, def]) => Object.entries(def.kinds).map(([kind, info]) => [kind, { ...info, type }])),
) as Record<Kind, KindInfo & { type: SubjectType }>;

/** An item's rank: its kind's, and for a reminder or card that is overdue one step earlier than the rest. */
export const rankOf = (kind: Kind, late = false) => KINDS[kind].rank - (late ? 2.5 : 0);

/** What an agent needs the user for, in this order on top of Today. */
export const AGENT_KINDS: Kind[] = ["ask", "blocked", "finished"];
export const isAgentItem = (entry: { kind: Kind }) => AGENT_KINDS.includes(entry.kind);

const toEntry = (draft: Draft, snap: Snapshot): Entry => {
  const { late, times, ...entry } = draft;
  return {
    ...entry,
    rank: rankOf(draft.kind, late),
    est: KINDS[draft.kind].est * (times ?? 1),
    // a card's status is its tracker's; anything else is in progress once the user said so
    status: statusOf(draft.id, (SUBJECTS[draft.subject.type] as Def).state?.(draft.subject), snap.doing),
  };
};
const asleep = (snap: Snapshot, id: string) => {
  const snooze = snap.snoozed[id];
  return !!snooze && snooze.until > snap.today;
};

/** Everything that needs the user today, unordered, without what was taken off Today or snoozed. `now` in ms. */
export function entries(snap: Snapshot, w: Words, now: number): Entry[] {
  return defs
    .flatMap(([, def]) => def.entries(snap, w, now))
    .map(draft => toEntry(draft, snap))
    .filter(entry => !snap.dismissed.includes(entry.id) && !asleep(snap, entry.id));
}

/** The queue in order: what an agent needs you for first (a decision, a blocked session, a result to read), then
 *  what is in progress, then the rest by rank, oldest first; what the user put off (`later`) at the end of each. */
export function queueOf(all: Entry[], later: string[]): Entry[] {
  const sorted = doingFirst(ordered(all, later) as Entry[], entry => entry.status);
  return [
    ...AGENT_KINDS.flatMap(kind => sorted.filter(entry => entry.kind === kind)),
    ...sorted.filter(entry => !isAgentItem(entry)),
  ];
}

/** The item's actions. */
export function actionsFor(entry: Entry, flags: Flags, w: Words): ActionSet {
  return (SUBJECTS[entry.subject.type] as SubjectDef<SubjectType>).actions(entry as EntryOf<SubjectType>, flags, w);
}

/** The kind chip over an item's title: `today.kind.<kind>` unless its subject says otherwise. */
export const kindLabelKey = (entry: Entry): Key =>
  (SUBJECTS[entry.subject.type] as SubjectDef<SubjectType>).labelKey?.(entry as EntryOf<SubjectType>) ??
  (`today.kind.${entry.kind}` as const);
