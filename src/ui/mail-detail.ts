import { html, nothing } from "lit";
import { t, th, currentLocale } from "../i18n";
import { icon } from "../icons";
import { RelayElement, styles } from "../lib/store";
import { S } from "../app/state";
import { closePr, mailSeen, mailChat, toggleMailText, mailLinkGo } from "../app/actions";
import { mailKey, unread, renderBody, type Mail, type MailBody } from "../mail";
import css from "./mail-detail.css?inline";

const kb = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1)} MB`;
// 16px line icons in the app's glyph style, every icon button carries its label as tooltip and for VoiceOver
const ib = (name: string, label: string, click: () => void, cls = "btn ib", tip = label) =>
  html`<button class=${cls} title=${tip} aria-label=${label} @click=${click}>${icon(name)}</button>`;

/** One mail in the right panel: who, when, the mail, and the ways into a conversation. Headers show at once, the body loads.
 *  HTML goes in a sandbox without tokens (the backend sanitized it and set a CSP), "textView" shows what Claude reads instead. */
export class RelayMailDetail extends RelayElement {
  static styles = styles(css);

  private main(b: MailBody, textView: boolean) {
    // the srcdoc is a plain attribute binding: while the html is the same string the frame is not touched, so it does not reload
    return b.html && !textView ? html`<iframe class="mail-frame" sandbox="" referrerpolicy="no-referrer" srcdoc=${b.html}></iframe>` : renderBody(b.text);
  }

  render() {
    const key = S.prOpen, m: Mail | undefined = S.mails?.find(x => mailKey(x) === key), body: MailBody | undefined = S.prDetail[key], err = S.prDetailErr, textView = S.mailText.has(key);
    // two groups: reading this mail on the left, the ways into a conversation on the right. A narrow panel wraps a whole group
    const bar = html`<div class="prd-bar"><span class="prd-grp">${ib("close", t("pr.close"), closePr)}${m ? ib(unread(m) ? "read" : "unread", unread(m) ? t("mail.markRead") : t("mail.markUnread"), () => mailSeen(key, unread(m))) : nothing}
      ${body?.html ? (textView ? ib("html", t("mail.showMail"), toggleMailText) : ib("text", t("mail.showText"), toggleMailText)) : nothing}</span>
      ${m ? html`<span class="prd-grp end">${ib("reply", t("mail.draft"), () => mailChat(key, "draft"), "btn ib", `${t("mail.draft")}: ${t("mail.draftTitle")}`)}${ib("talk", t("mail.talk"), () => mailChat(key, "talk"), "btn ib primary", `${t("mail.talk")}: ${t("mail.talkTitle")}`)}</span>` : nothing}</div>`;
    if (!m) return html`${bar}<div class="meta">${th("mail.gone")}</div>`;
    const who = (l: Mail["from"]) => l.map((a, i) => html`${i ? ", " : nothing}${a.name ? html`${a.name} <span class="count">${a.email}</span>` : a.email}`);
    const loading = html`<div class="mail-load"><span class="spin"></span>${th("mail.loadingBody")}</div><div class="skel">${[92, 100, 84, 96, 60, 0, 88, 72].map(w => html`<i class=${w ? "" : "gap"} style="width:${w}%"></i>`)}</div>`;
    const atts = body?.attachments.length ? html`<div class="mail-atts">${body.attachments.map(a => html`<span class="count">${a.name} (${kb(a.size)})</span>`)}</div>` : nothing;
    return html`${bar}${S.mailLink ? html`<div class="mail-link"><div class="mail-url">${S.mailLink}</div><div class="mail-link-btns"><button class="btn primary" @click=${() => mailLinkGo(true)}>${th("mail.linkOpen")}</button><button class="btn" @click=${() => mailLinkGo(false)}>${th("mail.linkCancel")}</button></div></div>` : nothing}<div class="prd">
      <h2 class="prd-t">${m.subject || th("mail.noSubject")}</h2>
      <div class="mail-hd"><div>${who(m.from)}</div><div class="count">${th("mail.to")} ${who(m.to)}</div><div class="count">${new Date(m.date).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" })}</div></div>
      ${err ? html`<div class="err">${err}</div>` : body === undefined ? loading : html`${atts}${this.main(body, textView)}`}
    </div>`;
  }
}
customElements.define("relay-mail-detail", RelayMailDetail);
