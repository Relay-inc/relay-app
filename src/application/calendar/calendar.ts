import { currentLocale, t } from "../../shared/i18n";
import { clockTime } from "../../shared/format";
import {
  bannerDue,
  prepChatOf,
  briefingIn,
  meetingNoteName,
  withBriefing,
  joinable,
  meetingPrompt,
  soon,
  type MeetingChat,
  type Recording,
} from "../../domain/calendar/rules";
import type { Meeting } from "../../domain/calendar/types";
import { calendarOn as isCalendarOn } from "../../domain/settings/types";
import { WAIT } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { isPrimary } from "../../infrastructure/window";
import { settings } from "../settings/settings";
import { findProjects } from "../workspace/vault";
import { select, toast } from "../navigation/navigation";
import { useAgentsStore } from "../agents/store";
import { agentOf } from "../agents/agents";
import { startChat } from "../conversations/chats";
import { useConversationsStore } from "../conversations/store";
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
/** Cmd-K: the loaded meetings (the day's, application/calendar) whose title, organizer or a guest holds `q`. */
export function findMeetings(q: string) {
  const needle = q.toLowerCase();
  if (!calendarOn()) return [];
  return cal().list.filter(meeting =>
    [meeting.title, meeting.organizer, ...meeting.people.map(person => person.name)].some(text =>
      text.toLowerCase().includes(needle),
    ),
  );
}

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
  if (!cal().list.length) return; // nothing counts down: no wake-up for the reads over this store
  const now = Date.now();
  set(draft => {
    draft.now = now;
  });
  if (!isPrimary()) return; // one banner, from the main window
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

/** The vault project a meeting is about: the one project its title names, else none (General). */
export function meetingProjectOf(meeting: Meeting) {
  const hits = findProjects(meeting.title);
  return hits.length === 1 ? hits[0] : null;
}
/** The meeting's link in the browser, only when it goes to a meeting service (checked again: the invite wrote it). */
export const joinMeeting = (link: string) => joinable(link) && backend.openUrl(link);

/** A conversation about a meeting, in General: a meeting note in the vault, or a briefing before it. The invite's text
 *  is from whoever sent it, so the conversation is marked like one about a mail (fromMail, see mark_tainted in
 *  src-tauri/src/lib.rs). It always starts on Claude, whatever the default agent; with Claude switched off it does not
 *  start. */
export async function meetingChat(id: string, how: MeetingChat) {
  // a briefing asked before opens again instead of a second one
  const prep = how === "prep" ? prepChatOf(useConversationsStore.getState().chats, id) : null;
  if (prep) return select(prep);
  const meeting = cal().list.find(x => x.id === id);
  if (meeting) await chatAbout(meeting, how);
}
/** A meeting's note, when the vault has it (read fresh: the note may change in Obsidian or by an agent at any time). */
export async function meetingNote(meeting: Meeting) {
  const note = (await backend.readNote(meetingNoteName(meeting)).catch(() => null)) as {
    path: string;
    text: string;
    hash: string;
  } | null;
  return note && typeof note.text === "string" ? note : null;
}
/** The briefing in the meeting's note replaced by `body`, the note read again right before so an edit elsewhere is not
 *  lost outside the section. The note as written, or null when it is gone or has no briefing any more; a note changed
 *  in between throws "changed" (nothing written). */
export async function saveBriefing(meeting: Meeting, body: string) {
  const note = await meetingNote(meeting);
  if (!note || briefingIn(note.text) === null) return null;
  const text = withBriefing(note.text, body);
  const { hash } = await backend.writeNote(note.path, text, note.hash, false);
  return { path: note.path, text, hash };
}
/** The same for a meeting already in hand: a recording outlives the meeting's place in the list. */
export async function chatAbout(meeting: Meeting, how: MeetingChat, recording?: Recording) {
  if (useAgentsStore.getState().loaded && !agentOf("claude")?.on) return toast(t("cal.needClaude"));
  // under the meeting's project, so its prep and its note sit with the project's other work
  const key = startChat(meetingProjectOf(meeting), {
    provider: "claude",
    title: `${how === "prep" ? t("cal.prepTitle") : ""}${meeting.title}`.slice(0, 48),
    note: t("note.meetingStarted", { title: meeting.title }),
    fromMail: true,
    meeting: how === "prep" ? meeting.id : undefined,
  });
  await select(key);
  sendMsg(meetingPrompt(meeting, how, timeOf, undefined, recording));
}
