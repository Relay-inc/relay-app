import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th, tn, currentLocale } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { md } from "../../core/markdown";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import "./pr-chip";
import "./pr-status";
import "./pr-section";
import type { PrDetail, GhActor, GhCheck, GhThread } from "../../domain/prs";

// the raw GraphQL answer of github_pr
const CHECK: Record<string, string> = {
  SUCCESS: "ok",
  NEUTRAL: "",
  SKIPPED: "",
  FAILURE: "bad",
  ERROR: "bad",
  TIMED_OUT: "bad",
  CANCELLED: "bad",
  ACTION_REQUIRED: "bad",
  STARTUP_FAILURE: "bad",
};
const DOT: Record<string, string> = { ok: "bg-ok", bad: "bg-late", run: "bg-soon", "": "bg-separator" };
const RSTATE: Record<string, ["ok" | "bad" | "", Key]> = {
  APPROVED: ["ok", "rs.approved"],
  CHANGES_REQUESTED: ["bad", "rs.changes"],
  COMMENTED: ["", "rs.commented"],
  DISMISSED: ["", "rs.dismissed"],
};

type Check = { name: string; state: string; url?: string };
type TalkEntry = { at: string; head: TemplateResult; body?: string };

const actorName = (actor: GhActor | undefined) => actor?.login || "ghost";
const formatDate = (iso: string) => {
  const date = new Date(iso);
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString(currentLocale(), {
    day: "numeric",
    month: "short",
    ...(otherYear ? { year: "numeric" } : {}),
  });
};
const dateStamp = (iso: string) =>
  html`<span class="ml-auto text-xs text-secondary tabular-nums">${formatDate(iso)}</span>`;
const emptyNote = (text: unknown) => html`<div class="text-secondary mb-3">${text}</div>`;
const diffStat = (additions: number, deletions: number) =>
  html`<span class="text-ok">+${additions}</span> <span class="text-bad">−${deletions}</span>`;
const renderComment = (head: unknown, at: string, body?: string) =>
  html`<div class="py-2 border-b border-separator">
    <div class="flex items-center gap-2 text-sm mb-1">${head}${dateStamp(at)}</div>
    ${body?.trim() ? html`<div class="md-panel">${md(body)}</div>` : nothing}
  </div>`;

const isFailing = (check: Check) => CHECK[check.state] === "bad";
// failing checks first, then the rest by name
const compareChecks = (a: Check, b: Check) =>
  Number(isFailing(b)) - Number(isFailing(a)) || a.name.localeCompare(b.name);
const checksOf = (contexts: GhCheck[]): Check[] =>
  contexts
    .map(check => ({
      name: check.name || check.context || "",
      state: check.conclusion || check.state || check.status || "",
      url: check.detailsUrl || check.targetUrl,
    }))
    .sort(compareChecks);

const requestedReviewers = (pr: PrDetail) =>
  (pr.reviewRequests?.nodes || [])
    .map(request => request.requestedReviewer?.login || request.requestedReviewer?.name)
    .filter(Boolean);

const reviewChip = (state: string) => {
  const known = RSTATE[state];
  return html`<relay-pr-chip tone=${known?.[0] ?? ""}>${known ? th(known[1]) : state}</relay-pr-chip>`;
};
// the conversation: comments and reviews in time order. A review without text is only noted when it decided something
const conversationOf = (pr: PrDetail): TalkEntry[] => {
  const comments = (pr.comments?.nodes || []).map(comment => ({
    at: comment.createdAt,
    head: html`<b>${actorName(comment.author)}</b>`,
    body: comment.body,
  }));
  const reviews = (pr.reviews?.nodes || [])
    .filter(review => review.body?.trim() || review.state !== "COMMENTED")
    .map(review => ({
      at: review.createdAt,
      head: html`<b>${actorName(review.author)}</b> ${reviewChip(review.state)}`,
      body: review.body,
    }));
  return [...comments, ...reviews].sort((a, b) => a.at.localeCompare(b.at));
};

/** The content of one PR in the right panel, from the raw GraphQL answer: title, meta, chips, description, checks, conversation, threads, files. */
@customElement("relay-pr-body")
export class PrBody extends LitElement {
  static override styles = [
    tw,
    mdDefaults,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) pr!: PrDetail;

  private renderTitle() {
    const draft = this.pr.isDraft
      ? html`<span class="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5"
          >${th("pr.draft")}</span
        >`
      : nothing;
    return html`<h2 class="text-sm font-semibold mb-2 leading-snug">${draft}${this.pr.title}</h2>`;
  }
  private renderMeta() {
    const pr = this.pr;
    return html`<div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums">
      <span>#${pr.number}</span><span>${actorName(pr.author)}</span><span>${formatDate(pr.createdAt)}</span
      ><span><code>${pr.headRefName}</code> → <code>${pr.baseRefName}</code></span>
      <span>${diffStat(pr.additions, pr.deletions)} ${tn("pr.files", Number(pr.changedFiles) || 0)}</span>
    </div>`;
  }
  private renderStatus(rollup: { state?: string } | null | undefined) {
    const pr = this.pr;
    const asked = requestedReviewers(pr);
    const conflict =
      pr.mergeable === "CONFLICTING" ? html`<relay-pr-chip tone="bad">${th("pr.conflict")}</relay-pr-chip>` : nothing;
    const askedChip = asked.length
      ? html`<relay-pr-chip>${th("pr.asked", { who: asked.join(", ") })}</relay-pr-chip>`
      : nothing;
    return html`<relay-pr-status wrap .ci=${rollup?.state ?? null} .review=${pr.reviewDecision ?? null}
      >${conflict}${askedChip}</relay-pr-status
    >`;
  }
  private renderDescription() {
    const body = this.pr.body;
    return html`<relay-pr-section class="mt-4"
      ><span slot="heading">${th("pr.desc")}</span
      >${body?.trim() ? html`<div class="md-panel">${md(body)}</div>` : emptyNote(th("pr.noDesc"))}</relay-pr-section
    >`;
  }
  private renderChecks(checks: Check[]) {
    if (!checks.length) return nothing;
    return html`<relay-pr-section class="mt-4" count=${checks.length}
      ><span slot="heading">${th("pr.checks")}</span>
      <ul class="list-none p-0 text-sm">
        ${checks.map(check => this.renderCheck(check))}
      </ul></relay-pr-section
    >`;
  }
  private renderCheck(check: Check) {
    const dot = DOT[CHECK[check.state] ?? "run"];
    const name = check.url ? html`<a class="underline" href=${check.url}>${check.name}</a>` : check.name;
    return html`<li class="flex items-center gap-2 py-1">
      <span class="w-2 h-2 rounded-full flex-none ${dot}"></span>${name}<span
        class="ml-auto text-xs whitespace-nowrap text-secondary tabular-nums"
        >${String(check.state || "").toLowerCase()}</span
      >
    </li>`;
  }
  private renderConversation(talk: TalkEntry[]) {
    return html`<relay-pr-section class="mt-4" count=${talk.length}
      ><span slot="heading">${th("pr.talk")}</span
      >${talk.length ? talk.map(entry => renderComment(entry.head, entry.at, entry.body)) : emptyNote(th("pr.noComments"))}</relay-pr-section
    >`;
  }
  private renderThreads(threads: GhThread[]) {
    if (!threads.length) return nothing;
    return html`<relay-pr-section class="mt-4" count=${threads.length}
      ><span slot="heading">${th("pr.threads")}</span
      >${threads.map(thread => this.renderThread(thread))}</relay-pr-section
    >`;
  }
  private threadBadge(thread: GhThread) {
    if (thread.isResolved) return html`<span class="text-secondary tabular-nums">${th("pr.resolved")}</span>`;
    if (thread.isOutdated) return html`<span class="text-secondary tabular-nums">${th("pr.outdated")}</span>`;
    return nothing;
  }
  private renderThread(thread: GhThread) {
    const replies = (thread.comments?.nodes || []).map(reply =>
      renderComment(html`<b>${actorName(reply.author)}</b>`, reply.createdAt, reply.body || ""),
    );
    return html`<div class="mb-2.5 ${thread.isResolved ? "opacity-60" : ""}">
      <div class="flex justify-between gap-2 text-xs">
        <code class="font-mono wrap-anywhere">${thread.path}${thread.line ? `:${thread.line}` : ""}</code
        >${this.threadBadge(thread)}
      </div>
      ${replies}
    </div>`;
  }
  private renderFiles(files: NonNullable<PrDetail["files"]>["nodes"]) {
    if (!files?.length) return nothing;
    return html`<relay-pr-section class="mt-4" count=${this.pr.changedFiles}
      ><span slot="heading">${th("pr.filesH")}</span>
      <ul class="list-none p-0 text-sm">
        ${files.map(
          file =>
            html`<li class="flex items-center gap-2 py-1">
              <code class="font-mono text-xs wrap-anywhere">${file.path}</code
              ><span class="ml-auto text-xs whitespace-nowrap">${diffStat(file.additions, file.deletions)}</span>
            </li>`,
        )}
      </ul></relay-pr-section
    >`;
  }

  override render() {
    const pr = this.pr;
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    return html` ${this.renderTitle()}${this.renderMeta()}${this.renderStatus(rollup)}${this.renderDescription()}
    ${this.renderChecks(checksOf(rollup?.contexts?.nodes || []))}${this.renderConversation(conversationOf(pr))}
    ${this.renderThreads(pr.reviewThreads?.nodes || [])}${this.renderFiles(pr.files?.nodes)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-body": PrBody;
  }
}
