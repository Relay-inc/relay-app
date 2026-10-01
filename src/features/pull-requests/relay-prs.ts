import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { projectLabel } from "../../domain/vault";
import { panel, openDetail } from "../../domain/panel";
import { prs, loadPrs, type PR } from "../../domain/prs";
import { prKey } from "../../domain/keys";
import "./pr-row";

/** The Pull requests view: both lists, with a reload button. */
@customElement("relay-prs")
export class RelayPrs extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
    `,
  ];
  protected store = new StoreController(this);

  private renderRow(pr: PR, mine: boolean) {
    const key = prKey(pr.repo, pr.number);
    return html`<relay-pr-row
      .pr=${pr}
      ?mine=${mine}
      .project=${pr.project ? projectLabel(pr.project) : ""}
      ?selected=${panel.open === key}
      @open-pr=${() => openDetail(key)}
    ></relay-pr-row>`;
  }
  private renderGroup(name: unknown, list: PR[], mine: boolean) {
    const rows = list.length
      ? list.map(pr => this.renderRow(pr, mine))
      : html`<div class="text-secondary text-sm py-2">${th("pr.none")}</div>`;
    return html`<section class="mb-6">
      <h2 class="list-head">${name} <span class="font-mono tabular-nums">${list.length}</span></h2>
      ${rows}
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
    const { err, busy } = prs;
    return html`<div class="flex items-center gap-2 mb-3.5">
        <span class="flex-1"></span>${busy ? html`<span class="spinner"></span>` : nothing}<button
          class="btn"
          @click=${loadPrs}
        >
          ${th("pr.reload")}
        </button>
      </div>
      ${err ? html`<div class="err-box">${err}</div>` : nothing}${this.renderLists()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-prs": RelayPrs;
  }
}
