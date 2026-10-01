import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { Tpl } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-fold": SettingsFold;
  }
  interface HTMLElementEventMap {
    "fold-toggle": CustomEvent<void>;
  }
}

/** A row of a list that folds open to its settings (the slot): icon, name, a status line, and a chevron. The page keeps
 *  which rows are open and flips it on `fold-toggle`. */
@customElement("relay-settings-fold")
export class SettingsFold extends SettingsElement {
  static override styles = [
    tws,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) ico: Tpl = nothing;
  @property({ attribute: false }) name: Tpl = nothing;
  @property({ attribute: false }) state: Tpl = nothing;

  override render() {
    // a hairline between the rows, none above the first (the host's own border would lose to the page's `*` reset)
    return html`<div class="border-t border-s-border [:host(:first-child)_&]:border-t-0">
      <button
        class="group flex w-full items-center gap-3 rounded-sm py-2.5 text-left focus-visible:ring-2 ring-s-ring focus-visible:outline-none"
        @click=${() => emit(this, "fold-toggle")}
        aria-expanded=${this.open}
      >
        <span class="grid w-6 flex-none place-items-center">${this.ico}</span>
        <span class="min-w-0 flex-1"
          ><b class="flex items-center gap-1.5 overflow-hidden font-medium text-ellipsis whitespace-nowrap"
            >${this.name}</b
          >
          <div class="mt-px flex">${this.state}</div></span
        >
        <svg
          class="size-3.5 flex-none fill-none stroke-s-subtle stroke-2 transition-transform duration-150 ease-in-out glyph group-hover:stroke-s-fg ${this.open ? "rotate-90" : ""}"
          viewBox="0 0 24 24"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      ${this.open ? html`<div class="grid grid-cols-1 gap-3 pb-3.5 pl-9"><slot></slot></div>` : nothing}
    </div>`;
  }
}
