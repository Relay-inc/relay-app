import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// the conversations keep Sets (unseen, dismissed, …): Immer drafts them too
enableMapSet();

type AnyStore = UseBoundStore<StoreApi<object>>;
/** Every store made so far, in the order their modules loaded: `useDerived` (ui/hooks) subscribes to all of them. */
export const stores: AnyStore[] = [];

// the stores a read looked at while it ran, with the state it saw: `tracked` sets the slot, getState fills it
let reading: Map<AnyStore, object> | null = null;
/** Run a read and say which stores' state it read (and which state), so it only needs running again when one of
 *  those changed. */
export function tracked<T>(read: () => T): { value: T; deps: Map<AnyStore, object> } {
  const outer = reading;
  const deps = new Map<AnyStore, object>();
  reading = deps;
  try {
    return { value: read(), deps };
  } finally {
    reading = outer;
  }
}
/** Whether every store a read depended on still holds the state it saw. */
export const unchanged = (deps: Map<AnyStore, object>) => {
  for (const [store, state] of deps) if (store.getState() !== state) return false;
  return true;
};

/** A context's store: Zustand with Immer, so a use case writes `setState(draft => { draft.x = … })` and every
 *  untouched branch keeps its identity (selectors and memo work). Components only select from it. */
export const makeStore = <T extends object>(initial: () => T) => {
  const store = create<T>()(immer(() => initial()));
  const any = store as unknown as AnyStore;
  const read = store.getState;
  store.getState = () => {
    const state = read();
    reading?.set(any, state);
    return state;
  };
  stores.push(any);
  return store;
};
