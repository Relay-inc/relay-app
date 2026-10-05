import { provider } from "../../shared/plugins";
import type { TodayCard } from "../../domain/today/rules";
import type { PR } from "../../domain/pull-requests/types";
import * as backend from "../../infrastructure/backend";
import { ctxOf } from "../board/ctx";
import { useDetailsStore } from "./details";
import { loadTodayCards } from "./today";

// The detail of an item, fetched when it opens under Today: a PR's description, checks and conversation, a card's
// description, activity and statuses. Kept for the session; Refresh reads them again.
const set = useDetailsStore.setState;
const fail = (id: string, error: unknown) =>
  set(draft => {
    draft.err[id] = String(error);
  });

export async function loadPr(id: string, pr: PR, again = false) {
  if (useDetailsStore.getState().pr[id] && !again) return;
  try {
    const detail = await backend.githubPr(pr.repo, pr.number);
    set(draft => {
      draft.pr[id] = detail;
      delete draft.err[id];
    });
  } catch (error) {
    fail(id, error);
  }
}

export async function loadCard(id: string, item: TodayCard, again = false) {
  const tracker = provider(item.provider);
  if (!tracker?.detail || (useDetailsStore.getState().card[id] && !again)) return;
  try {
    const data = await tracker.detail.fetch(ctxOf(tracker), item.ref, item.card.id);
    set(draft => {
      draft.card[id] = tracker.detail!.view(data);
      delete draft.err[id];
    });
  } catch (error) {
    fail(id, error);
  }
}

/** An action on the card in its tracker (a comment, a status), then the card as it is now. Throws what it said. */
export async function cardAct(id: string, item: TodayCard, action: "comment" | "status", value: string) {
  const tracker = provider(item.provider);
  if (!tracker?.detail?.act) return;
  const data = await tracker.detail.act(ctxOf(tracker), item.ref, item.card.id, action, { value, files: [] });
  set(draft => {
    draft.card[id] = tracker.detail!.view(data);
  });
  if (action === "status") loadTodayCards();
}

/** Forget what was fetched, so the open item reads it again (Refresh). */
export const forgetDetails = () =>
  set(draft => {
    draft.pr = {};
    draft.card = {};
    draft.thread = {};
    draft.original = {};
  });
