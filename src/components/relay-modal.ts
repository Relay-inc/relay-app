import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../core/i18n";
import { emit } from "../core/dom";
import { icon } from "../core/icons";
import { tw } from "../core/styles";

declare global {
  interface HTMLElementEventMap {
    "modal-close": CustomEvent<void>;
  }
}

/** The window over a view (the board's task, a pull request): a dim backdrop and the 960x700 card on it. The header and
 * the body are its children; a click on the backdrop asks to close with "modal-close". */
@customElement("relay-modal")
export class RelayModal extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: contents;
      }
    `,
  ];
  /** an action is running: the card is dimmed and takes no clicks */
  @property({ type: Boolean }) acting = false;

  override render() {
    return html`<div
      class="fixed inset-0 z-50 grid place-items-center bg-black/30"
      @click=${() => emit(this, "modal-close")}
    >
      <div
        class="w-240 max-w-[calc(100vw-48px)] h-175 max-h-[calc(100vh-48px)] flex flex-col bg-bg rounded-2xl shadow-md ring-1 ring-separator-strong overflow-hidden ${this.acting ? "opacity-70" : ""}"
        .inert=${this.acting}
        @click=${(e: Event) => e.stopPropagation()}
      >
        <slot></slot>
      </div>
    </div>`;
  }
}

const button = (name: string, title: string, onClick: () => void, disabled = false) =>
  html`<button class="btn-icon disabled:opacity-40" title=${title} ?disabled=${disabled} @click=${onClick}>
    ${icon(name, "glyph size-4")}
  </button>`;

/** The window's 52px header: what it shows on the left, "3 of 14" with previous/next, an optional link, close. */
export function modalHeader(o: {
  left: TemplateResult | typeof nothing;
  position: string;
  first: boolean;
  last: boolean;
  link?: unknown;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  return html`<div class="h-13 flex-none flex items-center gap-2 pl-5 pr-3 border-b border-separator">
    ${o.left}
    <span class="flex-1"></span>
    <span class="text-xs text-tertiary tabular-nums mr-0.5">${o.position}</span>
    ${button("left", t("kb.prev"), () => o.onStep(-1), o.first)}
    ${button("right", t("kb.next"), () => o.onStep(1), o.last)}
    <span class="w-px h-4 bg-separator-strong mx-1"></span>
    ${o.link ?? nothing}${button("close", t("kb.closeEsc"), () => o.onClose())}
  </div>`;
}

/** A link in the window's header. */
export const modalLink = (href: string, text: string) =>
  html`<a
    class="inline-flex items-center gap-1 h-7 px-2.5 rounded-[7px] text-xs text-secondary no-underline hover:bg-fill-2 hover:text-label"
    href=${href}
    >${text}${icon("out", "glyph size-3")}</a
  >`;

declare global {
  interface HTMLElementTagNameMap {
    "relay-modal": RelayModal;
  }
}
