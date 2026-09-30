// Pull requests from GitHub, fetched by the backend through gh: what waits on the user's review and what
// he opened. Read-only: a row opens the PR in the right panel (description, checks, conversation), a link
// there opens it on GitHub. Anything others see (a review, a merge) does not happen from the app without approval (decided 29/9).
export type PR = { number: number; title: string; url: string; repo: string; draft: boolean; created: string; updated: string;
  author: string | null; review: string | null; ci: string | null; project: string | null };
export type PRs = { mine: PR[]; review: PR[] };
type H = { esc: (s: unknown) => string; projectLabel: (p: string | null) => string; open: string };
export const prKey = (repo: string, number: number | string) => `${repo}#${number}`;

const age = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return d < 1 ? "vandaag" : `${d} d`; };
const CI: Record<string, [string, string]> = { SUCCESS: ["ok", "Checks groen"], FAILURE: ["bad", "Checks rood"], ERROR: ["bad", "Checks in fout"],
  PENDING: ["run", "Checks lopen"], EXPECTED: ["run", "Checks verwacht"] };
const REVIEW: Record<string, [string, string]> = { APPROVED: ["ok", "Goedgekeurd"], CHANGES_REQUESTED: ["bad", "Wijzigingen gevraagd"] };
const chip = (m: Record<string, [string, string]>, k: string | null) => k && m[k] ? `<span class="pr-chip ${m[k][0]}">${m[k][1]}</span>` : "";

function row(p: PR, h: H, mine: boolean) {
  const e = h.esc;
  return `<div class="pr-row${h.open === prKey(p.repo, p.number) ? " sel" : ""}" data-pr-open="${e(prKey(p.repo, p.number))}">
    <div class="pr-main"><div class="pr-t">${p.draft ? '<span class="pr-draft">Concept</span>' : ""}${e(p.title)}</div>
      <div class="pr-meta"><span>${e(p.repo.split("/")[1] || p.repo)} #${e(p.number)}</span>${p.project ? `<span>${e(h.projectLabel(p.project))}</span>` : ""}${mine ? "" : `<span>${e(p.author || "")}</span>`}<span>${age(p.created)}</span></div></div>
    <div class="pr-st">${chip(CI, p.ci)}${chip(REVIEW, p.review)}</div></div>`;
}
const group = (name: string, list: PR[], h: H, mine: boolean) =>
  `<section class="rem-grp"><h2 class="rem-h">${name} <span class="rem-n">${list.length}</span></h2>${list.length ? list.map(p => row(p, h, mine)).join("") : '<div class="pr-none">Niets open.</div>'}</section>`;

/** The Pull requests view: both lists, with a reload button. */
export function renderPrs(prs: PRs | null, err: string, busy: boolean, h: H): string {
  return `<div class="kbhead"><span class="sp"></span>${busy ? '<span class="spin"></span>' : ""}<button class="btn" data-pr="reload">Vernieuwen</button></div>`
    + (err ? `<div class="err">${h.esc(err)}</div>` : "")
    + (prs ? group("Wacht op jouw review", prs.review, h, false) + group("Van jou", prs.mine, h, true) : busy ? "" : '<div class="note">Nog niet geladen.</div>');
}

/** The open PRs of one project, for the right panel. */
export function renderProjectPrs(prs: PRs | null, project: string, h: H): string {
  if (!prs) return '<div class="meta">Laden…</div>';
  const review = prs.review.filter(p => p.project === project), mine = prs.mine.filter(p => p.project === project);
  return `<h2>Pull requests <span class="count">${review.length + mine.length}</span></h2>`
    + (review.length + mine.length ? `<div class="pr-side">${review.map(p => row(p, h, false)).join("")}${mine.map(p => row(p, h, true)).join("")}</div>`
      : '<div class="meta">Geen open PR\'s voor dit project.</div>');
}

// ---------- one PR in the right panel, from the raw GraphQL answer of github_pr
type D = { esc: (s: unknown) => string; md: (s: string) => string };
const CHECK: Record<string, string> = { SUCCESS: "ok", NEUTRAL: "", SKIPPED: "", FAILURE: "bad", ERROR: "bad", TIMED_OUT: "bad", CANCELLED: "bad", ACTION_REQUIRED: "bad", STARTUP_FAILURE: "bad" };
const RSTATE: Record<string, [string, string]> = { APPROVED: ["ok", "keurde goed"], CHANGES_REQUESTED: ["bad", "vroeg wijzigingen"], COMMENTED: ["", "reviewde"], DISMISSED: ["", "review ingetrokken"] };

export function renderPrDetail(pr: any | null, err: string, h: D): string {
  const e = h.esc, bar = `<div class="prd-bar"><button class="btn" data-pr-close title="Sluiten (Esc)">×</button>`
    + (pr ? `<span class="sp"></span><button class="btn primary" data-pr-review title="Start een gesprek waarin Claude deze PR reviewt">Laat Claude reviewen</button><a class="btn" href="${e(pr.url)}">Openen op GitHub</a>` : "") + `</div>`;
  if (err) return bar + `<div class="err">${e(err)}</div>`;
  if (!pr) return bar + '<div class="meta">Laden…</div>';
  const who = (a: any) => e(a?.login || "ghost");
  const when = (iso: string) => { const d = new Date(iso);
    return d.toLocaleDateString("nl-BE", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); };
  const roll = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  // failing checks first, then the rest by name
  const checks = (roll?.contexts?.nodes || []).map((c: any) => ({ name: c.name || c.context, state: c.conclusion || c.state || c.status, url: c.detailsUrl || c.targetUrl }))
    .sort((a: any, b: any) => Number(CHECK[b.state] === "bad") - Number(CHECK[a.state] === "bad") || String(a.name).localeCompare(b.name));
  const asked = (pr.reviewRequests?.nodes || []).map((r: any) => r.requestedReviewer?.login || r.requestedReviewer?.name).filter(Boolean);
  // the conversation: comments and reviews in time order. A review without text is only noted when it decided something
  const talk = [...(pr.comments?.nodes || []).map((c: any) => ({ at: c.createdAt, head: `<b>${who(c.author)}</b>`, body: c.body })),
    ...(pr.reviews?.nodes || []).filter((r: any) => r.body?.trim() || r.state !== "COMMENTED").map((r: any) => ({ at: r.createdAt,
      head: `<b>${who(r.author)}</b> <span class="pr-chip ${RSTATE[r.state]?.[0] ?? ""}">${RSTATE[r.state]?.[1] ?? e(r.state)}</span>`, body: r.body }))]
    .sort((a, b) => a.at.localeCompare(b.at));
  const threads = pr.reviewThreads?.nodes || [], files = pr.files?.nodes || [];
  const sec = (t: string, n: number | string, body: string) => `<section class="prd-sec"><h3>${t}${n !== "" ? ` <span class="count">${n}</span>` : ""}</h3>${body}</section>`;
  return bar + `<div class="prd">
    <h2 class="prd-t">${pr.isDraft ? '<span class="pr-draft">Concept</span>' : ""}${e(pr.title)}</h2>
    <div class="pr-meta"><span>#${e(pr.number)}</span><span>${who(pr.author)}</span><span>${when(pr.createdAt)}</span><span><code>${e(pr.headRefName)}</code> → <code>${e(pr.baseRefName)}</code></span>
      <span><span class="pr-add">+${e(pr.additions)}</span> <span class="pr-del">−${e(pr.deletions)}</span> in ${e(pr.changedFiles)} ${pr.changedFiles === 1 ? "bestand" : "bestanden"}</span></div>
    <div class="pr-st">${chip(CI, roll?.state ?? null)}${chip(REVIEW, pr.reviewDecision)}${pr.mergeable === "CONFLICTING" ? '<span class="pr-chip bad">Conflict</span>' : ""}${asked.length ? `<span class="pr-chip">Gevraagd: ${asked.map(e).join(", ")}</span>` : ""}</div>`
    + sec("Beschrijving", "", pr.body?.trim() ? `<div class="prd-md">${h.md(pr.body)}</div>` : '<div class="meta">Geen beschrijving.</div>')
    + (checks.length ? sec("Checks", checks.length, `<ul class="prd-checks">${checks.map((c: any) => `<li><span class="sdot ${CHECK[c.state] ?? "run"}"></span>${c.url ? `<a href="${e(c.url)}">${e(c.name)}</a>` : e(c.name)}<span class="count">${e(String(c.state || "").toLowerCase())}</span></li>`).join("")}</ul>`) : "")
    + sec("Gesprek", talk.length, talk.length ? talk.map(t => `<div class="prd-c"><div class="prd-ch">${t.head}<span class="count">${when(t.at)}</span></div>${t.body?.trim() ? `<div class="prd-md">${h.md(t.body)}</div>` : ""}</div>`).join("") : '<div class="meta">Nog geen commentaar.</div>')
    + (threads.length ? sec("Opmerkingen in de code", threads.length, threads.map((t: any) => `<div class="prd-th${t.isResolved ? " done" : ""}"><div class="prd-path"><code>${e(t.path)}${t.line ? `:${e(t.line)}` : ""}</code>${t.isResolved ? '<span class="count">opgelost</span>' : t.isOutdated ? '<span class="count">verouderd</span>' : ""}</div>`
      + (t.comments?.nodes || []).map((c: any) => `<div class="prd-c"><div class="prd-ch"><b>${who(c.author)}</b><span class="count">${when(c.createdAt)}</span></div><div class="prd-md">${h.md(c.body || "")}</div></div>`).join("") + `</div>`).join("")) : "")
    + (files.length ? sec("Bestanden", pr.changedFiles, `<ul class="prd-files">${files.map((f: any) => `<li><code>${e(f.path)}</code><span><span class="pr-add">+${e(f.additions)}</span> <span class="pr-del">−${e(f.deletions)}</span></span></li>`).join("")}</ul>`) : "")
    + `</div>`;
}
