import { t } from "../../shared/i18n";
import {
  WAIT,
  PRS,
  MAIL,
  GRAPH,
  INBOX_VIEW,
  isView,
  boardIdOf,
  backAfter,
  type Back,
  type Drawer,
  type Tool,
} from "../../domain/navigation/views";
import { provider } from "../../shared/plugins";
import { isTerminal } from "../../domain/navigation/keys";
import { ORCH } from "../../domain/orchestrator/rules";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { chatsOf, label as chatLabel, selectedProject } from "../conversations/selectors";
import { newChat, newChatHere, dropEmptyDraft, markSeen } from "../conversations/chats";
import { typedOf } from "../conversations/drafts";
import { ensureHistory } from "../conversations/history";
import { loadGraph } from "./graph";
import { loadInboxNotes } from "../inbox/inbox";
import { loadPrs, loadProjectRepos } from "../pull-requests/prs";
import { loadMails } from "../mail/mail";
import { searchProjects } from "../../domain/navigation/project-search";
import { useWorkspaceStore } from "../workspace/store";
import { projectLabel } from "../workspace/vault";
import { settings } from "../settings/settings";
import { useNavigationStore } from "./store";
import { loadTodayCards } from "../today/today";
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
    draft.back = backAfter(draft.back, backHere(draft), key);
    draft.projectPanel = false;
    draft.tool = tool;
    // the coordinator opens with its workers next to it, anything else closes them (openWorker keeps them)
    draft.orchDetail = false;
    // a conversation's agents column and agent page belong to that conversation
    draft.agentPage = "";
    if (draft.selected !== key && draft.drawer === "agents") draft.drawer = "";
    if (key === ORCH) draft.drawer = "workers";
    else if (draft.drawer === "workers") draft.drawer = "";
    draft.selected = key;
  });
  const project = isView(key) ? null : selectedProject();
  set(draft => {
    if (!isView(key)) draft.lastProject = project;
    // a project's terminals and notes only stay open while that project's tools are in the bar
    if (
      (draft.drawer === "terminal" || draft.drawer === "notes" || draft.drawer === "design") &&
      !(isView(key) ? tool?.project : project)
    )
      draft.drawer = "";
  });
  markSeen(key);
  storage.set("sel", chats[key]?.draft && !typedOf(key) ? WAIT : key);
  if (!isView(key)) {
    loadProjectRepos();
    if (!useConversationsStore.getState().chats[key]?.draft) await ensureHistory(key, isTerminal(key));
  }
  if (key === PRS) loadPrs();
  if (key === WAIT) loadTodayCards();
  if (key === MAIL) loadMails();
  if (key === GRAPH) loadGraph();
  if (key === INBOX_VIEW) void loadInboxNotes();
  request(isView(key) ? "scroll-top" : "scroll-bottom");
  if (!isView(key)) request("focus-composer");
}
// where the open conversation's log is scrolled, as its view says on each scroll (null: at the bottom)
let logAt: { key: string; top: number | null } = { key: "", top: null };
export const logScrolled = (key: string, top: number | null) => void (logAt = { key, top });
const backHere = (draft: { selected: string; tool: Tool | null; drawer: Drawer }): Back => ({
  key: draft.selected,
  tool: draft.tool,
  drawer: draft.drawer,
  top: logAt.key === draft.selected ? logAt.top : null,
});
/** The page opened next goes back to what is open now, also when that is a page (a note made from a page's / menu). */
export const backToHere = () =>
  set(draft => {
    draft.back = backHere(draft);
  });
/** Where Back puts the log again, read once by the view when asked (`scroll-back`). */
export const backTop = () => logAt.top;
/** Back from a page: what it was opened from, with that drawer open again and its log scrolled where it was. */
export async function goBack() {
  const back = nav().back;
  if (!back) return;
  set(draft => {
    draft.back = null; // a page it goes back to has no Back of its own
  });
  await select(back.key, back.tool);
  set(draft => {
    if (back.drawer) draft.drawer = back.drawer;
  });
  if (back.top !== null) {
    logAt = { key: back.key, top: back.top };
    request("scroll-back");
  }
}
/** A worker as its page in the orchestrator: the workers stay on the right, the composer talks to the worker, Esc
 *  goes back to the coordinator. */
export async function openWorker(key: string) {
  await select(key);
  set(draft => {
    draft.orchDetail = true;
    draft.drawer = "workers";
  });
}
/** A subagent of the open conversation as a read-only page, its agents column next to it; Esc goes back. */
export function openAgent(id: string) {
  set(draft => {
    draft.agentPage = id;
    draft.drawer = "agents";
  });
  request("scroll-bottom");
}
export function closeAgent() {
  set(draft => {
    draft.agentPage = "";
  });
  request("scroll-bottom");
}
/** Only open a conversation and scroll to its end, without what `select` loads for the desktop's views (the phone). */
export function show(key: string) {
  set(draft => {
    draft.selected = key;
  });
  if (key) request("scroll-bottom");
}
/** A project's newest conversation, or a new one under it. */
export const openProject = (project: string) => select(chatsOf(project)[0]?.key || newChat(project));
/** A new conversation under the open one's project, or a general one. */
export const newHere = () => select(newChatHere(isView(nav().selected) ? null : selectedProject()));

let toastTimer = 0;
/** A bar at the bottom of the middle column for `ms`, with an undo (or other) button when `undo` is given. */
/** Text on the clipboard. */
export const copy = (text: string) => backend.copyText(text).catch(e => console.error(e));

export function toast(text: string, undo?: () => void, btn = t("toast.undo"), ms = 8000, detail?: string) {
  set(draft => {
    draft.toast = { text, undo, btn, detail };
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
export const toggleDrawer = (tool: "terminal" | "notes" | "design" | "workers" | "git" | "files" | "agents") =>
  set(draft => {
    draft.drawer = draft.drawer === tool ? "" : tool;
  });
/** A drawer tool open, whatever the drawer showed. */
export const showDrawer = (tool: "design") =>
  set(draft => {
    draft.drawer = tool;
  });
export const openProjectPanel = () => {
  // the coordinator belongs to no project and never moves
  if (isView(nav().selected) || nav().selected === ORCH) return;
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
/** Cmd-K's conversations for what is typed: matched on title and project name, as the projects are. */
export const quickChats = (typed: string) =>
  searchProjects(
    Object.values(useConversationsStore.getState().chats)
      .filter(chat => !chat.draft && !chat.closed && chat.key !== ORCH)
      .map(chat => ({
        key: chat.key,
        name: chatLabel(chat.key),
        context: projectLabel(chat.project),
        aliases: [],
      })),
    typed,
  );
/** The settings window on a page (the last one it showed when none is given). */
export const openSettingsTab = (tab?: string) => backend.openSettingsWindow(tab);
/** A drawer tool, opened and left open when it already is. */
export const openDrawer = (tool: Parameters<typeof toggleDrawer>[0]) => {
  if (nav().drawer !== tool) toggleDrawer(tool);
};
/** A web or mail link in the default browser or mail app: a webview window cannot open them itself. */
export const openExternal = (url: string) => backend.openUrl(url);
/** The settings window, on Updates while there is one. */
export const openSettings = () => backend.openSettingsWindow(nav().update ? "updates" : undefined);
/** Whether there is a Relay update, from the last check (the backend checks at start and every 12 hours). */
export function watchUpdate() {
  const show = ({ latest }: { latest: string | null }) =>
    set(draft => {
      draft.update = latest ?? "";
    });
  void backend.updatesStatus().then(show);
  void backend.onUpdates(show);
}
/** The provider whose board a selection key opens. */
export const boardOf = (key: string) => {
  const id = boardIdOf(key);
  return id === undefined ? undefined : provider(id);
};
