import { css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { appIcon, buttonClass, inputValue } from "./blocks";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";

declare global {
  interface HTMLElementTagNameMap {
    "relay-settings-path": SettingsPath;
  }
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
  static override styles = [
    tws,
    css`
      :host {
        display: contents;
      }
    `,
  ];

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

  override render() {
    const input = html`<input
      class="h-6 min-w-0 w-auto flex-1 rounded-none border-0 bg-transparent p-0 font-mono text-xs text-s-fg placeholder:font-sans placeholder:text-s-subtle focus-visible:ring-1 ring-s-primary focus-visible:outline-none"
      .value=${live(this.value)}
      title=${this.tip}
      placeholder=${ifDefined(this.placeholder || undefined)}
      ?readonly=${this.readonly}
      spellcheck="false"
      @input=${(e: Event) => emit(this, "path-input", inputValue(e))}
      @change=${() => emit(this, "path-change")}
    />`;
    // the vault folder: the path with a folder glyph, and Choose… beside it
    if (this.wide)
      return html`<div class="flex w-full gap-2">
        <div class="flex h-7.5 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg bg-fill-2 px-2.5 text-xs">
          ${appIcon("folder", "size-3.5 flex-none fill-none stroke-secondary stroke-2 glyph")}${input}
        </div>
        <button class=${buttonClass()} @click=${() => emit(this, "path-pick")}>${this.pickTip}</button>
      </div>`;
    return html`<div
      class="flex h-7 w-62.5 items-center gap-2 overflow-hidden rounded-[7px] bg-fill-2 pr-1 pl-2.5 text-xs focus-within:ring-1 ring-s-primary"
    >
      ${input}${this.found == null ? nothing : html`<span class="size-1.5 flex-none rounded-full ${this.found ? "bg-s-ok" : "bg-s-warn"}" title=${this.foundTip}></span>`}<button
        class="grid size-5 flex-none place-items-center rounded-md text-s-muted hover:bg-s-hover hover:text-s-fg focus-visible:ring-1 ring-s-primary"
        @click=${() => emit(this, "path-pick")}
        title=${this.pickTip}
      >
        ${appIcon("folder", "size-3.5 fill-none stroke-current stroke-2 glyph")}
      </button>
    </div>`;
  }
}
