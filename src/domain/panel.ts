import { invoke } from "@tauri-apps/api/core";
import { changed } from "../core/store";
import { ui } from "./ui";
import { config } from "./config";
import { ctxOf, provider, type BoardProvider, type BoardRef } from "./providers";
import { mail, type MailBody } from "./mail";
import { panelItem, cardKey, type PanelItem } from "./keys";

// The right drawer's detail: a mail ("mail:…"), a vault note ("note:…") or a board card ("card:<provider>:<id>"); a PR
// ("owner/repo#12") opens in its own window. `ui.drawer` says what the drawer shows, `open` is the key behind "detail".
export const panel = {
  open: "", // the key of the detail shown in the drawer, "" for none
  modal: "", // the card key shown in the ticket window over the board, "" for none
  prOpen: "", // the PR key shown in the Pull requests view, "" for none
  mailOpen: "", // the mail key shown in the Mail view, "" for none
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
    // a provider that can describe its card as data gets the ticket window, the others the right panel
    return boardProvider.detail.view ? openTicket(key) : openDetail(key);
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
/** Show a PR, mail, note or card in the right drawer: what is known at once, then fresh from the backend. */
export async function openDetail(key: string) {
  const item = panelItem(key);
  if (!item) return;
  panel.open = key;
  panel.err = "";
  panel.actErr = "";
  mail.link = "";
  const card = cardOf(key);
  if (card) panel.detail[key] ??= card.detail.cached(card.id);
  ui.drawer = "detail";
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
/** Show a mail in the Mail view next to the list: its headers at once, the body from the server. */
export async function openMail(key: string) {
  const item = panelItem(key);
  if (item?.kind !== "mail") return;
  panel.mailOpen = key;
  panel.err = "";
  mail.link = "";
  changed();
  try {
    panel.detail[key] = await fetchDetail(key, item);
  } catch (e) {
    // a mail that cannot be read is not shown from an older answer
    delete panel.detail[key];
    panel.err = String(e);
  }
  changed();
}
/** Show a card in the ticket window over the board: what is known at once, then fresh from the tracker. */
export async function openTicket(key: string) {
  const item = panelItem(key);
  const card = cardOf(key);
  if (item?.kind !== "card" || !card) return;
  panel.modal = key;
  panel.err = "";
  panel.actErr = "";
  panel.detail[key] ??= card.detail.cached(card.id);
  changed();
  try {
    panel.detail[key] = await fetchDetail(key, item);
  } catch (e) {
    if (!panel.detail[key]) panel.err = String(e);
  }
  changed();
}
/** Show a PR in the Pull requests view: what is known at once, then fresh from GitHub. */
export async function openPr(key: string) {
  const item = panelItem(key);
  if (item?.kind !== "pr") return;
  panel.prOpen = key;
  panel.err = "";
  changed();
  try {
    panel.detail[key] = await fetchDetail(key, item);
  } catch (e) {
    if (!panel.detail[key]) panel.err = String(e);
  }
  changed();
}
export function closeTicket() {
  if (!panel.modal) return;
  panel.modal = "";
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
    panel.detail[key] = await card.detail.act(
      ctxOf(card.provider, config.value.integrations),
      panel.cardRefs[key],
      card.id,
      a.action,
      { value: a.value, files: a.files },
    );
    a.done?.();
  } catch (e) {
    panel.actErr = String(e);
  }
  panel.acting = false;
  changed();
}
export function closeDrawer() {
  if (!ui.drawer) return;
  ui.drawer = "";
  panel.open = "";
  changed();
}
