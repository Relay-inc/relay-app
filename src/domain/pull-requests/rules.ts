import type { GhActor, GhCheck, PrDetail, PRs } from "./types";

// "Laat Claude reviewen": a new app conversation under the PR's project. Claude reads and reports here,
// posting on GitHub is something others see, so it waits for the user (decided 29/9)
export const reviewPrompt = (pr: PrDetail, repo: string) =>
  `Review PR ${pr.url} (${repo} #${pr.number}: ${pr.title}). Haal de diff en context op met gh, en lees de projectnote als die er is. ` +
  "Plaats niets op GitHub: geen review, comment of approve. Geef je bevindingen hier, meest ernstige eerst, met bestand en regel. " +
  "Wil ik iets posten, dan vraag ik het je daarna.";
/** The project of the PR's row in the lists, as gh's answer named it. */
export const rowProject = (list: PRs | null, repo: string, number: number) =>
  [...(list?.review || []), ...(list?.mine || [])].find(x => x.repo === repo && x.number === number)?.project ?? null;

// ---------- the PR detail, read from the raw GraphQL answer of github_pr
/** A check's state as a tone: "ok", "bad", "" (neutral, skipped); a state not listed is still running. */
export const CHECK: Record<string, "ok" | "bad" | ""> = {
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
export type Check = { name: string; state: string; url?: string };
/** A comment or a review in the PR's conversation; `state` only for a review. */
type TalkEntry = { at: string; who: string; state?: string; body?: string };

export const actorName = (actor: GhActor | undefined) => actor?.login || "ghost";
const isFailing = (check: Check) => CHECK[check.state] === "bad";
// failing checks first, then the rest by name
const compareChecks = (a: Check, b: Check) =>
  Number(isFailing(b)) - Number(isFailing(a)) || a.name.localeCompare(b.name);
export const checksOf = (contexts: GhCheck[]): Check[] =>
  contexts
    .map(check => ({
      name: check.name || check.context || "",
      state: check.conclusion || check.state || check.status || "",
      url: check.detailsUrl || check.targetUrl,
    }))
    .sort(compareChecks);
export const requestedReviewers = (pr: PrDetail) =>
  (pr.reviewRequests?.nodes || [])
    .map(request => request.requestedReviewer?.login || request.requestedReviewer?.name)
    .filter(Boolean);
/** The conversation: comments and reviews in time order. A review without text is only noted when it decided something. */
export const conversationOf = (pr: PrDetail): TalkEntry[] => {
  const comments = (pr.comments?.nodes || []).map(comment => ({
    at: comment.createdAt,
    who: actorName(comment.author),
    body: comment.body,
  }));
  const reviews = (pr.reviews?.nodes || [])
    .filter(review => review.body?.trim() || review.state !== "COMMENTED")
    .map(review => ({ at: review.createdAt, who: actorName(review.author), state: review.state, body: review.body }));
  return [...comments, ...reviews].sort((a, b) => a.at.localeCompare(b.at));
};
