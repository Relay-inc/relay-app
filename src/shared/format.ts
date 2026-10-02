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
