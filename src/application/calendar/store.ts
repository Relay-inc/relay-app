import type { Meeting } from "../../domain/calendar/types";
import { makeStore } from "../make-store";

type CalendarState = {
  list: Meeting[];
  errors: string[]; // per calendar that did not load
  now: number; // moved on by the tick, so "in 4 min" counts down
};

export const useCalendarStore = makeStore<CalendarState>(() => ({ list: [], errors: [], now: Date.now() }));
