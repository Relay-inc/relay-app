import type { DraftsState } from "../../domain/conversations/state";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

/** The composer's drafts (domain/conversations/state.ts): its own small store, so typing changes nothing the
 *  conversation reads depend on. `typed` is stored under `typed`, as before the split. */
export const useDraftsStore = makeStore<DraftsState>(() => ({
  typed: storage.get<Record<string, string>>("typed", {}),
  attached: [],
  files: [],
  machine: {},
  vault: {},
}));
// typed in another Relay window
storage.watch("typed", () =>
  useDraftsStore.setState(draft => {
    draft.typed = storage.get<Record<string, string>>("typed", {});
  }),
);
/** What is typed in a conversation's composer, "" for nothing. */
export const typedOf = (key: string) => useDraftsStore.getState().typed[key] ?? "";
