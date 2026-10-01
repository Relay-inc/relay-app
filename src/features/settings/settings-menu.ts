import { css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property, state } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { buttonClass, BUTTON_GLYPH, appIcon } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { Renderable } from "./types";

export type MenuItem = { id: string; icon?: Renderable; name: Renderable; status?: Renderable };

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-menu": SettingsMenu;
  }
  interface HTMLElementEventMap {
    "menu-pick": CustomEvent<string>;
  }
}

/** A button with a menu under it (or over it, `up`): the Add menu with what is not in the list yet (icon, name, status),
 *  and an integration's "…" menu with its rarer actions. */
@customElement("relay-settings-menu")
export class SettingsMenu extends SettingsElement {
  static override styles = [
    tws,
    css`
      :host {
        display: block;
        position: relative;
      }
      :host([hidden]) {
        display: none;
      }
    `,
  ];

  /** The text of the button; without it the button is the "…" glyph, titled `tip` */
  @property() label = "";
  @property() tip = "";
  @property({ type: Boolean }) up = false;
  @property({ attribute: false }) items: MenuItem[] = [];
  @state() private shown = false;

  private closeOnOutside = (e: MouseEvent) => {
    if (this.shown && !e.composedPath().includes(this)) this.shown = false;
  };
  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this.closeOnOutside);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("click", this.closeOnOutside);
  }

  // nothing to offer: not even a flex gap for the host
  override willUpdate() {
    this.toggleAttribute("hidden", !this.items.length);
  }

  private pick(item: MenuItem) {
    this.shown = false;
    emit(this, "menu-pick", item.id);
  }

  private renderItem(item: MenuItem) {
    const icon = item.icon
      ? html`<span class="mt-px grid size-4 flex-none place-items-center">${item.icon}</span>`
      : nothing;
    return html`<button
      class="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-s-hover focus-visible:bg-s-hover focus-visible:outline-none"
      @click=${() => this.pick(item)}
    >
      ${icon}<span class="grid min-w-0 gap-0.5"
        ><b class="text-sm font-medium">${item.name}</b>${item.status ?? nothing}</span
      >
    </button>`;
  }

  private renderPanel() {
    if (!this.shown) return nothing;
    const side = this.up ? "bottom-8 left-0" : "top-8 right-0";
    return html`<div
      class="absolute z-0 grid w-75 gap-0.5 rounded-md border border-s-border bg-s-bg p-1 shadow-lg ${side}"
    >
      ${this.items.map(item => this.renderItem(item))}
    </div>`;
  }

  override render() {
    if (!this.items.length) return nothing;
    return html`<button
        class=${this.label ? buttonClass() : buttonClass("plain", true)}
        @click=${() => {
          this.shown = !this.shown;
        }}
        title=${ifDefined(this.tip || undefined)}
        aria-expanded=${this.shown}
      >
        ${this.label || appIcon("more", BUTTON_GLYPH)}
      </button>
      ${this.renderPanel()}`;
  }
}
