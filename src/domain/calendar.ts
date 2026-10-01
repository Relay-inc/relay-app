import { invoke } from "@tauri-apps/api/core";
import { currentLocale, t } from "../core/i18n";
import { changed } from "../core/store";
import { calendarOn } from "./config";
import { VIEW } from "./keys";
import { bannerDue, soon, type Meeting } from "./meetings";

export type { Meeting };

// The meetings of the next 12 hours, fetched by the backend from each calendar's secret iCal address every 5 minutes.
// Not a view of its own: the ones about to start sit at the top of Waiting, and 5 minutes before the start a banner
// goes out. No events are created or answered from here, the calendar stays read-only.
export const calendar = {
  list: [] as Meeting[],
  errors: [] as string[],
  now: Date.now(), // moved on by the tick, so "in 4 min" counts down
  sent: new Set<string>(), // the meetings whose banner went out, for this run of the app
};

export const soonMeetings = () => (calendarOn() ? soon(calendar.list, calendar.now) : []);

export async function loadMeetings() {
  if (!calendarOn()) {
    calendar.list = [];
    calendar.errors = [];
    return changed();
  }
  try {
    const got = await invoke<{ meetings: Meeting[]; errors: string[] }>("calendar_meetings");
    calendar.list = got.meetings;
    calendar.errors = got.errors;
  } catch (error) {
    calendar.errors = [String(error)];
  }
  tick();
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });

// every 30 seconds: the countdown, and the banner. Also when the window has focus (unlike a finished turn's banner,
// src/domain/chats/events.ts): a meeting in 5 minutes matters whatever is on screen. A click opens Waiting.
export function tick() {
  calendar.now = Date.now();
  for (const meeting of bannerDue(calendar.list, calendar.now, calendar.sent)) {
    calendar.sent.add(meeting.id);
    invoke("notify", {
      key: VIEW.wait,
      title: t("cal.banner", { time: timeOf(meeting.start) }),
      body: meeting.title.slice(0, 160),
    });
  }
  changed();
}
