import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

@customElement("relay-error-line")
export class ErrorLine extends LitElement {
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
    return html`<div class="err-box">${this.text}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-error-line": ErrorLine;
  }
}
