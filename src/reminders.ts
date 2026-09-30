import { t, currentLang } from "./i18n";
import type { Key } from "./locales/en";

/** red when overdue, orange today and in the next 2 days, grey after that (Laurent, 29/9) */
export const urgency = (days: number) => days < 0 ? "due-late" : days <= 2 ? "due-soon" : "";

export type Reminder = { id: string; date: string; days: number; project: string | null; title: string; repeat: string | null };
type H = { esc: (s: unknown) => string; md: (s: string) => string; projectLabel: (p: string | null) => string };

const GROUPS: [Key, (d: number) => boolean][] = [
  ["rem.late", d => d < 0], ["rem.today", d => d === 0], ["rem.week", d => d >= 1 && d <= 7], ["rem.later", d => d > 7],
];

function when(r: Reminder): string {
  if (r.days < 0) return t("due.overdue", { n: `<span class="rem-n">${-r.days}</span>` });
  if (r.days === 0) return t("due.today");
  const [y, m, d] = r.date.split("-").map(Number), day = new Date(Date.UTC(y, m - 1, d)), fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(currentLang(), { ...o, timeZone: "UTC" }).format(day);
  return `${fmt({ weekday: "short" })} <span class="rem-n">${fmt({ day: "numeric", month: "numeric" })}</span>`;
}

export function renderReminders(rem: Reminder[], h: H): string {
  const row = (r: Reminder) => {
    const id = h.esc(r.id);
    const proj = r.project ? `<span>${h.esc(h.projectLabel(r.project))}</span>` : "";
    const rep = r.repeat ? `<span>${t("rem.every", { n: `<span class="rem-n">${h.esc(r.repeat)}</span>` })}</span>` : "";
    return `<div class="rem-row${r.days < 0 ? " late" : ""}">
      <div class="rem-main"><div class="rem-t">${h.md(r.title)}</div>
        <div class="rem-meta">${proj}<span class="${urgency(r.days)}">${when(r)}</span>${rep}</div></div>
      <div class="rem-acts">
        <button class="btn" data-rem="done" data-id="${id}">${t("rem.done")}</button>
        <button class="btn" data-rem="push" data-date="morgen" data-id="${id}">${t("rem.tomorrow")}</button>
        <button class="btn" data-rem="push" data-date="+1w" data-id="${id}">${t("rem.plusWeek")}</button>
        <input class="rem-date" type="date" data-rem-date data-id="${id}" min="${h.esc(r.date)}" aria-label="${t("rem.pick")}">
      </div></div>`;
  };
  const out = GROUPS.map(([name, f]) => {
    const items = rem.filter(r => f(r.days)).sort((a, b) => a.days - b.days);
    return items.length
      ? `<section class="rem-grp"><h2 class="rem-h">${t(name)} <span class="rem-n">${items.length}</span></h2>${items.map(row).join("")}</section>`
      : "";
  }).join("");
  return out || `<div class="rem-empty">${t("rem.none")}</div>`;
}

export function onRemindersEvent(e: Event, act: (action: "done" | "push", id: string, date?: string) => Promise<void>): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  let action: "done" | "push", id: string, date: string | undefined, src: HTMLElement;
  if (e.type === "click") {
    const b = t.closest<HTMLElement>("[data-rem]");
    if (!b) return false;
    src = b; action = b.dataset.rem as "done" | "push"; id = b.dataset.id!; date = b.dataset.date;
  } else if (e.type === "change") {
    const i = t.closest<HTMLInputElement>("[data-rem-date]");
    if (!i) return false;
    if (!i.value) return true;
    src = i; action = "push"; id = i.dataset.id!; date = i.value;
  } else return false;
  const ctl = src.closest(".rem-row")?.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input") ?? [];
  ctl.forEach(c => (c.disabled = true));
  act(action, id, date).catch(() => ctl.forEach(c => (c.disabled = false)));
  return true;
}
