import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { emit } from "../../core/dom";
import { btn, IB, ic } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { Tpl } from "./types";

export type MenuItem = { id: string; ico?: Tpl; name: Tpl; state?: Tpl };

declare global {
  interface HTMLElementTagNameMap { "relay-settings-menu": SettingsMenu }
  interface HTMLElementEventMap { "menu-pick": CustomEvent<string> }
}

/** A button with a menu under it (or over it, `up`): the Add menu with what is not in the list yet (icon, name, status),
 *  and an integration's "…" menu with its rarer actions. */
@customElement("relay-settings-menu")
export class SettingsMenu extends SettingsElement {
  static styles = [tws, css`:host{display:block;position:relative}:host([hidden]){display:none}`];

  /** The text of the button; without it the button is the "…" glyph, titled `tip` */
  @property() label = "";
  @property() tip = "";
  @property({ type: Boolean }) up = false;
  @property({ attribute: false }) items: MenuItem[] = [];
  @state() private shown = false;

  private away = (e: MouseEvent) => { if (this.shown && !e.composedPath().includes(this)) this.shown = false; };
  connectedCallback() { super.connectedCallback(); window.addEventListener("click", this.away); }
  disconnectedCallback() { super.disconnectedCallback(); window.removeEventListener("click", this.away); }

  // nothing to offer: not even a flex gap for the host
  willUpdate() { this.toggleAttribute("hidden", !this.items.length); }
  render() {
    if (!this.items.length) return nothing;
    return html`<button class=${this.label ? btn() : btn("plain", true)} @click=${() => { this.shown = !this.shown; }} title=${this.tip || nothing} aria-expanded=${this.shown}>${this.label || ic("more", IB)}</button>
      ${this.shown ? html`<div class="absolute z-0 grid w-75 gap-0.5 rounded-md border border-s-border bg-s-bg p-1 shadow-lg ${this.up ? "bottom-8 left-0" : "top-8 right-0"}">${this.items.map(x =>
        html`<button class="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-s-hover focus-visible:bg-s-hover focus-visible:outline-none" @click=${() => { this.shown = false; emit(this, "menu-pick", x.id); }}>${x.ico ? html`<span class="mt-px grid size-4 flex-none place-items-center">${x.ico}</span>` : nothing}<span class="grid min-w-0 gap-0.5"><b class="text-sm font-medium">${x.name}</b>${x.state ?? nothing}</span></button>`)}</div>` : nothing}`;
  }
}
