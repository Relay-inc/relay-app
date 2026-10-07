import type { Key, PluralBase } from "../../../shared/i18n";
import type { Translate } from "../../conversations/state";
import type { AgentSession, Pending } from "../../conversations/types";
import type { Meeting } from "../../calendar/types";
import type { Mail } from "../../mail/types";
import type { PR, PRs } from "../../pull-requests/types";
import type { Reminder } from "../../reminders/types";
import type { Capture } from "../capture";
import type { Item, Kind, Status } from "../plan";
import type { TodayCard } from "../rules";

// What a Today item kind is made of. A kind is one module in this folder (ask.ts, mail.ts, ...): it derives its
// entries from a plain snapshot of the stores, says how long and how urgent each of them is, and lists the actions
// of an entry. `index.ts` is the registry that puts them in order. Nothing here reads a store: the application layer
// builds the `Snapshot` once (application/today/snapshot.ts) and runs the actions (application/today/actions.ts).

/** What an item is about, for its detail and its actions. A subject can hold more than one kind: a meeting is a prep
 *  before it and a note after, a pull request is a review or a fix. */
export type Subject =
  | { type: "ask"; request: Pending; chat: string }
  | { type: "blocked"; session: AgentSession }
  | { type: "meeting"; meeting: Meeting }
  | { type: "reminder"; reminder: Reminder }
  | { type: "card"; card: TodayCard }
  | { type: "pr"; pr: PR; prs?: PR[] }
  | { type: "mail"; key: string; mail: Mail }
  | { type: "chat"; key: string }
  | { type: "time"; date: string; minutes: number }
  | { type: "capture"; capture: Capture };
export type SubjectType = Subject["type"];
/** An item as Today shows it: the queue's item, what it says and where it belongs. `tone` colours why it is here. */
export type Entry = Item & {
  status: Status;
  title: string;
  where: string;
  why: string;
  tone: "late" | "soon" | "";
  project: string | null; // the vault project
  subject: Subject;
};
/** An entry of one subject type, for the code that works on one kind. */
export type EntryOf<T extends SubjectType> = Entry & { subject: Extract<Subject, { type: T }> };

/** The ticket a pull request is about, when one was found (application/today/links). */
export type Ticket = { provider?: string; card?: string; number?: string; title?: string };
/** A conversation as an item names it. */
export type ChatInfo = { label: string; project: string | null; projectLabel: string };

/** What the actions and the entries need to know about the settings. */
export type Flags = {
  trackers: Record<string, string>; // tracker id -> its name
  boardsReady: boolean; // a board is connected: a mail can become a ticket
  mailExperimental: boolean; // archive and trash exist
  reviewer: string; // the name of the agent a review's first pass runs on
};
/** Everything the entries are derived from, read from the stores once. */
export type Snapshot = Pick<Flags, "trackers"> & {
  today: string; // local yyyy-mm-dd
  doing: string[]; // ids the user started
  dismissed: string[];
  snoozed: Record<string, { until: string }>;
  pending: Pending[]; // permissions and questions of the agents, oldest first
  pendingAt: Record<string, number>; // per request id: since when, ms
  agents: AgentSession[];
  hiddenAgents: string[];
  unseen: string[]; // conversations finished while the user was elsewhere
  chats: Record<string, ChatInfo>; // of every conversation `pending` and `unseen` name
  meetings: Meeting[];
  meetingProject: Record<string, string | null>; // per meeting id
  reminders: Reminder[];
  cards: TodayCard[];
  prs: PRs | null;
  tickets: Record<string, Ticket>; // per PR url, of the PRs that have one
  mails: Mail[];
  mailProject: Record<string, string | null>; // per mail key, of the mails that wait on the user
  timeMin: number; // minutes of the day's conversations
  timeFromSessions: boolean; // the setting
  captures: Capture[];
};

/** What the rules that write text need: the translations and the clock as the user reads it. */
export type Words = {
  t: Translate;
  tn: (base: PluralBase, count: number) => string;
  clock: (iso: string) => string;
};

export type KindInfo = {
  est: number; // minutes it takes. ponytail: one guess per kind; a tracker's own estimate on the card would beat it once a provider gives one.
  rank: number; // in the queue, lower first; within a rank the oldest or most overdue first
  icon: string;
  bundle?: "mail" | "pr"; // three or more in a slot are one row that opens
  waits?: boolean; // an agent waits on it: the row says for how long
};
/** An entry before it has its rank, estimate and status. `late`: overdue, one step earlier in the queue. `times`:
 *  the estimate is that many times the kind's. */
export type Draft = Omit<Entry, "rank" | "est" | "status"> & { late?: boolean; times?: number };

/** An action as data: what the button says, and `id`, which the application layer runs (application/today/actions.ts). */
export type ActionSpec<A extends string = string> = {
  id: A | "done";
  label: string;
  icon?: string;
  key?: string;
  tip?: string;
};
/** An item's actions in the order Today shows them (the first two as buttons, the rest under "..."): `primary` and
 *  `secondary` are what Enter and Backspace run, `done` what E does, when the item has one. */
export type ActionSet<A extends string = string> = {
  acts: ActionSpec<A>[];
  primary?: number;
  secondary?: number;
  done?: ActionSpec<A>;
};

export type SubjectDef<T extends SubjectType, A extends string = string> = {
  /** The kinds this subject comes in. */
  kinds: Partial<Record<Kind, KindInfo>>;
  entries: (snap: Snapshot, w: Words, now: number) => Draft[];
  actions: (entry: EntryOf<T>, flags: Flags, w: Words) => ActionSet<A>;
  /** The kind chip over the title: `today.kind.<kind>` unless this says otherwise. */
  labelKey?: (entry: EntryOf<T>) => Key;
  /** The status of the item in the system it lives in, when it has one. */
  state?: (subject: Extract<Subject, { type: T }>) => Status | undefined;
};
