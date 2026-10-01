import { html, nothing } from "lit";
import { t, th, tn, currentLocale } from "../i18n";
import type { Key } from "../locales/en";
import { RelayElement, styles } from "../lib/store";
import { md } from "../lib/md";
import { S } from "../app/state";
import { closePr, reviewPr } from "../app/actions";
import { ciChip, reviewChip } from "../github";
import css from "./pr-detail.css?inline";

// one PR in the right panel, from the raw GraphQL answer of github_pr
const CHECK: Record<string, string> = { SUCCESS: "ok", NEUTRAL: "", SKIPPED: "", FAILURE: "bad", ERROR: "bad", TIMED_OUT: "bad", CANCELLED: "bad", ACTION_REQUIRED: "bad", STARTUP_FAILURE: "bad" };
const RSTATE: Record<string, [string, Key]> = { APPROVED: ["ok", "rs.approved"], CHANGES_REQUESTED: ["bad", "rs.changes"], COMMENTED: ["", "rs.commented"], DISMISSED: ["", "rs.dismissed"] };

const who = (a: any) => a?.login || "ghost";
const when = (iso: string) => { const d = new Date(iso);
  return d.toLocaleDateString(currentLocale(), { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); };
const sec = (title: unknown, n: number | string, body: unknown) => html`<section class="prd-sec"><h3>${title}${n !== "" ? html` <span class="count">${n}</span>` : nothing}</h3>${body}</section>`;

export class RelayPrDetail extends RelayElement {
  static styles = styles(css);
  render() {
    const pr = S.prDetail[S.prOpen] ?? null, err = S.prDetailErr;
    const bar = html`<div class="prd-bar"><button class="btn" title=${t("pr.close")} @click=${closePr}>×</button>
      ${pr ? html`<span class="sp"></span><button class="btn primary" title=${t("pr.reviewTitle")} @click=${() => reviewPr(S.prOpen)}>${th("pr.review")}</button><a class="btn" href=${pr.url}>${th("pr.openGh")}</a>` : nothing}</div>`;
    if (err) return html`${bar}<div class="err">${err}</div>`;
    if (!pr) return html`${bar}<div class="meta">${th("pr.loading")}</div>`;
    const roll = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    // failing checks first, then the rest by name
    const checks = (roll?.contexts?.nodes || []).map((c: any) => ({ name: c.name || c.context, state: c.conclusion || c.state || c.status, url: c.detailsUrl || c.targetUrl }))
      .sort((a: any, b: any) => Number(CHECK[b.state] === "bad") - Number(CHECK[a.state] === "bad") || String(a.name).localeCompare(b.name));
    const asked = (pr.reviewRequests?.nodes || []).map((r: any) => r.requestedReviewer?.login || r.requestedReviewer?.name).filter(Boolean);
    // the conversation: comments and reviews in time order. A review without text is only noted when it decided something
    const talk = [...(pr.comments?.nodes || []).map((c: any) => ({ at: c.createdAt, head: html`<b>${who(c.author)}</b>`, body: c.body })),
      ...(pr.reviews?.nodes || []).filter((r: any) => r.body?.trim() || r.state !== "COMMENTED").map((r: any) => ({ at: r.createdAt,
        head: html`<b>${who(r.author)}</b> <span class="pr-chip ${RSTATE[r.state]?.[0] ?? ""}">${RSTATE[r.state] ? th(RSTATE[r.state][1]) : r.state}</span>`, body: r.body }))]
      .sort((a, b) => a.at.localeCompare(b.at));
    const threads = pr.reviewThreads?.nodes || [], files = pr.files?.nodes || [];
    return html`${bar}<div class="prd">
      <h2 class="prd-t">${pr.isDraft ? html`<span class="pr-draft">${th("pr.draft")}</span>` : nothing}${pr.title}</h2>
      <div class="pr-meta"><span>#${pr.number}</span><span>${who(pr.author)}</span><span>${when(pr.createdAt)}</span><span><code>${pr.headRefName}</code> → <code>${pr.baseRefName}</code></span>
        <span><span class="pr-add">+${pr.additions}</span> <span class="pr-del">−${pr.deletions}</span> ${tn("pr.files", Number(pr.changedFiles) || 0)}</span></div>
      <div class="pr-st">${ciChip(roll?.state ?? null)}${reviewChip(pr.reviewDecision)}${pr.mergeable === "CONFLICTING" ? html`<span class="pr-chip bad">${th("pr.conflict")}</span>` : nothing}${asked.length ? html`<span class="pr-chip">${th("pr.asked", { who: asked.join(", ") })}</span>` : nothing}</div>
      ${sec(th("pr.desc"), "", pr.body?.trim() ? html`<div class="prd-md">${md(pr.body)}</div>` : html`<div class="meta">${th("pr.noDesc")}</div>`)}
      ${checks.length ? sec(th("pr.checks"), checks.length, html`<ul class="prd-checks">${checks.map((c: any) => html`<li><span class="sdot ${CHECK[c.state] ?? "run"}"></span>${c.url ? html`<a href=${c.url}>${c.name}</a>` : c.name}<span class="count">${String(c.state || "").toLowerCase()}</span></li>`)}</ul>`) : nothing}
      ${sec(th("pr.talk"), talk.length, talk.length ? talk.map(c => html`<div class="prd-c"><div class="prd-ch">${c.head}<span class="count">${when(c.at)}</span></div>${c.body?.trim() ? html`<div class="prd-md">${md(c.body)}</div>` : nothing}</div>`) : html`<div class="meta">${th("pr.noComments")}</div>`)}
      ${threads.length ? sec(th("pr.threads"), threads.length, threads.map((x: any) => html`<div class=${"prd-th" + (x.isResolved ? " done" : "")}><div class="prd-path"><code>${x.path}${x.line ? `:${x.line}` : ""}</code>${x.isResolved ? html`<span class="count">${th("pr.resolved")}</span>` : x.isOutdated ? html`<span class="count">${th("pr.outdated")}</span>` : nothing}</div>
        ${(x.comments?.nodes || []).map((c: any) => html`<div class="prd-c"><div class="prd-ch"><b>${who(c.author)}</b><span class="count">${when(c.createdAt)}</span></div><div class="prd-md">${md(c.body || "")}</div></div>`)}</div>`)) : nothing}
      ${files.length ? sec(th("pr.filesH"), pr.changedFiles, html`<ul class="prd-files">${files.map((f: any) => html`<li><code>${f.path}</code><span><span class="pr-add">+${f.additions}</span> <span class="pr-del">−${f.deletions}</span></span></li>`)}</ul>`) : nothing}
    </div>`;
  }
}
customElements.define("relay-pr-detail", RelayPrDetail);
