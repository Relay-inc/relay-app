import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

/** The end of a turn: a quiet line under the answer, so it is clear the agent stopped. */
@customElement("relay-done-line")
export class DoneLine extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property() text = "";

  render() { return html`<div class="flex items-center gap-[6px] text-secondary text-xs pt-[2px] pb-[6px]">${icon("check", "glyph size-3 [stroke-width:1.6]")}${this.text}</div>`; }
}
