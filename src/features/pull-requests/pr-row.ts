import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { tw } from "../../core/styles";
import { emit } from "../../core/dom";
import type { PR } from "../../domain/prs";
import "./pr-status";

declare global {
  interface HTMLElementEventMap {
    "open-pr": CustomEvent<PR>;
  }
}

const age = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d < 1 ? th("due.today") : th("pr.days", { n: d });
};

/** One PR row, in the list and (compact, chips under the title) in a project's PR tab. */
@customElement("relay-pr-row")
export class PrRow extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) pr!: PR;
  @property({ type: Boolean }) mine = false;
  @property({ type: Boolean }) selected = false;
  @property({ type: Boolean }) compact = false;
  /** the project's display label, "" when the PR has none */
  @property() project = "";

  render() {
    const p = this.pr,
      c = this.compact;
    return html`<div
      class="group items-center border-b border-separator text-inherit cursor-default
        ${c ? "grid grid-cols-1 gap-1 py-2" : "flex gap-4 py-2.5"} ${this.selected ? "bg-fill -mx-2.5 px-2.5 rounded-lg" : ""}"
      @click=${() => emit(this, "open-pr", p)}
    >
      <div class="min-w-0 flex-1">
        <div class="group-hover:text-accent leading-snug line-clamp-2 ${c ? "text-sm" : "text-base"}">
          ${p.draft ? html`<span class="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5">${th("pr.draft")}</span>` : nothing}${p.title}
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-secondary mt-0.5 tabular-nums ${c ? "text-xs" : "text-sm"}">
          <span>${p.repo.split("/")[1] || p.repo} #${p.number}</span
          >${this.project ? html`<span>${this.project}</span>` : nothing}${this.mine ? nothing : html`<span>${p.author || ""}</span>`}<span
            >${age(p.created)}</span
          >
        </div>
      </div>
      <relay-pr-status .ci=${p.ci} .review=${p.review}></relay-pr-status>
    </div>`;
  }
}
