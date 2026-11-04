import type { MeetingStage } from "../../domain/calendar/rules";
import type { Meeting } from "../../domain/calendar/types";
import type { Owed } from "../../domain/today/day";
import { useCalendarStore } from "../calendar/store";
import { useRecordingStore } from "../calendar/recording";
import { meetingById, openMeetingView } from "../calendar/meeting-view";
import { meetingsOfToday } from "./today";

/** What the day strip, the card above the queue and the wrap-ups read: today's timed meetings (with the one being
 *  recorded, also an ad-hoc one the calendar does not have), each one's stage (from its note, "live" while it is
 *  recorded) and whether a follow-up was drafted. All-day events are not in the calendar's list. */
export function dayInputs(now: number) {
  const rec = useRecordingStore.getState();
  const digests = useCalendarStore.getState().digests;
  const meetings = meetingsOfToday(now);
  const recorded = rec.phase === "recording" ? rec.meeting : null;
  const all: Meeting[] = recorded && !meetings.some(m => m.id === recorded.id) ? [...meetings, recorded] : meetings;
  const stages: Record<string, MeetingStage> = {};
  const followed: Record<string, boolean> = {};
  for (const m of all) {
    stages[m.id] = recorded?.id === m.id ? "live" : (digests[m.id]?.stage ?? "planned");
    followed[m.id] = !!digests[m.id]?.followed;
  }
  return { meetings: all, stages, followed };
}

/** A meeting that is owed its wrap-up, opened on Wrap-up: the calendar's copy when it has one, else the meeting as its
 *  note describes it (an earlier day's). */
export function openOwed(owed: Owed) {
  const known = meetingById(owed.id);
  const end = new Date(Date.parse(owed.start) + 3_600_000).toISOString();
  return openMeetingView(
    known ?? {
      id: owed.id,
      feed: "",
      title: owed.title,
      start: owed.start,
      end,
      location: "",
      join: "",
      organizer: "",
      people: [],
    },
  );
}
