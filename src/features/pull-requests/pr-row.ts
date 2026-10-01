import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { tw } from "../../core/styles";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import type { Key } from "../../core/locales/en";
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

// the compact row's CI dot: colour and label
const CI_DOT: Record<string, [string, Key]> = {
  SUCCESS: ["text-ok", "ci.ok"],
  FAILURE: ["text-bad", "ci.fail"],
  ERROR: ["text-bad", "ci.error"],
  PENDING: ["text-secondary", "ci.pending"],
  EXPECTED: ["text-secondary", "ci.expected"],
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
      class="group-hover:text-accent leading-snug line-clamp-2 text-base"
    >
      ${draft}${this.pr.title}
    </div>`;
  }
  private renderMeta() {
    const pr = this.pr;
    const project = this.project ? html`<span>${this.project}</span>` : nothing;
    const author = this.mine ? nothing : html`<span>${pr.author || ""}</span>`;
    return html`<div
      class="flex flex-wrap gap-x-3 gap-y-1 text-secondary mt-0.5 tabular-nums text-sm"
    >
      <span>${pr.repo.split("/")[1] || pr.repo} #${pr.number}</span>${project}${author}<span>${age(pr.created)}</span>
    </div>`;
  }

  // the inspector's row: a state-coloured PR glyph, the title, then "#number repo, CI dot and label"
  private renderCompact() {
    const pr = this.pr;
    const state = pr.draft ? "text-secondary" : pr.review === "CHANGES_REQUESTED" ? "text-bad" : pr.review === "APPROVED" ? "text-ok" : "text-accent";
    const ci = pr.ci ? CI_DOT[pr.ci] : undefined;
    return html`<div
      class="group flex gap-2.5 py-2.5 border-b border-separator cursor-default ${this.selected ? "bg-fill -mx-2.5 px-2.5 rounded-lg" : ""}"
      @click=${() => emit(this, "open-pr", this.pr)}
    >
      <span class="mt-px size-4 flex-none ${state}">${icon("pr")}</span>
      <div class="min-w-0 flex-1 flex flex-col gap-0.75">
        <span class="text-[13px] font-medium leading-snug line-clamp-2 group-hover:text-accent"
          >${this.pr.draft ? html`<span class="text-xs font-normal text-secondary mr-1.5">${th("pr.draft")}</span>` : nothing}${pr.title}</span
        >
        <span class="text-xs text-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5"
          ><span class="font-mono text-[11px]">#${pr.number}</span>${pr.repo.split("/")[1] || pr.repo}${ci
            ? html`<span class="inline-flex items-center gap-1 ${ci[0]}"
                ><span class="size-1.5 rounded-full bg-current"></span>${th(ci[1])}</span
              >`
            : nothing}</span
        >
      </div>
    </div>`;
  }

  override render() {
    if (this.compact) return this.renderCompact();
    const layout = "flex gap-4 py-2.5";
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
