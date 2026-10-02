import { provider } from "../../shared/plugins";
import type { BoardProvider, BoardRef } from "../../domain/board/types";
import { panelItem, cardKey, type PanelItem } from "../../domain/navigation/keys";
import type { PanelTab } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { ctxOf } from "../board/ctx";
import { clearMailLink } from "../mail/mail";
import { useNavigationStore } from "./store";

// The right panel's detail: a PR, a mail, a vault note or a tracker card, shown from what is known at once, then fresh.
const nav = () => useNavigationStore.getState();
const set = useNavigationStore.setState;

/** The provider and card id of a card key, when that provider shows its cards in the panel. */
export const cardOf = (key: string) => {
  const item = panelItem(key);
  const cardProvider = item?.kind === "card" ? provider(item.provider) : undefined;
  return item?.kind === "card" && cardProvider?.detail
    ? { provider: cardProvider, detail: cardProvider.detail, id: item.id }
    : undefined;
};
/** A card opens in the right panel when its provider has one, else in the browser. */
export async function openCard(boardProvider: BoardProvider, ref: BoardRef, id: string) {
  const key = cardKey(boardProvider.id, id);
  if (boardProvider.detail) {
    set(draft => {
      draft.panel.cardRefs[key] = ref;
    });
    return openDetail(key);
  }
  try {
    backend.openUrl(await boardProvider.url(ctxOf(boardProvider), ref, id));
  } catch (e) {
    console.error(e);
  }
}

function fetchDetail(key: string, item: PanelItem): Promise<unknown> {
  switch (item.kind) {
    case "card": {
      const card = cardOf(key)!;
      return card.detail.fetch(ctxOf(card.provider), nav().panel.cardRefs[key], card.id);
    }
    case "mail":
      return backend.mailRead(item.account, item.id);
    case "note":
      return backend.readNote(item.target);
    case "pr":
      return backend.githubPr(item.repo, item.number);
  }
}
/** Show a PR, mail, note or card in the right panel: what is known at once, then fresh from the backend. */
export async function openDetail(key: string) {
  const item = panelItem(key);
  if (!item) return;
  const card = cardOf(key);
  clearMailLink();
  set(draft => {
    draft.panel.open = key;
    draft.panel.err = "";
    draft.panel.actErr = "";
    if (card) draft.panel.detail[key] ??= card.detail.cached(card.id);
    draft.panelHidden = false;
  });
  storage.set("noinsp", false);
  try {
    const detail = await fetchDetail(key, item);
    set(draft => {
      draft.panel.detail[key] = detail;
    });
  } catch (e) {
    set(draft => {
      // a mail that cannot be read is not shown from an older answer
      if (item.kind === "mail") delete draft.panel.detail[key];
      // the error of a load the user already left does not show on the detail open now
      if (!draft.panel.detail[key] && draft.panel.open === key) draft.panel.err = String(e);
    });
  }
}
/** An action from a card's panel (comment, status, assignee, attach): the provider does it in the tracker and answers
 *  with the card as it is now. Resolves true when it worked (the UI then empties the comment box); on a failure what
 *  was typed stays and `panel.actErr` says why. */
export async function cardAct(key: string, action: string, input: { value: string; files: File[] }) {
  const card = cardOf(key);
  if (!card?.detail.act || nav().panel.acting) return false;
  set(draft => {
    draft.panel.acting = true;
    draft.panel.actErr = "";
  });
  let ok = false;
  try {
    const detail = await card.detail.act(ctxOf(card.provider), nav().panel.cardRefs[key], card.id, action, input);
    set(draft => {
      draft.panel.detail[key] = detail;
    });
    ok = true;
  } catch (e) {
    set(draft => {
      draft.panel.actErr = String(e);
    });
  }
  set(draft => {
    draft.panel.acting = false;
  });
  return ok;
}
/** The answers kept for the keys `match` accepts are dropped (the mail settings changed). */
export const forgetDetails = (match: (key: string) => boolean) =>
  set(draft => {
    for (const key of Object.keys(draft.panel.detail)) if (match(key)) delete draft.panel.detail[key];
  });
export function closeDetail() {
  if (!nav().panel.open) return;
  set(draft => {
    draft.panel.open = "";
  });
}
export function setTab(tab: PanelTab) {
  set(draft => {
    draft.tab = tab;
    draft.panel.open = "";
  });
}
