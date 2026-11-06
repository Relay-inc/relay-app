// A view inside a page: a fenced ```relay-view block of `key: value` lines naming a collection and what narrows it.
// `about: this` is the page the block is in, so the same block works on every project page. Pure text in, View out:
// the block's text is never rewritten by showing it or by editing a cell of the notes it lists.
import { COLLECTIONS, newView, type CollectionId, type Sort, type View } from "../collections/rules.ts";

export const VIEW_LANG = "relay-view";
export const THIS = "this";

export type ViewSpec = {
  collection: CollectionId;
  layout: View["layout"];
  /** the note `about:` names: a name, or "this" for the page holding the block ("" for any) */
  about: string;
  context: string;
  sort: Sort | null;
  group: string;
};

/** The block a / View puts in a page: meetings about this page. */
export const NEW_VIEW = "```" + VIEW_LANG + "\ncollection: meetings\nabout: this\n```";

/** The spec a block's lines say; null without a known collection. Unknown keys are left alone. */
export function parseViewSpec(source: string): ViewSpec | null {
  const keys: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) keys[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  const collection = keys.collection?.toLowerCase() as CollectionId;
  if (!COLLECTIONS.includes(collection)) return null;
  const [key, dir] = (keys.sort ?? "").split(/\s+/);
  return {
    collection,
    layout: keys.layout?.toLowerCase() === "board" ? "board" : "table",
    about: keys.about ?? "",
    context: keys.context ?? "",
    sort: key ? { key, dir: dir?.toLowerCase() === "desc" ? "desc" : "asc" } : null,
    group: keys.group ?? "",
  };
}

/** The collection view a spec is on the page called `page`. */
export function viewOf(spec: ViewSpec, page: string): View {
  const about = spec.about.toLowerCase() === THIS ? page : spec.about;
  const view = newView(spec.collection, spec.context, about ? [{ key: "about", is: about }] : []);
  return { ...view, layout: spec.layout, sort: spec.sort, group: spec.group };
}
