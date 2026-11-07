import { frontmatterOf, typed, type Property } from "../workspace/properties.ts";
import type { RailNote } from "../workspace/rail.ts";
import { typeOf, type NoteType, type Registry, type TypeField } from "./registry.ts";

// A typed note's page header (issue 419): its type's fields in the registry's order, each with the editor its kind
// gives, a required one the note lacks as an empty slot to fill; the keys the type does not know stay below as plain
// properties. And its backlinks grouped by the typed field they come through.

/** A field of the header: `row` its value and editor, `missing` a required field that is empty or not there. */
export type Slot = { field: TypeField; row: Property; missing: boolean };
export type Header = { type: NoteType; slots: Slot[]; rest: Property[]; absent: TypeField[] };

const empty = (row: Property) =>
  row.value === null || row.value === "" || (Array.isArray(row.value) && !row.value.length);

/** The keys the breadcrumb is made of: where a note belongs. Empty, on a type that requires a context, they are slots
 *  to fill like a required key. */
const PLACE = ["context", "about"];

/** The header of a note from its frontmatter rows: null when it has no `type:` or one the registry does not know (it
 *  shows its properties as before). `slots` are the type's fields it has plus the ones it lacks that are required or
 *  place it (`context:`, `about:`), those as `missing`; `rest` the
 *  keys outside the type (not `type:` itself), `absent` the type's other fields, what "Add property" offers first. */
export function headerOf(rows: Property[], registry: Registry): Header | null {
  const name = rows.find(row => row.key === "type")?.value;
  const type = typeof name === "string" ? typeOf(registry, name) : undefined;
  if (!type) return null;
  // a type that must sit in a context (Meeting, Document) also wants its project; a Person or a Reference does not
  const placed = type.required?.includes("context") ? PLACE.filter(key => type.fields?.some(f => f.key === key)) : [];
  const required = [...new Set([...(type.required ?? []), ...placed])];
  const fields = [
    ...(type.fields ?? []),
    ...(type.required ?? [])
      .filter(key => !type.fields?.some(f => f.key === key))
      .map(key => ({ key, kind: "text" as const })),
  ];
  const lacking = fields.filter(f => required.includes(f.key) && !rows.some(row => row.key === f.key));
  const all = typed([...rows, ...lacking.map(f => ({ key: f.key, value: null, kind: "text" as const }))], registry);
  const slots = fields.flatMap(field => {
    const row = all.find(r => r.key === field.key);
    return row ? [{ field, row, missing: required.includes(field.key) && empty(row) }] : [];
  });
  return {
    type,
    slots,
    rest: all.filter(row => row.key !== "type" && !fields.some(f => f.key === row.key)),
    absent: fields.filter(f => !slots.some(s => s.field.key === f.key)),
  };
}

/** The `type:` a note's text (or its head) gives, "" when none. */
export const typeNameOf = (text: string) =>
  /^type:[ \t]*["']?([^"'\n]*)/m.exec(frontmatterOf(text) ?? "")?.[1].trim() ?? "";

/** A type's name for many of its notes: Meetings, People. */
export const plural = (name: string) => (name.toLowerCase() === "person" ? "People" : `${name}s`);

/** A group of backlinks: the notes of type `kind` whose field `key` links here. */
export type Relation = { kind: string; key: string; notes: RailNote[] };
/** The backlinks that come through a typed field (a link or people field of the linking note's type, `f` from the
 *  backend) grouped by type and field, in the order they first come; the others stay plain backlinks. */
export function relations(backlinks: RailNote[], registry: Registry): { groups: Relation[]; rest: RailNote[] } {
  const groups: Relation[] = [];
  const rest: RailNote[] = [];
  for (const note of backlinks) {
    const type = note.f ? typeOf(registry, note.k) : undefined;
    const field = type?.fields?.find(f => f.key === note.f && (f.kind === "link" || f.kind === "people"));
    if (!type || !field) {
      rest.push(note);
      continue;
    }
    const group = groups.find(g => g.kind === type.name && g.key === field.key);
    if (group) group.notes.push(note);
    else groups.push({ kind: type.name, key: field.key, notes: [note] });
  }
  return { groups, rest };
}
