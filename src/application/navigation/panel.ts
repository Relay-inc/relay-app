import { provider } from "../../shared/plugins";
import type { BoardProvider, BoardRef } from "../../domain/board/types";
import { panelItem, cardKey, type PanelItem } from "../../domain/navigation/keys";
import * as backend from "../../infrastructure/backend";
import { ctxOf } from "../board/ctx";
import { clearMailLink } from "../mail/mail";
import { useNavigationStore } from "./store";

// The details: a note in the right drawer, a PR or mail next to its list, a card in the ticket window over the
// board. Each is shown from what is known at once, then fresh.
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
/** A card opens in the ticket window when its provider describes it, else in the browser. */
export async function openCard(boardProvider: BoardProvider, ref: BoardRef, id: string) {
  const key = cardKey(boardProvider.id, id);
  if (boardProvider.detail) {
    set(draft => {
      draft.panel.cardRefs[key] = ref;
    });
    return openTicket(key);
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
/** Show a vault note in the right drawer: what is known at once, then fresh from the backend. */
export async function openDetail(key: string) {
  const item = panelItem(key);
  if (!item) return;
  clearMailLink();
  set(draft => {
    draft.panel.open = key;
    draft.panel.err = "";
    draft.panel.actErr = "";
    draft.drawer = "detail";
  });
  try {
    const detail = await fetchDetail(key, item);
    set(draft => {
      draft.panel.detail[key] = detail;
    });
  } catch (e) {
    set(draft => {
      // the error of a load the user already left does not show on the detail open now
      if (!draft.panel.detail[key] && draft.panel.open === key) draft.panel.err = String(e);
    });
  }
}
/** Show a mail in the Mail view next to the list: its headers at once, the body from the server. */
export async function openMail(key: string) {
  const item = panelItem(key);
  if (item?.kind !== "mail") return;
  clearMailLink();
  set(draft => {
    draft.panel.mailOpen = key;
    draft.panel.err = "";
  });
  try {
    const detail = await fetchDetail(key, item);
    set(draft => {
      draft.panel.detail[key] = detail;
    });
  } catch (e) {
    set(draft => {
      // a mail that cannot be read is not shown from an older answer
      delete draft.panel.detail[key];
      if (draft.panel.mailOpen === key) draft.panel.err = String(e);
    });
  }
}
/** Show a card in the ticket window over the board: what is known at once, then fresh from the tracker. */
export async function openTicket(key: string) {
  const item = panelItem(key);
  const card = cardOf(key);
  if (item?.kind !== "card" || !card) return;
  set(draft => {
    draft.panel.modal = key;
    draft.panel.err = "";
    draft.panel.actErr = "";
    draft.panel.detail[key] ??= card.detail.cached(card.id);
  });
  await refresh(key, item, "modal");
}
/** Show a PR in the Pull requests view: what is known at once, then fresh from GitHub. */
export async function openPr(key: string) {
  const item = panelItem(key);
  if (item?.kind !== "pr") return;
  set(draft => {
    draft.panel.prOpen = key;
    draft.panel.err = "";
  });
  await refresh(key, item, "prOpen");
}
// the fresh answer replaces the known one; an error shows only without one, and only while that detail is still open
async function refresh(key: string, item: PanelItem, slot: "modal" | "prOpen") {
  try {
    const detail = await fetchDetail(key, item);
    set(draft => {
      draft.panel.detail[key] = detail;
    });
  } catch (e) {
    set(draft => {
      if (!draft.panel.detail[key] && draft.panel[slot] === key) draft.panel.err = String(e);
    });
  }
}
export function closeTicket() {
  if (!nav().panel.modal) return;
  set(draft => {
    draft.panel.modal = "";
  });
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
/** Close the right drawer, whatever it shows. */
export function closeDrawer() {
  if (!nav().drawer) return;
  set(draft => {
    draft.drawer = "";
    draft.panel.open = "";
  });
}
