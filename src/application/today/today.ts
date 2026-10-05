import { t } from "../../shared/i18n";
import { provider } from "../../shared/plugins";
import { byDue, meetingsToday, myCardToday, prsForMe, type TodayCard } from "../../domain/today/rules";
import { todayIso } from "../../domain/reminders/rules";
import * as backend from "../../infrastructure/backend";
import { settings } from "../settings/settings";
import { useBoardStore } from "../board/store";
import { ctxOf } from "../board/ctx";
import { ticketChat } from "../board/board";
import { openCard, openPr } from "../navigation/panel";
import { select } from "../navigation/navigation";
import { prKey } from "../../domain/navigation/keys";
import { PRS } from "../../domain/navigation/views";
import { projectLabel } from "../workspace/vault";
import { useWorkspaceStore } from "../workspace/store";
import { useCalendarStore } from "../calendar/store";
import { soonMeetings } from "../calendar/calendar";
import { usePullRequestsStore } from "../pull-requests/store";
import { useConversationsStore } from "../conversations/store";
import { useTodayStore } from "./store";

// The cards under Today: the ones assigned to the user that are due or in progress, from every board linked to a vault
// project (settings.boards). Read on boot, every 5 minutes, when Today opens and when a ticket closes.
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
/** The line under Today's heading: what needs the user now and how much more there is today. */
export const todaySummary = (now: number, rest: number) =>
  now ? t("today.summaryNow", { now, rest }) : rest ? t("today.summary", { n: rest }) : "";

/** How many items Today shows below Now (Now's own count is waitCount). */
export function todayRest(now = Date.now()) {
  const soon = new Set(soonMeetings().map(meeting => meeting.id));
  const { coming } = meetingsToday(useCalendarStore.getState().list, now, soon);
  const due = useWorkspaceStore.getState().snap.reminders.filter(reminder => reminder.days <= 0).length;
  const prs = prsForMe(usePullRequestsStore.getState().list);
  const { unseen, pendingList } = useConversationsStore.getState();
  const asking = new Set(pendingList.map(request => request.project));
  const finished = [...unseen].filter(key => !asking.has(key)).length;
  return coming.length + due + useTodayStore.getState().cards.length + prs.review.length + prs.mine.length + finished;
}
