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

const MS_PER_DAY = 864e5;
const age = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / MS_PER_DAY);
  return days < 1 ? th("due.today") : th("pr.days", { n: days });
};

/** One PR row, in the list and (compact, chips under the title) in a project's PR tab. */
@customElement("relay-pr-row")
export class PrRow extends LitElement {
  static override styles = [
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

  private renderTitle() {
    const draft = this.pr.draft
      ? html`<span class="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5"
          >${th("pr.draft")}</span
        >`
      : nothing;
    return html`<div
      class="group-hover:text-accent leading-snug line-clamp-2 ${this.compact ? "text-sm" : "text-base"}"
    >
      ${draft}${this.pr.title}
    </div>`;
  }
  private renderMeta() {
    const pr = this.pr;
    const project = this.project ? html`<span>${this.project}</span>` : nothing;
    const author = this.mine ? nothing : html`<span>${pr.author || ""}</span>`;
    return html`<div
      class="flex flex-wrap gap-x-3 gap-y-1 text-secondary mt-0.5 tabular-nums ${this.compact ? "text-xs" : "text-sm"}"
    >
      <span>${pr.repo.split("/")[1] || pr.repo} #${pr.number}</span>${project}${author}<span>${age(pr.created)}</span>
    </div>`;
  }

  override render() {
    const layout = this.compact ? "grid grid-cols-1 gap-1 py-2" : "flex gap-4 py-2.5";
    const selected = this.selected ? "bg-fill -mx-2.5 px-2.5 rounded-lg" : "";
    return html`<div
      class="group items-center border-b border-separator text-inherit cursor-default ${layout} ${selected}"
      @click=${() => emit(this, "open-pr", this.pr)}
    >
      <div class="min-w-0 flex-1">${this.renderTitle()}${this.renderMeta()}</div>
      <relay-pr-status .ci=${this.pr.ci} .review=${this.pr.review}></relay-pr-status>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-row": PrRow;
  }
}
