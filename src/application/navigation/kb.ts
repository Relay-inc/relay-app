import type { PageSort } from "../../domain/navigation/pages";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { loadSnapshot } from "../workspace/vault";
import { makeStore } from "../make-store";
import { toast } from "./navigation";
import { openPage, togglePage } from "./pages";
import { activeFolder } from "./workspaces";

// The knowledge base's note tools: New ▸ from a template, Today's note, ⌘K's search and a folder's sort.
export const useKbStore = makeStore<{
  templates: Record<string, string[]>; // the names in Resources/Templates, per workspace folder
  times: Record<string, Record<string, number>>; // when each note last changed (seconds), per workspace folder
  sorts: Record<string, PageSort>; // per folder, `<workspace>|<folder>`; kept over a restart
}>(() => ({ templates: {}, times: {}, sorts: storage.get("pagesSort", {}) }));
const set = useKbStore.setState;

/** The templates New ▸ offers in the workspace shown. */
export async function loadTemplates(folder = activeFolder()) {
  try {
    const list = await backend.noteTemplates(folder);
    set(draft => {
      draft.templates[folder] = list;
    });
  } catch (e) {
    console.error(e);
  }
}
export const templatesOf = (folder = activeFolder()) => useKbStore.getState().templates[folder] ?? [];

/** Where a new note is asked for: a folder, and the project and context that folder is under. */
export type Place = { folder: string; about: string; context: string };
/** A note from a template: in its type's home (a meeting under Calendar/Meetings/<year>/), else in the folder it was
 *  asked in, with `about:` and `context:` from that place. It opens. */
export async function newFromTemplate(template: string, place: Place) {
  try {
    const path = await backend.newFromTemplate(activeFolder(), template, place.folder, place.about, place.context);
    await loadSnapshot();
    if (place.folder) togglePage(place.folder, true);
    openPage(path);
  } catch (e) {
    toast(String(e));
  }
}
/** Today's note: opens the one that is there, makes it once when it is not. */
export async function openDailyNote() {
  try {
    const path = await backend.dailyNote(activeFolder());
    await loadSnapshot();
    openPage(path);
  } catch (e) {
    toast(String(e));
  }
}

export type { ContentHit, NameHit } from "../../infrastructure/backend";
/** ⌘K's notes for a typed query in a workspace. An empty query only has the backend bring its index up to date. */
export const findNotes = (folder: string, query: string) => backend.findNotes(folder, query);

// ---------- a folder's sort
const sortKey = (folder: string) => `${activeFolder()}|${folder}`;
export const sortOf = (folder: string): PageSort => useKbStore.getState().sorts[sortKey(folder)] ?? "name";
/** Whether any folder of the workspace shown is sorted by modified (the times are only read then). */
export const sortsByModified = () =>
  Object.entries(useKbStore.getState().sorts).some(
    ([key, sort]) => sort === "modified" && key.startsWith(`${activeFolder()}|`),
  );
export function setSort(folder: string, sort: PageSort) {
  set(draft => {
    if (sort === "name") delete draft.sorts[sortKey(folder)];
    else draft.sorts[sortKey(folder)] = sort;
  });
  storage.set("pagesSort", useKbStore.getState().sorts);
  if (sort === "modified") void loadTimes();
}
/** When each note of the workspace shown last changed. */
export async function loadTimes(folder = activeFolder()) {
  try {
    const times = await backend.noteTimes(folder);
    set(draft => {
      draft.times[folder] = times;
    });
  } catch (e) {
    console.error(e);
  }
}
export const timesOf = () => useKbStore.getState().times[activeFolder()] ?? {};
