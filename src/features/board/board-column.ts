import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { tw } from "../../core/styles";
import type { Card, Column } from "../../domain/providers";
import "./board-card";

/** One column with its cards; `over` while a dragged card hovers it. */
@customElement("relay-board-column")
export class BoardColumn extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
        flex: 0 0 264px;
      }
    `,
  ];
  @property({ attribute: false }) column!: Column;
  @property({ attribute: false }) cards: Card[] = [];
  @property({ type: Boolean }) over = false;

  override render() {
    return html`<div
      class="flex flex-col max-h-160 bg-fill rounded-lg p-2 transition-shadow duration-150 ease-out ${this.over ? "ring-2 ring-inset ring-accent" : ""}"
    >
      <div class="flex justify-between gap-2 px-1 pt-0.5 pb-2 text-sm font-semibold">
        <span>${this.column.name}</span><span class="text-secondary tabular-nums">${this.cards.length}</span>
      </div>
      <div class="flex flex-col gap-1.5 min-h-7 overflow-y-auto">
        ${repeat(
          this.cards,
          c => c.id,
          c => html`<relay-board-card .card=${c}></relay-board-card>`,
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
