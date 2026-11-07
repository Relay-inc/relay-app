import shipped from "../../../src-tauri/resources/default-vault/.relay/types.json?raw";

// The type registry (src-tauri/src/types.rs): what each note type is, read from the vault's `.relay/types.json`, the
// shipped one (the starter vault's) when it has none. Collections take their columns and sort from it, Properties
// the editor of a type's keys.

/** text, a date, one of `values`, a [[link]] to a note of a `target` type, a list of links to `target` notes, true/false */
export type FieldKind = "text" | "date" | "select" | "link" | "people" | "check";
export type TypeField = { key: string; kind: FieldKind; values?: string[]; target?: string[] };
/** A note type: `home` a homes key (src-tauri/src/homes.rs), `template` relative to the vault, `columns` and `sort` its
 *  collection's defaults. */
export type NoteType = {
  name: string;
  home?: string;
  template?: string;
  required?: string[];
  fields?: TypeField[];
  columns?: string[];
  sort?: { key: string; dir: "asc" | "desc" };
};
export type Registry = { types: NoteType[] };

/** The registry the app ships, until a workspace's own is read. */
export const SHIPPED: Registry = JSON.parse(shipped);

/** A type by the name a note gives in `type:` (any case). */
export const typeOf = (registry: Registry, name: string): NoteType | undefined =>
  registry.types.find(t => t.name.toLowerCase() === name.trim().toLowerCase());
