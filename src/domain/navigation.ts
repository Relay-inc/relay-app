import { t } from "../core/i18n";
import { changed, ls, request } from "../core/store";
import { ui, WAIT, PRS, MAIL, isView, isTerm } from "./ui";
import { chat, chatsOf, newChat, termOf, projOf } from "./chats/state";
import { ensureHistory } from "./chats/events";
import { panel } from "./panel";
import { loadPrs } from "./prs";
import { loadMails } from "./mail";

// Moving around the main window: which conversation or view is open, the toast, the right panel and the overlays.

export async function select(k: string) {
  // an empty draft that is left behind disappears, one with typed text stays
  if (ui.sel !== k && chat.chats[ui.sel]?.draft && !(chat.convo[ui.sel] || []).length && !chat.typed[ui.sel]) delete chat.chats[ui.sel];
  ui.pop = false;
  if (ui.sel !== k && panel.open) panel.open = "";
  ui.sel = k; chat.unseen.delete(k); chat.routeChoice = chat.routeChoice?.key === k ? chat.routeChoice : null;
  ls.set("sel", chat.chats[k]?.draft && !chat.typed[k] ? WAIT : k);
  changed();
  if (!isView(k) && !chat.chats[k]?.draft) await ensureHistory(k, isTerm(k));
  if (k === PRS) loadPrs();
  if (k === MAIL) loadMails();
  changed();
  request(isView(k) ? "scroll-top" : "scroll-bottom");
  if (!isView(k)) request("focus-composer");
}
export const openProject = (p: string) => select(chatsOf(p)[0]?.key || newChat(p));
/** A new conversation under the open one's project, or a general one. */
export const newHere = () => select(newChat(isView(ui.sel) ? null : isTerm(ui.sel) ? termOf(ui.sel)?.project ?? null : projOf(ui.sel)));
export const newGeneral = () => select(newChat(null));

let toastTimer = 0;
export function toast(text: string, undo?: () => void, btn = t("toast.undo"), ms = 8000) {
  ui.toast = { text, undo, btn }; changed();
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { ui.toast = null; changed(); }, ms);
}
export const hideToast = () => { clearTimeout(toastTimer); ui.toast = null; changed(); };

export const setInsp = (hide: boolean) => { ui.noinsp = hide; ls.set("noinsp", hide); changed(); };
export const openPop = () => { if (isView(ui.sel)) return; ui.pop = true; changed(); };
export const closePop = () => { ui.pop = false; changed(); };
export const zoom = (url: string) => { ui.zoom = url; changed(); };
export const toggleQuick = (on = !ui.qk) => { ui.qk = on; changed(); };
