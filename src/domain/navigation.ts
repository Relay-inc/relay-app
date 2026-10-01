import { t } from "../core/i18n";
import { changed, ls, request } from "../core/store";
import { ui, WAIT, PRS, MAIL, isView, isTerminal } from "./ui";
import { chat, chatsOf, newChat, selectedProject } from "./chats/state";
import { ensureHistory } from "./chats/events";
import { panel } from "./panel";
import { loadPrs } from "./prs";
import { loadMails } from "./mail";

// Moving around the main window: which conversation or view is open, the toast, the right panel and the overlays.

// an empty draft that is left behind disappears, one with typed text stays
function dropAbandonedDraft(leaving: string, next: string) {
  const isEmptyDraft = chat.chats[leaving]?.draft && !(chat.messages[leaving] || []).length && !chat.typed[leaving];
  if (leaving !== next && isEmptyDraft) delete chat.chats[leaving];
}

export async function select(key: string) {
  dropAbandonedDraft(ui.selected, key);
  ui.projectPanel = false;
  if (ui.selected !== key && panel.open) panel.open = "";
  ui.selected = key;
  if (!isView(key)) ui.lastProject = selectedProject();
  chat.unseen.delete(key);
  chat.routeChoice = chat.routeChoice?.key === key ? chat.routeChoice : null;
  ls.set("sel", chat.chats[key]?.draft && !chat.typed[key] ? WAIT : key);
  changed();
  if (!isView(key) && !chat.chats[key]?.draft) await ensureHistory(key, isTerminal(key));
  if (key === PRS) loadPrs();
  if (key === MAIL) loadMails();
  changed();
  request(isView(key) ? "scroll-top" : "scroll-bottom");
  if (!isView(key)) request("focus-composer");
}
export const openProject = (project: string) => select(chatsOf(project)[0]?.key || newChat(project));
/** A new conversation under the open one's project, or a general one. */
export const newHere = () => select(newChat(isView(ui.selected) ? null : selectedProject()));
export const newGeneral = () => select(newChat(null));

let toastTimer = 0;
export function toast(text: string, undo?: () => void, btn = t("toast.undo"), ms = 8000) {
  ui.toast = { text, undo, btn };
  changed();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast = null;
    changed();
  }, ms);
}
export const hideToast = () => {
  clearTimeout(toastTimer);
  ui.toast = null;
  changed();
};

export const setPanelHidden = (hide: boolean) => {
  ui.panelHidden = hide;
  ls.set("noinsp", hide);
  changed();
};
export const openProjectPanel = () => {
  if (isView(ui.selected)) return;
  ui.projectPanel = true;
  changed();
};
export const closeProjectPanel = () => {
  ui.projectPanel = false;
  changed();
};
export const zoom = (url: string) => {
  ui.zoom = url;
  changed();
};
export const toggleQuickAsk = (on = !ui.quickAsk) => {
  ui.quickAsk = on;
  changed();
};
