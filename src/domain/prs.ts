import { invoke } from "@tauri-apps/api/core";
import { t } from "../core/i18n";
import { changed } from "../core/store";
import { ghOn } from "./config";
import { project } from "./vault";
import { chat, newChat } from "./chats/state";
import { panel } from "./panel";
import { select } from "./navigation";
import { sendMsg } from "./chats/actions";
import { prKey, panelItem } from "./keys";

// Pull requests from GitHub, fetched by the backend through gh: what isWaiting on the user's review and what
// he opened. Read-only: a row opens the PR in the right panel (description, checks, conversation), a link
// there opens it on GitHub. Anything others see (a review, a merge) does not happen from the app without approval (decided 29/9).
export type PR = {
  number: number;
  title: string;
  url: string;
  repo: string;
  draft: boolean;
  created: string;
  updated: string;
  author: string | null;
  review: string | null;
  ci: string | null;
  project: string | null;
};
export type PRs = { mine: PR[]; review: PR[] };
export { prKey };

/** A GitHub user as the GraphQL answer names them: null for a deleted account ("ghost"). */
export type GhActor = { login?: string; name?: string } | null;
type Nodes<T> = { nodes?: T[] } | null;
export type GhComment = { author: GhActor; createdAt: string; body?: string };
export type GhReview = GhComment & { state: string };
export type GhCheck = {
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  status?: string;
  detailsUrl?: string;
  targetUrl?: string;
};
export type GhThread = {
  path: string;
  line?: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments?: Nodes<GhComment>;
};
/** One PR as github_pr returns it: the raw GraphQL answer, as far as the panel reads it. */
export type PrDetail = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: GhActor;
  createdAt: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body?: string;
  mergeable?: string;
  reviewDecision?: string | null;
  commits?: Nodes<{ commit: { statusCheckRollup?: { state?: string; contexts?: Nodes<GhCheck> } | null } }>;
  reviewRequests?: Nodes<{ requestedReviewer?: GhActor }>;
  comments?: Nodes<GhComment>;
  reviews?: Nodes<GhReview>;
  reviewThreads?: Nodes<GhThread>;
  files?: Nodes<{ path: string; additions: number; deletions: number }>;
};

export const prs = { list: null as PRs | null, err: "", busy: false };

// once GitHub is switched on in the settings. Refreshed every 5 minutes and on opening the view
export async function loadPrs() {
  if (!ghOn() || prs.busy) return;
  prs.busy = true;
  changed();
  try {
    prs.list = await invoke<PRs>("github_prs");
    prs.err = "";
  } catch (e) {
    prs.err = String(e);
  }
  prs.busy = false;
  changed();
}
export const resetPrs = () => {
  prs.list = null;
  prs.err = "";
};
// "Laat Claude reviewen": a new app conversation under the PR's project. Claude reads and reports here,
// posting on GitHub is something others see, so it isWaiting for the user (decided 29/9)
const reviewPrompt = (pr: PrDetail, repo: string) =>
  `Review PR ${pr.url} (${repo} #${pr.number}: ${pr.title}). Haal de diff en context op met gh, en lees de projectnote als die er is. ` +
  "Plaats niets op GitHub: geen review, comment of approve. Geef je bevindingen hier, meest ernstige eerst, met bestand en regel. " +
  "Wil ik iets posten, dan vraag ik het je daarna.";
// the conversation goes under the project of the PR's row in the lists, when the vault knows it
const projectOfPr = (repo: string, number: number) => {
  const row = [...(prs.list?.review || []), ...(prs.list?.mine || [])].find(
    x => x.repo === repo && x.number === number,
  );
  return row?.project && project(row.project) ? row.project : null;
};
export async function reviewPr(key: string) {
  const pr = panel.detail[key] as PrDetail | undefined;
  const item = panelItem(key);
  if (!pr || item?.kind !== "pr") return;
  const repo = item.repo;
  const chatKey = newChat(projectOfPr(repo, pr.number));
  chat.chats[chatKey].title = `Review ${repo.split("/")[1]} #${pr.number}`;
  chat.messages[chatKey] = [{ kind: "note", text: t("note.reviewStarted", { repo, n: pr.number }) }]; // also keeps the typed title, no generated one
  await select(chatKey);
  sendMsg(reviewPrompt(pr, repo));
}
