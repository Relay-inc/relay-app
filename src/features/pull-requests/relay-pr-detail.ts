import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { panel, closeDetail } from "../../domain/panel";
import { reviewPr, type PrDetail } from "../../domain/prs";
import "./pr-body";

/** One PR in the right panel: the bar, then the body once github_pr has answered. */
@customElement("relay-pr-detail")
export class RelayPrDetail extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);

  private renderBar(key: string, pr: PrDetail | null) {
    const actions = pr
      ? html`<span class="flex-1"></span
          ><button
            class="btn btn-primary whitespace-nowrap flex-none"
            title=${t("pr.reviewTitle")}
            @click=${() => reviewPr(key)}
          >
            ${th("pr.review")}</button
          ><a class="btn whitespace-nowrap flex-none inline-flex items-center" href=${pr.url}>${th("pr.openGh")}</a>`
      : nothing;
    return html`<div class="flex items-center flex-wrap gap-2 mb-3">
      <button class="btn whitespace-nowrap flex-none" title=${t("pr.close")} @click=${closeDetail}>×</button>
      ${actions}
    </div>`;
  }

  override render() {
    const key = panel.open;
    const pr = (panel.detail[key] as PrDetail | undefined) ?? null;
    const bar = this.renderBar(key, pr);
    if (panel.err)
      return html`${bar}
        <div class="err-box">${panel.err}</div>`;
    if (!pr)
      return html`${bar}
        <div class="text-secondary mb-3">${th("pr.loading")}</div>`;
    return html`${bar}<relay-pr-body .pr=${pr}></relay-pr-body>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-detail": RelayPrDetail;
  }
}
