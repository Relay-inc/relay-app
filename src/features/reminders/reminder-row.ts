import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t, th, raw, currentLocale } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { md } from "../../core/markdown";
import { tw } from "../../core/styles";
import type { Reminder } from "../../domain/reminders";
import "./reminder-calendar";

declare global {
  interface HTMLElementEventMap {
    "reminder-chat": CustomEvent<string>; "reminder-done": CustomEvent<string>; "reminder-cal": CustomEvent<string>;
    "reminder-push": CustomEvent<{ id: string; date: string }>;
  }
}

/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
const DUE = { late: "due-late", soon: "due-soon", "": "" };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// some translations get markup around their numbers, so those go in raw; the values are escaped first
const num = (s: string | number) => raw(`<span class="font-mono tabular-nums">${esc(String(s))}</span>`);

function when(r: Reminder) {
  if (r.days < 0) return th("due.overdue", { n: num(-r.days) });
  if (r.days === 0) return t("due.today");
  const [y, m, d] = r.date.split("-").map(Number), day = new Date(Date.UTC(y, m - 1, d)), fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(currentLocale(), { ...o, timeZone: "UTC" }).format(day);
  return html`${fmt({ weekday: "short" })} <span class="font-mono tabular-nums">${fmt({ day: "numeric", month: "numeric" })}</span>`;
}

// the buttons override the generic .btn: 26px high, icons 15px in the secondary colour (accent on hover)
const BTN = "btn h-[26px]! px-[9px]! text-sm whitespace-nowrap disabled:opacity-50";
const IBTN = `${BTN} group relative grid place-items-center w-[26px]! px-0! after:content-[attr(data-tip)] after:absolute after:bottom-[calc(100%+6px)] after:left-1/2 after:-translate-x-1/2 after:z-[6] after:px-[7px] after:py-[3px] after:rounded-[5px] after:bg-[rgba(30,30,30,.92)] after:text-white after:text-xs after:whitespace-nowrap after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-[120ms] after:ease-app hover:after:opacity-100 hover:after:delay-[350ms]`;
const G = "glyph w-[15px]! h-[15px]! stroke-secondary! [stroke-width:1.5]! group-hover:stroke-accent!";

/** One reminder: title, project, due date, repeat and the actions. `urgency` is the domain's "late" | "soon" | "". */
@customElement("relay-reminder-row")
export class ReminderRow extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property({ attribute: false }) reminder!: Reminder;
  @property() label = ""; // the project as it is shown
  @property() urgency: "late" | "soon" | "" = "";
  @property({ type: Boolean }) busy = false; // an action of this row is running
  @property({ type: Boolean }) cal = false; // its date picker is open

  render() {
    const r = this.reminder, off = this.busy, id = r.id;
    return html`<div class="list-row">
      <div class="min-w-0"><div class="text-xl leading-[1.45] line-clamp-2 ${r.days < 0 ? "font-semibold" : ""} [&_code]:font-mono [&_code]:text-md [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:rounded-xs [&_a]:text-[color:-webkit-link] [&_a]:underline [&_.vlink]:text-accent [&_.vlink]:no-underline [&_.vlink:hover]:underline">${md(r.title)}</div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5">${r.project ? html`<span>${this.label}</span>` : nothing}<span class=${DUE[this.urgency]}>${when(r)}</span>${r.repeat ? html`<span>${th("rem.every", { n: num(r.repeat) })}</span>` : nothing}</div></div>
      <div class="relative flex items-center gap-1.5">
        <button class=${IBTN} ?disabled=${off} @click=${() => emit(this, "reminder-chat", id)} data-tip=${t("rem.chat")} aria-label=${t("rem.chat")}>${icon("chat", G)}</button>
        <button class=${IBTN} ?disabled=${off} @click=${() => emit(this, "reminder-done", id)} data-tip=${t("rem.done")} aria-label=${t("rem.done")}>${icon("check", G)}</button>
        <button class=${BTN} ?disabled=${off} @click=${() => emit(this, "reminder-push", { id, date: "morgen" })}>${t("rem.tomorrow")}</button>
        <button class=${BTN} ?disabled=${off} @click=${() => emit(this, "reminder-push", { id, date: "+1w" })}>${t("rem.plusWeek")}</button>
        <button class=${IBTN} data-rem-cal ?disabled=${off} @click=${() => emit(this, "reminder-cal", id)} data-tip=${t("rem.pick")} aria-label=${t("rem.pick")}>${icon("cal", G)}</button>
        ${this.cal ? html`<relay-reminder-calendar @date-pick=${(e: CustomEvent<string>) => emit(this, "reminder-push", { id, date: e.detail })}></relay-reminder-calendar>` : nothing}
      </div></div>`;
  }
}
