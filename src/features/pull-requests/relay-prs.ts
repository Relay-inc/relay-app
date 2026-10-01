import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { pLabel } from "../../domain/vault";
import { panel, openPr } from "../../domain/panel";
import { prs, prKey, loadPrs, type PR } from "../../domain/prs";
import "./pr-row";

/** The Pull requests view: both lists, with a reload button. */
@customElement("relay-prs")
export class RelayPrs extends LitElement {
  static styles = [tw, css`:host { display: flex; flex-direction: column; gap: 18px; }`];
  protected store = new StoreController(this);

  private group(name: unknown, list: PR[], mine: boolean) {
    return html`<section class="mb-[22px]"><h2 class="list-head">${name} <span class="font-mono tabular-nums">${list.length}</span></h2>${list.length
      ? list.map(p => html`<relay-pr-row .pr=${p} ?mine=${mine} .project=${p.project ? pLabel(p.project) : ""} ?selected=${panel.open === prKey(p.repo, p.number)}
          @open-pr=${() => openPr(prKey(p.repo, p.number))}></relay-pr-row>`)
      : html`<div class="text-secondary text-sm py-2">${th("pr.none")}</div>`}</section>`;
  }

  render() {
    const { list, err, busy } = prs;
    return html`<div class="flex items-center gap-2 mb-[14px]"><span class="flex-1"></span>${busy ? html`<span class="spinner"></span>` : nothing}<button class="btn" @click=${loadPrs}>${th("pr.reload")}</button></div>
      ${err ? html`<div class="err-box">${err}</div>` : nothing}
      ${list ? html`${this.group(th("nav.prsReview"), list.review, false)}${this.group(th("pr.mine"), list.mine, true)}` : busy ? nothing : html`<div class="text-secondary text-sm text-center">${th("pr.notLoaded")}</div>`}`;
  }
}
