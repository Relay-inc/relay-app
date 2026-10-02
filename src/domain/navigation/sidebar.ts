// The sidebar's rows as data: the view rows on top, then the sections with their projects and conversations.
// application/navigation/sidebar.ts builds them from the state, the order the user dragged is kept by these rules.
export type Trail = "" | "dot" | "spin";
/** The badge or count at the end of a view row. */
export type Meta = { kind: "badge" | "count" | "late" | "soon"; n: number; title?: string };
export type ViewRow = { key: string; icon?: string; svg?: string; name: string; meta?: Meta };
export type ConvRow = {
  key: string;
  parent: string;
  term: boolean;
  glyph: string; // the agent's own mark; a terminal session draws the terminal
  title: string;
  selected: boolean;
  unseen: boolean;
  trail: Trail;
  subs: number;
  subsTitle: string;
  closable: boolean;
};
export type ProjectBlock = {
  name: string;
  context: string;
  label: string;
  img?: string | null;
  emoji?: string;
  unseen: boolean;
  trail: Trail;
  addTitle: string;
  convs: ConvRow[];
  fold: string;
};
/** `tint` is the colour of a vault context, `add` the project a new conversation from the header is about ("" for general). */
export type Section = {
  id: string;
  label: string;
  tint: "" | "ctx-a" | "ctx-m" | "ctx-p";
  count: number;
  collapsed: boolean;
  open: boolean;
  add?: string;
  convs: ConvRow[];
  projects: ProjectBlock[];
};
export type SidebarModel = { views: ViewRow[]; sections: Section[] };
export type ReorderKind = "sec" | "proj" | "conv";

// contexts come from the vault index, in its order, each takes the next of three colours
export const CONTEXT_TINTS = ["ctx-a", "ctx-m", "ctx-p"] as const;
export const GENERAL = "Algemeen";
export const SHOWN_CONVERSATIONS = 5;

/** `list` with `id` moved before or after `ref` (to the end when `ref` is not in it). */
export const place = (list: string[], id: string, ref: string, after: boolean) => {
  const rest = list.filter(x => x !== id);
  const refIndex = rest.indexOf(ref);
  const at = refIndex < 0 ? rest.length : refIndex + (after ? 1 : 0);
  rest.splice(at, 0, id);
  return rest;
};
/** Rows in the user's dragged order first, the rest after them in their own order. */
export const ordered = <T>(
  rows: T[],
  key: (row: T) => string,
  order: string[] = [],
  byRest: (a: T, b: T) => number = () => 0,
) =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const posA = order.indexOf(key(a.row));
      const posB = order.indexOf(key(b.row));
      if (posA >= 0 && posB >= 0) return posA - posB;
      if (posA >= 0) return -1;
      if (posB >= 0) return 1;
      return byRest(a.row, b.row) || a.index - b.index;
    })
    .map(x => x.row);
