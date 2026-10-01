import { LitElement, css, html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import { icon } from "../../core/icons";
import type { Card } from "../../domain/providers";
import { avatar, due, ring, updated } from "./format";

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
const CARD_AT_REST = "shadow-sm ring-1 ring-separator-strong hover:shadow-md";
const CARD_SELECTED = "ring-2 ring-accent shadow-[0_0_0_4px_var(--accent-soft)]";
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
  @property({ type: Boolean }) selected = false;
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
    const path = [card.folder, card.list].filter(Boolean).join(" › ");
    const dueDay = due(card.due);
    const touched = updated(card.updated);
    return html`<div
      class="bg-raised rounded-lg px-3 py-2.5 flex flex-col gap-1.5 cursor-grab select-none ${ghost ? CARD_DRAGGED : this.selected ? CARD_SELECTED : CARD_AT_REST}"
      style=${styleMap(position)}
      @pointerdown=${ghost ? nothing : (e: PointerEvent) => this.onDown(e)}
    >
      <div class="flex items-center gap-1.5 h-5 font-mono text-xs text-tertiary">
        ${this.renderNumber()}${this.renderPriority()}<span class="flex-1"></span>${avatar(card.who)}
      </div>
      <div class="flex gap-2 items-start">
        ${card.state ? html`<span class="mt-0.5 inline-flex">${ring(card.state)}</span>` : nothing}
        <div class="text-[13px] font-medium leading-snug">${card.title}</div>
      </div>
      ${path ? html`<div class="text-[11px] text-tertiary ${card.state ? "pl-5.5" : ""}">${path}</div>` : nothing}
      ${
        card.labels?.length || dueDay || touched
          ? html`<div
              class="flex items-center gap-1.5 text-[11px] text-secondary tabular-nums ${card.state ? "pl-5.5" : ""}"
            >
              ${(card.labels ?? []).map(name => html`<span class="h-4.5 px-1.5 rounded-sm bg-fill-2 inline-flex items-center">${name}</span>`)}
              ${dueDay ? html`<span class="inline-flex items-center gap-1 font-medium ${dueDay.tone}">${icon("cal", "glyph size-3")}${dueDay.short}</span>` : nothing}
              <span class="flex-1"></span><span class="text-tertiary">${touched}</span>
            </div>`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board-card": BoardCard;
  }
}
