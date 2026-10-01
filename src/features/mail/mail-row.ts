import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t, th, currentLocale } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";
import type { Mail } from "../../domain/mail";

declare global {
  interface HTMLElementEventMap {
    "open-mail": CustomEvent<void>;
    "flip-mail": CustomEvent<void>;
  }
}

// today a time, this year a day and month, before that with the year
function when(iso: string) {
  const d = new Date(iso),
    now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(currentLocale(), {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its place. */
@customElement("relay-mail-row")
export class MailRow extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) mail!: Mail;
  /** who wrote it, as the list shows it */
  @property() sender = "";
  /** the display label of the mail's project, "" when it has none */
  @property() project = "";
  @property({ type: Boolean }) selected = false;

  render() {
    const m = this.mail,
      label = m.unread ? t("mail.markRead") : t("mail.markUnread");
    return html`<div
      class="group flex gap-4 items-center py-2.5 -mx-2.5 px-2.5 rounded-lg border-b border-separator text-inherit cursor-default transition-colors duration-150 ease-out
        ${this.selected ? "bg-accent/15" : "hover:bg-fill"}"
      @click=${() => emit(this, "open-mail")}
    >
      <div class="min-w-0 flex-1">
        <div
          class="text-base leading-snug line-clamp-1 group-hover:text-accent ${m.unread ? "font-semibold before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-accent before:mr-2" : ""}"
        >
          ${m.subject || th("mail.noSubject")}
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums">
          <span>${this.sender}</span>${this.project ? html`<span>${this.project}</span>` : nothing}
        </div>
      </div>
      <div class="grid justify-items-end">
        <span class="col-start-1 row-start-1 flex text-sm text-secondary mt-0.5 tabular-nums group-hover:invisible"
          >${when(m.date)}</span
        >
        <button
          class="col-start-1 row-start-1 btn inline-grid place-items-center w-6! h-6! p-0! invisible group-hover:visible"
          title=${label}
          aria-label=${label}
          @click=${(e: Event) => {
            e.stopPropagation();
            emit(this, "flip-mail");
          }}
        >
          ${icon(m.unread ? "read" : "unread")}
        </button>
      </div>
    </div>`;
  }
}
