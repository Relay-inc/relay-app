import { t } from "../../shared/i18n";
import { panelItem } from "../../domain/navigation/keys";
import type { PrDetail } from "../../domain/pull-requests/types";
import { reviewPrompt, reviewsOf, rowProject, secondOpinionPrompt } from "../../domain/pull-requests/rules";
import { briefingText } from "../../domain/calendar/rules";
import { ensureHistory } from "../conversations/history";
import { useConversationsStore } from "../conversations/store";
import { agent } from "../../shared/plugins";
import * as backend from "../../infrastructure/backend";
import { ghOn } from "../settings/settings";
import { project, projectLabel } from "../workspace/vault";
import { contextTint } from "../navigation/sidebar";
import { useNavigationStore } from "../navigation/store";
import { select } from "../navigation/navigation";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { projectOf } from "../conversations/selectors";
import { reviewAgent } from "../agents/agents";
import { usePullRequestsStore } from "./store";

const set = usePullRequestsStore.setState;

/** Once GitHub is switched on in the settings. Refreshed every 5 minutes and on opening the view. */
export async function loadPrs() {
  if (!ghOn() || usePullRequestsStore.getState().busy) return;
  set(draft => {
    draft.busy = true;
  });
  try {
    const list = await backend.githubPrs();
    set(draft => {
      draft.list = list;
      draft.at = Date.now();
      draft.err = "";
    });
  } catch (e) {
    set(draft => {
      draft.err = String(e);
    });
  }
  set(draft => {
    draft.busy = false;
  });
}
/** The GitHub repos per vault project, for the title bar's PRs button. */
export async function loadProjectRepos() {
  if (!ghOn()) return;
  const repos = await backend.projectRepos().catch(() => undefined);
  if (repos)
    set(draft => {
      draft.repos = repos;
    });
}
export const resetPrs = () =>
  set(draft => {
    draft.list = null;
    draft.at = 0;
    draft.err = "";
  });
/** "Laat Claude reviewen": a new app conversation under the PR's project, Claude reports here and posts nothing. */
export async function reviewPr(key: string) {
  const pr = useNavigationStore.getState().panel.detail[key] as PrDetail | undefined;
  const item = panelItem(key);
  if (!pr || item?.kind !== "pr") return;
  const repo = item.repo;
  // the conversation goes under the project of the PR's row in the lists, when the vault knows it
  const rowName = rowProject(usePullRequestsStore.getState().list, repo, pr.number);
  const chatKey = startChat(rowName && project(rowName) ? rowName : null, {
    provider: reviewAgent(),
    title: `Review ${repo.split("/")[1]} #${pr.number}`,
    note: t("note.reviewStarted", { repo, n: pr.number }),
    pr: pr.url,
  });
  await select(chatKey);
  sendMsg(reviewPrompt(pr, repo));
}
/** The last finished review of the PR in the detail: its conversation and its answer, "" while none is done. */
export function finishedReview(key: string) {
  const pr = useNavigationStore.getState().panel.detail[key] as PrDetail | undefined;
  if (!pr) return null;
  const { chats, messages, status } = useConversationsStore.getState();
  const done = reviewsOf(chats, pr.url).filter(chat => status[chat.key] !== "busy");
  const last = done[done.length - 1];
  return last ? { key: last.key, provider: last.provider || "claude", text: briefingText(messages[last.key]) } : null;
}
/** The PR detail's reviews: each conversation with its agent and whether it still runs, and the agent of the last
 *  finished one (what a second opinion answers), "" while none is done. Read it with `useDerived`. */
export function prReviews(key: string) {
  const pr = useNavigationStore.getState().panel.detail[key] as PrDetail | undefined;
  const { chats, status } = useConversationsStore.getState();
  const list = pr
    ? reviewsOf(chats, pr.url).map(chat => ({
        key: chat.key,
        title: chat.title,
        provider: chat.provider || "claude",
        busy: status[chat.key] === "busy",
      }))
    : [];
  return { list, answers: finishedReview(key)?.provider ?? "" };
}
/** A second agent answers the last finished review: a conversation of its own, listed with the PR's reviews. */
export async function secondOpinion(key: string) {
  const pr = useNavigationStore.getState().panel.detail[key] as PrDetail | undefined;
  const item = panelItem(key);
  const first = finishedReview(key);
  if (!pr || item?.kind !== "pr" || !first) return;
  await ensureHistory(first.key); // after a restart its messages are not read yet
  const review = briefingText(useConversationsStore.getState().messages[first.key]);
  if (!review) return;
  const repo = item.repo;
  const firstName = agent(first.provider)?.name ?? first.provider;
  const chatKey = startChat(useConversationsStore.getState().chats[first.key]?.project ?? null, {
    provider: reviewAgent(),
    title: `Second opinion ${repo.split("/")[1]} #${pr.number}`,
    note: t("note.secondOpinion", { repo, n: pr.number, agent: firstName }),
    pr: pr.url,
  });
  await select(chatKey);
  sendMsg(secondOpinionPrompt(pr, repo, firstName, review));
}
/** The label of the project a PR row belongs to, or "" when the vault does not know it. */
export function prProjectLabel(name: string): string {
  const known = project(name);
  return known ? projectLabel(known.name) : "";
}
/** The PR detail's header: its repo and, when the vault knows the project of its row in the lists, that project's
 *  label and context tint. Read it with `useDerived`. */
export function prHeading(key: string) {
  const item = panelItem(key);
  if (item?.kind !== "pr") return { repo: "", project: null };
  const known = project(rowProject(usePullRequestsStore.getState().list, item.repo, item.number));
  return {
    repo: item.repo,
    project: known ? { label: projectLabel(known.name), tint: contextTint(known.context) } : null,
  };
}

// ---------- a conversation that committed to a repo no project has asks to link it to its project
/** The backend's `repo-unlinked`: the ask waits per conversation until answered, and shows in a project conversation. */
export function askRepo(key: string, repo: string) {
  const { repos, asks } = usePullRequestsStore.getState();
  if (Object.values(repos).some(linked => linked.includes(repo)) || asks[key]?.includes(repo)) return;
  set(draft => {
    (draft.asks[key] ??= []).push(repo);
  });
}
/** The repo to ask about in this conversation, with the project it would join. Read it with `useDerived`. */
export function repoAskFor(key: string) {
  const project = projectOf(key);
  const repo = usePullRequestsStore.getState().asks[key]?.[0];
  return project && repo ? { project, repo } : null;
}
/** Link: the repo joins the project's. Not now: it is unlinked on purpose, no conversation asks again. */
export async function answerRepo(key: string, link: boolean) {
  const ask = repoAskFor(key);
  if (!ask) return;
  set(draft => {
    for (const k of Object.keys(draft.asks)) draft.asks[k] = draft.asks[k].filter(repo => repo !== ask.repo);
  });
  if (!link) return void backend.ignoreRepo(ask.repo);
  await backend.setProjectRepos(ask.project, [...(usePullRequestsStore.getState().repos[ask.project] ?? []), ask.repo]);
  loadPrs();
}
