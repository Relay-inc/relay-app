import { t } from "../../shared/i18n";
import { panelItem } from "../../domain/navigation/keys";
import type { PrDetail } from "../../domain/pull-requests/types";
import { reviewPrompt, rowProject } from "../../domain/pull-requests/rules";
import * as backend from "../../infrastructure/backend";
import { ghOn } from "../settings/settings";
import { project } from "../workspace/vault";
import { useNavigationStore } from "../navigation/store";
import { select } from "../navigation/navigation";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
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
export const resetPrs = () =>
  set(draft => {
    draft.list = null;
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
    title: `Review ${repo.split("/")[1]} #${pr.number}`,
    note: t("note.reviewStarted", { repo, n: pr.number }),
  });
  await select(chatKey);
  sendMsg(reviewPrompt(pr, repo));
}
