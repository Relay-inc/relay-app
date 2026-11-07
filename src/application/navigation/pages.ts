import {
  findPages,
  isSystemPage,
  pagesModel,
  pageTree,
  noteName,
  placeOf,
  recentPages,
  typedTree,
  type PageFolder,
  type PagesModel,
  type TypedTree,
} from "../../domain/navigation/pages";
import { pageKey, VIEW } from "../../domain/navigation/keys";
import { pageOf } from "../../domain/navigation/views";
import { ORCH } from "../../domain/orchestrator/rules";
import { chatVault, inWorkspace, vaultChoices } from "../../domain/conversations/rules";
import { noteIn } from "../../domain/conversations/files";
import { resolveNote } from "../../domain/workspace/rules";
import { noteOf } from "../../shared/markdown";
import * as backend from "../../infrastructure/backend";
import { t, tn } from "../../shared/i18n";
import { storage } from "../../infrastructure/storage";
import { useConversationsStore } from "../conversations/store";
import { newChatHere } from "../conversations/chats";
import { attachPaths, typeInto } from "../conversations/actions";
import { filesOn, settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { contexts, loadNotes, loadSnapshot, projectName } from "../workspace/vault";
import { FILE_TOOLS } from "../../domain/git/git";
import { copy, select, toast } from "./navigation";
import { useNavigationStore } from "./store";
import { makeStore } from "../make-store";
import { trailing } from "../trailing";
import { loadLinked } from "./linked";
import { favouritesOf, followFavourites } from "./favourites";
import { activeFolder, workspaceOf, workspaces } from "./workspaces";
import { loadRows } from "../collections/collections";
import { useCollectionsStore } from "../collections/store";
import { registryOf } from "../types/types";

// The sidebar's two tabs: Chats (the conversations, as before) and Pages (the notes of the workspace shown).
const set = useNavigationStore.setState;
export type SidebarTab = "chats" | "pages";
/** With Files off there are no tabs: the sidebar is Chats, as before. */
export const sidebarTab = (): SidebarTab => (filesOn() ? useNavigationStore.getState().sidebar.tab : "chats");
export function setSidebarTab(tab: SidebarTab) {
  set(draft => {
    draft.sidebar.tab = tab;
  });
  storage.set("sidebarTab", tab);
  if (tab === "pages") void loadRecent();
}
/** ⌘.: the other tab. */
export const swapSidebarTab = () => filesOn() && setSidebarTab(sidebarTab() === "chats" ? "pages" : "chats");

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
  shared: unknown;
  paths: string[];
  exists: Set<string>;
  model: PagesModel;
  system: PageFolder | null;
};
/** Admin of the workspace shown: always of one's own vault and the folders added, of a shared one when its role says. */
export const isAdmin = (workspace: string) =>
  settings().sharedVaults?.find(vault => vault.folder === workspace)?.role !== "member";
let built: Built | null = null;
// the tree is built again only when the notes, the projects or the workspace changed, not on every click
function build(): Built {
  const workspace = activeFolder();
  const { snap, notes } = useWorkspaceStore.getState();
  const shared = settings().sharedVaults;
  if (built?.notes === notes && built.snap === snap && built.workspace === workspace && built.shared === shared)
    return built;
  // the notes the vault runs on stay out of the tree; an admin finds them under System and in the search, a member not
  const all = workspacePaths(workspace);
  const admin = isAdmin(workspace);
  const system = all.filter(isSystemPage);
  const paths = admin ? all : all.filter(path => !isSystemPage(path));
  const projects = snap.projects
    .filter(project => (project.vault || snap.vault?.vault) === workspace)
    // another vault's project key is "name␟vault id" (policy.rs `project_key`): its note is named by the first part
    .map(project => ({
      key: project.name,
      name: project.name.split("\u001f")[0],
      label: projectName(project.name),
      context: project.context,
    }));
  const model = pagesModel(
    paths.filter(path => !isSystemPage(path)),
    projects,
    contexts(),
    snap.contexts?.[workspace] ?? [],
  );
  built = {
    notes,
    snap,
    workspace,
    shared,
    paths,
    exists: new Set(paths),
    model,
    system: admin && system.length ? pageTree(system) : null,
  };
  return built;
}
/** The Pages tab: the workspace's contexts with their projects, its top folders, the notes the vault runs on (for an
 *  admin, else null), the pinned and the recent notes, or the search's. */
export function pagesView(): {
  model: PagesModel;
  system: PageFolder | null;
  favourites: string[];
  recent: string[];
  found: string[] | null;
  total: number;
} {
  const { workspace, paths, exists, model, system } = build();
  const { find, touches, recentRemoved } = useNavigationStore.getState().sidebar;
  const root = isMain(workspace) ? useWorkspaceStore.getState().notes.root : workspace;
  const query = find.trim().toLowerCase();
  return {
    model,
    system,
    favourites: favouritesOf(workspace).filter(path => exists.has(path)),
    recent: recentPages(touches, root, path => exists.has(path), 5, recentRemoved[root]),
    found: query ? findPages(paths, query) : null,
    total: model.top.count, // the pages people write in: System not counted, for an admin either
  };
}

/** The Pages tab shows the folders of the workspace shown (Show files), else its notes by type. Only an admin has the
 *  switch; it is kept per workspace over a restart. */
export const filesShown = (folder = activeFolder()) =>
  isAdmin(folder) && !!useNavigationStore.getState().sidebar.pagesFiles[folder];
export function showFiles(on: boolean, folder = activeFolder()) {
  set(draft => {
    if (on) draft.sidebar.pagesFiles[folder] = true;
    else delete draft.sidebar.pagesFiles[folder];
  });
  storage.set("pagesFiles", useNavigationStore.getState().sidebar.pagesFiles);
}
/** The notes of the workspace shown by type: per project and context, the rest, and Unsorted (`loadRows` reads them). */
export function typedView(): TypedTree {
  const { workspace, model } = build();
  const rows = useCollectionsStore.getState().rows[workspace] ?? [];
  return typedTree(
    model,
    rows,
    registryOf(workspace).types.map(type => type.name),
  );
}

/** Folders and projects unfolded in the Pages tab, by path, kept over a restart. `open` unfolds or folds it either
 *  way, else it toggles. */
export function togglePage(path: string, open = !useNavigationStore.getState().sidebar.pagesOpen.has(path)) {
  set(draft => {
    if (open) draft.sidebar.pagesOpen.add(path);
    else draft.sidebar.pagesOpen.delete(path);
  });
  storage.set("pagesOpen", [...useNavigationStore.getState().sidebar.pagesOpen]);
}
/** A note of the workspace shown opens as a page in the middle column. */
export const openPage = (path: string) => openPageIn(activeFolder(), path);
/** The path a note of workspace `folder` is read and written by: the main vault's relative, another vault's absolute. */
export const noteTarget = (folder: string, path: string) => (isMain(folder) ? path : `${folder}/${path}`);
/** A note of any workspace (`folder`, its path in it) as a page in the middle column, in that workspace. */
export const openPageIn = (folder: string, path: string) => select(pageKey(noteTarget(folder, path)));
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
/** The context whose note this page is, in the workspace shown. */
export const pageContext = (path: string) =>
  build().model.contexts.find(context => !!context.folder && path === `${context.folder}/${context.name}.md`);
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
    void loadLinked(); // its about:, context: or with: may have changed
    if (!filesShown()) void loadRows(); // and its type:
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
/** A link out of a page's file, its first one: the / menu's Undo once the page's editor has closed. An open editor of
 *  the page takes the change in as one made outside. */
export async function dropLink(page: string, link: string) {
  const read = (await backend.readNote(page)) as Page;
  if ("err" in read || !read.text.includes(link)) return;
  const text = read.text.replace(link, "");
  const { hash } = await backend.writeNote(page, text, read.hash, false);
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
// the watcher sends one event per changed file: the walks wait for the burst to end
const reload = trailing(() => {
  void loadNotes();
  void loadLinked();
  if (!filesShown()) void loadRows(); // a `type:` set or taken off moves the note in the tree by type
}, 300);
/** A note changed outside Relay (the file watcher): the Pages tab reads which notes exist again, and an open page that
 *  holds another text than the file gets the file's, to merge. */
export async function noteChanged({ path, hash, relinked }: backend.NoteChange) {
  reload();
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
// the heading an Open on an embedded section asks for, until the page's editor has scrolled to it
const headings = new Map<string, string>();
const headingWatchers = new Set<(page: string) => void>();
/** The editor of `page` calls this when it is made, and when a heading is asked of a page already open: the heading to
 *  scroll to (and forget), or undefined. */
export const takeHeading = (page: string) => {
  const heading = headings.get(page);
  headings.delete(page);
  return heading;
};
export function onHeading(listener: (page: string) => void) {
  headingWatchers.add(listener);
  return () => void headingWatchers.delete(listener);
}
/** The marker a line to open at is kept under in `headings`: `LINE` + the line's number in the file. */
export const LINE = "\u0000line:";
/** The page `page` (a page key's target) scrolls to a line of its file, its editor's cursor there: in the middle of the
 *  window, or with `top` at its top (the rail's outline). */
export function revealLine(page: string, line: number, top = false) {
  headings.set(page, `${LINE}${line}${top ? ":top" : ""}`);
  headingWatchers.forEach(listener => listener(page));
}
/** A note of any workspace opened at a line (⌘K's content matches, a backlink): the editor puts its cursor there. */
export function openPageAtLine(folder: string, path: string, line: number) {
  revealLine(isMain(folder) ? path : `${folder}/${path}`, line);
  return openPageIn(folder, path);
}
/** A note a link, a tool call or a list names (a path, absolute or not, or a bare name looked for in every workspace,
 *  first in the one of what is open, else the one shown) as a page; a toast when no note has that name. With a
 *  `heading` the page opens at it. */
export function openNoteLink(link: string, heading = "") {
  const folder = workspaceOf(useNavigationStore.getState().selected) || activeFolder();
  const here = isMain(folder) ? "" : folder;
  const page = resolveNote(useWorkspaceStore.getState().notes, settings().vault, noteOf(link), here);
  if (!page) return void toast(t("page.notFound", { name: noteOf(link) }));
  if (heading) {
    headings.set(page, heading);
    headingWatchers.forEach(listener => listener(page));
  }
  return select(pageKey(page));
}
/** Ask Claude about a page: a new conversation in the page's workspace (its project's, when it is a project's note)
 *  with the note's path typed in. */
export function askAboutPage(path: string) {
  const key = newChatHere(pageProject(path)?.key ?? null);
  typeInto(key, `\`${abs(path)}\` `);
  return select(key);
}

/** The key of the project a note belongs to (its own note, or one in its folder), null for none. */
function noteProject(path: string) {
  const own = pageProject(path);
  if (own) return own.key;
  const { about } = placeOf(build().model, path.split("/").slice(0, -1).join("/"));
  return about
    ? (build()
        .model.contexts.flatMap(c => c.projects)
        .find(p => noteName(p.note) === about)?.key ?? null)
    : null;
}
/** A note of `folder` as a chip in the open conversation's composer: its absolute path, which the agent reads from
 *  wherever the conversation runs (a project's may run in its code repo).
 *  A conversation that runs in another workspace than the note's refuses. */
export async function mentionNote(path: string, folder = activeFolder()) {
  const { selected } = useNavigationStore.getState();
  const chat = useConversationsStore.getState().chats[selected];
  const other = chat ? chatVault(chat, useWorkspaceStore.getState().snap) !== folder : folder !== activeFolder();
  if (other) {
    toast(t("composer.noteOtherWorkspace"));
    return false;
  }
  await attachPaths([`${isMain(folder) ? useWorkspaceStore.getState().notes.root : folder}/${path}`]);
  return true;
}
/** The note an attached file is (it sits under a workspace and is markdown): its workspace folder and its path there. */
export function attachedNote(file: string) {
  const main = useWorkspaceStore.getState().notes.root;
  const found = noteIn(file, [main, ...vaultChoices(settings()).map(choice => choice.folder)]);
  return found && { folder: found.root === main ? settings().vault : found.root, path: found.path };
}
/** Add to conversation: the note as a chip in the open conversation when it is one of the note's project (or the note
 *  has none and it is a general one), else in a new conversation of the note's project. */
export async function addToConversation(path: string, folder = activeFolder()) {
  if (folder !== activeFolder()) return toast(t("composer.noteOtherWorkspace"));
  const { selected } = useNavigationStore.getState();
  const chat = useConversationsStore.getState().chats[selected];
  const project = noteProject(path);
  const here = chat && !chat.closed && selected !== ORCH && (chat.project ?? null) === project;
  if (!here) await select(newChatHere(project));
  await mentionNote(path, folder);
}

/** The notes Relay's conversations read and wrote this week: Recent in the Pages tab. */
export async function loadRecent() {
  try {
    const touches = await backend.noteTouches(7);
    set(draft => {
      draft.sidebar.touches = touches;
    });
  } catch (e) {
    console.error(e);
  }
}

/** Take notes off Recent (the notes stay as they are): until a conversation touches one again. Kept over a restart. */
function removeFromRecent(paths: string[] | null) {
  const root = rootOf();
  const { touches } = useNavigationStore.getState().sidebar;
  set(draft => {
    const gone = (draft.sidebar.recentRemoved[root] ??= {});
    for (const touch of touches)
      if (touch.root === root && (!paths || paths.includes(touch.path)))
        gone[touch.path] = Math.max(gone[touch.path] ?? 0, touch.at);
  });
  storage.set("recentRemoved", useNavigationStore.getState().sidebar.recentRemoved);
}
export const removeRecent = (path: string) => removeFromRecent([path]);
/** Clear: empty Recent. */
export const clearRecent = () => removeFromRecent(null);

// ---------- managing files: new page or folder, rename and move (links to it follow), duplicate, trash with Undo
/** The workspace shown's folder, and a path of it as an absolute one ("" is the folder itself). */
const rootOf = () => (isMain(activeFolder()) ? useWorkspaceStore.getState().notes.root : activeFolder());
export const abs = (path: string) => (path ? `${rootOf()}/${path}` : rootOf());
/** The workspace shown is shared on a relay-server: a delete there deletes for every member. */
export const sharedWorkspace = () => workspaces().find(workspace => workspace.active && workspace.team)?.name ?? "";
/** How many pages a folder of the workspace shown holds, at any depth (what Delete names). */
export const pagesIn = (folder: string) => workspacePaths().filter(path => path.startsWith(`${folder}/`)).length;
/** The name New page offers in `folder`: Untitled, or Untitled 1… when that one is there. */
export const freePageName = (folder: string) =>
  backend.freePageName(abs(folder), t("pages.untitled")).catch(() => t("pages.untitled"));
/** A project's own note can't be renamed or moved here: the project is keyed by its name. */
export const isProjectNote = (path: string) => !!pageProject(path);
/** Where a new note is asked for in `folder` of the workspace shown: the project and context it sits under. */
export const placeIn = (folder: string) => placeOf(build().model, folder);
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
    followFavourites(from, path);
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
/** Files into the workspace's .trash/ as one run, with one Undo that puts them all back. */
export async function trashPages(paths: string[], undone?: () => unknown) {
  const gone: Awaited<ReturnType<typeof backend.trashPath>>[] = [];
  try {
    for (const path of paths) gone.push(await backend.trashPath(abs(path)));
  } catch (e) {
    fail(e);
  }
  await loadSnapshot();
  if (!gone.length) return;
  toast(tn("garden.trashed", gone.length), () => {
    void Promise.all(gone.map(g => backend.restorePath(g.root, g.trash, g.path)))
      .then(loadSnapshot)
      .then(undone)
      .catch(fail);
  });
}
const noteLabel = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
export const revealPage = (path: string) => backend.openFile(abs(path), true).catch(fail);
export const copyPagePath = (path: string) => copy(abs(path));

// ---------- contexts and projects: a new context, a new project, a project's state, a project deleted with Undo
export const PROJECT_STATES = ["Active", "Blocked", "Quiet", "Paused"] as const;
/** The note types New project offers in the workspace shown (its templates). */
export const projectKinds = () => backend.projectKinds(activeFolder()).catch(() => ["Project"]);
/** A project of the workspace shown, by its key: where it sits in the Pages tree and its state. */
export function projectEntry(key: string) {
  for (const context of build().model.contexts) {
    const project = context.projects.find(p => p.key === key);
    if (project) {
      const state = useWorkspaceStore.getState().snap.projects.find(p => p.name === key)?.state ?? "";
      return { ...project, context: context.name, state };
    }
  }
  return null;
}
// another vault's project key is "name␟vault id": its note, its row and its card go by the first part
const nameOf = (key: string) => key.split("\u001f")[0];
/** A new context in the workspace shown; its note opens. */
export async function createContext(name: string) {
  try {
    const path = await backend.createContext(activeFolder(), name);
    await loadSnapshot();
    openPage(path);
  } catch (e) {
    fail(e);
  }
}
/** A new project in `context` of the workspace shown; its note opens. Returns its key, "" when it failed. */
export async function createProject(context: string, name: string, kind: string, state: string) {
  try {
    const path = await backend.createProject(activeFolder(), context, name, kind, state);
    await loadSnapshot();
    openPage(path);
    return pageProject(path)?.key ?? "";
  } catch (e) {
    fail(e);
    return "";
  }
}
export async function setProjectState(key: string, state: string) {
  try {
    await backend.setProjectState(activeFolder(), nameOf(key), state);
    await loadSnapshot();
  } catch (e) {
    fail(e);
  }
}
/** A project's folder (or its note, when it has no folder of its own) into the trash and its row out of work-state,
 *  with one Undo for both. Its conversations stay. */
export async function deleteProject(key: string) {
  const project = projectEntry(key);
  if (!project) return;
  const workspace = activeFolder();
  // a project named like its context would take the context's folder: then only its note goes
  const own = project.folder && !build().model.contexts.some(context => context.folder === project.folder?.path);
  const path = own ? project.folder!.path : project.note;
  const open = openPagePath();
  try {
    const gone = await backend.trashPath(abs(path));
    const row = await backend.projectRow(workspace, nameOf(key), project.context, null);
    await loadSnapshot();
    if (open === path || open.startsWith(`${path}/`)) select(VIEW.wait);
    const shared = sharedWorkspace();
    toast(
      shared
        ? t("pages.trashedShared", { name: project.label, workspace: shared })
        : t("pages.trashed", { name: project.label }),
      () => {
        void backend
          .restorePath(gone.root, gone.trash, gone.path)
          // "" puts nothing back but reads the index again (a vault of cards)
          .then(() => backend.projectRow(workspace, nameOf(key), project.context, row ?? ""))
          .then(loadSnapshot)
          .catch(fail);
      },
    );
  } catch (e) {
    fail(e);
  }
}
