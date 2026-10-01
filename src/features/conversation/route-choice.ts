import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { tw } from "../../core/styles";

declare global {
  interface HTMLElementEventMap {
    route: CustomEvent<string>;
  }
}

/** A general message names several projects: pick one, or keep it general (`route`, the project or ""). */
@customElement("relay-route-choice")
export class RouteChoice extends LitElement {
  static styles = [tw, css`:host{display:block}`];
  @property({ attribute: false }) hits: string[] = [];

  render() {
    return html`<div class="grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3"><div class="text-sm text-secondary">${t("route.question")}</div>
      <div class="flex flex-wrap gap-2">${this.hits.map(h => html`<button class="btn" @click=${() => emit(this, "route", h)}>${h}</button>`)}<button class="btn" @click=${() => emit(this, "route", "")}>${t("route.keep")}</button></div></div>`;
  }
}
