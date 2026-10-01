// Pull requests from GitHub, fetched by the backend through gh: what waits on the user's review and what
// he opened. Read-only: a row opens the PR in the right panel (description, checks, conversation), a link
// there opens it on GitHub. Anything others see (a review, a merge) does not happen from the app without approval (decided 29/9).
// The types and the pieces shared by the list (src/ui/prs.ts), the project tab (src/ui/inspector.ts) and the detail (src/ui/pr-detail.ts).
import { html, nothing } from "lit";
import { th } from "./i18n";
import type { Key } from "./locales/en";
import { S, pLabel } from "./app/state";
import { openPr } from "./app/actions";

export type PR = { number: number; title: string; url: string; repo: string; draft: boolean; created: string; updated: string;
  author: string | null; review: string | null; ci: string | null; project: string | null };
export type PRs = { mine: PR[]; review: PR[] };
export const prKey = (repo: string, number: number | string) => `${repo}#${number}`;

const age = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return d < 1 ? th("due.today") : th("pr.days", { n: d }); };
const CI: Record<string, [string, Key]> = { SUCCESS: ["ok", "ci.ok"], FAILURE: ["bad", "ci.fail"], ERROR: ["bad", "ci.error"],
  PENDING: ["run", "ci.pending"], EXPECTED: ["run", "ci.expected"] };
const REVIEW: Record<string, [string, Key]> = { APPROVED: ["ok", "rv.approved"], CHANGES_REQUESTED: ["bad", "rv.changes"] };
const chip = (m: Record<string, [string, Key]>, k: string | null) => k && m[k] ? html`<span class="pr-chip ${m[k][0]}">${th(m[k][1])}</span>` : nothing;
/** The CI and review chips of a PR. */
export const ciChip = (k: string | null) => chip(CI, k);
export const reviewChip = (k: string | null) => chip(REVIEW, k);

/** One PR row, in the list and in a project's PR tab. */
export function prRow(p: PR, mine: boolean) {
  const key = prKey(p.repo, p.number);
  return html`<div class=${"pr-row" + (S.prOpen === key ? " sel" : "")} @click=${() => openPr(key)}>
    <div class="pr-main"><div class="pr-t">${p.draft ? html`<span class="pr-draft">${th("pr.draft")}</span>` : nothing}${p.title}</div>
      <div class="pr-meta"><span>${p.repo.split("/")[1] || p.repo} #${p.number}</span>${p.project ? html`<span>${pLabel(p.project)}</span>` : nothing}${mine ? nothing : html`<span>${p.author || ""}</span>`}<span>${age(p.created)}</span></div></div>
    <div class="pr-st">${ciChip(p.ci)}${reviewChip(p.review)}</div></div>`;
}
