import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

/** The agent is busy: an accent band runs along a hairline where the done line will go. `label` says what it is doing, read out by assistive technology and shown on hover. */
@customElement("relay-working")
export class Working extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
      /* an accent band runs along the line, left to right */
      .flow {
        background: linear-gradient(90deg, var(--separator) 0 42%, var(--accent) 50%, var(--separator) 58% 100%)
          var(--separator);
        background-size: 300% 100%;
        animation: flow 1.6s ease-in-out infinite;
      }
      @keyframes flow {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: 0 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .flow {
          background: var(--separator);
        }
      }
    `,
  ];
  @property() label = "";

  override render() {
    return html`<div class="flow h-px my-2" role="status" aria-label=${this.label} title=${this.label}></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-working": Working;
  }
}
