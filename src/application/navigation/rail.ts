import { pageKey } from "../../domain/navigation/keys";
import { linkMention, touchedBy, type RailData, type RailNote } from "../../domain/workspace/rail";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { t } from "../../shared/i18n";
import { label } from "../conversations/selectors";
import { useConversationsStore } from "../conversations/store";
import { makeStore } from "../make-store";
import { settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { toast } from "./navigation";
import { loadRecent } from "./pages";
import { useNavigationStore } from "./store";
import { workspaceOf } from "./workspaces";

// The right rail of a page (K2): what the backend found for the note (backlinks, unlinked mentions, related), computed
// when the page opens and when it is saved, never per keystroke. Whether the rail is shown is kept per workspace over a
// restart; the conversations beside it are the touches Recent reads.
type RailState = { by: Record<string, RailData>; closed: Record<string, boolean> };
const CLOSED = "railClosed";
export const useRailStore = makeStore<RailState>(() => ({ by: {}, closed: storage.get(CLOSED, {}) }));
const set = useRailStore.setState;
export const railKey = (folder: string, path: string) => `${folder}\u001f${path}`;

/** A page's workspace and its path in it, from the page's key target (the main vault's are relative, another's absolute). */
export function railNote(page: string) {
  const folder = workspaceOf(pageKey(page));
  return { folder, path: folder === settings().vault ? page : page.slice(folder.length + 1) };
}
/** The rail's data for a note, once loaded. */
export const railOf = (folder: string, path: string) => useRailStore.getState().by[railKey(folder, path)];

/** Ask the backend for the note's rail again, and the touches with it. The store only changes when the answer did. */
export async function loadRail(folder: string, path: string) {
  void loadRecent();
  try {
    const data = await backend.noteRail(folder, path);
    if (JSON.stringify(railOf(folder, path)) === JSON.stringify(data)) return;
    set(draft => {
      draft.by[railKey(folder, path)] = data;
    });
  } catch (e) {
    console.error(e);
  }
}

/** Whether the workspace's pages show the rail (open until closed). */
export const railOpen = (folder: string) => !useRailStore.getState().closed[folder];
export function setRail(folder: string, open: boolean) {
  set(draft => {
    if (open) delete draft.closed[folder];
    else draft.closed[folder] = true;
  });
  storage.set(CLOSED, useRailStore.getState().closed);
}

/** The conversations that read or wrote the note this week, newest first. A conversation that is gone is left out. */
export function railConversations(folder: string, path: string) {
  const root = folder === settings().vault ? useWorkspaceStore.getState().notes.root : folder;
  const chats = useConversationsStore.getState().chats;
  return touchedBy(useNavigationStore.getState().sidebar.touches, root, path)
    .filter(touch => chats[touch.key])
    .map(touch => ({ key: touch.key, label: label(touch.key), at: touch.at, kind: touch.kind }));
}

/** Link on an unlinked mention: the plain words in the other note become a wikilink to `name`, written like any other
 *  save (read, change the line, write with the hash it was read with). The rail is read again, where the note now
 *  stands under Backlinks. */
export async function linkUnlinked(folder: string, note: string, mention: RailNote, name: string) {
  const full = folder === settings().vault ? mention.p : `${folder}/${mention.p}`;
  try {
    const read = (await backend.readNote(full)) as { text: string; hash: string };
    const text = linkMention(read.text, mention.line, mention.hit, name);
    if (text === null) toast(t("rail.linkGone", { note: mention.t }));
    else await backend.writeNote(full, text, read.hash, false);
  } catch (e) {
    toast(String(e) === "changed" ? t("rail.linkChanged", { note: mention.t }) : String(e));
  }
  await loadRail(folder, note);
}
