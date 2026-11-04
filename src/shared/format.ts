// Dates and numbers in a locale. Intl formatters are slow to make and the reads run on every store change, so each
// one is made once per locale and options.
const made = new Map<string, unknown>();
const once = <T>(id: string, make: () => T): T => {
  if (!made.has(id)) made.set(id, make());
  return made.get(id) as T;
};
export const numberFormat = (locale: string, options: Intl.NumberFormatOptions) =>
  once(`number|${locale}|${JSON.stringify(options)}`, () => new Intl.NumberFormat(locale, options));
export const dateFormat = (locale: string, options: Intl.DateTimeFormatOptions) =>
  once(`date|${locale}|${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options));
export const relativeFormat = (locale: string, options: Intl.RelativeTimeFormatOptions) =>
  once(`relative|${locale}|${JSON.stringify(options)}`, () => new Intl.RelativeTimeFormat(locale, options));
export const pluralRules = (lang: string) => once(`plural|${lang}`, () => new Intl.PluralRules(lang));

/** A day: "30 sep." this year, "30 sep. 2025" before (the year only when it is not this year's). */
export function dayMonth(iso: string, locale: string, now = new Date()) {
  const date = new Date(iso);
  const otherYear = date.getFullYear() !== now.getFullYear();
  return dateFormat(locale, { day: "numeric", month: "short", ...(otherYear ? { year: "numeric" } : {}) }).format(date);
}
/** When something happened in a conversation: the clock time today, the day and the time before ("14 okt. 09:12"). */
export function sentAt(ms: number, locale: string, now = new Date()) {
  const date = new Date(ms);
  const time = dateFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return date.toDateString() === now.toDateString() ? time : `${dayMonth(date.toISOString(), locale, now)} ${time}`;
}
/** A clock time: hours and minutes, always on the 24-hour clock ("17:53", never "05:53 PM"). */
export const clockTime = (iso: string, locale: string) =>
  dateFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
/** A file's size the way Finder says it: "840 KB", "1,2 MB" (decimal units, one decimal from a megabyte up). */
export function fileSize(bytes: number, locale: string) {
  const [value, unit] =
    bytes < 1e3
      ? [bytes, "B"]
      : bytes < 1e6
        ? [bytes / 1e3, "KB"]
        : bytes < 1e9
          ? [bytes / 1e6, "MB"]
          : [bytes / 1e9, "GB"];
  return `${numberFormat(locale, { maximumFractionDigits: unit === "B" || unit === "KB" ? 0 : 1 }).format(value)} ${unit}`;
}
