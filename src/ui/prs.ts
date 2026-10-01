import { html, nothing } from "lit";
import { th } from "../i18n";
import { RelayElement, styles } from "../lib/store";
import { S } from "../app/state";
import { loadPrs } from "../app/data";
import { prRow, type PR } from "../github";

const group = (name: unknown, list: PR[], mine: boolean) =>
  html`<section class="rem-grp"><h2 class="rem-h">${name} <span class="rem-n">${list.length}</span></h2>${list.length ? list.map(p => prRow(p, mine)) : html`<div class="pr-none">${th("pr.none")}</div>`}</section>`;

/** The Pull requests view: both lists, with a reload button. */
export class RelayPrs extends RelayElement {
  static styles = styles(":host{display:flex;flex-direction:column;gap:18px}");
  render() {
    const { prs, prErr: err, prBusy: busy } = S;
    return html`<div class="kbhead"><span class="sp"></span>${busy ? html`<span class="spin"></span>` : nothing}<button class="btn" @click=${loadPrs}>${th("pr.reload")}</button></div>
      ${err ? html`<div class="err">${err}</div>` : nothing}
      ${prs ? html`${group(th("nav.prsReview"), prs.review, false)}${group(th("pr.mine"), prs.mine, true)}` : busy ? nothing : html`<div class="note">${th("pr.notLoaded")}</div>`}`;
  }
}
customElements.define("relay-prs", RelayPrs);
