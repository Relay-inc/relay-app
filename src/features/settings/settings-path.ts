import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { ic, val } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap { "relay-settings-path": SettingsPath }
  interface HTMLElementEventMap {
    "path-input": CustomEvent<string>;
    "path-change": CustomEvent<void>;
    "path-pick": CustomEvent<void>;
  }
}

// A path with its folder button inside the field, and a dot for whether the app found it.
// The window used to load the main stylesheet too, where the composer's `.pick` (all:unset, 2px 4px padding) also hit
// these path boxes: kept, it sets their height. all:unset made the box content-box, so 260 × 28 is the content and the
// padding and border come on top.
@customElement("relay-settings-path")
export class SettingsPath extends SettingsElement {
  static styles = [tws, css`:host{display:contents}`];

  @property() value = "";
  @property() placeholder = "";
  /** The tooltip of the input */
  @property() tip = "";
  @property({ type: Boolean }) readonly = false;
  @property({ type: Boolean }) wide = false;
  /** Found (true) or missing (false), or no dot */
  @property({ attribute: false }) found: boolean | null = null;
  @property() foundTip = "";
  @property() pickTip = "";

  render() {
    return html`<div class="${this.wide ? "w-auto" : "w-[260px]"} box-content flex h-7 items-center gap-[7px] overflow-hidden rounded-[6px] border border-s-input py-0.5 pr-1 pl-[9px] text-xs focus-within:shadow-[0_0_0_1px_var(--s-primary)]">${this.found == null ? nothing : html`<span class="size-1.5 flex-none rounded-full ${this.found ? "bg-s-ok" : "bg-s-warn"}" title=${this.foundTip}></span>`}<input
        class="h-[26px] min-w-0 w-auto flex-1 rounded-none border-0 bg-transparent p-0 font-mono text-xs text-s-fg placeholder:font-sans placeholder:text-s-subtle focus-visible:shadow-[0_0_0_1px_var(--s-primary)] focus-visible:outline-none"
        .value=${live(this.value)} title=${this.tip} placeholder=${this.placeholder || nothing} ?readonly=${this.readonly} spellcheck="false"
        @input=${(e: Event) => emit(this, "path-input", val(e))} @change=${() => emit(this, "path-change")}><button
        class="box-content grid h-7 w-[30px] flex-none place-items-center border-l border-s-border text-s-muted hover:bg-s-hover hover:text-s-fg focus-visible:shadow-[inset_0_0_0_1px_var(--s-primary)]"
        @click=${() => emit(this, "path-pick")} title=${this.pickTip}>${ic("folder", "size-[15px] fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]")}</button></div>`;
  }
}
