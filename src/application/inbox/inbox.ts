import * as backend from "../../infrastructure/backend";
import { t, tn } from "../../shared/i18n";
import { keeps, folderList } from "../../domain/inbox/rules";
import { useInboxStore } from "./store";
import { toast } from "../navigation/navigation";
import { workspacePaths } from "../navigation/pages";
import { activeFolder } from "../navigation/workspaces";
import { loadChanges, undoChange, useChangesStore } from "../navigation/changes";
import { loadNotes } from "../workspace/vault";

// The Inbox (src-tauri/src/inbox.rs): notes dropped in by quick capture or the notes drawer, filed one by one. File
// with Claude asks for a proposal per note and writes nothing; Accept moves the note with its frontmatter and links
// through the backend, and the writes are one entry in the Changes feed, which is where each filing is undone.
const set = useInboxStore.setState;
const st = () => useInboxStore.getState();

/** The Inbox of a workspace, read again. */
export async function loadInboxNotes(folder = activeFolder()) {
  try {
    const list = await backend.inboxList(folder);
    if (JSON.stringify(st().notes[folder]) === JSON.stringify(list)) return;
    set(draft => {
      draft.notes[folder] = list;
      // a proposal for a note that is gone (filed elsewhere, deleted) goes with it
      const proposal = draft.proposal[folder];
      if (proposal) proposal.items = proposal.items.filter(item => list.some(note => note.path === item.path));
    });
  } catch (e) {
    console.error(e);
  }
}
/** Something wrote to the Inbox from outside this view (quick capture): every reader asks again. */
export async function inboxChanged() {
  set(draft => {
    draft.version++;
  });
  await loadNotes();
  await loadInboxNotes();
}

/** File with Claude: a proposal for every note of the Inbox. Nothing is written. */
export async function fileWithClaude() {
  const folder = activeFolder();
  if (st().busy) return;
  set(draft => {
    draft.busy = "propose";
    draft.edit = null;
    draft.skipped = [];
  });
  try {
    const answer = await backend.inboxPropose(folder);
    set(draft => {
      draft.proposal[folder] = answer;
    });
  } catch (e) {
    toast(String(e));
  } finally {
    set(draft => {
      draft.busy = "";
    });
  }
}

export function skip(path: string) {
  set(draft => {
    const proposal = draft.proposal[activeFolder()];
    if (proposal) proposal.items = proposal.items.filter(item => item.path !== path);
    if (!draft.skipped.includes(path)) draft.skipped.push(path);
  });
}

export function editDest(path: string) {
  const item = st().proposal[activeFolder()]?.items.find(x => x.path === path);
  if (!item) return;
  set(draft => {
    draft.edit = { path, dest: item.dest };
  });
  void typeHome(item.type);
}
export const pickDest = (dest: string) =>
  set(draft => {
    if (draft.edit) draft.edit.dest = dest;
  });
export const cancelEdit = () =>
  set(draft => {
    draft.edit = null;
  });
/** The folder picked becomes the proposal's; Keep in Inbox/ leaves the note. */
export function saveEdit() {
  const edit = st().edit;
  set(draft => {
    const item = draft.proposal[activeFolder()]?.items.find(x => x.path === draft.edit?.path);
    if (item && draft.edit) item.dest = draft.edit.dest;
    draft.edit = null;
  });
  return edit;
}

/** The home of a note type in the workspace shown (meeting, daily and thread have one), read once. */
export async function typeHome(kind: string) {
  const folder = activeFolder();
  const key = homeKey(kind);
  if (!kind || key in st().home) return;
  const home = await backend.inboxHome(folder, kind).catch(() => null);
  set(draft => {
    draft.home[key] = home;
  });
}
export const homeKey = (kind: string) => `${activeFolder()}\n${kind.toLowerCase()}`;
/** The folders a note may be filed into, of the workspace shown. */
export const folders = () => folderList(workspacePaths());

/** Accept these notes' proposals (a note whose folder is Keep in Inbox/ is left). The toast undoes the filing. */
export async function accept(paths: string[]) {
  const folder = activeFolder();
  const items = (st().proposal[folder]?.items ?? []).filter(item => paths.includes(item.path) && !keeps(item));
  if (!items.length || st().busy) return;
  set(draft => {
    draft.busy = "accept";
    draft.edit = null;
  });
  try {
    const { filed, failed } = await backend.inboxAccept(folder, items);
    set(draft => {
      const proposal = draft.proposal[folder];
      if (proposal) proposal.items = proposal.items.filter(item => !filed.some(f => f.path === item.path));
    });
    await Promise.all([loadNotes(), loadInboxNotes(folder), loadChanges(folder)]);
    if (failed.length) toast(t("inbox.failed", { name: failed[0].path.split("/").pop() ?? "", why: failed[0].error }));
    else if (filed.length)
      toast(tn("inbox.filed", filed.length), () => void undoFiling(folder, filed.length), t("toast.undo"));
  } catch (e) {
    toast(String(e));
  } finally {
    set(draft => {
      draft.busy = "";
    });
  }
}
/** Every note the newest Inbox entry of the feed still holds open, back as it was. */
async function undoFiling(folder: string, count: number) {
  const entry = (useChangesStore.getState().by[folder] ?? []).find(c => c.source === "inbox");
  if (!entry) return;
  for (const file of entry.files.filter(f => f.state === "open")) await undoChange(folder, entry.id, file.path);
  await Promise.all([loadNotes(), loadInboxNotes(folder)]);
  toast(tn("inbox.undone", count));
}
/** Accept all: every proposal that moves its note. */
export const acceptAll = () => accept((st().proposal[activeFolder()]?.items ?? []).map(item => item.path));

export { useInboxStore };
