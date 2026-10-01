import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";

const DROP_LINE_BEFORE = "relative before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent";
const TINT = { "": "", "ctx-a": "text-ctx-a", "ctx-m": "text-ctx-m", "ctx-p": "text-ctx-p" };

/** A section header: the fold chevron, the name in its context colour, the count while folded, and the "+" for a new conversation. */
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
      class="ml-auto w-5 h-4 rounded-md text-base leading-none text-secondary cursor-default hover:bg-fill hover:text-label"
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
      class="flex items-center gap-1.5 px-2 pt-3 pb-1 text-xs font-semibold text-secondary tracking-wide cursor-default ${this.dropBefore ? DROP_LINE_BEFORE : ""}"
    >
      <span
        class="w-0 h-0 border-l-4 border-l-secondary border-y-3 border-y-transparent transition-transform duration-150 ease-out ${this.collapsed ? "" : "rotate-90"}"
      ></span>
      <span class=${TINT[this.tint]}>${this.label}</span>
      ${this.collapsed && this.count ? html`<span class="font-normal tabular-nums">${this.count}</span>` : nothing}
      ${this.addable ? this.renderAdd() : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-sidebar-head": SidebarHead;
  }
}
