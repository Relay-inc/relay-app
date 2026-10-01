import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

const TONE = { ok: "text-ok bg-ok/10", bad: "text-bad bg-bad/10", "": "text-secondary bg-fill" };

/** A small status pill: grey, pale green or pale red. */
@customElement("relay-pr-chip")
export class PrChip extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: inline-block;
      }
    `,
  ];
  @property() tone: "ok" | "bad" | "" = "";
  override render() {
    return html`<span
      class="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap block ${TONE[this.tone]}"
      ><slot></slot
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-chip": PrChip;
  }
}
