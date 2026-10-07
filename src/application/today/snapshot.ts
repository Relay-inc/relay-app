import { agentOf, reviewWriter } from "../agents/agents";
import { t, tn } from "../../shared/i18n";
import { PROVIDERS } from "../../shared/plugins";
import { todayIso } from "../../domain/reminders/rules";
import type { Reminder } from "../../domain/reminders/types";
import { mailKey } from "../../domain/navigation/keys";
import { prsForMe } from "../../domain/today/rules";
import { waitsOnYou } from "../../domain/today/kinds/mail";
import type { Flags, Snapshot, Words } from "../../domain/today/kinds/types";
import { useBoardStore } from "../board/store";
import { useCalendarStore } from "../calendar/store";
import { meetingProjectOf, timeOf } from "../calendar/calendar";
import { label } from "../conversations/selectors";
import { useConversationsStore } from "../conversations/store";
import { useMailStore } from "../mail/store";
import { mailProject } from "../mail/mail";
import { usePullRequestsStore } from "../pull-requests/store";
import { mailExperimental, timeFromSessionsOn } from "../settings/settings";
import { projectLabel } from "../workspace/vault";
import { useWorkspaceStore } from "../workspace/store";
import { ticketOf } from "./links";
import { useTodayStore } from "./store";

// The one place that reads the stores for Today's items: it hands the domain (domain/today/kinds) a plain snapshot.

/** The translations and the clock the rules write their text with. */
export const words: Words = { t, tn, clock: timeOf };

const trackers = () => Object.fromEntries(PROVIDERS.map(provider => [provider.id, provider.name]));
/** What the actions need to know about the settings. */
export const flags = (): Flags => ({
  trackers: trackers(),
  boardsReady: useBoardStore.getState().ready.length > 0,
  mailExperimental: mailExperimental(),
  reviewer: agentOf(reviewWriter())?.name ?? reviewWriter(),
});

/** Everything Today's items are derived from, read from the stores now. */
export function snapshot(): Snapshot {
  const conversations = useConversationsStore.getState();
  const today = useTodayStore.getState();
  const prs = usePullRequestsStore.getState().list;
  const mails = useMailStore.getState().list ?? [];
  const meetings = useCalendarStore.getState().list;
  const chat = (key: string) => {
    const project = conversations.chats[key]?.project ?? null;
    return [key, { label: label(key), project, projectLabel: projectLabel(project) }] as const;
  };
  const tickets = prsForMe(prs).review.flatMap(pr => {
    const link = ticketOf(pr.url);
    return link ? [[pr.url, link] as const] : [];
  });
  return {
    trackers: trackers(),
    today: todayIso(),
    doing: today.doing,
    dismissed: today.dismissed,
    snoozed: today.snoozed,
    pending: conversations.pendingList,
    pendingAt: conversations.pendingAt,
    agents: conversations.agentsList,
    hiddenAgents: conversations.hidden,
    unseen: [...conversations.unseen],
    chats: Object.fromEntries(
      [...conversations.pendingList.map(request => request.project), ...conversations.unseen].map(chat),
    ),
    meetings,
    meetingProject: Object.fromEntries(meetings.map(meeting => [meeting.id, meetingProjectOf(meeting)])),
    reminders: useWorkspaceStore.getState().snap.reminders as Reminder[],
    cards: today.cards,
    prs,
    tickets: Object.fromEntries(tickets),
    mails,
    mailProject: Object.fromEntries(mails.filter(waitsOnYou).map(mail => [mailKey(mail), mailProject(mail)])),
    timeMin: today.timeMin,
    timeFromSessions: timeFromSessionsOn(),
    captures: Object.values(today.captures),
  };
}
