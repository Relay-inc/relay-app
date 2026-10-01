import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t, th, currentLocale } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";
import type { Mail } from "../../domain/mail";

declare global { interface HTMLElementEventMap { "open-mail": CustomEvent<void>; "flip-mail": CustomEvent<void>; } }

// today a time, this year a day and month, before that with the year
function when(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(currentLocale(), { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its place. */
@customElement("relay-mail-row")
export class MailRow extends LitElement {
  static styles = [tw, css`:host { display: block; }`];
  @property({ attribute: false }) mail!: Mail;
  /** who wrote it, as the list shows it */
  @property() sender = "";
  /** the display label of the mail's project, "" when it has none */
  @property() project = "";
  @property({ type: Boolean }) selected = false;

  render() {
    const m = this.mail, label = m.unread ? t("mail.markRead") : t("mail.markUnread");
    return html`<div class="group grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-center py-[10px] -mx-[10px] px-[10px] rounded-lg border-b border-separator text-inherit cursor-default transition-[background-color] duration-150 ease-out
        ${this.selected ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : "hover:bg-fill"}" @click=${() => emit(this, "open-mail")}>
      <div class="min-w-0"><div class="text-lg leading-[1.4] line-clamp-1 group-hover:text-accent ${m.unread ? "font-semibold before:content-[''] before:inline-block before:w-[7px] before:h-[7px] before:rounded-full before:bg-accent before:mr-[7px] before:align-[2px]" : ""}">${m.subject || th("mail.noSubject")}</div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums"><span>${this.sender}</span>${this.project ? html`<span>${this.project}</span>` : nothing}</div></div>
      <div class="grid justify-items-end"><span class="[grid-area:1/1] flex text-sm text-secondary mt-0.5 tabular-nums group-hover:invisible">${when(m.date)}</span>
        <button class="[grid-area:1/1] btn inline-grid place-items-center w-6! h-6! p-0! invisible group-hover:visible" title=${label} aria-label=${label}
          @click=${(e: Event) => { e.stopPropagation(); emit(this, "flip-mail"); }}>${icon(m.unread ? "read" : "unread")}</button></div></div>`;
  }
}
