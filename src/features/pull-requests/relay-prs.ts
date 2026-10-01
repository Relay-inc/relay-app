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

  private group(name: unknown, list: PR[], mine: boolean) {
    return html`<section class="mb-6">
      <h2 class="list-head">${name} <span class="font-mono tabular-nums">${list.length}</span></h2>
      ${
        list.length
          ? list.map(
              p =>
                html`<relay-pr-row
                  .pr=${p}
                  ?mine=${mine}
                  .project=${p.project ? projectLabel(p.project) : ""}
                  ?selected=${panel.open === prKey(p.repo, p.number)}
                  @open-pr=${() => openDetail(prKey(p.repo, p.number))}
                ></relay-pr-row>`,
            )
          : html`<div class="text-secondary text-sm py-2">${th("pr.none")}</div>`
      }
    </section>`;
  }

  override render() {
    const { list, err, busy } = prs;
    return html`<div class="flex items-center gap-2 mb-3.5">
        <span class="flex-1"></span>${busy ? html`<span class="spinner"></span>` : nothing}<button
          class="btn"
          @click=${loadPrs}
        >
          ${th("pr.reload")}
        </button>
      </div>
      ${err ? html`<div class="err-box">${err}</div>` : nothing}
      ${list ? html`${this.group(th("nav.prsReview"), list.review, false)}${this.group(th("pr.mine"), list.mine, true)}` : busy ? nothing : html`<div class="text-secondary text-sm text-center">${th("pr.notLoaded")}</div>`}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-prs": RelayPrs;
  }
}
