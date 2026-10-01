import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

/** The end of a turn: a centred label between two lines under the answer, so it is clear the agent stopped. */
@customElement("relay-done-line")
export class DoneLine extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() text = "";

  override render() {
    return html`<div class="flex items-center gap-2.5 text-tertiary text-xs">
      <span class="flex-1 h-px bg-separator"></span>${this.text}<span class="flex-1 h-px bg-separator"></span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-done-line": DoneLine;
  }
}
