import { t } from "../../shared/i18n";
import { WAIT, PRS, MAIL, isView, boardIdOf, type Tool } from "../../domain/navigation/views";
import { provider } from "../../shared/plugins";
import { isTerminal } from "../../domain/navigation/keys";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { chatsOf, selectedProject } from "../conversations/selectors";
import { newChat, dropEmptyDraft, markSeen } from "../conversations/chats";
import { typedOf } from "../conversations/drafts";
import { ensureHistory } from "../conversations/history";
import { loadPrs, loadProjectRepos } from "../pull-requests/prs";
import { loadMails } from "../mail/mail";
import { searchProjects } from "../../domain/navigation/project-search";
import { useWorkspaceStore } from "../workspace/store";
import { projectLabel } from "../workspace/vault";
import { settings } from "../settings/settings";
import { useNavigationStore } from "./store";
import { request } from "./requests";

// Moving around the main window: which conversation or view is open, the toast, the right drawer and the overlays.
const nav = () => useNavigationStore.getState();
const set = useNavigationStore.setState;

/** Open a conversation, terminal session, board or view in the middle column. `tool`: it is a project's board or PRs
 *  opened from its title bar (`openTool`). */
export async function select(key: string, tool: Tool | null = null) {
  if (nav().selected !== key) dropEmptyDraft(nav().selected);
  const { chats } = useConversationsStore.getState();
  set(draft => {
    draft.projectPanel = false;
    draft.tool = tool;
    if (draft.selected !== key && draft.drawer === "detail") {
      draft.drawer = "";
      draft.panel.open = "";
    }
    draft.selected = key;
  });
  const project = isView(key) ? null : selectedProject();
  set(draft => {
    if (!isView(key)) draft.lastProject = project;
    // a project's terminals and notes only stay open while that project's tools are in the bar
    if ((draft.drawer === "terminal" || draft.drawer === "notes") && !(isView(key) ? tool?.project : project))
      draft.drawer = "";
  });
  markSeen(key);
  storage.set("sel", chats[key]?.draft && !typedOf(key) ? WAIT : key);
  if (!isView(key)) {
    loadProjectRepos();
    if (!useConversationsStore.getState().chats[key]?.draft) await ensureHistory(key, isTerminal(key));
  }
  if (key === PRS) loadPrs();
  if (key === MAIL) loadMails();
  request(isView(key) ? "scroll-top" : "scroll-bottom");
  if (!isView(key)) request("focus-composer");
}
/** A project's newest conversation, or a new one under it. */
export const openProject = (project: string) => select(chatsOf(project)[0]?.key || newChat(project));
/** A new conversation under the open one's project, or a general one. */
export const newHere = () => select(newChat(isView(nav().selected) ? null : selectedProject()));

let toastTimer = 0;
/** A bar at the bottom of the middle column for `ms`, with an undo (or other) button when `undo` is given. */
export function toast(text: string, undo?: () => void, btn = t("toast.undo"), ms = 8000) {
  set(draft => {
    draft.toast = { text, undo, btn };
  });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    set(draft => {
      draft.toast = null;
    });
  }, ms);
}
export const hideToast = () => {
  clearTimeout(toastTimer);
  set(draft => {
    draft.toast = null;
  });
};

/** The board or PRs button of a project: shows that view as the project's, the same button (or Esc) goes back. */
export async function openTool(project: string, key: string) {
  const current = nav().tool;
  if (current?.project === project && nav().selected === key) return closeTool();
  const back = current?.back ?? nav().selected;
  // the board view follows the project last shown (application/board followLinkedBoard)
  set(draft => {
    draft.lastProject = project;
  });
  await select(key, { project, back });
}
export function closeTool() {
  const tool = nav().tool;
  if (!tool) return;
  const chat = useConversationsStore.getState().chats[tool.back];
  // the conversation it came from may have been closed meanwhile: then the project's latest one
  if (isTerminal(tool.back) || (chat && !chat.closed)) select(tool.back);
  else openProject(tool.project);
}
/** A drawer tool's button: opens it, or closes it when it is the one shown. */
export const toggleDrawer = (tool: "terminal" | "notes") =>
  set(draft => {
    draft.drawer = draft.drawer === tool ? "" : tool;
    draft.panel.open = "";
  });
export const openProjectPanel = () => {
  if (isView(nav().selected)) return;
  set(draft => {
    draft.projectPanel = true;
  });
};
export const closeProjectPanel = () =>
  set(draft => {
    draft.projectPanel = false;
  });
/** Show an image large, "" closes it. */
export const zoom = (url: string) =>
  set(draft => {
    draft.zoom = url;
  });
/** Cmd-K open or closed; `text` opens it with that typed. */
export const toggleQuickAsk = (on = !nav().quickAsk, text = "") =>
  set(draft => {
    draft.quickAsk = on;
    draft.quickText = on ? text : "";
  });
/** Cmd-K's projects for what is typed: name, label (as shown, with its emoji) and context. */
export const quickProjects = (typed: string) =>
  searchProjects(
    useWorkspaceStore
      .getState()
      .snap.projects.map(project => ({ ...project, label: settings().projects[project.name]?.label })),
    typed,
  ).map(project => ({ name: project.name, label: projectLabel(project.name), context: project.context }));
/** A web or mail link in the default browser or mail app: a webview window cannot open them itself. */
export const openExternal = (url: string) => backend.openUrl(url);
export const openSettings = () => backend.openSettingsWindow();
/** The provider whose board a selection key opens. */
export const boardOf = (key: string) => {
  const id = boardIdOf(key);
  return id === undefined ? undefined : provider(id);
};
