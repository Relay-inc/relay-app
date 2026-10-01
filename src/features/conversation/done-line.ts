import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

/** The end of a turn: a quiet line under the answer, so it is clear the agent stopped. */
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
    return html`<div class="flex items-center gap-1.5 text-secondary text-xs pt-0.5 pb-1.5">
      ${icon("check", "glyph size-3 stroke-2")}${this.text}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-done-line": DoneLine;
  }
}
