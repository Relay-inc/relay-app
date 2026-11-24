// The calendar layout of a collection (issue 423): which days a month or a week shows, Monday first, and on which day a
// row falls. Dates are local calendar days (yyyy-mm-dd), never UTC's.
import { localToday as iso, valuesOf, type Row } from "./rules.ts";

/** A yyyy-mm-dd as the local midnight it starts at. */
export const localDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** The days before the 1st in a Monday-first month grid (0 when the month starts on a Monday). */
export const leadingDays = (year: number, month: number) => (new Date(year, month, 1).getDay() + 6) % 7;

/** The weeks a month grid shows (`month` 0-11): seven dates each, Monday first, the days of the months around it
 *  filling the first and the last week. */
export function monthWeeks(year: number, month: number): string[][] {
  const last = new Date(year, month + 1, 0).getDate();
  const weeks: string[][] = [];
  for (let day = 1 - leadingDays(year, month); day <= last; day += 7)
    weeks.push(Array.from({ length: 7 }, (_, i) => iso(new Date(year, month, day + i))));
  return weeks;
}

/** The Monday to Sunday a date is in. */
export function weekOf(date: string): string[] {
  const d = localDate(date);
  const monday = d.getDate() - ((d.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => iso(new Date(d.getFullYear(), d.getMonth(), monday + i)));
}

/** The date shown after a step back (-1) or on (1): the 1st of the month before or after, or the same day a week
 *  away. */
export function shift(date: string, mode: "month" | "week", step: number): string {
  const d = localDate(date);
  return iso(
    mode === "month"
      ? new Date(d.getFullYear(), d.getMonth() + step, 1)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * step),
  );
}

/** A row's day: its `date:` when that is a real ISO date (a time after it is fine), else "". */
export function dayOf(row: Row): string {
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(valuesOf(row, "date")[0] ?? "")?.[1] ?? "";
  return day && iso(localDate(day)) === day ? day : "";
}

/** The rows by their day, in the order given, and the rows that have none. */
export function byDay(rows: Row[]): { days: Map<string, Row[]>; undated: Row[] } {
  const days = new Map<string, Row[]>();
  const undated: Row[] = [];
  for (const row of rows) {
    const day = dayOf(row);
    if (day) days.set(day, [...(days.get(day) ?? []), row]);
    else undated.push(row);
  }
  return { days, undated };
}
