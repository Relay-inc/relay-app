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
    "select-mail": CustomEvent<{ range: boolean }>;
    "archive-mail": CustomEvent<void>;
    "trash-mail": CustomEvent<void>;
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

const hoverButton = (
  host: HTMLElement,
  name: string,
  label: string,
  event: "flip-mail" | "archive-mail" | "trash-mail",
) =>
  html`<button
    class="btn btn-icon cursor-pointer w-6! h-6!"
    title=${label}
    aria-label=${label}
    @click=${(e: Event) => {
      e.stopPropagation();
      emit(host, event);
    }}
  >
    ${icon(name)}
  </button>`;

/** One mail in the inbox: unread in bold with a dot like Mail.app; the date, and on hover the read/unread button in its place.
 *  `selectable` (experimental): a checkbox in front, Cmd- or Shift-click ticks instead of opening, and archive/delete on hover. */
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
  @property({ type: Boolean }) selectable = false;
  @property({ type: Boolean }) checked = false;

  private renderSubject() {
    const unreadClass = this.mail.unread
      ? "font-semibold before:inline-block before:size-1.75 before:rounded-full before:bg-accent before:mr-1.5 before:align-middle"
      : "font-medium";
    return html`<div class="text-[13px] leading-snug line-clamp-1 ${unreadClass}">
      ${this.mail.subject || th("mail.noSubject")}
    </div>`;
  }
  // the date, and on hover the read/unread button (with archive and delete when selectable) on the same spot
  private renderDateAndFlip() {
    const label = this.mail.unread ? t("mail.markRead") : t("mail.markUnread");
    const moves = this.selectable
      ? html`${hoverButton(this, "archive", t("mail.archive"), "archive-mail")}${hoverButton(this, "trash", t("mail.trash"), "trash-mail")}`
      : nothing;
    return html`<div class="grid justify-items-end">
      <span class="col-start-1 row-start-1 flex text-xs text-secondary tabular-nums group-hover:invisible"
        >${formatWhen(this.mail.date)}</span
      >
      <span class="col-start-1 row-start-1 flex invisible group-hover:visible"
        >${moves}${hoverButton(this, this.mail.unread ? "read" : "unread", label, "flip-mail")}</span
      >
    </div>`;
  }
  private renderCheckbox() {
    if (!this.selectable) return nothing;
    return html`<input
      type="checkbox"
      class="mt-0.5 flex-none cursor-pointer"
      aria-label=${t("mail.select")}
      .checked=${this.checked}
      @click=${(e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault(); // the list decides, the box follows its checked property
        emit(this, "select-mail", { range: e.shiftKey });
      }}
    />`;
  }
  private onClick = (e: MouseEvent) => {
    if (this.selectable && (e.metaKey || e.shiftKey)) emit(this, "select-mail", { range: e.shiftKey });
    else emit(this, "open-mail");
  };

  override render() {
    const account = this.account ? html`<span>${this.account}</span>` : nothing;
    const project = this.project ? html`<span>${this.project}</span>` : nothing;
    return html`<div
      class="group flex gap-3 items-start p-2.5 rounded-[9px] text-inherit cursor-pointer transition-colors duration-150 ease-out
        ${this.selected || this.checked ? "bg-accent-soft" : "hover:bg-fill"}"
      @click=${this.onClick}
    >
      ${this.renderCheckbox()}
      <div class="min-w-0 flex-1">
        ${this.renderSubject()}
        <div class="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-secondary mt-1 tabular-nums">
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
