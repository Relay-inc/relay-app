import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

/** A token row: the name (slot), then tokens and cost for today and for the week. `head` is the column headings. */
@customElement("relay-usage-row")
export class UsageRow extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property() today = "";
  @property() todayCost = "";
  @property() week = "";
  @property() weekCost = "";
  @property({ type: Boolean }) head = false;

  render() {
    const v = "w-16 text-right tabular-nums", c = "w-16 text-right text-secondary tabular-nums";
    return html`<div class="flex items-baseline gap-3 text-sm py-[7px] border-b border-separator ${this.head ? "text-secondary font-medium" : ""}"><span class="flex-1 min-w-0 truncate"><slot></slot></span>
      <span class=${v}>${this.today}</span><span class=${c}>${this.todayCost}</span><span class=${v}>${this.week}</span><span class=${c}>${this.weekCost}</span></div>`;
  }
}
