import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { tw } from "../../core/styles";
import { emit } from "../../core/dom";
import { icon } from "../../core/icons";
import type { Key } from "../../core/locales/en";
import type { PR } from "../../domain/prs";
import { CI, CI_TEXT, prColor } from "./pr-state";

declare global {
  interface HTMLElementEventMap {
    "open-pr": CustomEvent<PR>;
  }
}

const MS_PER_DAY = 864e5;
export const age = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / MS_PER_DAY);
  return days < 1 ? th("due.today") : th("pr.days", { n: days });
};

const draftBadge = (cls: string) =>
  html`<span class="${cls} font-medium text-secondary border border-separator-strong">${th("pr.draft")}</span>`;
const REVIEW: Record<string, [string, Key]> = {
  CHANGES_REQUESTED: ["text-late", "rv.changes"],
  APPROVED: ["text-ok", "rv.approved"],
};

/** One PR row: in the Pull requests view (title, meta, CI and review status) and, compact, in the inspector's PR tab. */
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

  private renderStatus() {
    const { ci: ciState, review } = this.pr;
    const ci = ciState ? CI[ciState] : undefined;
    const rv = review ? REVIEW[review] : undefined;
    return html`<span class="flex flex-wrap gap-1.5 text-[11px] font-medium"
      >${
        ci
          ? html`<span class="inline-flex items-center gap-1.25 ${CI_TEXT[ci[0]]}"
              ><span class="size-1.5 rounded-full bg-current"></span>${th(ci[1])}</span
            >`
          : nothing
      }${rv ? html`<span class=${rv[0]}>· ${th(rv[1])}</span>` : nothing}</span
    >`;
  }

  private renderList() {
    const pr = this.pr;
    const byline = [this.mine ? "" : pr.author, age(pr.created)].filter(Boolean).join(" · ");
    return html`<div
      class="flex gap-2.5 p-2.5 rounded-[9px] cursor-pointer hover:bg-fill"
      @click=${() => emit(this, "open-pr", this.pr)}
    >
      <span class="mt-px size-4 flex-none ${prColor(pr)}">${icon("pr")}</span>
      <div class="min-w-0 flex-1 flex flex-col gap-1.25">
        <span class="text-[13px] font-medium leading-snug"
          >${pr.draft ? draftBadge("text-[11px] px-1.25 py-px rounded-sm mr-1.5") : nothing}${pr.title}</span
        >
        <span class="flex flex-wrap items-center gap-2 text-xs text-secondary tabular-nums"
          ><span class="font-mono text-[11px]">${pr.repo.split("/")[1] || pr.repo}#${pr.number}</span>${byline}</span
        >
        ${this.renderStatus()}
      </div>
    </div>`;
  }

  // the inspector's row: a state-coloured PR glyph, the title, then "#number repo, CI dot and label"
  private renderCompact() {
    const pr = this.pr;
    const ci = pr.ci ? CI[pr.ci] : undefined;
    return html`<div
      class="group flex gap-2.5 py-2.5 border-b border-separator cursor-default ${this.selected ? "bg-fill -mx-2.5 px-2.5 rounded-lg" : ""}"
      @click=${() => emit(this, "open-pr", this.pr)}
    >
      <span class="mt-px size-4 flex-none ${prColor(pr)}">${icon("pr")}</span>
      <div class="min-w-0 flex-1 flex flex-col gap-0.75">
        <span class="text-[13px] font-medium leading-snug line-clamp-2 group-hover:text-accent"
          >${pr.draft ? html`<span class="text-xs font-normal text-secondary mr-1.5">${th("pr.draft")}</span>` : nothing}${pr.title}</span
        >
        <span class="text-xs text-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5"
          ><span class="font-mono text-[11px]">#${pr.number}</span>${pr.repo.split("/")[1] || pr.repo}${
            ci
              ? html`<span class="inline-flex items-center gap-1 ${CI_TEXT[ci[0]]}"
                  ><span class="size-1.5 rounded-full bg-current"></span>${th(ci[1])}</span
                >`
              : nothing
          }</span
        >
      </div>
    </div>`;
  }

  override render() {
    return this.compact ? this.renderCompact() : this.renderList();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-row": PrRow;
  }
}
