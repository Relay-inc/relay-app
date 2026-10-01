import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

/** A quiet centred line: "stopped", "moved to …", the empty conversation. */
@customElement("relay-note-line")
export class NoteLine extends LitElement {
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
    return html`<div class="text-center text-sm text-secondary">${this.text}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-note-line": NoteLine;
  }
}
