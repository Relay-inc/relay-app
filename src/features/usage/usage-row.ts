import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

const TOKENS = "w-16 text-right tabular-nums";
const COST = "w-16 text-right text-secondary tabular-nums";

/** A token row: the name (slot), then tokens and cost for today and for the week. `head` is the column headings. */
@customElement("relay-usage-row")
export class UsageRow extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() today = "";
  @property() todayCost = "";
  @property() week = "";
  @property() weekCost = "";
  @property({ type: Boolean }) head = false;

  override render() {
    return html`<div
      class="flex items-baseline gap-3 text-sm py-2 border-b border-separator ${this.head ? "text-secondary font-medium" : ""}"
    >
      <span class="flex-1 min-w-0 truncate"><slot></slot></span> <span class=${TOKENS}>${this.today}</span
      ><span class=${COST}>${this.todayCost}</span><span class=${TOKENS}>${this.week}</span
      ><span class=${COST}>${this.weekCost}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-usage-row": UsageRow;
  }
}
