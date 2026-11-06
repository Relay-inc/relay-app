// The note types of the workspace shown, as Rust resolves them (src-tauri/src/types.rs: the defaults in
// resources/types.json with the vault's `types` on top). There is no second copy here: until the registry is read
// there are no types, and a property is typed by its value alone.

export type FieldKind = "text" | "date" | "select" | "link" | "people" | "check";
export type Field = { key: string; kind: FieldKind; values?: string[]; target?: string };
/** A collection's default view of a type; `rest` takes every typed note no other collection does. */
export type TypeCollection = {
  id: string;
  rest?: boolean;
  columns: { key: string; kind: string }[];
  sort: { key: string; dir: "asc" | "desc" };
  board: string;
  derived: string[];
};
export type NoteType = {
  name: string;
  aliases?: string[];
  /** a key of `homes` (src-tauri/src/homes.rs) */
  home?: string;
  template?: string;
  required?: string[];
  fields: Field[];
  collection?: TypeCollection;
};

let types: NoteType[] = [];
export const setTypes = (next: NoteType[]) => {
  types = next;
};
export const noteTypes = () => types;

/** The type a `type:` value names (name or alias, any case). */
export const typeOf = (kind: string) => {
  const k = kind.toLowerCase();
  return types.find(t => t.name.toLowerCase() === k || t.aliases?.includes(k));
};
/** What the registry says about `key` for a note of type `kind`; undefined when it does not know. */
export const fieldOf = (kind: string, key: string) => typeOf(kind)?.fields.find(f => f.key === key);
