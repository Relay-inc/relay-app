import { currentLocale, t } from "../../shared/i18n";
import { clockTime } from "../../shared/format";
import { bannerDue, joinable, meetingPrompt, soon, type MeetingChat } from "../../domain/calendar/rules";
import { calendarOn as isCalendarOn } from "../../domain/settings/types";
import { WAIT } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { settings } from "../settings/settings";
import { select, toast } from "../navigation/navigation";
import { useAgentsStore } from "../agents/store";
import { agentOf } from "../agents/agents";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { useCalendarStore } from "./store";

// The meetings of the next 12 hours, fetched by the backend from each calendar's secret iCal address every 5 minutes.
// Not a view of its own: the ones about to start sit at the top of Waiting, and 5 minutes before the start a banner
// goes out. No events are created or answered from here, the calendar stays read-only.
const set = useCalendarStore.setState;
const cal = () => useCalendarStore.getState();
// the meetings whose banner went out, for this run of the app
const sent = new Set<string>();

export const calendarOn = () => isCalendarOn(settings());
export const soonMeetings = () => (calendarOn() ? soon(cal().list, cal().now) : []);
export const timeOf = (iso: string) => clockTime(iso, currentLocale());

export async function loadMeetings() {
  if (!calendarOn()) {
    set(draft => {
      draft.list = [];
      draft.errors = [];
    });
    return;
  }
  try {
    const got = await backend.calendarMeetings();
    set(draft => {
      draft.list = got.meetings;
      draft.errors = got.errors;
    });
  } catch (error) {
    set(draft => {
      draft.errors = [String(error)];
    });
  }
  tick();
}

// every 30 seconds: the countdown, and the banner. Also when the window has focus (unlike a finished turn's banner,
// application/conversations/events.ts): a meeting in 5 minutes matters whatever is on screen. A click opens Waiting.
export function tick() {
  const now = Date.now();
  set(draft => {
    draft.now = now;
  });
  for (const meeting of bannerDue(cal().list, now, sent)) {
    sent.add(meeting.id);
    // a slot per meeting, so the next one's banner does not replace this one; a click opens Waiting
    backend.notify(
      WAIT,
      t("cal.banner", { time: timeOf(meeting.start) }),
      meeting.title.slice(0, 160),
      `meeting:${meeting.id}`,
    );
  }
}

/** The meeting's link in the browser, only when it goes to a meeting service (checked again: the invite wrote it). */
export const joinMeeting = (link: string) => joinable(link) && backend.openUrl(link);

/** A conversation about a meeting, in General: a meeting note in the vault, or a briefing before it. The invite's text
 *  is from whoever sent it, so the conversation runs restricted like one about a mail (fromMail, see taint in
 *  src-tauri/src/lib.rs). Only Claude Code runs restricted, so it always starts on Claude, whatever the default agent;
 *  with Claude switched off it does not start. */
export async function meetingChat(id: string, how: MeetingChat) {
  const meeting = cal().list.find(x => x.id === id);
  if (!meeting) return;
  if (useAgentsStore.getState().loaded && !agentOf("claude")?.on) return toast(t("cal.needClaude"));
  const key = startChat(null, {
    provider: "claude",
    title: `${how === "prep" ? t("cal.prepTitle") : ""}${meeting.title}`.slice(0, 48),
    note: t("note.meetingStarted", { title: meeting.title }),
    fromMail: true,
  });
  await select(key);
  sendMsg(meetingPrompt(meeting, how, timeOf));
}
