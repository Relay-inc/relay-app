import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { tw } from "../../core/styles";
import type { Card, Column } from "../../domain/providers";
import "./board-card";

/** One column with its cards; `over` while a dragged card hovers it. A click on the header asks to fold it ("column-fold");
 * folded it is a narrow strip with its name upright, which still takes a dropped card. */
@customElement("relay-board-column")
export class BoardColumn extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
        flex: 0 0 264px;
      }
      :host([folded]) {
        flex-basis: 40px;
      }
    `,
  ];
  @property({ attribute: false }) column!: Column;
  @property({ attribute: false }) cards: Card[] = [];
  @property({ type: Boolean }) over = false;
  @property({ type: Boolean, reflect: true }) folded = false;
  private fold = () => this.dispatchEvent(new CustomEvent("column-fold", { bubbles: true, composed: true, detail: this.column.id }));

  override render() {
    return html`<div
      class="flex flex-col max-h-160 bg-fill rounded-lg p-2 transition-shadow duration-150 ease-out ${this.over ? "ring-2 ring-inset ring-accent" : ""}"
    >
      <div class="flex ${this.folded ? "flex-col items-center" : "justify-between"} gap-2 px-1 pt-0.5 pb-2 text-sm font-semibold cursor-pointer" title=${this.column.name} @click=${this.fold}>
        <span class=${this.folded ? "[writing-mode:vertical-rl] max-h-[60vh] truncate" : ""}>${this.column.name}</span><span class="text-secondary tabular-nums">${this.cards.length}</span>
      </div>
      <div class="flex flex-col gap-1.5 min-h-7 overflow-y-auto" ?hidden=${this.folded}>
        ${repeat(
          this.cards,
          card => card.id,
          card => html`<relay-board-card .card=${card}></relay-board-card>`,
        )}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board-column": BoardColumn;
  }
}
