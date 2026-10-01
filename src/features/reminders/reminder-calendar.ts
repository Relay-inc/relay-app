import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { t, currentLocale } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

declare global {
  interface HTMLElementEventMap {
    "date-pick": CustomEvent<string>;
    "date-close": CustomEvent<void>;
  }
}

export const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
export const todayIso = (daysAhead = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
};

const GLYPH = "w-4 h-4 fill-none stroke-secondary glyph";
const MONTH_BUTTON =
  "grid place-items-center rounded-md cursor-default w-6 h-6 enabled:hover:bg-fill disabled:*:opacity-35 focus-visible:outline-2 focus-visible:outline-accent/45";
const DAY_BUTTON =
  "grid place-items-center rounded-md cursor-default h-8 text-sm font-mono tabular-nums focus-visible:outline-2 focus-visible:outline-accent/45 disabled:text-secondary disabled:opacity-45 enabled:hover:bg-accent enabled:hover:text-on-accent";
const TODAY_DAY = "text-accent font-semibold ring-1 ring-inset ring-accent";

// the scrolling ancestor, through the shadow roots on the way up
function scrollingAncestor(start: Node): HTMLElement | null {
  let node: Node | null = start;
  while (node) {
    if (node instanceof HTMLElement && getComputedStyle(node).overflowY === "auto") return node;
    node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
  }
  return null;
}

/** A month grid under its button, past days off, Monday first. Opens upwards near the bottom of the view; a click outside or Escape closes it (the toggle button, marked data-rem-cal, handles itself). */
@customElement("relay-reminder-calendar")
export class ReminderCalendar extends LitElement {
  // the host takes no box, the picker is positioned against the row's actions
  static override styles = [
    tw,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  @state() private year = new Date().getFullYear();
  @state() private month = new Date().getMonth();
  @query("[data-pop]") private popup!: HTMLElement;

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.onOutside);
    document.addEventListener("keydown", this.onOutside);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.onOutside);
    document.removeEventListener("keydown", this.onOutside);
  }

  private onOutside = (e: Event) => {
    const shouldClose = e instanceof KeyboardEvent ? e.key === "Escape" : !this.isInside(e);
    if (shouldClose) emit(this, "date-close");
  };

  // the document sees the host, not what is inside the shadow root: the path tells inside from outside
  private isInside(e: Event) {
    return e
      .composedPath()
      .some(node => node instanceof Element && (node === this.popup || node.matches("[data-rem-cal]")));
  }

  override updated() {
    // near the bottom of the view the picker opens upwards
    const viewBottom = scrollingAncestor(this)?.getBoundingClientRect().bottom ?? innerHeight;
    this.popup.removeAttribute("data-up");
    if (this.popup.getBoundingClientRect().bottom > viewBottom) this.popup.setAttribute("data-up", "");
  }

  private goToMonth(step: number) {
    const date = new Date(this.year, this.month + step);
    this.year = date.getFullYear();
    this.month = date.getMonth();
  }

  private format(options: Intl.DateTimeFormatOptions, date: Date) {
    return new Intl.DateTimeFormat(currentLocale(), options).format(date);
  }

  private renderHeader(isCurrentMonth: boolean) {
    const monthName = this.format({ month: "long", year: "numeric" }, new Date(this.year, this.month, 1));
    return html`<div class="flex items-center gap-0.5 mb-2 ml-1">
      <span class="flex-1 text-sm font-semibold capitalize">${monthName}</span>
      <button
        class=${MONTH_BUTTON}
        ?disabled=${isCurrentMonth}
        @click=${() => this.goToMonth(-1)}
        aria-label=${t("cal.prev")}
      >
        ${icon("left", GLYPH)}
      </button>
      <button class=${MONTH_BUTTON} @click=${() => this.goToMonth(1)} aria-label=${t("cal.next")}>
        ${icon("right", GLYPH)}
      </button>
    </div>`;
  }

  private renderWeekdays() {
    // 2024-01-01 was a Monday
    return html`<div class="grid grid-cols-7 gap-0.5 text-center">
      ${Array.from({ length: 7 }, (_, i) => html`<span class="text-xs font-semibold text-secondary uppercase pb-1">${this.format({ weekday: "narrow" }, new Date(2024, 0, 1 + i))}</span>`)}
    </div>`;
  }

  private renderDay(day: number, today: string) {
    const date = isoDate(this.year, this.month, day);
    return html`<button
      ?disabled=${date < today}
      class="${DAY_BUTTON} ${date === today ? TODAY_DAY : "text-label"}"
      @click=${() => emit(this, "date-pick", date)}
    >
      ${day}
    </button>`;
  }

  private renderDays(today: string) {
    const blanks = (new Date(this.year, this.month, 1).getDay() + 6) % 7; // Monday first
    const dayCount = new Date(this.year, this.month + 1, 0).getDate();
    return html`<div class="grid grid-cols-7 gap-0.5 text-center">
      ${Array.from({ length: blanks }, () => html`<span></span>`)}${Array.from({ length: dayCount }, (_, i) => this.renderDay(i + 1, today))}
    </div>`;
  }

  override render() {
    const now = new Date();
    const today = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
    const isCurrentMonth = this.year === now.getFullYear() && this.month === now.getMonth();
    return html`<div
      data-pop
      class="absolute z-10 right-0 top-full mt-1.5 data-[up]:top-auto data-[up]:bottom-full mb-1.5 w-60 p-2.5 bg-bg border border-separator rounded-xl shadow-xl"
      role="dialog"
      aria-label=${t("rem.pick")}
    >
      ${this.renderHeader(isCurrentMonth)} ${this.renderWeekdays()} ${this.renderDays(today)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-reminder-calendar": ReminderCalendar;
  }
}
