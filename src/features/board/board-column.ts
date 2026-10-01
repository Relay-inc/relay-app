import { LitElement, css, html, nothing } from "lit";
import { t } from "../../core/i18n";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { tw } from "../../core/styles";
import { icon } from "../../core/icons";
import type { Card, Column } from "../../domain/providers";
import { ring } from "./format";
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
  @property({ attribute: false }) selected = "";
  @property({ type: Boolean }) over = false;
  @property({ type: Boolean, reflect: true }) folded = false;
  private fold = () =>
    this.dispatchEvent(new CustomEvent("column-fold", { bubbles: true, composed: true, detail: this.column }));

  override render() {
    return html`<div
      class="flex flex-col gap-1.5 max-h-160 bg-fill rounded-xl p-1.5 transition-shadow duration-150 ease-out ${this.over ? "ring-2 ring-inset ring-accent" : ""}"
    >
      <div
        class="flex ${this.folded ? "flex-col items-center" : "items-center"} gap-2 ${this.folded ? "py-1.5" : "h-7.5 px-1.5"} text-xs font-semibold cursor-pointer"
        title=${this.column.name}
        @click=${this.fold}
      >
        ${this.column.state ? ring(this.column.state) : icon("folder", "glyph size-3.5 text-secondary")}
        <span class=${this.folded ? "[writing-mode:vertical-rl] max-h-[60vh] truncate" : "truncate"}
          >${this.column.name}</span
        ><span class="text-tertiary font-medium tabular-nums">${this.cards.length}</span>
      </div>
      <div class="flex flex-col gap-1.5 min-h-7 overflow-y-auto" ?hidden=${this.folded}>
        ${repeat(
          this.cards,
          card => card.id,
          card => html`<relay-board-card .card=${card} ?selected=${card.id === this.selected}></relay-board-card>`,
        )}
        ${this.cards.length ? nothing : html`<div class="py-4 text-center text-xs text-tertiary">${t("kb.noTasks")}</div>`}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board-column": BoardColumn;
  }
}
