import { LitElement, css, html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import type { Card } from "../../domain/providers";

/** where a card was grabbed: the pointer, and the pointer's offset inside the card */
export type CardGrab = {
  id: string;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  width: number;
};

declare global {
  interface HTMLElementEventMap {
    "board-card-grab": CustomEvent<CardGrab>;
  }
}

// priorities 1 and 2 are coloured, 3 and 4 only named
const PRIORITY_CLASS: Record<number, string> = { 1: "text-late", 2: "text-soon", 3: "", 4: "" };
const CARD_AT_REST = "shadow-xs ring-1 ring-separator";
const CARD_DRAGGED = "fixed left-0 top-0 z-40 pointer-events-none opacity-95 shadow-lg";

/** One card. Pressing it reports where it was grabbed (the board drags it with pointer events, the Mac webview does not deliver HTML drag and drop reliably); `ghost` is the copy that follows the pointer. */
@customElement("relay-board-card")
export class BoardCard extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) card!: Card;
  @property({ attribute: false }) ghost: { left: number; top: number; width: number } | null = null;

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = this.getBoundingClientRect();
    emit(this, "board-card-grab", {
      id: this.card.id,
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: e.clientX - box.left,
      offsetY: e.clientY - box.top,
      width: box.width,
    });
  }

  private get dueLabel() {
    // 2026-10-03 shows as 3/10
    return this.card.due!.split("-").reverse().slice(0, 2).map(Number).join("/");
  }

  private renderNumber() {
    const { number } = this.card;
    if (!number) return nothing;
    return html`<span>${/^\d+$/.test(number) ? "#" : ""}${number}</span>`;
  }

  private renderPriority() {
    const { priority } = this.card;
    if (!priority || priority > 4) return nothing;
    return html`<span class=${PRIORITY_CLASS[priority] ?? ""}>${t(`kb.prio${priority}` as Key)}</span>`;
  }

  override render() {
    const { card, ghost } = this;
    const position = ghost ? { width: `${ghost.width}px`, transform: `translate(${ghost.left}px,${ghost.top}px)` } : {};
    return html`<div
      class="bg-bg rounded-md px-2.5 py-2 cursor-grab select-none ${ghost ? CARD_DRAGGED : CARD_AT_REST}"
      style=${styleMap(position)}
      @pointerdown=${ghost ? nothing : (e: PointerEvent) => this.onDown(e)}
    >
      <div class="text-sm leading-snug">${card.title}</div>
      <div class="flex gap-2.5 mt-1 text-xs text-secondary tabular-nums">
        ${this.renderNumber()}${this.renderPriority()}${card.who ? html`<span>${card.who}</span>` : nothing}${card.due ? html`<span>${this.dueLabel}</span>` : nothing}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board-card": BoardCard;
  }
}
