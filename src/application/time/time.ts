import { t } from "../../shared/i18n";
import { timeLines, timePrompt, type Activity } from "../../domain/time/blocks";
import { todayIso } from "../../domain/reminders/rules";
import * as backend from "../../infrastructure/backend";
import { settings, timeFromSessionsOn } from "../settings/settings";
import { select } from "../navigation/navigation";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { useConversationsStore } from "../conversations/store";
import { projectLabel } from "../workspace/vault";
import { useTodayStore } from "../today/store";

// "Time from sessions": the day's time per project from when the user wrote in their conversations (Claude Code
// transcripts, read by the backend), proposed as Productive time entries the user approves one by one. The agent adds
// the other sources weareantenna/antenna-tools' timesheet skill reads (calendar, Slack, git, other sessions, ...).

/** The day's time lines from the conversations under a project. Other providers' conversations are not counted. */
async function linesOf(date: string) {
  const { chats, sidOf } = useConversationsStore.getState();
  const bySid = new Map<string, { project: string; title: string }>();
  for (const [key, chat] of Object.entries(chats))
    if (chat.project && sidOf[key]?.provider === "claude")
      bySid.set(sidOf[key].sid, { project: chat.project, title: chat.title });
  if (!bySid.size) return Object.assign([], { sids: [] as string[] });
  const days = await backend.activity(date, [...bySid.keys()]);
  const events: Activity[] = Object.entries(days).flatMap(([sid, times]) =>
    times.map(at => ({ ...bySid.get(sid)!, at })),
  );
  return Object.assign(timeLines(events), { sids: Object.keys(days) });
}

/** Minutes of activity today that look unbooked: Productive is not asked, the backend only reads local transcripts. */
export async function loadTodayTime() {
  // switched off: the transcripts are not read at all
  const lines = timeFromSessionsOn() ? await linesOf(todayIso()).catch(() => []) : [];
  useTodayStore.setState(draft => {
    draft.timeMin = lines.reduce((sum, line) => sum + line.minutes, 0);
  });
}

/** A conversation "Time <date>" that books the day's time: the summary per project and how the agent proceeds. */
export async function proposeTime(date: string) {
  const lines = await linesOf(date);
  const key = startChat(null, { provider: "claude", title: t("time.title", { date }), note: t("time.note", { date }) });
  await select(key);
  const boards = settings().boards || {};
  return sendMsg(
    timePrompt(
      date,
      lines.map(line => ({
        ...line,
        label: projectLabel(line.project),
        board: boards[line.project]?.provider === "productive" ? boards[line.project].project : undefined,
      })),
      lines.sids,
    ),
  );
}
