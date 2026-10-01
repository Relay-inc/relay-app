import { LitElement, css, html, nothing } from "lit";
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

const who = (a: GhActor | undefined) => a?.login || "ghost";
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(currentLocale(), {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
};
const stamp = (iso: string) => html`<span class="ml-auto text-xs text-secondary tabular-nums">${when(iso)}</span>`;
const none = (text: unknown) => html`<div class="text-secondary mb-3">${text}</div>`;
const diff = (add: number, del: number) =>
  html`<span class="text-ok">+${add}</span> <span class="text-bad">−${del}</span>`;
const comment = (head: unknown, at: string, body?: string) =>
  html`<div class="py-2 border-b border-separator">
    <div class="flex items-center gap-2 text-sm mb-1">${head}${stamp(at)}</div>
    ${body?.trim() ? html`<div class="md-panel">${md(body)}</div>` : nothing}
  </div>`;

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

  override render() {
    const pr = this.pr,
      roll = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    // failing checks first, then the rest by name
    const checks = (roll?.contexts?.nodes || [])
      .map((c: GhCheck) => ({
        name: c.name || c.context || "",
        state: c.conclusion || c.state || c.status || "",
        url: c.detailsUrl || c.targetUrl,
      }))
      .sort(
        (a, b) => Number(CHECK[b.state] === "bad") - Number(CHECK[a.state] === "bad") || a.name.localeCompare(b.name),
      );
    const asked = (pr.reviewRequests?.nodes || [])
      .map(r => r.requestedReviewer?.login || r.requestedReviewer?.name)
      .filter(Boolean);
    // the conversation: comments and reviews in time order. A review without text is only noted when it decided something
    const talk = [
      ...(pr.comments?.nodes || []).map(c => ({
        at: c.createdAt,
        head: html`<b>${who(c.author)}</b>`,
        body: c.body,
      })),
      ...(pr.reviews?.nodes || [])
        .filter(r => r.body?.trim() || r.state !== "COMMENTED")
        .map(r => ({
          at: r.createdAt,
          head: html`<b>${who(r.author)}</b>
            <relay-pr-chip tone=${RSTATE[r.state]?.[0] ?? ""}
              >${RSTATE[r.state] ? th(RSTATE[r.state][1]) : r.state}</relay-pr-chip
            >`,
          body: r.body,
        })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const threads = pr.reviewThreads?.nodes || [],
      files = pr.files?.nodes || [];
    return html` <h2 class="text-sm font-semibold mb-2 leading-snug">
        ${pr.isDraft ? html`<span class="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5">${th("pr.draft")}</span>` : nothing}${pr.title}
      </h2>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums">
        <span>#${pr.number}</span><span>${who(pr.author)}</span><span>${when(pr.createdAt)}</span
        ><span><code>${pr.headRefName}</code> → <code>${pr.baseRefName}</code></span>
        <span>${diff(pr.additions, pr.deletions)} ${tn("pr.files", Number(pr.changedFiles) || 0)}</span>
      </div>
      <relay-pr-status wrap .ci=${roll?.state ?? null} .review=${pr.reviewDecision ?? null}
        >${pr.mergeable === "CONFLICTING" ? html`<relay-pr-chip tone="bad">${th("pr.conflict")}</relay-pr-chip>` : nothing}${asked.length ? html`<relay-pr-chip>${th("pr.asked", { who: asked.join(", ") })}</relay-pr-chip>` : nothing}</relay-pr-status
      >
      <relay-pr-section class="mt-4"
        ><span slot="heading">${th("pr.desc")}</span
        >${pr.body?.trim() ? html`<div class="md-panel">${md(pr.body)}</div>` : none(th("pr.noDesc"))}</relay-pr-section
      >
      ${
        checks.length
          ? html`<relay-pr-section class="mt-4" count=${checks.length}
              ><span slot="heading">${th("pr.checks")}</span>
              <ul class="list-none p-0 text-sm">
                ${checks.map(c => html`<li class="flex items-center gap-2 py-1"><span class="w-2 h-2 rounded-full flex-none ${DOT[CHECK[c.state] ?? "run"]}"></span>${c.url ? html`<a class="underline" href=${c.url}>${c.name}</a>` : c.name}<span class="ml-auto text-xs whitespace-nowrap text-secondary tabular-nums">${String(c.state || "").toLowerCase()}</span></li>`)}
              </ul></relay-pr-section
            >`
          : nothing
      }
      <relay-pr-section class="mt-4" count=${talk.length}
        ><span slot="heading">${th("pr.talk")}</span
        >${talk.length ? talk.map(c => comment(c.head, c.at, c.body)) : none(th("pr.noComments"))}</relay-pr-section
      >
      ${
        threads.length
          ? html`<relay-pr-section class="mt-4" count=${threads.length}
              ><span slot="heading">${th("pr.threads")}</span>${threads.map(
                (x: GhThread) =>
                  html`<div class="mb-2.5 ${x.isResolved ? "opacity-60" : ""}">
                    <div class="flex justify-between gap-2 text-xs">
                      <code class="font-mono wrap-anywhere">${x.path}${x.line ? `:${x.line}` : ""}</code
                      >${x.isResolved ? html`<span class="text-secondary tabular-nums">${th("pr.resolved")}</span>` : x.isOutdated ? html`<span class="text-secondary tabular-nums">${th("pr.outdated")}</span>` : nothing}
                    </div>
                    ${(x.comments?.nodes || []).map(c => comment(html`<b>${who(c.author)}</b>`, c.createdAt, c.body || ""))}
                  </div>`,
              )}</relay-pr-section
            >`
          : nothing
      }
      ${
        files.length
          ? html`<relay-pr-section class="mt-4" count=${pr.changedFiles}
              ><span slot="heading">${th("pr.filesH")}</span>
              <ul class="list-none p-0 text-sm">
                ${files.map(f => html`<li class="flex items-center gap-2 py-1"><code class="font-mono text-xs wrap-anywhere">${f.path}</code><span class="ml-auto text-xs whitespace-nowrap">${diff(f.additions, f.deletions)}</span></li>`)}
              </ul></relay-pr-section
            >`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-pr-body": PrBody;
  }
}
