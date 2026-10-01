import { t } from "../core/i18n";
import { changed, ls, request } from "../core/store";
import { ui, WAIT, PRS, MAIL, isView, isTerminal } from "./ui";
import { chat, chatsOf, newChat, terminalOf, projectOf } from "./chats/state";
import { ensureHistory } from "./chats/events";
import { panel } from "./panel";
import { loadPrs } from "./prs";
import { loadMails } from "./mail";

// Moving around the main window: which conversation or view is open, the toast, the right panel and the overlays.

export async function select(k: string) {
  // an empty draft that is left behind disappears, one with typed text stays
  if (
    ui.selected !== k &&
    chat.chats[ui.selected]?.draft &&
    !(chat.messages[ui.selected] || []).length &&
    !chat.typed[ui.selected]
  )
    delete chat.chats[ui.selected];
  ui.projectPanel = false;
  if (ui.selected !== k && panel.open) panel.open = "";
  ui.selected = k;
  chat.unseen.delete(k);
  chat.routeChoice = chat.routeChoice?.key === k ? chat.routeChoice : null;
  ls.set("sel", chat.chats[k]?.draft && !chat.typed[k] ? WAIT : k);
  changed();
  if (!isView(k) && !chat.chats[k]?.draft) await ensureHistory(k, isTerminal(k));
  if (k === PRS) loadPrs();
  if (k === MAIL) loadMails();
  changed();
  request(isView(k) ? "scroll-top" : "scroll-bottom");
  if (!isView(k)) request("focus-composer");
}
export const openProject = (p: string) => select(chatsOf(p)[0]?.key || newChat(p));
/** A new conversation under the open one's project, or a general one. */
export const newHere = () =>
  select(
    newChat(
      isView(ui.selected)
        ? null
        : isTerminal(ui.selected)
          ? (terminalOf(ui.selected)?.project ?? null)
          : projectOf(ui.selected),
    ),
  );
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
