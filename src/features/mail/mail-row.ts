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
function formatWhen(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(currentLocale(), {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its place. */
@customElement("relay-mail-row")
export class MailRow extends LitElement {
  static override styles = [
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
  /** the account's address, set when there is more than one */
  @property() account = "";
  @property({ type: Boolean }) selected = false;

  private renderSubject() {
    const unreadClass = this.mail.unread
      ? "font-semibold before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-accent before:mr-2"
      : "";
    return html`<div class="text-base leading-snug line-clamp-1 group-hover:text-accent ${unreadClass}">
      ${this.mail.subject || th("mail.noSubject")}
    </div>`;
  }
  // the date, and on hover the read/unread button on the same spot
  private renderDateAndFlip() {
    const label = this.mail.unread ? t("mail.markRead") : t("mail.markUnread");
    return html`<div class="grid justify-items-end">
      <span class="col-start-1 row-start-1 flex text-sm text-secondary mt-0.5 tabular-nums group-hover:invisible"
        >${formatWhen(this.mail.date)}</span
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
        ${icon(this.mail.unread ? "read" : "unread")}
      </button>
    </div>`;
  }

  override render() {
    const account = this.account ? html`<span>${this.account}</span>` : nothing;
    const project = this.project ? html`<span>${this.project}</span>` : nothing;
    return html`<div
      class="group flex gap-4 items-center py-2.5 -mx-2.5 px-2.5 rounded-lg border-b border-separator text-inherit cursor-default transition-colors duration-150 ease-out
        ${this.selected ? "bg-accent/15" : "hover:bg-fill"}"
      @click=${() => emit(this, "open-mail")}
    >
      <div class="min-w-0 flex-1">
        ${this.renderSubject()}
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums">
          <span>${this.sender}</span>${account}${project}
        </div>
      </div>
      ${this.renderDateAndFlip()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail-row": MailRow;
  }
}
