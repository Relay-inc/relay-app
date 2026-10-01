import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

/** A titled block of the PR detail, the title (slot "heading", a directive cannot be a property) with its count. */
@customElement("relay-pr-section")
export class PrSection extends LitElement {
  static styles = [tw, css`:host { display: block; }`];
  @property() count: number | string = "";
  render() {
    return html`<h3 class="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5 pb-1 border-b border-separator"><slot name="heading"></slot>${this.count !== "" ? html` <span class="text-secondary tabular-nums">${this.count}</span>` : nothing}</h3><slot></slot>`;
  }
}
