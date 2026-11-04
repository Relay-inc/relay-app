import type { Meeting } from "../../domain/calendar/types";
import { makeStore } from "../make-store";

type CalendarState = {
  list: Meeting[];
  errors: string[]; // per calendar that did not load
  now: number; // moved on by the tick, so "in 4 min" counts down
  opened: Record<string, Meeting>; // the meetings the Meeting view was opened on, for the ones the list does not hold
  note: { id: string; path: string; text: string; hash: string } | null; // the open Meeting view's note, as last read or written
  noted: string; // the meeting whose note has been looked for (note is null when it has none yet)
  conflict: boolean; // its notes were changed outside Relay: what is typed is not written over them
  error: string; // why the last write to it failed
};

export const useCalendarStore = makeStore<CalendarState>(() => ({
  list: [],
  errors: [],
  now: Date.now(),
  opened: {},
  note: null,
  noted: "",
  conflict: false,
  error: "",
}));
