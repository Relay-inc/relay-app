import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th, currentLocale } from "../../core/i18n";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { panel } from "../../domain/panel";
import {
  mail,
  mailKey,
  mailSeen,
  mailChat,
  toggleMailText,
  mailLinkGo,
  unread,
  type Mail,
  type MailBody,
} from "../../domain/mail";
import "./mail-text";

const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;
const formatSize = (bytes: number) => {
  if (bytes < KILOBYTE) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${Math.round(bytes / KILOBYTE)} kB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
};
// widths in percent of the grey lines shown while the body loads, 0 is a gap between paragraphs
const SKELETON_WIDTHS = [92, 100, 84, 96, 60, 0, 88, 72];
// 16px line icons in the app's glyph style, every icon button carries its label as tooltip and for VoiceOver
const iconButton = (name: string, label: string, onClick: () => void, classes = "btn btn-icon", tooltip = label) =>
  html`<button class="${classes} whitespace-nowrap flex-none" title=${tooltip} aria-label=${label} @click=${onClick}>
    ${icon(name)}
  </button>`;
const secondary = (content: unknown) => html`<span class="text-secondary tabular-nums">${content}</span>`;
const formatAddresses = (addresses: Mail["from"]) =>
  addresses.map(
    (address, i) =>
      html`${i ? ", " : nothing}${address.name ? html`${address.name} ${secondary(address.email)}` : address.email}`,
  );

/** One mail next to the Mail list: who, when, the mail, and the ways into a conversation. Headers show at once, the body loads.
 *  HTML goes in a sandbox without tokens (the backend sanitized it and set a CSP), "textView" shows what Claude reads instead. */
@customElement("relay-mail-detail")
export class RelayMailDetail extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);

  private frame?: { html: string; element: HTMLIFrameElement };
  // the html of a mail: a frame sandboxed with no allowances at all (no scripts, no same origin), built in code so the
  // empty sandbox is set before its content; kept while the html is the same, so a redraw does not reload it.
  // White because mails are designed for white
  private mailFrame(mailHtml: string) {
    if (this.frame?.html !== mailHtml) {
      const element = document.createElement("iframe");
      element.setAttribute("sandbox", "");
      element.referrerPolicy = "no-referrer";
      element.className =
        "block w-full h-[calc(100vh-15rem)] min-h-100 mt-3 border border-separator rounded-lg bg-white";
      element.srcdoc = mailHtml;
      this.frame = { html: mailHtml, element };
    }
    return this.frame.element;
  }

  private renderMailBody(body: MailBody, textView: boolean) {
    return body.html && !textView
      ? this.mailFrame(body.html)
      : html`<relay-mail-text .text=${body.text}></relay-mail-text>`;
  }

  // the button that switches between the mail as designed and the plain text, only when there is html
  private renderViewToggle(body: MailBody | undefined, textView: boolean) {
    if (!body?.html) return nothing;
    return textView
      ? iconButton("html", t("mail.showMail"), toggleMailText)
      : iconButton("text", t("mail.showText"), toggleMailText);
  }
  private renderReadToggle(key: string, item: Mail) {
    const isUnread = unread(item);
    const label = isUnread ? t("mail.markRead") : t("mail.markUnread");
    return iconButton(isUnread ? "read" : "unread", label, () => mailSeen(key, isUnread));
  }
  private renderConversationButtons(key: string) {
    return html`<span class="flex items-center gap-2 ml-auto"
      >${iconButton("reply", t("mail.draft"), () => mailChat(key, "draft"), "btn btn-icon", `${t("mail.draft")}: ${t("mail.draftTitle")}`)}${iconButton(
        "talk",
        t("mail.talk"),
        () => mailChat(key, "talk"),
        "btn btn-icon btn-primary",
        `${t("mail.talk")}: ${t("mail.talkTitle")}`,
      )}</span
    >`;
  }
  // two groups: reading this mail on the left, the ways into a conversation on the right
  private renderBar(key: string, item: Mail | undefined, body: MailBody | undefined, textView: boolean) {
    return html`<div class="flex items-center flex-wrap gap-2 mb-3">
      <span class="flex items-center gap-2"
        >${item ? this.renderReadToggle(key, item) : nothing} ${this.renderViewToggle(body, textView)}</span
      >
      ${item ? this.renderConversationButtons(key) : nothing}
    </div>`;
  }

  // the right panel: headers at once, a spinner and grey lines while the text loads
  private renderLoading() {
    return html`<div class="flex items-center gap-2 mt-3.5 text-sm text-secondary">
        <span class="spinner"></span>${th("mail.loadingBody")}
      </div>
      <div class="mt-3">
        ${SKELETON_WIDTHS.map(
          width =>
            html`<i
              class="block mb-2 rounded-sm ${width ? "h-2.5 bg-fill animate-skel" : "h-1.5"}"
              style="width:${width}%"
            ></i>`,
        )}
      </div>`;
  }
  private renderAttachments(body: MailBody) {
    if (!body.attachments.length) return nothing;
    return html`<div class="flex flex-wrap gap-x-3.5 gap-y-1 mt-2.5 text-xs">
      ${body.attachments.map(attachment => secondary(`${attachment.name} (${formatSize(attachment.size)})`))}
    </div>`;
  }
  // confirm before a link in a mail opens
  private renderLinkConfirm() {
    if (!mail.link) return nothing;
    return html`<div class="my-2 px-2.5 py-2 border border-separator rounded-lg bg-fill">
      <div class="text-xs break-all select-text">${mail.link}</div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-primary" @click=${() => mailLinkGo(true)}>${th("mail.linkOpen")}</button
        ><button class="btn" @click=${() => mailLinkGo(false)}>${th("mail.linkCancel")}</button>
      </div>
    </div>`;
  }
  private renderHeaders(item: Mail) {
    const sent = new Date(item.date).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
    return html`<h2 class="text-xl font-semibold tracking-tight mb-2.5 leading-snug text-pretty">
        ${item.subject || th("mail.noSubject")}
      </h2>
      <div class="text-[13px] leading-normal pb-3 border-b border-separator">
        <div>${formatAddresses(item.from)}</div>
        <div class="text-secondary tabular-nums">${th("mail.to")} ${formatAddresses(item.to)}</div>
        <div class="text-secondary tabular-nums">${sent}</div>
      </div>`;
  }
  private renderContent(body: MailBody | undefined, textView: boolean) {
    if (panel.err) return html`<div class="err-box">${panel.err}</div>`;
    if (body === undefined) return this.renderLoading();
    return html`${this.renderAttachments(body)}${this.renderMailBody(body, textView)}`;
  }

  override render() {
    const key = panel.mailOpen;
    const item: Mail | undefined = mail.list?.find(candidate => mailKey(candidate) === key);
    const body = panel.detail[key] as MailBody | undefined;
    const textView = mail.textView.has(key);
    const bar = this.renderBar(key, item, body, textView);
    if (!item)
      return html`${bar}
        <div class="text-secondary mb-3">${th("mail.gone")}</div>`;
    return html`${bar}${this.renderLinkConfirm()}${this.renderHeaders(item)}${this.renderContent(body, textView)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail-detail": RelayMailDetail;
  }
}
