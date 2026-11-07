import { linkedTo, type LinkedGroups, type LinkedNote } from "../../domain/workspace/linked";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { activeFolder } from "./workspaces";

// What points at a project or a context (`about:`, `context:`, `with:`), per workspace folder: the Pages tree's virtual
// groups and a project page's auto sections read it. The index follows the folder by mtime, so reading it again after
// a save or a watcher batch is cheap.
// `icons`: the notes with an `icon:` (issue 427), {path: icon}, for the Pages tree's rows; read along, on the same moments.
export const useLinkedStore = makeStore<{
  by: Record<string, LinkedNote[]>;
  icons: Record<string, Record<string, string>>;
}>(() => ({ by: {}, icons: {} }));
const set = useLinkedStore.setState;

/** The notes of the workspace shown that point somewhere, and their icons, read again; the store only changes when they
 *  did. */
export async function loadLinked(folder = activeFolder()) {
  void loadIcons(folder);
  try {
    const notes = await backend.notesLinked(folder);
    if (JSON.stringify(useLinkedStore.getState().by[folder]) === JSON.stringify(notes)) return;
    set(draft => {
      draft.by[folder] = notes;
    });
  } catch (e) {
    console.error(e);
  }
}

async function loadIcons(folder: string) {
  try {
    const icons = await backend.noteIcons(folder);
    if (JSON.stringify(useLinkedStore.getState().icons[folder]) === JSON.stringify(icons)) return;
    set(draft => {
      draft.icons[folder] = icons;
    });
  } catch (e) {
    console.error(e);
  }
}

/** What points at `name` in the workspace shown, outside the folder `inside`; `apart`: projects in a group of their own
 *  (a context's). */
export const linkedOf = (name: string, inside = "", apart = false): LinkedGroups =>
  linkedTo(useLinkedStore.getState().by[activeFolder()] ?? [], name, inside, apart);
