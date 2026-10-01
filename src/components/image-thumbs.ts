import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../core/i18n";
import { emit } from "../core/dom";
import { tw } from "../core/styles";

declare global {
  interface HTMLElementEventMap {
    remove: CustomEvent<number>;
    open: CustomEvent<string>;
  }
}

/** Thumbnails in the composer, the Cmd-K field and the user's messages. An empty url is an image the transcript did not hold inline.
 *  A click opens one larger (`open`), `removable` adds the × button (`remove`, the index). */
@customElement("relay-image-thumbs")
export class ImageThumbs extends LitElement {
  static styles = [tw, css`:host{display:flex;flex-wrap:wrap;gap:8px} :host([size=message]){justify-content:flex-end}`];
  @property({ attribute: false }) urls: string[] = [];
  @property({ type: Boolean }) removable = false;
  @property({ reflect: true }) size: "composer" | "message" = "composer";

  render() {
    const img = this.size === "message" ? "h-16 max-w-[200px]" : "h-[60px] max-w-[180px]";
    return this.urls.map((u, i) => u
      ? html`<span class="group relative block flex-none"><img class="${img} block object-cover rounded-lg shadow-[0_0_0_.5px_var(--separator)] cursor-zoom-in" src=${u} alt="" @click=${() => emit(this, "open", u)}>${this.removable
          ? html`<button class="absolute -top-[6px] -right-[6px] hidden group-hover:grid focus-visible:grid size-[18px] rounded-full p-0 bg-label text-bg text-[13px] leading-none place-items-center cursor-default" title=${t("img.remove")} aria-label=${t("img.removeLabel")} @click=${(e: Event) => { e.stopPropagation(); emit(this, "remove", i); }}>×</button>` : nothing}</span>`
      : html`<span class="text-sm text-secondary">${t("img.placeholder")}</span>`);
  }
}
