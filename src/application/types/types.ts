import * as backend from "../../infrastructure/backend";
import { SHIPPED, typeOf, type Registry } from "../../domain/types/registry";
import { plural } from "../../domain/types/header";
import { noteName } from "../../domain/navigation/pages";
import { loadRows } from "../collections/collections";
import { templatesOf } from "../navigation/kb";
import { workspacePaths } from "../navigation/pages";
import { loadSnapshot } from "../workspace/vault";
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

/** The template a note of `type` is made from (its registry `template`, else one named after it), when the workspace
 *  has it: what a link picker's "Create <type>" needs. */
export function templateOf(folder: string, type: string) {
  const file = typeOf(registryOf(folder), type)?.template?.split("/").pop()?.replace(/\.md$/, "") ?? type;
  return templatesOf(folder).includes(file) ? file : null;
}

/** A link picker's "Create <type> '<name>'": the note from the type's template, in its home when the type has one,
 *  else beside the note's context, under People/ for a person (`Contexts/Northwind/People/Jane Doe.md`), the type's
 *  plural otherwise. Returns the new note's name, to link. */
export async function createLinked(folder: string, type: string, name: string, context: string) {
  const template = templateOf(folder, type);
  if (!template) throw new Error(`no template for ${type}`);
  const home = workspacePaths(folder).find(p => noteName(p).toLowerCase() === context.toLowerCase());
  const dir = [home?.split("/").slice(0, -1).join("/"), plural(type)].filter(Boolean).join("/");
  const path = await backend.newFromTemplate(folder, template, dir, "", context, name);
  await loadSnapshot();
  void loadRows(folder);
  return noteName(path);
}
