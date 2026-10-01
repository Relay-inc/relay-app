import { invoke } from "@tauri-apps/api/core";
import { changed, ls } from "../core/store";
import { ui } from "./ui";
import { config } from "./config";
import { ctxOf, provider, type BoardProvider, type BoardRef } from "./providers";
import { mail, type MailBody } from "./mail";
import { panelItem, cardKey, type PanelItem } from "./keys";

// The right panel's detail: a PR ("owner/repo#12"), a mail ("mail:…"), a vault note ("note:…") or a board card
// ("card:<provider>:<id>"). While one is open the panel widens; its tabs (open, status, reminders, PRs) are behind it.
export const panel = {
  open: "", // the key of what is shown, "" for the tabs
  detail: {} as Record<string, unknown>, // the last answer per key: shown at once, a fresh one follows
  err: "",
  cardRefs: {} as Record<string, BoardRef>,
  acting: false, // a card action (comment, status, files) is running: the panel is inert meanwhile
  actErr: "",
};
export type CardAct = { action: string; value: string; files: File[]; done?: () => void };

/** The provider and card id of a card key, when that provider draws its cards in the panel. */
export const cardOf = (key: string) => {
  const item = panelItem(key);
  const cardProvider = item?.kind === "card" ? provider(item.provider) : undefined;
  return item?.kind === "card" && cardProvider?.detail
    ? { provider: cardProvider, detail: cardProvider.detail, id: item.id }
    : undefined;
};
// a card opens in the right panel when its provider has one, else in the browser
export async function openCard(boardProvider: BoardProvider, ref: BoardRef, id: string) {
  const key = cardKey(boardProvider.id, id);
  if (boardProvider.detail) {
    panel.cardRefs[key] = ref;
    return openDetail(key);
  }
  try {
    const url = await boardProvider.url(ctxOf(boardProvider, config.value.integrations), ref, id);
    invoke("plugin:opener|open_url", { url });
  } catch (e) {
    console.error(e);
  }
}

function fetchDetail(key: string, item: PanelItem): Promise<unknown> {
  switch (item.kind) {
    case "card": {
      const card = cardOf(key)!;
      return card.detail.fetch(ctxOf(card.provider, config.value.integrations), panel.cardRefs[key], card.id);
    }
    case "mail":
      return invoke<MailBody>("mail_read", { account: item.account, id: item.id });
    case "note":
      return invoke("read_note", { target: item.target });
    case "pr":
      return invoke("github_pr", { repo: item.repo, number: item.number });
  }
}
/** Show a PR, mail, note or card in the right panel: what is known at once, then fresh from the backend. */
export async function openDetail(key: string) {
  const item = panelItem(key);
  if (!item) return;
  panel.open = key;
  panel.err = "";
  panel.actErr = "";
  mail.link = "";
  const card = cardOf(key);
  if (card) panel.detail[key] ??= card.detail.cached(card.id);
  ui.panelHidden = false;
  ls.set("noinsp", false);
  changed();
  try {
    panel.detail[key] = await fetchDetail(key, item);
  } catch (e) {
    // a mail that cannot be read is not shown from an older answer
    if (item.kind === "mail") delete panel.detail[key];
    if (!panel.detail[key]) panel.err = String(e);
  }
  changed();
}
/** An action from a card's panel: the provider does it in the tracker and answers with the card as it is now.
 * `done` (the template's) runs on success, e.g. emptying the comment box; on a failure what was typed stays. */
export async function cardAct(key: string, a: CardAct) {
  const card = cardOf(key);
  if (!card?.detail.act || panel.acting) return;
  panel.acting = true;
  panel.actErr = "";
  changed();
  try {
    panel.detail[key] = await card.detail.act(ctxOf(card.provider, config.value.integrations), panel.cardRefs[key], card.id, a.action, { value: a.value, files: a.files });
    a.done?.();
  } catch (e) {
    panel.actErr = String(e);
  }
  panel.acting = false;
  changed();
}
export function closeDetail() {
  if (!panel.open) return;
  panel.open = "";
  changed();
}
export function setTab(tab: string) {
  ui.tab = tab;
  if (panel.open) closeDetail();
  else changed();
}
