import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

const TONE = { ok: "text-ok", bad: "text-bad", "": "text-secondary" };

/** A small status pill: grey, green or red. */
@customElement("relay-pr-chip")
export class PrChip extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: inline-block;
      }
    `,
  ];
  @property() tone: "ok" | "bad" | "" = "";
  render() {
    return html`<span class="text-xs px-2 py-0.5 rounded-lg bg-fill whitespace-nowrap block ${TONE[this.tone]}"
      ><slot></slot
    ></span>`;
  }
}
