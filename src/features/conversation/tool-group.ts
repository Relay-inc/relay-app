import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tn } from "../../core/i18n";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

/** The tool calls between two messages, folded into one line ("3 steps") that opens to list them (its children).
 *  It stays open while a step runs or failed, so what the agent is doing shows. */
@customElement("relay-tool-group")
export class ToolGroup extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ type: Number }) count = 0;
  @property({ type: Boolean }) active = false;
  @state() private open = false;

  override render() {
    const shown = this.open || this.active;
    return html`<button
        class="inline-flex items-center gap-1.5 h-6 cursor-pointer px-1.5 -ml-1.5 border-0 rounded-md bg-transparent text-xs text-secondary hover:bg-fill hover:text-label"
        aria-expanded=${shown}
        @click=${() => (this.open = !this.open)}
      >
        ${icon("right", `glyph size-3 stroke-2 transition-transform duration-150 ${shown ? "rotate-90" : ""}`)}${tn("steps", this.count)}
      </button>
      <div class="flex-col gap-0.5 ml-1.25 pl-3 border-l border-separator-strong ${shown ? "flex" : "hidden"}">
        <slot></slot>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-tool-group": ToolGroup;
  }
}
