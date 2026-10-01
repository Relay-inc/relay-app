import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th, currentLocale } from "../../core/i18n";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { panel, closePr } from "../../domain/panel";
import { mail, mailKey, mailSeen, mailChat, toggleMailText, mailLinkGo, unread, type Mail, type MailBody } from "../../domain/mail";
import "./mail-text";

const kb = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1)} MB`;
// 16px line icons in the app's glyph style, every icon button carries its label as tooltip and for VoiceOver
const ib = (name: string, label: string, click: () => void, cls = "btn btn-icon", tip = label) =>
  html`<button class="${cls} whitespace-nowrap flex-none" title=${tip} aria-label=${label} @click=${click}>${icon(name)}</button>`;

/** One mail in the right panel: who, when, the mail, and the ways into a conversation. Headers show at once, the body loads.
 *  HTML goes in a sandbox without tokens (the backend sanitized it and set a CSP), "textView" shows what Claude reads instead. */
@customElement("relay-mail-detail")
export class RelayMailDetail extends LitElement {
  static styles = [tw, css`:host { display: block; }`];
  protected store = new StoreController(this);

  private main(b: MailBody, textView: boolean) {
    // the srcdoc is a plain attribute binding: while the html is the same string the frame is not touched, so it does not reload
    // the html of a mail: sandboxed frame that scrolls itself, white because mails are designed for white
    return b.html && !textView ? html`<iframe class="block w-full h-140 mt-3 border border-separator rounded-lg bg-white" sandbox="" referrerpolicy="no-referrer" srcdoc=${b.html}></iframe>`
      : html`<relay-mail-text .text=${b.text}></relay-mail-text>`;
  }

  render() {
    const key = panel.open, m: Mail | undefined = mail.list?.find(x => mailKey(x) === key), body: MailBody | undefined = panel.detail[key], err = panel.err, textView = mail.textView.has(key);
    // two groups: reading this mail on the left, the ways into a conversation on the right. A narrow panel wraps a whole group
    const bar = html`<div class="flex items-center flex-wrap gap-2 mb-3"><span class="flex items-center gap-2">${ib("close", t("pr.close"), closePr)}${m ? ib(unread(m) ? "read" : "unread", unread(m) ? t("mail.markRead") : t("mail.markUnread"), () => mailSeen(key, unread(m))) : nothing}
      ${body?.html ? (textView ? ib("html", t("mail.showMail"), toggleMailText) : ib("text", t("mail.showText"), toggleMailText)) : nothing}</span>
      ${m ? html`<span class="flex items-center gap-2 ml-auto">${ib("reply", t("mail.draft"), () => mailChat(key, "draft"), "btn btn-icon", `${t("mail.draft")}: ${t("mail.draftTitle")}`)}${ib("talk", t("mail.talk"), () => mailChat(key, "talk"), "btn btn-icon btn-primary", `${t("mail.talk")}: ${t("mail.talkTitle")}`)}</span>` : nothing}</div>`;
    if (!m) return html`${bar}<div class="text-secondary mb-3">${th("mail.gone")}</div>`;
    const count = (x: unknown) => html`<span class="text-secondary tabular-nums">${x}</span>`;
    const who = (l: Mail["from"]) => l.map((a, i) => html`${i ? ", " : nothing}${a.name ? html`${a.name} ${count(a.email)}` : a.email}`);
    // the right panel: headers at once, a spinner and grey lines while the text loads
    const loading = html`<div class="flex items-center gap-2 mt-3.5 text-sm text-secondary"><span class="spinner"></span>${th("mail.loadingBody")}</div><div class="mt-3">${[92, 100, 84, 96, 60, 0, 88, 72].map(w =>
      html`<i class="block mb-2 rounded-sm ${w ? "h-2.5 bg-fill animate-skel" : "h-1.5"}" style="width:${w}%"></i>`)}</div>`;
    const atts = body?.attachments.length ? html`<div class="flex flex-wrap gap-x-3.5 gap-y-1 mt-2.5 text-xs">${body.attachments.map(a => count(`${a.name} (${kb(a.size)})`))}</div>` : nothing;
    // confirm before a link in a mail opens
    const link = mail.link ? html`<div class="my-2 px-2.5 py-2 border border-separator rounded-lg bg-fill"><div class="text-xs break-all select-text">${mail.link}</div><div class="flex gap-2 mt-2"><button class="btn btn-primary" @click=${() => mailLinkGo(true)}>${th("mail.linkOpen")}</button><button class="btn" @click=${() => mailLinkGo(false)}>${th("mail.linkCancel")}</button></div></div>` : nothing;
    return html`${bar}${link}
      <h2 class="text-sm font-semibold mb-2 leading-snug">${m.subject || th("mail.noSubject")}</h2>
      <div class="text-sm leading-normal pb-2.5 border-b border-separator"><div>${who(m.from)}</div><div class="text-secondary tabular-nums">${th("mail.to")} ${who(m.to)}</div><div class="text-secondary tabular-nums">${new Date(m.date).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" })}</div></div>
      ${err ? html`<div class="err-box">${err}</div>` : body === undefined ? loading : html`${atts}${this.main(body, textView)}`}`;
  }
}
