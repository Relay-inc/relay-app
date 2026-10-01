import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import { tw } from "../../core/styles";

const DROP_LINE_BEFORE = "relative before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent";
const TINT = { "": "bg-tertiary", "ctx-a": "bg-ctx-a", "ctx-m": "bg-ctx-m", "ctx-p": "bg-ctx-p" };

/** A section header: a square in the context's colour, the name, the count while folded, the "+" for a new conversation and the fold chevron. */
@customElement("relay-sidebar-head")
export class SidebarHead extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property() label = "";
  @property() tint: keyof typeof TINT = "";
  @property({ type: Number }) count = 0;
  @property({ type: Boolean }) collapsed = false;
  @property({ type: Boolean }) addable = false;
  @property({ type: Boolean }) dropBefore = false;

  private renderAdd() {
    return html`<button
      class="hidden group-hover:block w-5 h-4 rounded-md text-base leading-none text-secondary cursor-default hover:bg-fill hover:text-label"
      title=${t("nav.newChat")}
      @click=${(e: Event) => {
        e.stopPropagation();
        emit(this, "addchat");
      }}
    >
      +
    </button>`;
  }

  override render() {
    return html`<div
      class="group flex items-center gap-2 h-6 px-2 rounded-md text-[11px] font-semibold uppercase tracking-wider text-tertiary hover:text-secondary cursor-default ${this.dropBefore ? DROP_LINE_BEFORE : ""}"
    >
      <span class="size-1.5 flex-none rounded-xs ${TINT[this.tint]}"></span>
      <span>${this.label}</span>
      ${this.collapsed && this.count ? html`<span class="font-medium tabular-nums">${this.count}</span>` : nothing}
      <span class="flex-1"></span>
      ${this.addable ? this.renderAdd() : nothing}
      ${icon("chevron", `glyph size-3 flex-none stroke-2 transition-transform duration-150 ease-out ${this.collapsed ? "-rotate-90" : ""}`)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-sidebar-head": SidebarHead;
  }
}
