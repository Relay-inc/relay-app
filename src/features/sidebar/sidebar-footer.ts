import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";
import mark from "../../relay-mark.svg";

declare global {
  interface HTMLElementEventMap {
    usage: CustomEvent<void>;
    theme: CustomEvent<void>;
    settings: CustomEvent<void>;
  }
}

const BTN =
  "relative flex size-7 items-center justify-center rounded-md text-secondary hover:bg-fill-2 hover:text-label transition-colors duration-150 ease-out";
const GLYPH = "glyph size-4 flex-none";

/** The footer bar: the Relay mark, the usage button with its status dot, the light/dark toggle and the settings button. */
@customElement("relay-sidebar-footer")
export class SidebarFooter extends LitElement {
  static override styles = [tw];

  @property({ type: Boolean }) selected = false; // the usage view is open
  @property({ type: Boolean }) dark = false; // the page is dark: the toggle offers light
  @property() tip = ""; // the usage button's tooltip
  @property() level: "" | "soon" | "late" = ""; // "" shows no dot

  private get dotColor() {
    if (this.level === "soon") return "bg-soon";
    if (this.level === "late") return "bg-late";
    return "bg-ok";
  }

  override render() {
    const themeTip = t(this.dark ? "nav.themeLight" : "nav.themeDark");
    return html`<div class="flex items-center gap-0.5 pt-2 pr-2 pb-2.5 pl-3.5 border-t border-separator">
      <img class="w-3.5 h-4 flex-none" src=${mark} alt="Relay" title="Relay" />
      <span class="flex-1"></span>
      <button
        class="${BTN} ${this.selected ? "bg-accent-soft text-accent-text!" : ""}"
        title=${this.tip}
        aria-label=${this.tip}
        @click=${() => emit(this, "usage")}
      >
        ${icon("gauge", GLYPH)}<span
          class="absolute bottom-1.25 right-1.25 size-1.5 rounded-full ring-[1.5px] ring-sidebar ${this.level ? "opacity-100" : "opacity-0"} ${this.dotColor}"
        ></span>
      </button>
      <button class=${BTN} title=${themeTip} aria-label=${themeTip} @click=${() => emit(this, "theme")}>
        ${icon(this.dark ? "sun" : "moon", GLYPH)}
      </button>
      <button
        class=${BTN}
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
