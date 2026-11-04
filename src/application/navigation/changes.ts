import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { openCount, undoMerge, type Change, type Merge } from "../../domain/workspace/changes";
import { makeStore } from "../make-store";
import { toast } from "./navigation";

// The Changes feed (changes.rs): what Relay-run Claude jobs wrote to a workspace, per workspace folder, for review.
// Keep marks a note as read; Undo puts it back, or, when the note was edited since, offers the merge of both.

/** A note whose Undo found a later edit: the three texts, and what taking the job's change out of the edit gives
 *  (null when the same lines were edited: only Keep mine is offered). */
export type Pending = { merge: Merge; merged: string | null };
export const useChangesStore = makeStore<{
  by: Record<string, Change[]>;
  open: boolean;
  /** by `<id>\n<path>` */
  merging: Record<string, Pending>;
}>(() => ({ by: {}, open: false, merging: {} }));
const set = useChangesStore.setState;

/** A workspace's feed, read again. */
export async function loadChanges(folder: string) {
  try {
    const list = await backend.changesList(folder);
    if (JSON.stringify(useChangesStore.getState().by[folder]) === JSON.stringify(list)) return;
    set(draft => {
      draft.by[folder] = list;
    });
  } catch (e) {
    console.error(e);
  }
}
/** Entries still to review in a workspace. */
export const toReview = (folder: string) => openCount(useChangesStore.getState().by[folder] ?? []);
export const setChangesOpen = (open: boolean) =>
  set(draft => {
    draft.open = open;
  });
/** Every workspace the feed was read for, again: a job finished. */
export const reloadChanges = () => Object.keys(useChangesStore.getState().by).forEach(loadChanges);

const failed = (e: unknown) => toast(String(e));
/** Keep one note of an entry, or all of its open ones. */
export async function keepChange(folder: string, id: string, path: string | null = null) {
  try {
    await backend.changeKeep(folder, id, path);
    set(draft => {
      for (const key of Object.keys(draft.merging))
        if (key.startsWith(`${id}\n`) && (!path || key === `${id}\n${path}`)) delete draft.merging[key];
    });
  } catch (e) {
    failed(e);
  }
  await loadChanges(folder);
}
/** Undo one note of an entry. A note edited since is not touched: its merge shows in the feed to apply. */
export async function undoChange(folder: string, id: string, path: string) {
  try {
    const out = await backend.changeUndo(folder, id, path);
    if (out.merge) {
      const merge = { current: out.current, before: out.before, after: out.after };
      set(draft => {
        draft.merging[`${id}\n${path}`] = { merge, merged: undoMerge(merge) };
      });
    }
  } catch (e) {
    failed(e);
  }
  await loadChanges(folder);
}
/** Write the merge shown for a note. */
export async function applyMerge(folder: string, id: string, path: string) {
  const pending = useChangesStore.getState().merging[`${id}\n${path}`];
  if (pending?.merged == null) return;
  try {
    await backend.changeResolve(folder, id, path, pending.merge.current, pending.merged);
    set(draft => {
      delete draft.merging[`${id}\n${path}`];
    });
  } catch (e) {
    // "changed": edited again while the merge was shown: Undo again for a fresh one
    failed(e === "changed" ? t("changes.editedAgain") : e);
    set(draft => {
      delete draft.merging[`${id}\n${path}`];
    });
  }
  await loadChanges(folder);
}

/** A page action: Claude does the job in the background and the result lands in the feed. */
export async function runPageAction(folder: string, path: string, action: string, selection: string | null) {
  toast(t("changes.working", { name: path.split("/").pop()!.replace(/\.md$/, "") }), undefined, "", 4000);
  try {
    await backend.pageAction(folder, path, action, selection);
  } catch (e) {
    failed(e);
  }
  await loadChanges(folder);
}
