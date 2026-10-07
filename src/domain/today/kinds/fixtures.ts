import type { Meeting } from "../../calendar/types";
import type { Mail } from "../../mail/types";
import type { PR } from "../../pull-requests/types";
import type { Reminder } from "../../reminders/types";
import type { Flags, Snapshot, Words } from "./types.ts";

// What the kind tests build their snapshots from: an empty day, and words that print their key and parameters.

/** Mon 5 Oct 2026, 10:00 local. */
export const NOW = new Date(2026, 9, 5, 10, 0).getTime();
export const TODAY = "2026-10-05";
export const at = (hours: number, minutes = 0) => new Date(2026, 9, 5, hours, minutes).getTime();
export const iso = (ms: number) => new Date(ms).toISOString();

export const words: Words = {
  t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
  tn: (base, count) => `${base}#${count}`,
  clock: iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
};
export const flags: Flags = {
  trackers: { prod: "Productive" },
  boardsReady: true,
  mailExperimental: false,
  reviewer: "Claude Code",
};

export const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  trackers: flags.trackers,
  today: TODAY,
  doing: [],
  dismissed: [],
  snoozed: {},
  pending: [],
  pendingAt: {},
  agents: [],
  hiddenAgents: [],
  unseen: [],
  chats: {},
  meetings: [],
  meetingProject: {},
  reminders: [],
  cards: [],
  prs: null,
  tickets: {},
  mails: [],
  mailProject: {},
  timeMin: 0,
  timeFromSessions: false,
  captures: [],
  ...over,
});

export const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: "m1@9",
  feed: "work",
  title: "Standup",
  start: iso(at(11)),
  end: iso(at(11, 30)),
  location: "",
  join: "",
  organizer: "Ann",
  people: [],
  ...over,
});
export const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1",
  date: TODAY,
  days: 0,
  project: null,
  title: "Call the bank",
  text: "Call the bank",
  repeat: null,
  ...over,
});
export const pr = (over: Partial<PR> = {}): PR => ({
  number: 7,
  title: "Fix the thing",
  url: "https://github.com/acme/app/pull/7",
  repo: "acme/app",
  draft: false,
  created: iso(at(8)),
  updated: iso(at(9)),
  author: "bob",
  review: null,
  ci: null,
  project: "app",
  ...over,
});
export const mail = (over: Partial<Mail> = {}): Mail => ({
  id: "1",
  account: "a",
  subject: "Hello",
  date: iso(at(9)),
  unread: true,
  from: [{ name: "Ann", email: "ann@example.com" }],
  to: [],
  attachments: false,
  ...over,
});
