import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

declare global {
  interface HTMLElementEventMap {
    usage: CustomEvent<void>;
    settings: CustomEvent<void>;
  }
}

const BTN = "relative flex size-7 items-center justify-center rounded-md transition-colors duration-150 ease-out";
const GLYPH = "glyph size-4 flex-none";

/** The footer bar: the usage button with its warning dot, and the settings button. */
@customElement("relay-sidebar-footer")
export class SidebarFooter extends LitElement {
  static override styles = [tw];

  @property({ type: Boolean }) selected = false; // the usage view is open
  @property() tip = ""; // the usage button's tooltip
  @property() level: "" | "soon" | "late" = ""; // "" shows no dot

  override render() {
    return html`<div class="flex justify-center gap-1.5 px-2.5 pt-1.5 pb-2.5 border-t border-separator">
      <button
        class="${BTN} ${this.selected ? "bg-accent text-on-accent" : "text-secondary hover:bg-fill hover:text-label"}"
        title=${this.tip}
        aria-label=${this.tip}
        @click=${() => emit(this, "usage")}
      >
        ${icon("gauge", GLYPH)}<span
          class="absolute bottom-0.5 right-0.5 size-2 rounded-full ${this.level ? "opacity-100" : "opacity-0"} ${this.level === "soon" ? "bg-soon" : this.level === "late" ? "bg-late" : "bg-secondary"}"
        ></span>
      </button>
      <button
        class="${BTN} text-secondary hover:bg-fill hover:text-label"
        title=${t("nav.settingsTooltip")}
        aria-label=${t("nav.settingsLabel")}
        @click=${() => emit(this, "settings")}
      >
        ${icon("gear", GLYPH)}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-sidebar-footer": SidebarFooter;
  }
}
