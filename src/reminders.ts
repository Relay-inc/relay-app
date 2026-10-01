import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { t, th, raw, currentLocale } from "./i18n";
import type { Key } from "./locales/en";
import { RelayElement, styles } from "./lib/store";
import { S, pLabel, projectsByLabel } from "./app/state";
import { remAct, remAdd, remChat } from "./app/actions";
import { md } from "./lib/md";
import { icon } from "./icons";
import css from "./reminders.css?inline";

/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
export const urgency = (days: number) => days < 0 ? "due-late" : days <= 2 ? "due-soon" : "";

export type Reminder = { id: string; date: string; days: number; project: string | null; title: string; text: string; repeat: string | null };

const GROUPS: [Key, (d: number) => boolean][] = [
  ["rem.late", d => d < 0], ["rem.today", d => d === 0], ["rem.tomorrow", d => d === 1], ["rem.week", d => d >= 2 && d <= 7], ["rem.later", d => d > 7],
];
const REPEATS = ["", "1w", "14d", "1m", "3m"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const todayIso = (plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// some translations get markup around their numbers, so those go in raw; the values are escaped first
const num = (s: string | number) => raw(`<span class="rem-n">${esc(String(s))}</span>`);

function when(r: Reminder) {
  if (r.days < 0) return th("due.overdue", { n: num(-r.days) });
  if (r.days === 0) return t("due.today");
  const [y, m, d] = r.date.split("-").map(Number), day = new Date(Date.UTC(y, m - 1, d)), fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(currentLocale(), { ...o, timeZone: "UTC" }).format(day);
  return html`${fmt({ weekday: "short" })} <span class="rem-n">${fmt({ day: "numeric", month: "numeric" })}</span>`;
}

/**
 * The reminders view. The half-typed form and the open date picker survive snapshot reloads (the store only
 * redraws it); it reads the store and calls the actions itself.
 */
const draft = { open: false, text: "", date: "", project: "", repeat: "", err: "", busy: false };

export class RelayReminders extends RelayElement {
  static styles = styles(css);

  // the new-reminder form lives outside the element, so a half-typed reminder survives switching views
  private draft = draft;
  private cal: { id: string; y: number; m: number } | null = null;
  private busy: string | null = null; // the row whose action is running
  private focusText = false;

  connectedCallback() { super.connectedCallback(); document.addEventListener("pointerdown", this.closeCal); document.addEventListener("keydown", this.closeCal); }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener("pointerdown", this.closeCal); document.removeEventListener("keydown", this.closeCal); }

  private closeCal = (e: Event) => {
    if (!this.cal) return;
    // the document sees the host, not what is inside the shadow root: the path tells inside from outside
    if (e instanceof KeyboardEvent ? e.key === "Escape" : !e.composedPath().some(n => n instanceof Element && n.matches(".rem-cal,[data-rem-cal]"))) { this.cal = null; this.requestUpdate(); }
  };

  // the scrolling ancestor, through the shadow roots on the way up
  private scroller(): HTMLElement | null {
    let n: Node | null = this;
    while (n) {
      if (n instanceof HTMLElement && getComputedStyle(n).overflowY === "auto") return n;
      n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
    }
    return null;
  }

  updated() {
    if (this.focusText) { this.focusText = false; this.renderRoot.querySelector<HTMLInputElement>('[data-rem-f="text"]')?.focus(); }
    // near the bottom of the view the picker opens upwards
    const pop = this.renderRoot.querySelector<HTMLElement>(".rem-cal");
    if (pop) { pop.classList.remove("up"); if (pop.getBoundingClientRect().bottom > (this.scroller()?.getBoundingClientRect().bottom ?? innerHeight)) pop.classList.add("up"); }
  }

  private setDraft(p: Partial<RelayReminders["draft"]>) { Object.assign(this.draft, p); this.requestUpdate(); }

  private async submit() {
    const d = this.draft, text = d.text.trim();
    if (!text) { this.focusText = true; this.requestUpdate(); return; }
    if (!d.date || d.busy) return;
    this.setDraft({ busy: true, err: "" });
    try { await remAdd(text, d.date, d.project || null, d.repeat || null); this.setDraft({ open: false, text: "", date: "", project: "", repeat: "" }); }
    catch (e) { this.setDraft({ err: String(e) }); }
    this.setDraft({ busy: false });
  }

  private async run(id: string, action: "done" | "push", date?: string) {
    this.busy = id; this.cal = null; this.requestUpdate();
    try { await remAct(action, id, date); } finally { this.busy = null; this.requestUpdate(); }
  }

  /** Enter in the text field adds, Escape anywhere in the form closes it */
  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const f = (e.target as HTMLElement).dataset.remF;
    if (e.key === "Enter" && f === "text") { e.preventDefault(); this.submit(); }
    else if (e.key === "Escape") this.setDraft({ open: false, err: "" });
  };

  private form() {
    const d = this.draft;
    if (!d.open) return html`<div class="rem-new"><button class="btn" @click=${() => { this.focusText = true; this.setDraft({ open: true }); }}>${t("rem.new")}</button></div>`;
    if (!d.date) d.date = todayIso(1);
    // the draft follows the fields without a redraw, the browser already shows what was typed
    const set = (f: "text" | "date" | "project" | "repeat") => (e: Event) => { d[f] = (e.target as HTMLInputElement).value; };
    const opt = (v: string, l: string, cur: string) => html`<option value=${v} ?selected=${v === cur}>${l}</option>`;
    return html`<div class="rem-new open" @keydown=${this.onKey}>
      <input class="rem-f" data-rem-f="text" .value=${live(d.text)} @input=${set("text")} placeholder=${t("rem.newText")} aria-label=${t("rem.newText")} spellcheck="false">
      <div class="rem-new-row">
        <input type="date" class="rem-f" data-rem-f="date" .value=${live(d.date)} @change=${set("date")} min=${todayIso()} aria-label=${t("rem.newDate")}>
        <select class="rem-f" data-rem-f="project" @change=${set("project")} aria-label=${t("rem.newProject")}>
          ${opt("", t("rem.noProject"), d.project)}${projectsByLabel(currentLocale()).map((p: { name: string; label: string }) => opt(p.name, p.label, d.project))}</select>
        <select class="rem-f" data-rem-f="repeat" @change=${set("repeat")} aria-label=${t("rem.newRepeat")}>
          ${REPEATS.map(r => opt(r, r ? t("rem.every", { n: r }) : t("rem.noRepeat"), d.repeat))}</select>
        <span class="rem-new-go"><button class="btn" @click=${() => this.setDraft({ open: false, err: "" })}>${t("rem.cancel")}</button>
          <button class="btn primary" ?disabled=${d.busy} @click=${() => this.submit()}>${t("rem.add")}</button></span></div>
      ${d.err ? html`<div class="rem-err" role="alert">${d.err}</div>` : nothing}</div>`;
  }

  private toggleCal(id: string) {
    const now = new Date();
    this.cal = this.cal?.id === id ? null : { id, y: now.getFullYear(), m: now.getMonth() };
    this.requestUpdate();
  }

  // a month grid under the calendar button, past days off, Monday first
  private calendar() {
    const { y, m, id } = this.cal!, now = new Date(), today = iso(now.getFullYear(), now.getMonth(), now.getDate());
    const f = (o: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(currentLocale(), o).format(d);
    const lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const nav = (step: number) => { const d = new Date(y, m + step); this.cal = { id, y: d.getFullYear(), m: d.getMonth() }; this.requestUpdate(); };
    return html`<div class="rem-cal" role="dialog" aria-label=${t("rem.pick")}>
      <div class="cal-top"><span class="cal-m">${f({ month: "long", year: "numeric" }, new Date(y, m, 1))}</span>
        <button ?disabled=${y === now.getFullYear() && m === now.getMonth()} @click=${() => nav(-1)} aria-label=${t("cal.prev")}>${icon("left")}</button>
        <button @click=${() => nav(1)} aria-label=${t("cal.next")}>${icon("right")}</button></div>
      <div class="cal-wd">${Array.from({ length: 7 }, (_, i) => html`<span>${f({ weekday: "narrow" }, new Date(2024, 0, 1 + i))}</span>`)}</div>
      <div class="cal-grid">${Array.from({ length: lead }, () => html`<span></span>`)}${Array.from({ length: days }, (_, i) => {
        const d = iso(y, m, i + 1);
        return html`<button ?disabled=${d < today} class=${d === today ? "today" : ""} @click=${() => this.run(id, "push", d)}>${i + 1}</button>`;
      })}</div></div>`;
  }

  private row(r: Reminder) {
    const off = this.busy === r.id, g = icon;
    return html`<div class="rem-row${r.days < 0 ? " late" : ""}">
      <div class="rem-main"><div class="rem-t">${md(r.title)}</div>
        <div class="rem-meta">${r.project ? html`<span>${pLabel(r.project)}</span>` : nothing}<span class=${urgency(r.days)}>${when(r)}</span>${r.repeat ? html`<span>${th("rem.every", { n: num(r.repeat) })}</span>` : nothing}</div></div>
      <div class="rem-acts">
        <button class="btn ic" ?disabled=${off} @click=${() => remChat(r.id)} data-tip=${t("rem.chat")} aria-label=${t("rem.chat")}>${g("chat")}</button>
        <button class="btn ic" ?disabled=${off} @click=${() => this.run(r.id, "done")} data-tip=${t("rem.done")} aria-label=${t("rem.done")}>${g("check")}</button>
        <button class="btn" ?disabled=${off} @click=${() => this.run(r.id, "push", "morgen")}>${t("rem.tomorrow")}</button>
        <button class="btn" ?disabled=${off} @click=${() => this.run(r.id, "push", "+1w")}>${t("rem.plusWeek")}</button>
        <button class="btn ic" data-rem-cal ?disabled=${off} @click=${() => this.toggleCal(r.id)} data-tip=${t("rem.pick")} aria-label=${t("rem.pick")}>${g("cal")}</button>
        ${this.cal?.id === r.id ? this.calendar() : nothing}
      </div></div>`;
  }

  render() {
    const reminders: Reminder[] = S.snap.reminders;
    const groups = GROUPS.map(([name, f]) => {
      const items = reminders.filter(r => f(r.days)).sort((a, b) => a.days - b.days);
      return items.length ? html`<section class="rem-grp"><h2 class="rem-h">${t(name)} <span class="rem-n">${items.length}</span></h2>${items.map(r => this.row(r))}</section>` : nothing;
    });
    return html`${this.form()}
      ${S.snap.vault?.found?.reminders === false ? html`<div class="meta rem-hint">${th("rem.noFile", { path: raw(`<code>${esc(S.snap.vault?.map?.reminders ?? "")}</code>`) })}</div>` : nothing}
      ${reminders.length ? groups : html`<div class="rem-empty">${t("rem.none")}</div>`}`;
  }
}
customElements.define("relay-reminders", RelayReminders);
