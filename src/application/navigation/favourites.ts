import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { toast } from "./navigation";
import { activeFolder } from "./workspaces";

// The notes pinned above Recent in the Pages tab, per workspace folder. The backend keeps them in the workspace's
// `.relay/config.json` (relay_config.rs), so they survive a restart and travel with the vault.
export const useFavouritesStore = makeStore<{ by: Record<string, string[]> }>(() => ({ by: {} }));
const set = useFavouritesStore.setState;

/** The pinned notes of the workspace shown (paths of it), read from its config. */
export async function loadFavourites(folder = activeFolder()) {
  try {
    const list = await backend.favourites(folder);
    if (JSON.stringify(useFavouritesStore.getState().by[folder]) === JSON.stringify(list)) return;
    set(draft => {
      draft.by[folder] = list;
    });
  } catch (e) {
    console.error(e);
  }
}
/** The pinned notes of the workspace shown, in the order they were pinned. */
export const favouritesOf = (folder = activeFolder()) => useFavouritesStore.getState().by[folder] ?? [];
export const isFavourite = (path: string) => favouritesOf().includes(path);

async function save(folder: string, list: string[]) {
  const before = favouritesOf(folder);
  set(draft => {
    draft.by[folder] = list;
  });
  try {
    const kept = await backend.setFavourites(folder, list);
    set(draft => {
      draft.by[folder] = kept;
    });
  } catch (e) {
    set(draft => {
      draft.by[folder] = before;
    });
    toast(String(e));
  }
}
/** Pin a note, or unpin it when it is. */
export const toggleFavourite = (path: string) => {
  const list = favouritesOf();
  return save(activeFolder(), list.includes(path) ? list.filter(p => p !== path) : [...list, path]);
};
/** A pinned note or folder was renamed or moved: its pin follows. */
export function followFavourites(from: string, to: string) {
  const list = favouritesOf();
  const next = list.map(p => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p));
  if (next.some((p, i) => p !== list[i])) void save(activeFolder(), next);
}
