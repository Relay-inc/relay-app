import { t } from "../../shared/i18n";
import { provider } from "../../shared/plugins";
import type { TodayCard } from "../../domain/today/rules";
import type { Status } from "../../domain/today/plan";
import { actionsFor } from "../../domain/today/kinds";
import { reviewGroupOf } from "../../domain/today/kinds/pr";
import type { ActionSpec, Entry, EntryOf, SubjectType } from "../../domain/today/kinds/types";
import type { AskAct } from "../../domain/today/kinds/ask";
import type { BlockedAct } from "../../domain/today/kinds/blocked";
import type { CardAct } from "../../domain/today/kinds/card";
import type { ChatAct } from "../../domain/today/kinds/chat";
import type { MailAct } from "../../domain/today/kinds/mail";
import type { MeetingAct } from "../../domain/today/kinds/meeting";
import type { PrAct } from "../../domain/today/kinds/pr";
import type { ReminderAct } from "../../domain/today/kinds/reminder";
import type { TimeAct } from "../../domain/today/kinds/time";
import type { PR } from "../../domain/pull-requests/types";
import { prKey } from "../../domain/navigation/keys";
import { PRS } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { ctxOf } from "../board/ctx";
import { ticketChat } from "../board/board";
import { openCard, openPr } from "../navigation/panel";
import { select, toast } from "../navigation/navigation";
import { projectLabel } from "../workspace/vault";
import { joinMeeting, meetingChat } from "../calendar/calendar";
import { reviewPr } from "../pull-requests/prs";
import { backgroundAction, typeInto } from "../conversations/actions";
import { markSeen, newChat } from "../conversations/chats";
import { mailChat, mailMove, mailSeen } from "../mail/mail";
import { mailExperimental } from "../settings/settings";
import { proposeTime } from "../time/time";
import { startRecording } from "../calendar/recording";
import { reminderAction, chatAboutReminder } from "../reminders/reminders";
import { openCompose } from "./mail";
import { startReview } from "./review";
import { changeDay, useTodayStore } from "./store";
import { relinkPr, ticketState } from "./links";
import { useDetailsStore } from "./details";
import { loadTodayCards, dismiss, entries, selectEntry } from "./today";
import { flags, words } from "./snapshot";

// What an item does: the actions its kind lists (domain/today/kinds/<kind>.ts, as data) bound to the use cases that
// run them, and what Done means for it.

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
  const finish = FINISH[s.type] as ((entry: Entry) => unknown) | undefined;
  return finish ? finish(entry) : dismiss(entry.id);
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
} /** Find the PR's ticket again, Claude included, and say what came out; what blocks it comes with its fix. */
export async function findTicketAgain(pr: PR) {
  const state = ticketState(pr);
  if (state === "noProject")
    return toast(t("today.link.noProject", { repo: pr.repo }), () => linkFor(pr), t("today.link.linkRepo"));
  if (state === "noBoard")
    return toast(
      t("today.link.noBoard", { project: projectLabel(pr.project) }),
      () => linkFor(pr),
      t("today.link.linkBoard"),
    );
  const link = await relinkPr(pr);
  if (link)
    return toast(
      t("today.link.found", {
        ticket: `${link.number ? `${/^\d+$/.test(link.number) ? "#" : ""}${link.number} ` : ""}${link.title ?? ""}`,
      }),
    );
  toast(t("today.link.none"), () => pickTicketFor(pr), t("today.link.choose"));
}
/** The repo or board linker on a PR's overview (from the toast: its item opens first). */
export function linkFor(pr: PR) {
  const item = entries().find(entry => entry.subject.type === "pr" && entry.subject.pr.url === pr.url);
  if (item) selectEntry(item.id);
  useDetailsStore.setState(draft => {
    draft.linking = pr.url;
  });
}
/** The ticket picker on a PR's overview (from the toast: its item opens first). */
export function pickTicketFor(pr: PR) {
  const item = entries().find(entry => entry.subject.type === "pr" && entry.subject.pr.url === pr.url);
  if (item) selectEntry(item.id);
  useDetailsStore.setState(draft => {
    draft.picking = pr.url;
  });
}
// Done where the item lives; an item that lives nowhere else is dismissed from Today.
type Finish = { [T in SubjectType]?: (entry: EntryOf<T>) => unknown };
const FINISH: Finish = {
  reminder: ({ subject }) => reminderAction(subject.reminder, "done"),
  mail: ({ subject }) => (mailExperimental() ? mailMove([subject.key], false) : mailSeen(subject.key, true)),
  chat: ({ subject }) => markSeen(subject.key),
  blocked: ({ subject }) => backgroundAction("hide", subject.session.id),
  ask: () => undefined, // an agent's question is done by answering it
};

// ---------- what an item does: its actions in the order Today shows them (the first two as buttons, the rest under
// "..."), which of them Enter and Backspace run, and what Done does for it (E), when it has one
export type Action = ActionSpec & { run: () => unknown };
export type Actions = { acts: Action[]; primary?: Action; secondary?: Action; done?: Action };
const after = (run: () => unknown, then: () => void) => async () => {
  await run();
  then();
};

// what each action id of a kind runs
type Run<T extends SubjectType, A extends string> = Record<A, (entry: EntryOf<T>) => unknown>;
const RUN: {
  ask: Run<"ask", AskAct>;
  blocked: Run<"blocked", BlockedAct>;
  meeting: Run<"meeting", MeetingAct>;
  reminder: Run<"reminder", ReminderAct>;
  card: Run<"card", CardAct>;
  pr: Run<"pr", PrAct>;
  mail: Run<"mail", MailAct>;
  chat: Run<"chat", ChatAct>;
  time: Run<"time", TimeAct>;
} = {
  ask: { open: ({ subject }) => select(subject.chat) },
  blocked: {
    attach: ({ subject }) => backgroundAction("attach", subject.session.id),
    stop: ({ subject }) => backgroundAction("stop", subject.session.id),
    hide: ({ subject }) => backgroundAction("hide", subject.session.id),
  },
  meeting: {
    prep: ({ subject }) => meetingChat(subject.meeting.id, "prep"),
    join: ({ subject }) => joinMeeting(subject.meeting.join),
    record: ({ subject }) => startRecording(subject.meeting.id),
    makeNote: entry =>
      after(
        () => meetingChat(entry.subject.meeting.id, "note"),
        () => dismiss(entry.id),
      )(),
    noNote: entry => dismiss(entry.id),
  },
  reminder: {
    complete: ({ subject }) => reminderAction(subject.reminder, "done"),
    tomorrow: ({ subject }) => reminderAction(subject.reminder, "push", "morgen"),
    week: ({ subject }) => reminderAction(subject.reminder, "push", "+1w"),
    chat: ({ subject }) => chatAboutReminder(subject.reminder.id),
  },
  card: {
    start: entry => startWorking(entry, entry.subject.card),
    openIn: ({ subject }) => openTodayCardIn(subject.card),
    chat: ({ subject }) => todayCardChat(subject.card),
    open: ({ subject }) => openTodayCard(subject.card),
  },
  pr: {
    review: entry => startReview(entry.id, [entry.subject.pr]),
    reviewTogether: entry => {
      const group = reviewGroupOf(entry)!;
      return startReview(group.id, group.prs, group.title);
    },
    github: ({ subject }) => backend.openUrl(subject.pr.url),
    inRelay: ({ subject }) => openTodayPr(subject.pr.repo, subject.pr.number),
    reviewChat: ({ subject }) => reviewWithClaude(subject.pr),
    findTicket: ({ subject }) => findTicketAgain(subject.pr),
    fix: ({ subject }) => fixWithClaude(subject.prs ?? [subject.pr]),
  },
  mail: {
    reply: ({ subject }) => openCompose(subject.key, "reply"),
    replyAll: ({ subject }) => openCompose(subject.key, "all"),
    forward: ({ subject }) => openCompose(subject.key, "fwd"),
    chat: ({ subject }) => mailChat(subject.key, "talk"),
    ticket: ({ subject }) => mailChat(subject.key, "ticket"),
    read: ({ subject }) => mailSeen(subject.key, true),
    trash: ({ subject }) => trashMail(subject.key),
    archive: ({ subject }) => mailMove([subject.key], false),
  },
  chat: {
    read: ({ subject }) => select(subject.key),
    markRead: ({ subject }) => markSeen(subject.key),
  },
  time: { book: ({ subject }) => proposeTime(subject.date) },
};
const run = (entry: Entry, id: string) =>
  id === "done"
    ? setStatus(entry, "done")
    : (RUN[entry.subject.type] as Record<string, (entry: Entry) => unknown>)[id](entry);

/** The item's actions. An agent's permission or question answers in its own card (Enter allows), so it has none of
 *  Enter or Backspace. */
export function actionsOf(entry: Entry): Actions {
  const set = actionsFor(entry, flags(), words);
  const bind = (spec: ActionSpec): Action => ({ ...spec, run: () => run(entry, spec.id) });
  const acts = set.acts.map(bind);
  return {
    acts,
    primary: set.primary === undefined ? undefined : acts[set.primary],
    secondary: set.secondary === undefined ? undefined : acts[set.secondary],
    done: set.done && bind(set.done),
  };
}

// Start working on a card: in progress in its tracker, and a conversation under its project with the ticket typed in
async function startWorking(entry: Entry, card: TodayCard) {
  if (entry.status !== "doing") await setStatus(entry, "doing").catch(console.error);
  await todayCardChat(card);
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
// a conversation under the PR's project with what is wrong typed in, one Enter away from sending; the PRs of one
// ticket in one conversation
async function fixWithClaude(prs: PR[]) {
  const key = newChat(prs[0].project);
  await select(key);
  const what = (pr: PR) => (pr.review === "CHANGES_REQUESTED" ? t("today.fixChanges") : t("today.fixChecks"));
  typeInto(key, prs.map(pr => `${what(pr)}\n${pr.url}`).join("\n\n"));
}
