import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import {
  newView,
  readView,
  type CollectionId,
  type Filter,
  type Row,
  type Sort,
  type View,
} from "../../domain/collections/rules";
import {
  frontmatterOf,
  readProperties,
  setProperty,
  withFrontmatter,
  type PropertyValue,
} from "../../domain/workspace/properties";
import { COLLECTION_VIEW } from "../../domain/navigation/views";
import { select, toast } from "../navigation/navigation";
import { noteTarget } from "../navigation/pages";
import { activeFolder } from "../navigation/workspaces";
import { loadLinked } from "../navigation/linked";
import { useCollectionsStore } from "./store";

// Collections (K8, K9): the notes of a workspace as a table or a board over their frontmatter. Opening one reads the
// index; a cell edited or a card dropped writes that one note's frontmatter and nothing else (the file's other bytes
// stay as they were, and the write is refused when the file changed since it was read). A person's own edit is not a
// Claude job, so it is not in the Changes feed.
const set = useCollectionsStore.setState;
const st = () => useCollectionsStore.getState();

/** The workspace's notes with their values, read again; the store only changes when they did. */
export async function loadRows(folder = activeFolder()) {
  try {
    const rows = await backend.notesCollection(folder);
    if (JSON.stringify(st().rows[folder]) === JSON.stringify(rows)) return;
    set(draft => {
      draft.rows[folder] = rows;
    });
  } catch (e) {
    console.error(e);
  }
}
/** The saved views of the workspace, read again from `.relay/views`. */
export async function loadViews(folder = activeFolder()) {
  try {
    const list = await backend.viewsList(folder);
    const views = list.flatMap(item => {
      const view = readView(item.view);
      return view ? [{ name: item.name, view }] : [];
    });
    set(draft => {
      draft.views[folder] = views;
    });
  } catch (e) {
    console.error(e);
  }
}

/** Open a built-in collection (Meetings in a context, About a project, …) in the middle column. */
export async function openCollection(collection: CollectionId, context = "", filters: Filter[] = []) {
  set(draft => {
    draft.view = newView(collection, context, filters);
    draft.name = "";
  });
  await select(COLLECTION_VIEW);
  void loadRows();
  void loadViews();
}
/** Open a saved view with its filters and sort. */
export async function openView(name: string) {
  const saved = st().views[activeFolder()]?.find(v => v.name === name);
  if (!saved) return;
  set(draft => {
    draft.view = structuredClone(saved.view);
    draft.name = name;
  });
  await select(COLLECTION_VIEW);
  void loadRows();
}

const change = (f: (view: View) => void) =>
  set(draft => {
    f(draft.view);
  });
export const setLayout = (layout: View["layout"]) => change(v => void (v.layout = layout));
export const setSort = (sort: Sort | null) => change(v => void (v.sort = sort));
export const setGroup = (group: string) => change(v => void (v.group = group));
export const addFilter = (filter: Filter) =>
  change(v => void (v.filters = [...v.filters.filter(f => f.key !== filter.key), filter]));
export const removeFilter = (key: string) => change(v => void (v.filters = v.filters.filter(f => f.key !== key)));

/** Save the view as `.relay/views/<name>.json`: the layout, filters, sort and grouping it has now. */
export async function saveView(name: string) {
  const folder = activeFolder();
  const view = st().view;
  try {
    await backend.viewSave(folder, name, view);
    set(draft => {
      draft.name = name;
    });
    await loadViews(folder);
  } catch (e) {
    toast(String(e));
  }
}
export async function deleteView(name: string) {
  const folder = activeFolder();
  try {
    await backend.viewDelete(folder, name);
    set(draft => {
      if (draft.name === name) draft.name = "";
    });
    await loadViews(folder);
  } catch (e) {
    toast(String(e));
  }
}

/** The note's frontmatter lines for a key, read now: what its cell edits (null while the note has no such key). */
export async function readCell(path: string, key: string) {
  const note = (await backend.readNote(noteTarget(activeFolder(), path))) as { text: string };
  return readProperties(frontmatterOf(note.text) ?? "")?.find(p => p.key === key) ?? null;
}

/** Set one property of one note (`null` removes its value): the note is read, only the key's own lines in its
 *  frontmatter are rewritten, and the file is written back unless it changed since the read ("changed" then shows as a
 *  toast and the rows are read again). */
export async function setCell(path: string, key: string, value: PropertyValue) {
  const folder = activeFolder();
  const target = noteTarget(folder, path);
  try {
    const note = (await backend.readNote(target)) as { text: string; hash: string };
    const yaml = frontmatterOf(note.text) ?? "";
    const next = setProperty(yaml, key, value);
    if (next === yaml) {
      if (value !== null) toast(t("coll.cantEdit", { key }));
      return;
    }
    await backend.writeNote(target, withFrontmatter(note.text, next), note.hash, false);
    await loadRows(folder);
    void loadLinked(folder); // its about: or context: may have changed
  } catch (e) {
    toast(String(e) === "changed" ? t("coll.changed") : String(e));
    await loadRows(folder);
  }
}
/** A card dropped on a lane: the lane's value written to the key. */
export const moveCard = (path: string, key: string, value: string) => setCell(path, key, value);

export const rowsOf = (folder: string): Row[] => st().rows[folder] ?? [];
export { useCollectionsStore };
