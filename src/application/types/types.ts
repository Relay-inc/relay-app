import * as backend from "../../infrastructure/backend";
import { SHIPPED, type Registry } from "../../domain/types/registry";
import { makeStore } from "../make-store";

// The type registry per workspace folder (domain/types/registry.ts), read from the workspace's `.relay/types.json`.
const useTypesStore = makeStore<{ byFolder: Record<string, Registry> }>(() => ({ byFolder: {} }));

/** The workspace's registry, read again; the store only changes when it did. */
export async function loadTypes(folder: string) {
  try {
    const registry = await backend.noteTypes(folder);
    if (JSON.stringify(useTypesStore.getState().byFolder[folder]) === JSON.stringify(registry)) return;
    useTypesStore.setState(draft => {
      draft.byFolder[folder] = registry;
    });
  } catch (e) {
    console.error(e);
  }
}

/** The registry of a workspace: the shipped one until its own is read (`loadTypes`). */
export const registryOf = (folder: string): Registry => useTypesStore.getState().byFolder[folder] ?? SHIPPED;
