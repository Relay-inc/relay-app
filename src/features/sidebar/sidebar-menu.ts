import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";

export type MenuItem = { id: string; label: string; head?: boolean };

declare global {
  interface HTMLElementEventMap {
    pick: CustomEvent<string>;
  }
}

/** The right-click menu at the pointer: buttons, and small headings between them. Emits `pick` with the item's id. */
@customElement("relay-sidebar-menu")
export class SidebarMenu extends LitElement {
  static styles = [tw];

  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ attribute: false }) items: MenuItem[] = [];

  render() {
    return html`<div class="fixed z-20 min-w-[180px] grid p-1 bg-bg border border-separator rounded-lg shadow-[0_8px_24px_rgba(0,0,0,.14)]" style="left:${this.x}px;top:${this.y}px">
      ${this.items.map(i => i.head ? html`<div class="px-2.5 pt-1.5 pb-0.5 text-2xs font-semibold text-secondary">${i.label}</div>`
        : html`<button class="max-w-[280px] px-2.5 py-[5px] rounded-sm text-sm text-left text-label truncate hover:bg-accent hover:text-on-accent" @click=${() => emit(this, "pick", i.id)}>${i.label}</button>`)}
    </div>`;
  }
}
