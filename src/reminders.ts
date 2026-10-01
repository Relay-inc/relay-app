import { t, currentLocale } from "./i18n";
import type { Key } from "./locales/en";

/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
export const urgency = (days: number) => days < 0 ? "due-late" : days <= 2 ? "due-soon" : "";

export type Reminder = { id: string; date: string; days: number; project: string | null; title: string; text: string; repeat: string | null };
type H = { esc: (s: unknown) => string; md: (s: string) => string; projectLabel: (p: string | null) => string; glyph: (n: string) => string };

const GROUPS: [Key, (d: number) => boolean][] = [
  ["rem.late", d => d < 0], ["rem.today", d => d === 0], ["rem.tomorrow", d => d === 1], ["rem.week", d => d >= 2 && d <= 7], ["rem.later", d => d > 7],
];

function when(r: Reminder): string {
  if (r.days < 0) return t("due.overdue", { n: `<span class="rem-n">${-r.days}</span>` });
  if (r.days === 0) return t("due.today");
  const [y, m, d] = r.date.split("-").map(Number), day = new Date(Date.UTC(y, m - 1, d)), fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(currentLocale(), { ...o, timeZone: "UTC" }).format(day);
  return `${fmt({ weekday: "short" })} <span class="rem-n">${fmt({ day: "numeric", month: "numeric" })}</span>`;
}

// ---------- the new-reminder form: the draft lives here so a snapshot redraw keeps what was typed
type Project = { name: string; label: string };
const REPEATS = ["", "1w", "14d", "1m", "3m"];
const draft = { open: false, text: "", date: "", project: "", repeat: "", err: "", busy: false };
let projects: Project[] = [], mapped = "";
const todayIso = (plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };

function form(h: Pick<H, "esc">): string {
  if (!draft.open) return `<div class="rem-new"><button class="btn" data-rem-new>${t("rem.new")}</button></div>`;
  if (!draft.date) draft.date = todayIso(1);
  const opt = (v: string, l: string, cur: string) => `<option value="${h.esc(v)}"${v === cur ? " selected" : ""}>${h.esc(l)}</option>`;
  return `<div class="rem-new open">
    <input class="rem-f" data-rem-f="text" value="${h.esc(draft.text)}" placeholder="${t("rem.newText")}" aria-label="${t("rem.newText")}" spellcheck="false">
    <div class="rem-new-row">
      <input type="date" class="rem-f" data-rem-f="date" value="${draft.date}" min="${todayIso()}" aria-label="${t("rem.newDate")}">
      <select class="rem-f" data-rem-f="project" aria-label="${t("rem.newProject")}">${opt("", t("rem.noProject"), draft.project)}${projects.map(p => opt(p.name, p.label, draft.project)).join("")}</select>
      <select class="rem-f" data-rem-f="repeat" aria-label="${t("rem.newRepeat")}">${REPEATS.map(r => opt(r, r ? t("rem.every", { n: r }) : t("rem.noRepeat"), draft.repeat)).join("")}</select>
      <span class="rem-new-go"><button class="btn" data-rem-cancel>${t("rem.cancel")}</button>
        <button class="btn primary" data-rem-add${draft.busy ? " disabled" : ""}>${t("rem.add")}</button></span></div>
    ${draft.err ? `<div class="rem-err" role="alert">${h.esc(draft.err)}</div>` : ""}</div>`;
}

let formEsc: (s: unknown) => string = String;
function redrawForm() {
  const el = document.querySelector<HTMLElement>(".rem-new");
  if (el) el.outerHTML = form({ esc: formEsc });
  if (draft.open) document.querySelector<HTMLInputElement>('[data-rem-f="text"]')?.focus();
}

/** runs a full redraw and puts the caret back in the form when it had focus, so typing survives a snapshot reload */
export function keepFormFocus(redraw: () => void) {
  const a = document.activeElement as HTMLElement | null, f = a?.closest?.(".rem-new") ? a.dataset.remF : undefined;
  redraw();
  if (!f) return;
  const n = document.querySelector<HTMLInputElement>(`[data-rem-f="${f}"]`);
  n?.focus(); if (n?.type === "text") n.setSelectionRange(n.value.length, n.value.length);
}

async function submit(add: Add) {
  const text = draft.text.trim();
  if (!text || !draft.date || draft.busy) { if (!text) document.querySelector<HTMLInputElement>('[data-rem-f="text"]')?.focus(); return; }
  draft.busy = true; draft.err = ""; redrawForm();
  try { await add(text, draft.date, draft.project || null, draft.repeat || null); Object.assign(draft, { open: false, text: "", date: "", project: "", repeat: "" }); }
  catch (e) { draft.err = String(e); }
  draft.busy = false; redrawForm();
}

type Add = (text: string, date: string, project: string | null, repeat: string | null) => Promise<void>;

/** typing, selecting and Enter/Escape in the form */
export function onReminderField(e: Event, add: Add): void {
  const n = (e.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-rem-f]");
  if (!n) return;
  if (e.type === "input" || e.type === "change") { (draft as any)[n.dataset.remF!] = n.value; return; }
  if (!(e instanceof KeyboardEvent) || e.isComposing) return;
  if (e.key === "Enter" && n.dataset.remF === "text") { e.preventDefault(); submit(add); }
  else if (e.key === "Escape") { draft.open = false; draft.err = ""; redrawForm(); }
}

/** `found`: which vault paths exist. Without a reminders file, a hint that the first reminder creates it at `path`. */
export function renderReminders(rem: Reminder[], h: H, found?: { reminders?: boolean }, path = "", projs: Project[] = []): string {
  glyphOf = h.glyph; formEsc = h.esc; projects = projs; mapped = path;
  const row = (r: Reminder) => {
    const id = h.esc(r.id);
    const proj = r.project ? `<span>${h.esc(h.projectLabel(r.project))}</span>` : "";
    const rep = r.repeat ? `<span>${t("rem.every", { n: `<span class="rem-n">${h.esc(r.repeat)}</span>` })}</span>` : "";
    return `<div class="rem-row${r.days < 0 ? " late" : ""}">
      <div class="rem-main"><div class="rem-t">${h.md(r.title)}</div>
        <div class="rem-meta">${proj}<span class="${urgency(r.days)}">${when(r)}</span>${rep}</div></div>
      <div class="rem-acts">
        <button class="btn ic" data-rem-chat data-id="${id}" data-tip="${t("rem.chat")}" aria-label="${t("rem.chat")}">${h.glyph("chat")}</button>
        <button class="btn ic" data-rem="done" data-id="${id}" data-tip="${t("rem.done")}" aria-label="${t("rem.done")}">${h.glyph("check")}</button>
        <button class="btn" data-rem="push" data-date="morgen" data-id="${id}">${t("rem.tomorrow")}</button>
        <button class="btn" data-rem="push" data-date="+1w" data-id="${id}">${t("rem.plusWeek")}</button>
        <button class="btn ic" data-rem-cal data-id="${id}" data-tip="${t("rem.pick")}" aria-label="${t("rem.pick")}">${h.glyph("cal")}</button>
        ${cal?.id === r.id ? calendar() : ""}
      </div></div>`;
  };
  const out = GROUPS.map(([name, f]) => {
    const items = rem.filter(r => f(r.days)).sort((a, b) => a.days - b.days);
    return items.length
      ? `<section class="rem-grp"><h2 class="rem-h">${t(name)} <span class="rem-n">${items.length}</span></h2>${items.map(row).join("")}</section>`
      : "";
  }).join("");
  const hint = found?.reminders === false ? t("rem.noFile", { path: `<code>${h.esc(mapped)}</code>` }) : "";
  return form(h) + (hint ? `<div class="meta rem-hint">${hint}</div>` : "") + (out || `<div class="rem-empty">${t("rem.none")}</div>`);
}

// ---------- the date picker: a month grid under the calendar button, past days off, Monday first
let cal: { id: string; y: number; m: number } | null = null;
let glyphOf: (n: string) => string = () => "";
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function calendar(): string {
  if (!cal) return "";
  const glyph = glyphOf;
  const { y, m } = cal, now = new Date(), today = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const f = (o: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(currentLocale(), o).format(d);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
  const wd = Array.from({ length: 7 }, (_, i) => `<span>${f({ weekday: "narrow" }, new Date(2024, 0, 1 + i))}</span>`).join("");
  const days = Array.from({ length: n }, (_, i) => {
    const d = iso(y, m, i + 1);
    return `<button data-cal-day="${d}"${d < today ? " disabled" : ""}${d === today ? ' class="today"' : ""}>${i + 1}</button>`;
  }).join("");
  const first = y === now.getFullYear() && m === now.getMonth();
  return `<div class="rem-cal" role="dialog" aria-label="${t("rem.pick")}">
    <div class="cal-top"><span class="cal-m">${f({ month: "long", year: "numeric" }, new Date(y, m, 1))}</span>
      <button data-cal-nav="-1"${first ? " disabled" : ""} aria-label="${t("cal.prev")}">${glyph("left")}</button>
      <button data-cal-nav="1" aria-label="${t("cal.next")}">${glyph("right")}</button></div>
    <div class="cal-wd">${wd}</div><div class="cal-grid">${"<span></span>".repeat(lead)}${days}</div></div>`;
}

// redraws only the popover, the list stays as it is. Near the bottom of the view it opens upwards.
function redrawCal() {
  document.querySelector(".rem-cal")?.remove();
  const b = cal && document.querySelector<HTMLElement>(`[data-rem-cal][data-id="${cal.id}"]`);
  if (!b) return;
  b.insertAdjacentHTML("afterend", calendar());
  const pop = b.nextElementSibling as HTMLElement, box = b.closest(".log")?.getBoundingClientRect();
  if (box && pop.getBoundingClientRect().bottom > box.bottom) pop.classList.add("up");
}
const closeCal = (e: Event) => {
  if (!cal) return;
  if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest?.(".rem-cal,[data-rem-cal]")) { cal = null; redrawCal(); }
};
document.addEventListener("pointerdown", closeCal);
document.addEventListener("keydown", closeCal);

export function onRemindersEvent(e: Event, act: (action: "done" | "push", id: string, date?: string) => Promise<void>, add: Add): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (e.type === "click") {
    if (t.closest("[data-rem-new]")) { draft.open = true; redrawForm(); return true; }
    if (t.closest("[data-rem-cancel]")) { draft.open = false; draft.err = ""; redrawForm(); return true; }
    if (t.closest("[data-rem-add]")) { submit(add); return true; }
  }
  let action: "done" | "push", id: string, date: string | undefined, src: HTMLElement;
  if (e.type !== "click") return false;
  const c = t.closest<HTMLElement>("[data-rem-cal],[data-cal-nav]"), day = t.closest<HTMLElement>("[data-cal-day]");
  if (c) {
    if (c.dataset.calNav) { const d = new Date(cal!.y, cal!.m + Number(c.dataset.calNav)); cal = { ...cal!, y: d.getFullYear(), m: d.getMonth() }; }
    else if (cal?.id === c.dataset.id) cal = null;
    else { const now = new Date(); cal = { id: c.dataset.id!, y: now.getFullYear(), m: now.getMonth() }; }
    redrawCal();
    return true;
  }
  if (day && cal) {
    src = day; action = "push"; id = cal.id; date = day.dataset.calDay; cal = null; redrawCal();
  } else {
    const b = t.closest<HTMLElement>("[data-rem]");
    if (!b) return false;
    src = b; action = b.dataset.rem as "done" | "push"; id = b.dataset.id!; date = b.dataset.date;
  }
  const ctl = src.closest(".rem-row")?.querySelectorAll<HTMLButtonElement>("button") ?? [];
  ctl.forEach(c => (c.disabled = true));
  act(action, id, date).catch(() => ctl.forEach(c => (c.disabled = false)));
  return true;
}
