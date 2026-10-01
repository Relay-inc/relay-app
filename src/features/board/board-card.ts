import { LitElement, css, html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";
import type { Card } from "../../domain/providers";

declare global {
  interface HTMLElementEventMap {
    "board-card-grab": CustomEvent<{ id: string; x: number; y: number; dx: number; dy: number; w: number }>;
  }
}

// priorities 1 and 2 are coloured, 3 and 4 only named
const PRIO: Record<number, string> = { 1: "text-late", 2: "text-soon", 3: "", 4: "" };

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
  @property({ attribute: false }) ghost: { x: number; y: number; w: number } | null = null;

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = this.getBoundingClientRect();
    emit(this, "board-card-grab", {
      id: this.card.id,
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      w: r.width,
    });
  }

  override render() {
    const c = this.card,
      g = this.ghost;
    return html`<div
      class="bg-bg rounded-md px-2.5 py-2 cursor-grab select-none ${g ? "fixed left-0 top-0 z-40 pointer-events-none opacity-95 shadow-lg" : "shadow-xs ring-1 ring-separator"}"
      style=${styleMap(g ? { width: `${g.w}px`, transform: `translate(${g.x}px,${g.y}px)` } : {})}
      @pointerdown=${g ? nothing : (e: PointerEvent) => this.onDown(e)}
    >
      <div class="text-sm leading-snug">${c.title}</div>
      <div class="flex gap-2.5 mt-1 text-xs text-secondary tabular-nums">
        ${c.number ? html`<span>${/^\d+$/.test(c.number) ? "#" : ""}${c.number}</span>` : nothing}${c.priority && c.priority <= 4 ? html`<span class=${PRIO[c.priority] ?? ""}>${t(`kb.prio${c.priority}` as Key)}</span>` : nothing}${c.who ? html`<span>${c.who}</span>` : nothing}${c.due ? html`<span>${c.due.split("-").reverse().slice(0, 2).map(Number).join("/")}</span>` : nothing}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board-card": BoardCard;
  }
}
