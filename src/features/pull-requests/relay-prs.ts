import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { openPr, panel } from "../../domain/panel";
import { prs, type PR } from "../../domain/prs";
import { prKey } from "../../domain/keys";
import "./pr-row";
import "./relay-pr-detail";

/** The Pull requests view, as Mail does it: the list on the left (what waits for your review, what you opened), the
 * PR you picked on the right, so you can go from one to the next without closing anything. Reloading is the title bar's button. */
@customElement("relay-prs")
export class RelayPrs extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: grid;
        grid-template-columns: 380px minmax(0, 1fr);
        min-height: 0;
      }
    `,
  ];
  protected store = new StoreController(this);

  override updated() {
    // with nothing picked yet, the first PR of the list
    const list = prs.list;
    const first = list?.review[0] || list?.mine[0];
    if (!panel.prOpen && first) openPr(prKey(first.repo, first.number));
  }

  private renderGroup(name: unknown, list: PR[], mine: boolean) {
    const rows = list.length
      ? list.map(pr => {
          const key = prKey(pr.repo, pr.number);
          return html`<relay-pr-row
            .pr=${pr}
            ?mine=${mine}
            ?selected=${panel.prOpen === key}
            @open-pr=${() => openPr(key)}
          ></relay-pr-row>`;
        })
      : html`<div class="text-secondary text-sm px-2.5 py-2">${th("pr.none")}</div>`;
    return html`<section>
      <h2
        class="flex items-baseline gap-1.5 px-4 pt-4.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
      >
        ${name} <span class="tabular-nums">${list.length}</span>
      </h2>
      <div class="flex flex-col gap-0.5 px-2">${rows}</div>
    </section>`;
  }
  private renderLists() {
    const { list, busy } = prs;
    if (list)
      return html`${this.renderGroup(th("nav.prsReview"), list.review, false)}${this.renderGroup(th("pr.mine"), list.mine, true)}`;
    if (busy) return nothing;
    return html`<div class="text-secondary text-sm text-center p-4">${th("pr.notLoaded")}</div>`;
  }

  override render() {
    const { err } = prs;
    return html`<div class="min-h-0 overflow-y-auto border-r border-separator pb-4">
        ${err ? html`<div class="err-box m-4">${err}</div>` : nothing}${this.renderLists()}
      </div>
      <div class="min-h-0 overflow-y-auto"><relay-pr-detail></relay-pr-detail></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-prs": RelayPrs;
  }
}
