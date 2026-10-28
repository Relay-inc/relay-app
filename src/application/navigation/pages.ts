import { findPages, pagesModel, recentPages, type PagesModel } from "../../domain/navigation/pages";
import { noteKey, pageKey } from "../../domain/navigation/keys";
import { pageOf } from "../../domain/navigation/views";
import { ORCH } from "../../domain/orchestrator/rules";
import { chatVault, inWorkspace } from "../../domain/conversations/rules";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { newChatHere } from "../conversations/chats";
import { typeInto } from "../conversations/actions";
import { settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { contexts, projectName } from "../workspace/vault";
import { select } from "./navigation";
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
    chat =>
      !chat.draft && !chat.closed && chat.key !== ORCH && inWorkspace(chatVault(chat, snap), workspace, settings()),
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
/** A note of the workspace shown opens as a page in the middle column. */
export const openPage = (path: string) => select(pageKey(target(path)));
/** A page's note as a path of the workspace shown ("" when the open page is another workspace's). */
export function pagePath(page: string) {
  if (isMain(activeFolder())) return page.startsWith("/") ? "" : page;
  return page.startsWith(activeFolder() + "/") ? page.slice(activeFolder().length + 1) : "";
}
/** The page open in the middle column, as a path of the workspace shown, for the row to show selected. */
export const openPagePath = () => pagePath(pageOf(useNavigationStore.getState().selected));
/** The project whose note this page is, in the workspace shown. */
export function pageProject(path: string) {
  return build()
    .model.contexts.flatMap(context => context.projects)
    .find(project => project.note === path);
}
/** A page as read: its text, its hash (what a save checks the file against) and when it was changed, or why it could not
 *  be read. */
export type Page = { path: string; text: string; hash: string; modified: number } | { err: string };
/** Read a page's note again, kept under its page key (the middle column shows what is known, then fresh). */
export async function loadPage(page: string) {
  let read: Page;
  try {
    read = (await backend.readNote(page)) as Page;
  } catch (e) {
    read = { err: String(e) };
  }
  set(draft => {
    draft.panel.detail[pageKey(page)] = read;
  });
}
/** Save a page's text over its note: "changed" when the file changed on disk since it was read or saved (nothing
 *  written), unless `force` ("Keep mine"); "" when saved, after which the page holds the new text and hash. */
export async function savePage(page: string, text: string, force = false): Promise<"" | "changed"> {
  const read = useNavigationStore.getState().panel.detail[pageKey(page)] as Page | undefined;
  if (!read || "err" in read) return "";
  try {
    const { hash } = await backend.writeNote(page, text, read.hash, force);
    set(draft => {
      draft.panel.detail[pageKey(page)] = { ...read, text, hash, modified: Date.now() };
    });
    return "";
  } catch (e) {
    if (String(e) === "changed") return "changed";
    throw e;
  }
}
/** A [[link]] in a page: the note of the workspace shown it names opens as a page, or in the right drawer with
 *  `drawer` (⌘-click), as a link in a conversation does. */
export function followPageLink(link: string, drawer: boolean) {
  if (drawer) return openDetail(noteKey(link));
  const name = (/\.md$/i.test(link) ? link : `${link}.md`).toLowerCase();
  const paths = workspacePaths();
  const path = paths.find(p => p.toLowerCase() === name) ?? paths.find(p => p.toLowerCase().endsWith(`/${name}`));
  return path ? openPage(path) : openDetail(noteKey(link));
}
/** Ask Claude about a page: a new conversation in the page's workspace (its project's, when it is a project's note)
 *  with the note's path typed in. */
export function askAboutPage(path: string) {
  const key = newChatHere(pageProject(path)?.key ?? null);
  typeInto(key, `\`${path}\` `);
  return select(key);
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
