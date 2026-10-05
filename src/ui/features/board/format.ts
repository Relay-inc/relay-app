import { dateFormat } from "../../../shared/format";

// The board's dates, in the UI's locale.

const DAY = 864e5;
const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
/** A due day (yyyy-mm-dd): 3/10 short, "Sat 3 Oct" long, "3 Oct" for after Yesterday, Today or Tomorrow (`left`
 *  days from today), red when past, orange up to two days ahead. */
export function due(iso: string | null | undefined, locale: string, now = new Date()) {
  if (!iso) return null;
  const at = day(iso);
  const left = Math.round((at.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);
  return {
    short: `${at.getDate()}/${at.getMonth() + 1}`,
    long: dateFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(at),
    dayMonth: dateFormat(locale, { day: "numeric", month: "short" }).format(at),
    left,
    tone: left < 0 ? "text-late" : left <= 2 ? "text-soon" : "text-secondary",
  };
}
/** The last update as "Sep 29". */
export const updated = (iso: string | undefined, locale: string) =>
  iso ? dateFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso)) : "";
/** A feed entry's time: "29 Sep, 14:05". */
export const when = (iso: string, locale: string) =>
  dateFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** A file's size: kB, or MB from a million bytes. */
export const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
/** A card's number as shown: #12 when only digits, Linear's ENG-12 as it is. */
export const numbered = (number: string) => `${/^\d+$/.test(number) ? "#" : ""}${number}`;
