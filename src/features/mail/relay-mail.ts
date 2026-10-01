import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { config } from "../../domain/config";
import { pLabel } from "../../domain/vault";
import { panel, openPr } from "../../domain/panel";
import { mail, mailKey, mailProject, sender, unread, filtered, loadMails, moreMails, mailSeen, setMailFilter, openMailSetup, type Mail } from "../../domain/mail";
import "./mail-bar";
import "./mail-row";
import "./mail-setup";

/** The inbox: search, read state and project on top, the mails that pass the filters under one heading with the unread count. */
@customElement("relay-mail")
export class RelayMail extends LitElement {
  static styles = [tw, css`:host { display: flex; flex-direction: column; gap: 18px; }`];
  protected store = new StoreController(this);

  private list(list: Mail[] | null) {
    const err = mail.err, errEl = err ? html`<div class="err-box">${err}</div>` : nothing;
    if (!list) return html`${errEl}${mail.busy ? nothing : html`<div class="text-secondary text-sm text-center">${th("pr.notLoaded")}</div>`}`;
    const shown = filtered(list, mail.filter), n = list.filter(unread).length;
    return html`${errEl}<section class="mb-[22px]"><h2 class="list-head">${th("mail.inbox")}${n ? html` <span class="font-mono tabular-nums">${th("mail.unread", { n })}</span>` : nothing}</h2>
      ${shown.length ? shown.map(m => { const p = mailProject(m), key = mailKey(m);
        return html`<relay-mail-row .mail=${m} .sender=${sender(m)} .project=${p ? pLabel(p) : ""} ?selected=${panel.open === key}
          @open-mail=${() => openPr(key)} @flip-mail=${() => mailSeen(key, unread(m))}></relay-mail-row>`; })
        : html`<div class="text-secondary text-sm py-2">${list.length ? th("mail.noMatch") : th("mail.none")}</div>`}</section>`;
  }

  render() {
    if (!config.value.mail.accounts?.length) return html`<relay-mail-setup @setup=${openMailSetup}></relay-mail-setup>`;
    const f = mail.filter, list = mail.list;
    const ps = [...new Set((list || []).map(mailProject).filter((p): p is string => !!p))].sort();
    const opts = [...new Set([...ps, ...(f.project && f.project !== "-" ? [f.project] : [])])];
    return html`<relay-mail-bar .filter=${f} .projects=${opts.map(p => [p, pLabel(p)])} ?busy=${mail.busy}
        @filter=${(e: CustomEvent) => setMailFilter(e.detail)} @reload=${loadMails}></relay-mail-bar>
      <div>${this.list(list)}${list && !mail.end ? html`<div class="flex justify-center py-[14px]"><button class="btn inline-flex items-center gap-2" ?disabled=${mail.more} @click=${moreMails}>${mail.more ? html`<span class="spinner"></span>` : nothing}${th("mail.more")}</button></div>` : nothing}</div>`;
  }
}
