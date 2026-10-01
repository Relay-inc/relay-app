import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { t, currentLocale } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

declare global { interface HTMLElementEventMap { "date-pick": CustomEvent<string>; "date-close": CustomEvent<void> } }

export const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const todayIso = (plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };

const G = "w-4 h-4 fill-none stroke-secondary glyph";
const nav = "grid place-items-center rounded-md cursor-default w-6 h-6 enabled:hover:bg-fill disabled:*:opacity-35 focus-visible:outline-2 focus-visible:outline-accent/45";

/** A month grid under its button, past days off, Monday first. Opens upwards near the bottom of the view; a click outside or Escape closes it (the toggle button, marked data-rem-cal, handles itself). */
@customElement("relay-reminder-calendar")
export class ReminderCalendar extends LitElement {
  // the host takes no box, the picker is positioned against the row's actions
  static styles = [tw, css`:host{display:contents}`];
  @state() private y = new Date().getFullYear();
  @state() private m = new Date().getMonth();
  @query("[data-pop]") private pop!: HTMLElement;

  connectedCallback() { super.connectedCallback(); document.addEventListener("pointerdown", this.onOutside); document.addEventListener("keydown", this.onOutside); }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener("pointerdown", this.onOutside); document.removeEventListener("keydown", this.onOutside); }

  private onOutside = (e: Event) => {
    // the document sees the host, not what is inside the shadow root: the path tells inside from outside
    if (e instanceof KeyboardEvent ? e.key === "Escape" : !e.composedPath().some(n => n instanceof Element && (n === this.pop || n.matches("[data-rem-cal]")))) emit(this, "date-close");
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
    // near the bottom of the view the picker opens upwards
    this.pop.removeAttribute("data-up");
    if (this.pop.getBoundingClientRect().bottom > (this.scroller()?.getBoundingClientRect().bottom ?? innerHeight)) this.pop.setAttribute("data-up", "");
  }

  private go(step: number) { const d = new Date(this.y, this.m + step); this.y = d.getFullYear(); this.m = d.getMonth(); }

  render() {
    const { y, m } = this, now = new Date(), today = iso(now.getFullYear(), now.getMonth(), now.getDate());
    const f = (o: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(currentLocale(), o).format(d);
    const lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    return html`<div data-pop class="absolute z-10 right-0 top-full mt-1.5 data-[up]:top-auto data-[up]:bottom-full mb-1.5 w-60 p-2.5 bg-bg border border-separator rounded-xl shadow-xl" role="dialog" aria-label=${t("rem.pick")}>
      <div class="flex items-center gap-0.5 mb-2 ml-1"><span class="flex-1 text-sm font-semibold capitalize">${f({ month: "long", year: "numeric" }, new Date(y, m, 1))}</span>
        <button class=${nav} ?disabled=${y === now.getFullYear() && m === now.getMonth()} @click=${() => this.go(-1)} aria-label=${t("cal.prev")}>${icon("left", G)}</button>
        <button class=${nav} @click=${() => this.go(1)} aria-label=${t("cal.next")}>${icon("right", G)}</button></div>
      <div class="grid grid-cols-7 gap-0.5 text-center">${Array.from({ length: 7 }, (_, i) => html`<span class="text-xs font-semibold text-secondary uppercase pb-1">${f({ weekday: "narrow" }, new Date(2024, 0, 1 + i))}</span>`)}</div>
      <div class="grid grid-cols-7 gap-0.5 text-center">${Array.from({ length: lead }, () => html`<span></span>`)}${Array.from({ length: days }, (_, i) => {
        const d = iso(y, m, i + 1), isToday = d === today;
        return html`<button ?disabled=${d < today} class="grid place-items-center rounded-md cursor-default h-8 text-sm font-mono tabular-nums focus-visible:outline-2 focus-visible:outline-accent/45 disabled:text-secondary disabled:opacity-45 enabled:hover:bg-accent enabled:hover:text-on-accent ${isToday ? "text-accent font-semibold ring-1 ring-inset ring-accent" : "text-label"}" @click=${() => emit(this, "date-pick", d)}>${i + 1}</button>`;
      })}</div></div>`;
  }
}
