import { findPages, pagesModel, recentPages, type PagesModel } from "../../domain/navigation/pages";
import { noteKey, pageKey, VIEW } from "../../domain/navigation/keys";
import { pageOf } from "../../domain/navigation/views";
import { ORCH } from "../../domain/orchestrator/rules";
import { chatVault, inWorkspace } from "../../domain/conversations/rules";
import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { newChatHere } from "../conversations/chats";
import { typeInto } from "../conversations/actions";
import { settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { contexts, loadNotes, loadSnapshot, projectName } from "../workspace/vault";
import { FILE_TOOLS } from "../../domain/git/git";
import { copy, select, toast } from "./navigation";
import { openDetail } from "./panel";
import { useNavigationStore } from "./store";
import { makeStore } from "../make-store";
import { activeFolder, workspaces } from "./workspaces";

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
/** The file of an open page as it is now, after a change made outside the page: its text, hash and who changed it
 *  ("relay" when a move in the Pages tab rewrote its links, "claude" when a conversation's file tool wrote it in the
 *  last seconds, else "disk"). */
export type OutsideChange = { text: string; hash: string; by: "relay" | "claude" | "disk" };
const watchers = new Map<string, (change: OutsideChange) => void>();
/** An open page's editor hears about its file changing outside Relay; the returned function stops that. */
export function watchPage(page: string, merge: (change: OutsideChange) => void) {
  watchers.set(page, merge);
  return () => {
    if (watchers.get(page) === merge) watchers.delete(page);
  };
}
/** A version from a page's history made its text again. A shared workspace's document: as an edit of it, which the
 *  open editor and every member get. Any other note: written over its file, and the open editor takes it in as a
 *  change made outside (merged with what is typed, else the bar). */
export type { PageHistory, PageVersion } from "../../infrastructure/backend";
export const loadHistory = (page: string) => backend.pageHistory(page);
export type { PageComments } from "../../infrastructure/backend";
export const loadComments = (page: string) => backend.pageComments(page);
export const addComment = (
  page: string,
  kind: string,
  on: string,
  text = "",
  quote = "",
  anchor: unknown = null,
  mentions: string[] = [],
) => backend.pageComment(page, kind, on, text, quote, anchor, mentions);
export type { InboxItem } from "../../infrastructure/backend";
export const loadInbox = (folder: string) => backend.workspaceInbox(folder);
/** Any comment of a shared document changed (a member's, live): an Inbox reads itself again. */
export const onAnyComments = (then: () => void) =>
  backend.onSharedDoc(change => {
    if (change.id.endsWith("#comments")) then();
  });
/** A thread to open with its page (from the Inbox): PageView takes it when that page shows (`n` tells one ask from the
 *  next, also on the page already open). */
export const usePageThread = makeStore<{ page: string; thread: string; n: number }>(() => ({
  page: "",
  thread: "",
  n: 0,
}));
export function openPageThread(page: string, thread: string) {
  // the Inbox names a page by its full path (any workspace's), a page of the workspace shown by its path in it
  const at = page.startsWith("/") ? page : target(page);
  usePageThread.setState(s => ({ page: at, thread, n: s.n + 1 }));
  select(pageKey(at));
}
/** Another member's comment on a shared document arrived (its sidecar `<doc>#comments` changed). */
export const onComments = (doc: string, then: () => void) =>
  backend.onSharedDoc(change => {
    if (change.id === `${doc}#comments`) then();
  });
export async function restorePage(page: string, kind: backend.PageHistory["kind"], text: string) {
  if (kind === "doc") return backend.pageRestore(page, text);
  const { hash } = await backend.writeNote(page, text, "", true);
  watchers.get(page)?.({ text, hash, by: "relay" });
}
// a conversation's Edit or Write of this note that ended in the last 15 s
function byClaude(page: string) {
  const since = Date.now() - 15_000;
  const tail = page.startsWith("/") ? page : `/${page}`;
  return Object.values(useConversationsStore.getState().messages).some(items =>
    items.some(
      item =>
        item.kind === "tool" &&
        !!item.tool &&
        FILE_TOOLS.has(item.tool.name) &&
        (item.end ?? item.at ?? 0) > since &&
        String((item.tool.input as { file_path?: unknown }).file_path ?? "").endsWith(tail),
    ),
  );
}
/** A note changed outside Relay (the file watcher): the Pages tab reads which notes exist again, and an open page that
 *  holds another text than the file gets the file's, to merge. */
export async function noteChanged({ path, hash, relinked }: backend.NoteChange) {
  void loadNotes();
  const by = relinked ? "relay" : byClaude(path) ? "claude" : "disk";
  // another workspace's note (an absolute path): if it is a shared document, its file change becomes an edit of it
  if (hash && path.startsWith("/")) void backend.sharedDocAbsorb(path, by).catch(() => {});
  const merge = watchers.get(path);
  const read = useNavigationStore.getState().panel.detail[pageKey(path)] as Page | undefined;
  if (!merge || !hash || !read || "err" in read || read.hash === hash) return;
  try {
    const fresh = (await backend.readNote(path)) as Page;
    if (!("err" in fresh)) merge({ text: fresh.text, hash: fresh.hash, by });
  } catch {
    /* gone meanwhile: the next save says so */
  }
}
/** A shared document's page holds `text` now (its head changed in the document): the properties above follow it. Its
 *  file is written by the Mac's documents, not by a save, so the hash stays. */
export function pageTextIs(page: string, text: string) {
  set(draft => {
    const read = draft.panel.detail[pageKey(page)] as Page | undefined;
    if (read && !("err" in read)) draft.panel.detail[pageKey(page)] = { ...read, text, modified: Date.now() };
  });
}
/** The page now holds the file's text and hash (merged in by its editor): the next save checks against these. */
export function adoptPage(page: string, text: string, hash: string) {
  set(draft => {
    const read = draft.panel.detail[pageKey(page)] as Page | undefined;
    if (read && !("err" in read)) draft.panel.detail[pageKey(page)] = { ...read, text, hash, modified: Date.now() };
  });
}
// the values a key has in the workspace's notes, read once per workspace and key
const values = new Map<string, Promise<string[]>>();
/** What a page's property offers to pick from: the values the key has across the workspace shown, most used first. */
export function propertyValues(key: string) {
  const id = `${activeFolder()}\u001f${key}`;
  if (!values.has(id))
    values.set(
      id,
      backend.propertyValues(activeFolder(), key).catch(() => []),
    );
  return values.get(id)!;
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

// ---------- managing files: new page or folder, rename and move (links to it follow), duplicate, trash with Undo
/** The workspace shown's folder, and a path of it as an absolute one ("" is the folder itself). */
const rootOf = () => (isMain(activeFolder()) ? useWorkspaceStore.getState().notes.root : activeFolder());
const abs = (path: string) => (path ? `${rootOf()}/${path}` : rootOf());
/** The workspace shown is shared on a relay-server: a delete there deletes for every member. */
export const sharedWorkspace = () => workspaces().find(workspace => workspace.active && workspace.team)?.name ?? "";
/** How many pages a folder of the workspace shown holds, at any depth (what Delete names). */
export const pagesIn = (folder: string) => workspacePaths().filter(path => path.startsWith(`${folder}/`)).length;
/** The name New page offers in `folder`: Untitled, or Untitled 1… when that one is there. */
export const freePageName = (folder: string) =>
  backend.freePageName(abs(folder), t("pages.untitled")).catch(() => t("pages.untitled"));
/** A project's own note can't be renamed or moved here: the project is keyed by its name. */
export const isProjectNote = (path: string) => !!pageProject(path);
/** Every folder of the workspace shown, for Move to…. */
export function pageFolders() {
  const all = new Set<string>();
  for (const path of workspacePaths())
    for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) all.add(path.slice(0, at));
  return [...all].sort((a, b) => a.localeCompare(b));
}
const fail = (e: unknown) => toast(String(e));
/** A new page (or folder) `name` in `folder` ("" the top); a page opens. */
export async function createPage(folder: string, name: string, isFolder: boolean) {
  try {
    const path = await backend.createNote(abs(folder), name, isFolder);
    await loadSnapshot();
    if (folder) togglePage(folder, true);
    if (!isFolder) openPage(path);
  } catch (e) {
    fail(e);
  }
}
export async function duplicatePage(path: string) {
  try {
    openPage(await backend.duplicateNote(abs(path)));
    await loadSnapshot();
  } catch (e) {
    fail(e);
  }
}
/** How many links a move would rewrite, before asking. */
export const countLinks = (from: string, to: string) => backend.movePath(abs(from), abs(to), true);
/** Rename or move a page or folder within the workspace shown; the open page follows it. */
export async function movePage(from: string, to: string) {
  const open = openPagePath();
  try {
    const { path } = await backend.movePath(abs(from), abs(to), false);
    await loadSnapshot();
    if (open === from) openPage(path);
    else if (open.startsWith(`${from}/`)) openPage(path + open.slice(from.length));
  } catch (e) {
    fail(e);
  }
}
/** A page or folder into the workspace's .trash/, with Undo. */
export async function trashPage(path: string) {
  const open = openPagePath();
  try {
    const gone = await backend.trashPath(abs(path));
    await loadSnapshot();
    if (open === path || open.startsWith(`${path}/`)) select(VIEW.wait);
    const shared = sharedWorkspace();
    toast(
      shared
        ? t("pages.trashedShared", { name: noteLabel(path), workspace: shared })
        : t("pages.trashed", { name: noteLabel(path) }),
      () => {
        void backend.restorePath(gone.root, gone.trash, gone.path).then(loadSnapshot).catch(fail);
      },
    );
  } catch (e) {
    fail(e);
  }
}
const noteLabel = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
export const revealPage = (path: string) => backend.openFile(abs(path), true).catch(fail);
export const copyPagePath = (path: string) => copy(abs(path));
