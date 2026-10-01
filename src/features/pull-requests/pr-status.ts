import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { tw } from "../../core/styles";
import "./pr-chip";

const CI: Record<string, ["ok" | "bad" | "", Key]> = {
  SUCCESS: ["ok", "ci.ok"],
  FAILURE: ["bad", "ci.fail"],
  ERROR: ["bad", "ci.error"],
  PENDING: ["", "ci.pending"],
  EXPECTED: ["", "ci.expected"],
};
const REVIEW: Record<string, ["ok" | "bad" | "", Key]> = {
  APPROVED: ["ok", "rv.approved"],
  CHANGES_REQUESTED: ["bad", "rv.changes"],
};
const chip = (m: typeof CI, k: string | null) =>
  k && m[k] ? html`<relay-pr-chip tone=${m[k][0]}>${th(m[k][1])}</relay-pr-chip>` : nothing;

/** The CI and review chips of a PR, then whatever else is slotted in (the detail adds conflicts and requested reviewers). */
@customElement("relay-pr-status")
export class PrStatus extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() ci: string | null = null;
  @property() review: string | null = null;
  /** the detail lets the chips wrap and puts them under the title */
  @property({ type: Boolean }) wrap = false;
  render() {
    return html`<div class="flex gap-1.5 ${this.wrap ? "flex-wrap mt-2" : ""}">
      ${chip(CI, this.ci)}${chip(REVIEW, this.review)}<slot></slot>
    </div>`;
  }
}
