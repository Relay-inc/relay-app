import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { openPrModal } from "../../domain/panel";
import { prs, type PR } from "../../domain/prs";
import { prKey } from "../../domain/keys";
import "./pr-row";

/** The Pull requests view: what waits for your review and what you opened. A row opens the PR in its window; reloading is the title bar's button. */
@customElement("relay-prs")
export class RelayPrs extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
    `,
  ];
  protected store = new StoreController(this);

  private renderGroup(name: unknown, list: PR[], mine: boolean) {
    const rows = list.length
      ? list.map(
          pr =>
            html`<relay-pr-row
              .pr=${pr}
              ?mine=${mine}
              @open-pr=${() => openPrModal(prKey(pr.repo, pr.number))}
            ></relay-pr-row>`,
        )
      : html`<div class="text-secondary text-sm py-2">${th("pr.none")}</div>`;
    return html`<section>
      <h2 class="flex items-baseline gap-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
        ${name} <span class="tabular-nums">${list.length}</span>
      </h2>
      <div class="flex flex-col gap-0.5">${rows}</div>
    </section>`;
  }
  private renderLists() {
    const { list, busy } = prs;
    if (list)
      return html`${this.renderGroup(th("nav.prsReview"), list.review, false)}${this.renderGroup(th("pr.mine"), list.mine, true)}`;
    if (busy) return nothing;
    return html`<div class="text-secondary text-sm text-center">${th("pr.notLoaded")}</div>`;
  }

  override render() {
    const { err } = prs;
    return html`${err ? html`<div class="err-box">${err}</div>` : nothing}${this.renderLists()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-prs": RelayPrs;
  }
}
