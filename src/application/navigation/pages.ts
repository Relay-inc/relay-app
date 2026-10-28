import { findPages, pagesModel, recentPages, type PagesModel } from "../../domain/navigation/pages";
import { noteKey } from "../../domain/navigation/keys";
import { ORCH } from "../../domain/orchestrator/rules";
import { chatVault, inWorkspace } from "../../domain/conversations/rules";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { contexts, projectName } from "../workspace/vault";
import { openDetail } from "./panel";
import { useNavigationStore } from "./store";
import { activeFolder } from "./workspaces";

// The sidebar's two tabs: Chats (the conversations, as before) and Pages (the notes of the workspace shown).
const set = useNavigationStore.setState;
export type SidebarTab = "chats" | "pages";
export const sidebarTab = (): SidebarTab => useNavigationStore.getState().sidebar.tab;
export function setSidebarTab(tab: SidebarTab) {
  set(draft => {
    draft.sidebar.tab = tab;
  });
  storage.set("sidebarTab", tab);
  if (tab === "pages") void loadRecent();
}
/** ⌘.: the other tab. */
export const swapSidebarTab = () => setSidebarTab(sidebarTab() === "chats" ? "pages" : "chats");

const isMain = (folder: string) => folder === settings().vault;
/** The notes of the workspace shown, relative to it (vault_notes gives another vault's absolute). */
export function workspacePaths(folder = activeFolder()): string[] {
  const all = [...useWorkspaceStore.getState().notes.paths];
  if (isMain(folder)) return all.filter(path => !path.startsWith("/"));
  const prefix = folder + "/";
  return all.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length));
}
/** The path a note of the workspace shown opens by: the main vault's relative, another vault's absolute. */
const target = (path: string) => (isMain(activeFolder()) ? path : `${activeFolder()}/${path}`);

/** The open conversations of the workspace shown, for the Chats tab's count. */
export function chatCount() {
  const { snap } = useWorkspaceStore.getState();
  const workspace = activeFolder();
  return Object.values(useConversationsStore.getState().chats).filter(
    chat => !chat.draft && !chat.closed && chat.key !== ORCH && inWorkspace(chatVault(chat, snap), workspace, settings()),
  ).length;
}

type Built = {
  notes: unknown;
  snap: unknown;
  workspace: string;
  paths: string[];
  exists: Set<string>;
  model: PagesModel;
};
let built: Built | null = null;
// the tree is built again only when the notes, the projects or the workspace changed, not on every click
function build(): Built {
  const workspace = activeFolder();
  const { snap, notes } = useWorkspaceStore.getState();
  if (built?.notes === notes && built.snap === snap && built.workspace === workspace) return built;
  const paths = workspacePaths(workspace);
  const projects = snap.projects
    .filter(project => (project.vault || snap.vault?.vault) === workspace)
    // another vault's project key is "name␟vault id" (policy.rs `project_key`): its note is named by the first part
    .map(project => ({
      key: project.name,
      name: project.name.split("\u001f")[0],
      label: projectName(project.name),
      context: project.context,
    }));
  built = { notes, snap, workspace, paths, exists: new Set(paths), model: pagesModel(paths, projects, contexts()) };
  return built;
}
/** The Pages tab: the workspace's contexts with their projects, its top folders, the recent notes, or the search's. */
export function pagesView(): { model: PagesModel; recent: string[]; found: string[] | null; total: number } {
  const { workspace, paths, exists, model } = build();
  const { find, touches } = useNavigationStore.getState().sidebar;
  const root = isMain(workspace) ? useWorkspaceStore.getState().notes.root : workspace;
  const query = find.trim().toLowerCase();
  return {
    model,
    recent: recentPages(touches, root, path => exists.has(path)),
    found: query ? findPages(paths, query) : null,
    total: paths.length,
  };
}

/** Folders and projects unfolded in the Pages tab, by path; not kept over a restart. `open` unfolds or folds it
 *  either way, else it toggles. */
export const togglePage = (path: string, open = !useNavigationStore.getState().sidebar.pagesOpen.has(path)) =>
  set(draft => {
    if (open) draft.sidebar.pagesOpen.add(path);
    else draft.sidebar.pagesOpen.delete(path);
  });
/** A note of the workspace shown opens in the right drawer. */
export const openPage = (path: string) => openDetail(noteKey(target(path)));
/** The note open in the drawer, as a path of the workspace shown, for the row to show selected. */
export function openPagePath() {
  const { panel, drawer } = useNavigationStore.getState();
  if (drawer !== "detail" || !panel.open.startsWith("note:")) return "";
  const open = panel.open.slice("note:".length);
  return isMain(activeFolder()) ? open : open.slice(activeFolder().length + 1);
}

/** The notes Relay's conversations read and wrote this week: Recent in the Pages tab. */
export async function loadRecent() {
  try {
    const touches = await backend.brainTouches(7);
    set(draft => {
      draft.sidebar.touches = touches;
    });
  } catch (e) {
    console.error(e);
  }
}
