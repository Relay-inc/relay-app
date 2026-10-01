import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tw } from "../../core/styles";

/** The agent is busy: pulsing dots, and what it is doing. `label` is read out by assistive technology. */
@customElement("relay-working")
export class Working extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property() text = "";
  @property() label = "";

  render() {
    return html`<div class="flex items-center gap-[10px] text-secondary text-md py-1" role=${this.label ? "status" : nothing} aria-label=${this.label || nothing}><span class="pulse-dots"><i></i><i></i><i></i></span>${this.text
      ? html`<span class="overflow-hidden whitespace-nowrap text-ellipsis min-w-0 [&_code]:font-mono [&_code]:text-[12.5px]">${this.text}</span>` : nothing}</div>`;
  }
}
