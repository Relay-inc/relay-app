import { t } from "../../shared/i18n";
import { provider } from "../../shared/plugins";
import { byDue, myCardToday, prsForMe, type TodayCard } from "../../domain/today/rules";
import {
  EST,
  doingFirst,
  ordered,
  plan,
  rankOf,
  slots,
  statusOf,
  type Item,
  type Kind,
  type Status,
} from "../../domain/today/plan";
import { todayIso } from "../../domain/reminders/rules";
import { isQuestion } from "../../domain/conversations/rules";
import { joinable } from "../../domain/calendar/rules";
import { mailKey, prKey } from "../../domain/navigation/keys";
import { PRS } from "../../domain/navigation/views";
import type { Pending, AgentSession } from "../../domain/conversations/types";
import type { Meeting } from "../../domain/calendar/types";
import type { Reminder } from "../../domain/reminders/types";
import type { PR } from "../../domain/pull-requests/types";
import type { Mail } from "../../domain/mail/types";
import * as backend from "../../infrastructure/backend";
import { settings } from "../settings/settings";
import { useBoardStore } from "../board/store";
import { ctxOf } from "../board/ctx";
import { ticketChat } from "../board/board";
import { openCard, openPr } from "../navigation/panel";
import { select } from "../navigation/navigation";
import { projectLabel, findProjects, loadSnapshot } from "../workspace/vault";
import { useWorkspaceStore } from "../workspace/store";
import { useCalendarStore } from "../calendar/store";
import { joinMeeting, loadMeetings, meetingChat, timeOf } from "../calendar/calendar";
import { usePullRequestsStore } from "../pull-requests/store";
import { loadPrs, reviewPr } from "../pull-requests/prs";
import { useConversationsStore } from "../conversations/store";
import { label } from "../conversations/selectors";
import { backgroundAction, typeInto } from "../conversations/actions";
import { markSeen, newChat } from "../conversations/chats";
import { useMailStore } from "../mail/store";
import { loadMails, mailChat, mailMove, mailProject, mailSeen } from "../mail/mail";
import { mailExperimental, mailOn } from "../settings/settings";
import { reminderAction, chatAboutReminder } from "../reminders/reminders";
import { changeDay, setSnooze, useTodayStore } from "./store";

// Today: one queue of everything that needs the user, planned into the free time between today's meetings
// (domain/today/plan.ts). This module turns the stores into that queue, and runs an item's actions.

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
  const lists = await Promise.all(
    Object.entries(settings().boards || {}).map(async ([project, ref]): Promise<TodayCard[]> => {
      const tracker = provider(ref.provider);
      if (!tracker || !ready.includes(tracker.id)) return [];
      try {
        const cards = await tracker.cards(ctxOf(tracker), ref);
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
    draft.cards = lists.flat().sort(byDue);
    draft.errors = errors;
    draft.at = Date.now();
  });
}

/** Refresh: every source Today reads, at once (they also refresh by themselves every few minutes). */
export async function refreshToday() {
  if (useTodayStore.getState().reloading) return;
  useTodayStore.setState(draft => {
    draft.reloading = true;
  });
  await Promise.allSettled([
    loadTodayCards(),
    loadMeetings(),
    loadPrs(),
    loadSnapshot(),
    mailOn() ? loadMails() : null,
  ]);
  useTodayStore.setState(draft => {
    draft.reloading = false;
  });
}

// ---------- snooze: an item off Today until a later day, kept across days
const asleep = (id: string) => {
  const snooze = useTodayStore.getState().snoozed[id];
  return !!snooze && snooze.until > todayIso();
};
// snoozed and its day has come: an item that only shows while recent (mail) comes back anyway
const woke = (id: string) => {
  const snooze = useTodayStore.getState().snoozed[id];
  return !!snooze && snooze.until <= todayIso();
};
/** Snooze for `days` (a week by default): a reminder is pushed in the vault, anything else stays off Today until then. */
export async function snooze(entry: Entry, days = 7) {
  if (entry.subject.type === "reminder")
    return reminderAction(entry.subject.reminder, "push", days === 7 ? "+1w" : todayIso(days));
  setSnooze(entry.id, { until: todayIso(days), title: entry.title, kind: entry.kind });
  useTodayStore.setState(draft => {
    draft.selected = "";
  });
}
/** Back on Today now. */
export const wake = (id: string) => setSnooze(id, null);

// ---------- the items
/** What an item is about, for its detail and its actions. */
export type Subject =
  | { type: "ask"; request: Pending; chat: string }
  | { type: "blocked"; session: AgentSession }
  | { type: "meeting"; meeting: Meeting }
  | { type: "reminder"; reminder: Reminder }
  | { type: "card"; card: TodayCard }
  | { type: "pr"; pr: PR }
  | { type: "mail"; key: string; mail: Mail }
  | { type: "chat"; key: string };
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

const MIN = 60_000;
const DAY = 86_400_000;
const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);
const ago = (since: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - since) / MIN));
  return minutes < 60 ? t("wait.agoMin", { n: minutes }) : t("wait.agoHour", { n: Math.floor(minutes / 60) });
};
// a meeting's project: the one vault project its title names, if exactly one
const meetingProject = (meeting: Meeting) => {
  const hits = findProjects(meeting.title);
  return hits.length === 1 ? hits[0] : null;
};
const daysLate = (date: string) => Math.round((Date.parse(todayIso()) - Date.parse(date)) / DAY);

/** Everything that needs the user today, unordered. `now` in ms. */
export function entries(now = Date.now()): Entry[] {
  const out: Entry[] = [];
  const { doing } = useTodayStore.getState();
  const add = (kind: Kind, entry: Omit<Entry, "kind" | "rank" | "est" | "status">, late = false) =>
    out.push({
      kind,
      rank: rankOf(kind, late),
      est: EST[kind],
      // a card's status is its tracker's; anything else is in progress once the user said so
      status: statusOf(entry.id, entry.subject.type === "card" ? entry.subject.card.card.state : undefined, doing),
      ...entry,
    });
  const conversations = useConversationsStore.getState();
  const chatProject = (key: string) => conversations.chats[key]?.project ?? null;

  for (const request of conversations.pendingList) {
    const question = isQuestion(request) ? request.input.questions?.[0]?.question : "";
    const since = conversations.pendingAt[request.id] ?? now;
    add("ask", {
      id: `ask:${request.id}`,
      at: since,
      title: question || t("today.allow", { tool: request.tool_name }),
      where: [projectLabel(chatProject(request.project)), label(request.project)].join(" / "),
      why: t("today.waiting", { ago: ago(since, now) }),
      tone: "late",
      project: chatProject(request.project),
      subject: { type: "ask", request, chat: request.project },
    });
  }
  for (const session of conversations.agentsList.filter(
    agent => agent.kind === "background" && agent.state === "blocked" && !conversations.hidden.includes(agent.id),
  )) {
    const since = session.startedAt ? Date.parse(session.startedAt) : now;
    add("blocked", {
      id: `blocked:${session.id}`,
      at: since,
      title: session.name || t("today.blockedSession"),
      where: t("today.terminal"),
      why: t("today.blocked"),
      tone: "soon",
      project: null,
      subject: { type: "blocked", session },
    });
  }

  const midnight = startOfDay(now);
  for (const meeting of useCalendarStore.getState().list) {
    const start = Date.parse(meeting.start);
    const end = Date.parse(meeting.end);
    if (start < midnight || start >= midnight + DAY) continue;
    const base = { project: meetingProject(meeting), subject: { type: "meeting", meeting } as Subject };
    const when = `${timeOf(meeting.start)}–${timeOf(meeting.end)}`;
    const where = [t("today.meeting"), when, meeting.location].filter(Boolean).join(" · ");
    if (start > now)
      add("prep", {
        ...base,
        id: `prep:${meeting.id}`,
        at: start,
        by: start,
        title: t("today.prepTitle", { title: meeting.title || t("wait.meetingUntitled") }),
        where,
        why: t("today.starts", { time: timeOf(meeting.start) }),
        tone: start - now < 60 * MIN ? "soon" : "",
      });
    else if (end <= now)
      add("note", {
        ...base,
        id: `note:${meeting.id}`,
        at: end,
        title: t("today.noteTitle", { title: meeting.title || t("wait.meetingUntitled") }),
        where,
        why: t("today.ended", { time: timeOf(meeting.end) }),
        tone: "",
      });
  }

  for (const reminder of useWorkspaceStore.getState().snap.reminders as Reminder[]) {
    if (reminder.days > 0) continue;
    const late = reminder.days < 0;
    add(
      "reminder",
      {
        id: `rem:${reminder.id}`,
        at: Date.parse(reminder.date),
        title: reminder.title,
        where: [t("nav.reminders"), reminder.project && projectLabel(reminder.project)].filter(Boolean).join(" · "),
        why: late ? t("today.daysLate", { n: -reminder.days }) : t("rem.today"),
        tone: late ? "late" : "soon",
        project: reminder.project,
        subject: { type: "reminder", reminder },
      },
      late,
    );
  }
  for (const item of useTodayStore.getState().cards) {
    const late = !!item.card.due && daysLate(item.card.due) > 0;
    const number = item.card.number ? `${/^\d+$/.test(item.card.number) ? "#" : ""}${item.card.number} ` : "";
    add(
      "card",
      {
        id: `card:${item.provider}:${item.card.id}`,
        at: item.card.due ? Date.parse(item.card.due) : now,
        title: `${number}${item.card.title}`,
        where: [provider(item.provider)?.name, projectLabel(item.project)].join(" · "),
        why: late
          ? t("today.daysLate", { n: daysLate(item.card.due!) })
          : item.card.due
            ? t("rem.today")
            : item.card.status || t("today.inProgress"),
        tone: late ? "late" : "soon",
        project: item.project,
        subject: { type: "card", card: item },
      },
      late,
    );
  }

  const prs = prsForMe(usePullRequestsStore.getState().list);
  const prWhere = (pr: PR, mine: boolean) => `${pr.repo} #${pr.number} · ${mine ? t("today.yours") : pr.author}`;
  for (const pr of prs.review)
    add("review", {
      id: `review:${pr.url}`,
      at: Date.parse(pr.created),
      title: pr.title,
      where: prWhere(pr, false),
      why: t("today.reviewAsked"),
      tone: "soon",
      project: pr.project,
      subject: { type: "pr", pr },
    });
  for (const pr of prs.mine)
    add("fix", {
      id: `fix:${pr.url}`,
      at: Date.parse(pr.updated),
      title: pr.title,
      where: prWhere(pr, true),
      why: pr.review === "CHANGES_REQUESTED" ? t("rv.changes") : t("today.checksRed"),
      tone: "late",
      project: pr.project,
      subject: { type: "pr", pr },
    });

  // unread mail from a person in the last two days: older unread mail is triage for the Mail view, not today's work
  for (const mail of useMailStore.getState().list ?? []) {
    const at = Date.parse(mail.date);
    const key = mailKey(mail);
    if (!mail.unread || mail.other || (now - at > 2 * DAY && !woke(`mail:${key}`))) continue;
    const sender = mail.from[0]?.name || mail.from[0]?.email || "";
    add("mail", {
      id: `mail:${key}`,
      at,
      title: mail.subject || t("mail.noSubject"),
      where: [t("nav.mail"), sender, timeOf(mail.date)].filter(Boolean).join(" · "),
      why: t("today.waiting", { ago: ago(at, now) }),
      tone: now - at > 4 * 60 * MIN ? "soon" : "",
      project: mailProject(mail),
      subject: { type: "mail", key, mail },
    });
  }

  const asking = new Set(conversations.pendingList.map(request => request.project));
  for (const key of conversations.unseen) {
    if (asking.has(key)) continue; // its question is in the queue already
    add("finished", {
      id: `chat:${key}`,
      at: now,
      title: label(key),
      where: projectLabel(chatProject(key)),
      why: t("today.finished"),
      tone: "",
      project: chatProject(key),
      subject: { type: "chat", key },
    });
  }
  const { dismissed } = useTodayStore.getState();
  return out.filter(entry => !dismissed.includes(entry.id) && !asleep(entry.id));
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
  const all = entries(now);
  const queue = doingFirst(ordered(all, state.later) as Entry[], entry => entry.status);
  const meetings = meetingsOfToday(now);
  const dayEnd = new Date(now).setHours(18, 0, 0, 0);
  const free = slots(
    meetings.map(meeting => ({ id: meeting.id, start: Date.parse(meeting.start), end: Date.parse(meeting.end) })),
    now,
    dayEnd,
  );
  const { placed, tomorrow, used } = plan(queue, free, state.pins);
  const current = new Set(queue.map(entry => entry.id));
  // snoozed is not cleared: it comes back
  const gone = state.seen.filter(id => !current.has(id) && !asleep(id));
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
    // snoozed and not back yet, soonest first
    snoozed: Object.entries(state.snoozed)
      .filter(([, item]) => item.until > todayIso())
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
export function noteSeen(items: { id: string; title: string; kind: Kind }[]) {
  const { seen, log } = useTodayStore.getState();
  const fresh = items.filter(item => !seen.includes(item.id) || log[item.id]?.title !== item.title);
  if (fresh.length)
    changeDay(day => {
      for (const item of fresh) {
        if (!day.seen.includes(item.id)) day.seen.push(item.id);
        day.log[item.id] = { title: item.title, kind: item.kind };
      }
    });
}
/** Back in the queue: something taken off by hand on Today. */
export const reopen = (id: string) =>
  changeDay(day => {
    day.dismissed = day.dismissed.filter(x => x !== id);
  });

// ---------- status: to do, in progress, done, in the system the item lives in where it has one
/** Set an item's status. In progress and back to do: a card moves to its tracker's status of that kind, anything else
 *  is marked on Today. Done is done where the item lives: the reminder in the vault, the card in its tracker, the mail
 *  archived (read without the experimental mail flag), the conversation read, the session hidden. A PR, a meeting's
 *  prep or note are only done on Today: nothing on GitHub happens from the app without approval (decided 29/9). An
 *  agent's question is done by answering it. Throws what the tracker said. */
export async function setStatus(entry: Entry, status: Status) {
  const local = (doing: boolean) =>
    changeDay(day => {
      day.doing = doing
        ? [...day.doing.filter(id => id !== entry.id), entry.id]
        : day.doing.filter(id => id !== entry.id);
    });
  const s = entry.subject;
  if (s.type === "card" && (await setCardState(s.card, status))) return local(false);
  if (status !== "done") return local(status === "doing");
  local(false);
  switch (s.type) {
    case "reminder":
      return reminderAction(s.reminder, "done");
    case "mail":
      return mailExperimental() ? mailMove([s.key], false) : mailSeen(s.key, true);
    case "chat":
      return markSeen(s.key);
    case "blocked":
      return backgroundAction("hide", s.session.id);
    case "ask":
      return;
    default:
      return dismiss(entry.id);
  }
}
// The card to its tracker's first status of that kind ("doing": an active one before one in review or blocked), at
// once on Today, then read again. False when the tracker has no statuses (Trello's lists): the status stays on Today.
async function setCardState(item: TodayCard, state: Status) {
  const tracker = trackerOf(item);
  const ctx = ctxOf(tracker);
  for (const group of tracker.groupings?.map(grouping => grouping.id) ?? [undefined]) {
    // Linear lists its finished states only with `done` on: Done needs them
    const columns = await tracker.columns({ ...ctx, config: { ...ctx.config, done: true } }, item.ref, group);
    if (!columns.some(column => column.state)) continue;
    const to =
      columns.find(column => column.state === state && (state !== "doing" || column.tone === "active")) ??
      columns.find(column => column.state === state);
    if (!to) throw new Error(t("today.noStatus", { state: t(`today.status.${state}`) }));
    useTodayStore.setState(draft => {
      const card = draft.cards.find(x => x.provider === item.provider && x.card.id === item.card.id);
      if (card) Object.assign(card.card, { state, status: to.name });
    });
    await tracker.move(ctx, item.ref, item.card, to.id, group);
    loadTodayCards();
    return true;
  }
  return false;
}
export const selectEntry = (id: string) =>
  useTodayStore.setState(draft => {
    draft.selected = id;
  });
const dismiss = (id: string) =>
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

// ---------- what an item does: a primary action (Enter), a secondary one (Backspace), and maybe extras
export type Action = { label: string; run: () => unknown };
const after = (run: () => unknown, then: () => void) => async () => {
  await run();
  then();
};

/** The item's actions. An agent's question or permission answers in its own card (Enter allows), so it has none. */
export function actionsOf(entry: Entry): { primary?: Action; secondary?: Action; extra: Action[] } {
  const s = entry.subject;
  switch (s.type) {
    case "ask":
      return { secondary: { label: t("wait.open"), run: () => select(s.chat) }, extra: [] };
    case "blocked":
      return {
        primary: { label: t("bar.openTerminal"), run: () => backgroundAction("attach", s.session.id) },
        secondary: { label: t("wait.stop"), run: () => backgroundAction("stop", s.session.id) },
        extra: [{ label: t("wait.hide"), run: () => backgroundAction("hide", s.session.id) }],
      };
    case "meeting": {
      const join = joinable(s.meeting.join)
        ? { label: t("wait.meetingJoin"), run: () => joinMeeting(s.meeting.join) }
        : null;
      if (entry.kind === "note")
        return {
          primary: {
            label: t("today.makeNote"),
            run: after(
              () => meetingChat(s.meeting.id, "note"),
              () => dismiss(entry.id),
            ),
          },
          secondary: { label: t("today.noNote"), run: () => dismiss(entry.id) },
          extra: [],
        };
      return {
        primary: {
          label: t("wait.meetingPrep"),
          run: after(
            () => meetingChat(s.meeting.id, "prep"),
            () => dismiss(entry.id),
          ),
        },
        secondary: join ?? { label: t("today.skipPrep"), run: () => dismiss(entry.id) },
        extra: join ? [{ label: t("today.skipPrep"), run: () => dismiss(entry.id) }] : [],
      };
    }
    case "reminder":
      return {
        primary: { label: t("rem.done"), run: () => reminderAction(s.reminder, "done") },
        secondary: { label: t("rem.tomorrow"), run: () => reminderAction(s.reminder, "push", "morgen") },
        extra: [
          { label: t("rem.plusWeek"), run: () => reminderAction(s.reminder, "push", "+1w") },
          { label: t("rem.chat"), run: () => chatAboutReminder(s.reminder.id) },
        ],
      };
    case "card": {
      const tracker = provider(s.card.provider);
      return {
        primary: { label: t("today.open"), run: () => openTodayCard(s.card) },
        secondary: { label: t("kb.openIn", { name: tracker?.name ?? "" }), run: () => openTodayCardIn(s.card) },
        extra: [{ label: t("rem.chat"), run: () => todayCardChat(s.card) }],
      };
    }
    case "pr":
      return entry.kind === "review"
        ? {
            primary: { label: t("today.reviewWithClaude"), run: () => reviewWithClaude(s.pr) },
            secondary: { label: t("today.open"), run: () => openTodayPr(s.pr.repo, s.pr.number) },
            extra: [{ label: t("today.onGithub"), run: () => backend.openUrl(s.pr.url) }],
          }
        : {
            primary: { label: t("today.fixWithClaude"), run: () => fixWithClaude(s.pr) },
            secondary: { label: t("today.open"), run: () => openTodayPr(s.pr.repo, s.pr.number) },
            extra: [{ label: t("today.onGithub"), run: () => backend.openUrl(s.pr.url) }],
          };
    case "mail":
      // a reply is a draft Claude writes (nothing is sent from the app); replying, archiving or trashing takes the
      // mail off Today: a reply marks it read first
      return {
        primary: { label: t("today.reply"), run: () => replyToMail(s.key, "draft") },
        secondary: mailExperimental()
          ? { label: t("mail.archive"), run: () => mailMove([s.key], false) }
          : { label: t("today.markRead"), run: () => mailSeen(s.key, true) },
        extra: [
          { label: t("today.replyAll"), run: () => replyToMail(s.key, "draftAll") },
          ...(mailExperimental() ? [{ label: t("mail.trash"), run: () => trashMail(s.key) }] : []),
          { label: t("today.talkMail"), run: () => mailChat(s.key, "talk") },
        ],
      };
    case "chat":
      return {
        primary: { label: t("today.read"), run: () => select(s.key) },
        secondary: { label: t("today.markRead"), run: () => markSeen(s.key) },
        extra: [],
      };
  }
}

/** A reply to a mail under Today: marked read (it leaves the queue), then Claude drafts it; nothing is sent. */
export async function replyToMail(key: string, how: "draft" | "draftAll") {
  await mailSeen(key, true);
  await mailChat(key, how);
}
/** Trash a mail under Today (with the experimental mail flag, as in Mail). */
export const trashMail = (key: string) => mailMove([key], true);

const trackerOf = (item: TodayCard) => provider(item.provider)!;
/** The card in the ticket window, with the board it came from. */
export const openTodayCard = (item: TodayCard) => openCard(trackerOf(item), item.ref, item.card.id);
/** The card's page in the tracker's web app. */
export async function openTodayCardIn(item: TodayCard) {
  const tracker = trackerOf(item);
  try {
    backend.openUrl(await tracker.url(ctxOf(tracker), item.ref, item.card.id));
  } catch (error) {
    console.error(error);
  }
}
/** A new conversation under the card's vault project, its number, title and link typed in the composer. */
export async function todayCardChat(item: TodayCard) {
  const tracker = trackerOf(item);
  const url = await tracker.url(ctxOf(tracker), item.ref, item.card.id).catch(() => "");
  // as the ticket window types it
  await ticketChat(
    tracker,
    [`${item.card.number} ${item.card.title}`.trim(), url].filter(Boolean).join("\n"),
    item.project,
  );
}
/** The PR in the Pull requests view, its detail next to the list. */
export async function openTodayPr(repo: string, number: number) {
  await select(PRS);
  return openPr(prKey(repo, number));
}
// the review conversation reads the PR's detail, so it is fetched first (as opening it in the PR view does)
async function reviewWithClaude(pr: PR) {
  const key = prKey(pr.repo, pr.number);
  await openPr(key);
  await reviewPr(key);
}
// a conversation under the PR's project with what is wrong typed in, one Enter away from sending
async function fixWithClaude(pr: PR) {
  const key = newChat(pr.project);
  await select(key);
  const what = pr.review === "CHANGES_REQUESTED" ? t("today.fixChanges") : t("today.fixChecks");
  typeInto(key, `${what}\n${pr.url}`);
}

/** The line in the title bar and the sidebar's count: what is in the queue besides agents and sessions waiting. */
export const todayRest = (now = Date.now()) =>
  entries(now).filter(entry => entry.kind !== "ask" && entry.kind !== "blocked").length;
