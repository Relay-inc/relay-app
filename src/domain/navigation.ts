import { t } from "../core/i18n";
import { changed, ls, request } from "../core/store";
import { ui, WAIT, PRS, MAIL, isView, isTerminal } from "./ui";
import { chat, chatsOf, newChat, selectedProject } from "./chats/state";
import { ensureHistory } from "./chats/events";
import { panel, closeDrawer } from "./panel";
import { loadPrs, loadProjectRepos } from "./prs";
import { loadMails } from "./mail";

// Moving around the main window: which conversation or view is open, the toast, the right drawer and the overlays.

// an empty draft that is left behind disappears, one with typed text stays
function dropAbandonedDraft(leaving: string, next: string) {
  const isEmptyDraft = chat.chats[leaving]?.draft && !(chat.messages[leaving] || []).length && !chat.typed[leaving];
  if (leaving !== next && isEmptyDraft) delete chat.chats[leaving];
}

export async function select(key: string, tool: typeof ui.tool = null) {
  ui.tool = tool;
  dropAbandonedDraft(ui.selected, key);
  ui.projectPanel = false;
  if (ui.selected !== key && panel.open) closeDrawer();
  ui.selected = key;
  if (!isView(key)) ui.lastProject = selectedProject();
  // a project's terminals and notes only stay open while that project's tools are in the bar
  const toolsShown = isView(key) ? tool?.project : selectedProject();
  if ((ui.drawer === "terminal" || ui.drawer === "notes") && !toolsShown) ui.drawer = "";
  chat.unseen.delete(key);
  chat.routeChoice = chat.routeChoice?.key === key ? chat.routeChoice : null;
  ls.set("sel", chat.chats[key]?.draft && !chat.typed[key] ? WAIT : key);
  changed();
  if (!isView(key) && !chat.chats[key]?.draft) await ensureHistory(key, isTerminal(key));
  if (!isView(key)) loadProjectRepos();
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

/** The board or PRs button of a project: shows that view as the project's, the same button (or Esc) goes back. */
export async function openTool(project: string, key: string) {
  if (ui.tool?.project === project && ui.selected === key) return closeTool();
  const back = ui.tool?.back ?? ui.selected;
  // the board view follows the project last shown (src/domain/board.ts followLinkedBoard)
  ui.lastProject = project;
  await select(key, { project, back });
}
export function closeTool() {
  const back = ui.tool?.back;
  if (back) select(back);
}
/** A drawer tool's button: opens it, or closes it when it is the one shown. */
export const toggleDrawer = (tool: "terminal" | "notes") => {
  ui.drawer = ui.drawer === tool ? "" : tool;
  panel.open = "";
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
