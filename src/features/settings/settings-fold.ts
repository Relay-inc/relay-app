import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { emit } from "../../core/dom";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { Renderable } from "./types";

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
  /** a row that opens a page of its own instead of folding: no expanded state, never shows the slot */
  @property({ type: Boolean }) nav = false;
  @property({ attribute: false }) icon: Renderable = nothing;
  @property({ attribute: false }) name: Renderable = nothing;
  @property({ attribute: false }) status: Renderable = nothing;

  override render() {
    // a hairline between the rows, none above the first (the host's own border would lose to the page's `*` reset)
    return html`<div class="border-t border-s-border [:host(:first-child)_&]:border-t-0">
      <button
        class="group flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-fill focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${this.open ? "bg-fill" : ""}"
        @click=${() => emit(this, "fold-toggle")}
        aria-expanded=${ifDefined(this.nav ? undefined : (String(this.open) as "true" | "false"))}
      >
        <span class="grid size-7.5 flex-none place-items-center rounded-lg bg-fill-2">${this.icon}</span>
        <span class="min-w-0 flex-1"
          ><b class="flex items-center gap-1.5 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap"
            >${this.name}</b
          >
          <div class="mt-px flex">${this.status}</div></span
        >
        <svg
          class="size-3.5 flex-none fill-none stroke-tertiary stroke-2 transition-transform duration-150 ease-in-out glyph group-hover:stroke-s-fg ${this.open ? "rotate-90" : ""}"
          viewBox="0 0 24 24"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      ${this.open && !this.nav ? html`<div class="grid grid-cols-1 gap-3 px-3.5 pb-3.5 pl-13"><slot></slot></div>` : nothing}
    </div>`;
  }
}
