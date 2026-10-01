import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { t, th, tn, currentLocale } from "../../core/i18n";
import { icon } from "../../core/icons";
import type { Key } from "../../core/locales/en";
import { md } from "../../core/markdown";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { mdDefaults } from "../../components/md-defaults";
import { modalLink } from "../../components/relay-modal";
import { avatar } from "../board/format";
import { panel } from "../../domain/panel";
import { prs, reviewPr, type PrDetail, type GhActor, type GhCheck, type GhThread } from "../../domain/prs";
import { panelItem } from "../../domain/keys";
import { project, projectLabel } from "../../domain/vault";
import { contextTint } from "../../domain/sidebar";
import { age } from "./pr-row";
import { CI } from "./pr-state";

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
const CHECK_TEXT: Record<string, string> = {
  ok: "text-secondary",
  bad: "text-late",
  run: "text-soon",
  "": "text-secondary",
};
const RSTATE: Record<string, ["ok" | "bad" | "", Key]> = {
  APPROVED: ["ok", "rs.approved"],
  CHANGES_REQUESTED: ["bad", "rs.changes"],
  COMMENTED: ["", "rs.commented"],
  DISMISSED: ["", "rs.dismissed"],
};
// pale tones: green and red as in a diff, grey (orange text while running) for the rest
const TONE = {
  ok: "bg-add-bg text-add-fg",
  bad: "bg-del-bg text-del-fg",
  run: "bg-fill-2 text-soon",
  "": "bg-fill-2 text-secondary",
};
const FOLDER = { "ctx-a": "text-ctx-a", "ctx-m": "text-ctx-m", "ctx-p": "text-ctx-p" };

type Check = { name: string; state: string; url?: string };
type TalkEntry = { at: string; who: string; chip?: TemplateResult; body?: string };

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
const chip = (tone: keyof typeof TONE, text: unknown) =>
  html`<span class="inline-flex items-center h-5.5 px-2 rounded-md text-xs font-medium whitespace-nowrap ${TONE[tone]}"
    >${text}</span
  >`;
const diffStat = (additions: number, deletions: number) =>
  html`<span class="font-mono text-xs"
    ><span class="text-add-fg">+${additions}</span> <span class="text-del-fg">−${deletions}</span></span
  >`;
const draftBadge = () =>
  html`<span
    class="text-xs font-medium text-secondary px-1.5 py-0.5 rounded-sm border border-separator-strong mr-2 align-middle"
    >${th("pr.draft")}</span
  >`;

// failing checks first, then the rest by name
const compareChecks = (a: Check, b: Check) =>
  Number(CHECK[b.state] === "bad") - Number(CHECK[a.state] === "bad") || a.name.localeCompare(b.name);
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
  return chip(known?.[0] ?? "", known ? th(known[1]) : state);
};
// the conversation: comments and reviews in time order. A review without text is only noted when it decided something
const conversationOf = (pr: PrDetail): TalkEntry[] => {
  const comments = (pr.comments?.nodes || []).map(comment => ({
    at: comment.createdAt,
    who: actorName(comment.author),
    body: comment.body,
  }));
  const reviews = (pr.reviews?.nodes || [])
    .filter(review => review.body?.trim() || review.state !== "COMMENTED")
    .map(review => ({
      at: review.createdAt,
      who: actorName(review.author),
      chip: reviewChip(review.state),
      body: review.body,
    }));
  return [...comments, ...reviews].sort((a, b) => a.at.localeCompare(b.at));
};

const section = (title: unknown, count: number | string, body: unknown) =>
  html`<section class="flex flex-col gap-1">
    <h3 class="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
      ${title}${count !== "" ? html` <span class="font-medium tabular-nums">${count}</span>` : nothing}
    </h3>
    ${body}
  </section>`;
const box = (rows: unknown[]) => html`<div class="flex flex-col border border-separator rounded-[10px]">${rows}</div>`;
const entry = (who: string, at: string, body: string | undefined, extra?: TemplateResult) =>
  html`<div class="flex gap-3 py-2">
    ${avatar(who, "size-6 text-[9px]")}
    <div class="flex-1 min-w-0 flex flex-col gap-1">
      <div class="flex items-center gap-2 text-xs">
        <b class="font-semibold">${who}</b>${extra ?? nothing}<span class="ml-auto text-tertiary tabular-nums"
          >${formatDate(at)}</span
        >
      </div>
      ${body?.trim() ? html`<div class="md-panel text-sm leading-[1.55]">${md(body)}</div>` : nothing}
    </div>
  </div>`;

/** One PR in a window over the view, from the raw GraphQL answer of github_pr: title, meta, chips, description, checks,
 * conversation, comments in the code and files, with what to do about it in the sidebar. Opened from the list and the inspector. */
@customElement("relay-pr-detail")
export class PrDetailView extends LitElement {
  static override styles = [
    tw,
    mdDefaults,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);

  // repo · project on the left, GitHub and the AI review on the right
  private renderHeader(key: string, pr: PrDetail) {
    const item = panelItem(key);
    const row = [...(prs.list?.review || []), ...(prs.list?.mine || [])].find(
      x => item?.kind === "pr" && x.repo === item.repo && x.number === item.number,
    );
    const known = project(row?.project ?? null);
    return html`<div class="flex items-center gap-2 text-xs text-secondary">
      <span class="font-mono">${item?.kind === "pr" ? item.repo : ""}</span>${
        known
          ? html`<span>·</span
              ><span class="inline-flex items-center gap-1"
                >${icon("folder", `glyph size-3 ${FOLDER[contextTint(known.context)]}`)}${projectLabel(known.name)}</span
              >`
          : nothing
      } <span class="flex-1"></span>${modalLink(pr.url, t("pr.openGh"))}
      <button
        class="btn btn-primary cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 text-xs"
        title=${t("pr.reviewTitle")}
        @click=${() => reviewPr(key)}
      >
        ${icon("chat", "glyph size-3.5")}${th("pr.review")}
      </button>
    </div>`;
  }

  private renderMeta(pr: PrDetail) {
    const code = (text: string) =>
      html`<code class="font-mono text-xs bg-fill-2 text-label px-1.5 py-px rounded-sm">${text}</code>`;
    return html`<div class="flex flex-wrap items-center gap-2.5 text-[13px] text-secondary tabular-nums">
      <span class="font-mono text-xs text-label">#${pr.number}</span><span>${actorName(pr.author)}</span
      ><span>${age(pr.createdAt)}</span
      ><span class="inline-flex items-center gap-1">${code(pr.headRefName)}→${code(pr.baseRefName)}</span
      >${diffStat(pr.additions, pr.deletions)}<span>${tn("pr.files", Number(pr.changedFiles) || 0)}</span>
    </div>`;
  }
  private renderChips(pr: PrDetail, rollup: { state?: string } | null | undefined) {
    const ci = rollup?.state ? CI[rollup.state] : undefined;
    const asked = requestedReviewers(pr);
    return html`<div class="flex flex-wrap gap-1.5">
      ${ci ? chip(ci[0], th(ci[1])) : nothing}
      ${pr.reviewDecision === "CHANGES_REQUESTED" ? chip("bad", th("rv.changes")) : nothing}
      ${pr.reviewDecision === "APPROVED" ? chip("ok", th("rv.approved")) : nothing}
      ${pr.mergeable === "CONFLICTING" ? chip("bad", th("pr.conflict")) : nothing}
      ${asked.length ? chip("", th("pr.asked", { who: asked.join(", ") })) : nothing}
    </div>`;
  }
  private renderDescription(pr: PrDetail) {
    return section(
      th("pr.desc"),
      "",
      pr.body?.trim()
        ? html`<div class="md-panel text-sm leading-[1.65]">${md(pr.body)}</div>`
        : html`<div class="text-[13px] text-secondary">${th("pr.noDesc")}</div>`,
    );
  }
  private renderChecks(checks: Check[]) {
    if (!checks.length) return nothing;
    return section(
      th("pr.checks"),
      checks.length,
      box(
        checks.map(check => {
          const tone = CHECK[check.state] ?? "run";
          const name = check.url ? html`<a class="underline" href=${check.url}>${check.name}</a>` : check.name;
          return html`<div class="flex items-center gap-2.5 h-9 px-3 border-t border-separator first:border-t-0">
            <span class="size-2 rounded-full flex-none ${DOT[tone]}"></span
            ><span class="flex-1 min-w-0 truncate font-mono text-xs">${name}</span
            ><span class="text-xs ${CHECK_TEXT[tone]}">${String(check.state || "").toLowerCase()}</span>
          </div>`;
        }),
      ),
    );
  }
  private renderConversation(talk: TalkEntry[]) {
    return section(
      th("pr.talk"),
      talk.length,
      talk.length
        ? talk.map(e => entry(e.who, e.at, e.body, e.chip))
        : html`<div class="text-[13px] text-secondary">${th("pr.noComments")}</div>`,
    );
  }
  private renderThreads(threads: GhThread[]) {
    if (!threads.length) return nothing;
    return section(
      th("pr.threads"),
      threads.length,
      threads.map(thread => {
        const badge = thread.isResolved ? th("pr.resolved") : thread.isOutdated ? th("pr.outdated") : "";
        return html`<div class="mb-2.5 ${thread.isResolved ? "opacity-60" : ""}">
          <div class="flex justify-between gap-2 text-xs">
            <code class="font-mono wrap-anywhere">${thread.path}${thread.line ? `:${thread.line}` : ""}</code
            ><span class="text-secondary">${badge}</span>
          </div>
          ${(thread.comments?.nodes || []).map(reply => entry(actorName(reply.author), reply.createdAt, reply.body))}
        </div>`;
      }),
    );
  }
  private renderFiles(pr: PrDetail) {
    const files = pr.files?.nodes;
    if (!files?.length) return nothing;
    return section(
      th("pr.filesH"),
      pr.changedFiles,
      box(
        files.map(
          file =>
            html`<div class="flex items-center gap-2.5 h-9 px-3 border-t border-separator first:border-t-0">
              ${icon("file", "glyph size-3.5 flex-none text-tertiary")}<span
                class="flex-1 min-w-0 truncate font-mono text-xs"
                >${file.path}</span
              >${diffStat(file.additions, file.deletions)}
            </div>`,
        ),
      ),
    );
  }

  private renderBody(key: string, pr: PrDetail | null) {
    if (panel.err && !pr) return html`<div class="err-box">${panel.err}</div>`;
    if (!pr) return html`<div class="text-secondary">${th("pr.loading")}</div>`;
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    return html`<div class="flex flex-col gap-2.5">
        ${this.renderHeader(key, pr)}
        <h2 class="m-0 text-xl leading-snug font-semibold tracking-tight text-pretty">
          ${pr.isDraft ? draftBadge() : nothing}${pr.title}
        </h2>
        ${this.renderMeta(pr)}${this.renderChips(pr, rollup)}
      </div>
      ${this.renderDescription(pr)}${this.renderChecks(checksOf(rollup?.contexts?.nodes || []))}${this.renderConversation(conversationOf(pr))}
      ${this.renderThreads(pr.reviewThreads?.nodes || [])}${this.renderFiles(pr)}`;
  }

  override render() {
    const key = panel.prOpen;
    if (!key) return nothing;
    const pr = (panel.detail[key] as PrDetail | undefined) ?? null;
    return html`<div class="max-w-180 px-8 pt-5.5 pb-10 flex flex-col gap-6 select-text cursor-auto">
      ${this.renderBody(key, pr)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-detail": PrDetailView;
  }
}
