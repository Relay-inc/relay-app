import { html, nothing } from "lit";
import { t, th } from "../i18n";
import { icon } from "../icons";
import { RelayElement, styles } from "../lib/store";
import { S, pLabel } from "../app/state";
import { openPr, mailSeen, setMailFilter, openMailSetup, mailProject } from "../app/actions";
import { loadMails, moreMails } from "../app/data";
import { mailKey, sender, unread, when, type Mail, type MailFilter } from "../mail";
import css from "./mail-view.css?inline";

function row(m: Mail) {
  const p = mailProject(m), key = mailKey(m);
  const label = unread(m) ? t("mail.markRead") : t("mail.markUnread");
  return html`<div class=${"pr-row mail-row" + (unread(m) ? " unread" : "") + (S.prOpen === key ? " sel" : "")} @click=${() => openPr(key)}>
    <div class="pr-main"><div class="pr-t">${m.subject || th("mail.noSubject")}</div>
      <div class="pr-meta"><span>${sender(m)}</span>${p ? html`<span>${pLabel(p)}</span>` : nothing}</div></div>
    <div class="mail-side"><span class="pr-meta">${when(m.date)}</span>
      <button class="btn ib mail-flip" title=${label} aria-label=${label} @click=${(e: Event) => { e.stopPropagation(); mailSeen(key, unread(m)); }}>${icon(unread(m) ? "read" : "unread")}</button></div></div>`;
}

/** The inbox: search, read state and project on top, the mails that pass the filters under one heading with the unread count. */
export class RelayMail extends RelayElement {
  static styles = styles(css);

  // no account yet: what to do in three steps, and the way into the settings. The texts are the app's own
  private setup() {
    return html`<div class="mail-setup">
      <h2>${th("mail.setupTitle")}</h2><p>${th("mail.setupIntro")}</p>
      <ol><li>${th("mail.setupStep1")}</li><li>${th("mail.setupStep2")}</li><li>${th("mail.setupStep3")}</li></ol>
      <p class="mail-dim">${th("mail.setupPw")}</p>
      <button class="btn primary" @click=${openMailSetup}>${th("mail.setupOpen")}</button></div>`;
  }

  private tools(list: Mail[] | null, f: MailFilter) {
    const ps = [...new Set((list || []).map(mailProject).filter((p): p is string => !!p))].sort();
    const opts = [...new Set([...ps, ...(f.project && f.project !== "-" ? [f.project] : [])])];
    return html`<span class="seg mail-seg">${(["all", "unread", "read"] as const).map(s =>
      html`<button class=${f.state === s ? "on" : ""} @click=${() => setMailFilter({ state: s })}>${th(s === "all" ? "mail.fAll" : s === "unread" ? "mail.fUnread" : "mail.fRead")}</button>`)}</span>
      <select class="field" @change=${(e: Event) => setMailFilter({ project: (e.target as HTMLSelectElement).value })}>
        <option value="" .selected=${!f.project}>${t("mail.allProjects")}</option><option value="-" .selected=${f.project === "-"}>${t("mail.noProject")}</option>
        ${opts.map(p => html`<option value=${p} .selected=${f.project === p}>${pLabel(p)}</option>`)}</select>
      <span class="sp"></span>${S.mailBusy ? html`<span class="spin"></span>` : nothing}<button class="btn" @click=${loadMails}>${th("pr.reload")}</button>`;
  }

  private list(list: Mail[] | null, f: MailFilter) {
    const err = S.mailErr, errEl = err ? html`<div class="err">${err}</div>` : nothing;
    if (!list) return html`${errEl}${S.mailBusy ? nothing : html`<div class="note">${th("pr.notLoaded")}</div>`}`;
    const q = f.q.trim().toLowerCase();
    const shown = list.filter(m => (f.state === "all" || unread(m) === (f.state === "unread"))
      && (!f.project || (f.project === "-" ? !mailProject(m) : mailProject(m) === f.project))
      && (!q || `${m.subject} ${sender(m)} ${m.from[0]?.email ?? ""}`.toLowerCase().includes(q)));
    const n = list.filter(unread).length;
    return html`${errEl}<section class="rem-grp"><h2 class="rem-h">${th("mail.inbox")}${n ? html` <span class="rem-n">${th("mail.unread", { n })}</span>` : nothing}</h2>
      ${shown.length ? shown.map(row) : html`<div class="pr-none">${list.length ? th("mail.noMatch") : th("mail.none")}</div>`}</section>`;
  }

  render() {
    if (!S.settings.mail.accounts?.length) return this.setup();
    const f = S.mailFilter, list = S.mails;
    // the search field stays one element across redraws, so it keeps its focus and caret while the list changes
    return html`<div class="kbhead mail-bar"><input class="field mailq" type="search" placeholder=${t("mail.search")} .value=${f.q} spellcheck="false"
        @input=${(e: Event) => setMailFilter({ q: (e.target as HTMLInputElement).value })}>${this.tools(list, f)}</div>
      <div>${this.list(list, f)}${list && !S.mailEnd ? html`<div class="mail-more"><button class="btn" ?disabled=${S.mailMore} @click=${moreMails}>${S.mailMore ? html`<span class="spin"></span>` : nothing}${th("mail.more")}</button></div>` : nothing}</div>`;
  }
}
customElements.define("relay-mail", RelayMail);
