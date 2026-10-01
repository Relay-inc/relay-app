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
    "reminder-chat": CustomEvent<string>;
    "reminder-done": CustomEvent<string>;
    "reminder-cal": CustomEvent<string>;
    "reminder-push": CustomEvent<{ id: string; date: string }>;
  }
}

/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
const DUE = { late: "due-late", soon: "due-soon", "": "" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
// some translations get markup around their numbers, so those go in raw; the values are escaped first
const monoNumber = (value: string | number) =>
  raw(`<span class="font-mono tabular-nums">${escapeHtml(String(value))}</span>`);

function dueText(reminder: Reminder) {
  if (reminder.days < 0) return th("due.overdue", { n: monoNumber(-reminder.days) });
  if (reminder.days === 0) return t("due.today");
  const [year, month, day] = reminder.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone: "UTC" }).format(date);
  return html`${format({ weekday: "short" })}
    <span class="font-mono tabular-nums">${format({ day: "numeric", month: "numeric" })}</span>`;
}

// the buttons override the generic .btn: 26px high, icons 15px in the secondary colour (accent on hover)
const BUTTON = "btn h-6! px-2! text-sm whitespace-nowrap disabled:opacity-50";
const ICON_BUTTON = `${BUTTON} group relative grid place-items-center w-6! px-0! after:content-[attr(data-tip)] after:absolute after:bottom-full after:mb-1.5 after:left-1/2 after:-translate-x-1/2 after:z-10 after:px-2 after:py-1 after:rounded-sm after:bg-black/90 after:text-white after:text-xs after:whitespace-nowrap after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-100 after:ease-out hover:after:opacity-100 hover:after:delay-300`;
const GLYPH = "glyph w-4! h-4! stroke-secondary! group-hover:stroke-accent!";

/** One reminder: title, project, due date, repeat and the actions. `urgency` is the domain's "late" | "soon" | "". */
@customElement("relay-reminder-row")
export class ReminderRow extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) reminder!: Reminder;
  @property() label = ""; // the project as it is shown
  @property() urgency: "late" | "soon" | "" = "";
  @property({ type: Boolean }) busy = false; // an action of this row is running
  @property({ type: Boolean }) cal = false; // its date picker is open

  private renderTitle(reminder: Reminder) {
    return html`<div
      class="text-base leading-normal line-clamp-2 ${reminder.days < 0 ? "font-semibold" : ""} [&_code]:font-mono [&_code]:text-sm [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:rounded-sm [&_a]:text-accent [&_a]:underline [&_.vlink]:text-accent [&_.vlink]:no-underline [&_.vlink:hover]:underline"
    >
      ${md(reminder.title)}
    </div>`;
  }

  private renderDetails(reminder: Reminder) {
    return html`<div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5">
      ${reminder.project ? html`<span>${this.label}</span>` : nothing}<span class=${DUE[this.urgency]}
        >${dueText(reminder)}</span
      >${reminder.repeat ? html`<span>${th("rem.every", { n: monoNumber(reminder.repeat) })}</span>` : nothing}
    </div>`;
  }

  // an icon button with a tooltip
  private renderIconButton(iconName: string, tip: string, onClick: () => void, isCalendarToggle = false) {
    return html`<button
      class=${ICON_BUTTON}
      ?data-rem-cal=${isCalendarToggle}
      ?disabled=${this.busy}
      @click=${onClick}
      data-tip=${tip}
      aria-label=${tip}
    >
      ${icon(iconName, GLYPH)}
    </button>`;
  }

  private renderPushButton(id: string, date: string, label: string) {
    return html`<button
      class=${BUTTON}
      ?disabled=${this.busy}
      @click=${() => emit(this, "reminder-push", { id, date })}
    >
      ${label}
    </button>`;
  }

  private renderCalendar(id: string) {
    if (!this.cal) return nothing;
    return html`<relay-reminder-calendar
      @date-pick=${(e: CustomEvent<string>) => emit(this, "reminder-push", { id, date: e.detail })}
    ></relay-reminder-calendar>`;
  }

  private renderActions(id: string) {
    return html`<div class="relative flex items-center gap-1.5">
      ${this.renderIconButton("chat", t("rem.chat"), () => emit(this, "reminder-chat", id))}
      ${this.renderIconButton("check", t("rem.done"), () => emit(this, "reminder-done", id))}
      ${this.renderPushButton(id, "morgen", t("rem.tomorrow"))} ${this.renderPushButton(id, "+1w", t("rem.plusWeek"))}
      ${this.renderIconButton("cal", t("rem.pick"), () => emit(this, "reminder-cal", id), true)}
      ${this.renderCalendar(id)}
    </div>`;
  }

  override render() {
    const reminder = this.reminder;
    return html`<div class="list-row">
      <div class="min-w-0">${this.renderTitle(reminder)} ${this.renderDetails(reminder)}</div>
      ${this.renderActions(reminder.id)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-reminder-row": ReminderRow;
  }
}
