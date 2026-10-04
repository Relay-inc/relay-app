import type { ViewItem } from "./sidebar-views";

export { place, ordered } from "./sidebar-order.ts";

// The sidebar's rows as data: the view rows on top, then the sections with their projects and conversations.
// application/navigation/sidebar.ts builds them from the state, the order the user dragged is kept by these rules.
export type Trail = "" | "dot" | "spin";
/** The badge or count at the end of a view row. */
export type Meta = { kind: "badge" | "count" | "late" | "soon"; n: number; title?: string };
export type ViewRow = ViewItem & { meta?: Meta };
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
  closing: boolean; // being closed: greyed out and pulsing until it is gone
  orch: boolean; // a worker of the orchestrator: a small marker
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
/** The orchestrator's coordinator on top: a conversation that opens with the composer, with its running workers as the count. */
export type OrchRow = ViewRow & { unseen: boolean; trail: Trail };
export type SidebarModel = { orch: OrchRow; views: ViewRow[]; sections: Section[] };
export type ReorderKind = "sec" | "proj" | "conv" | "view";

// contexts come from the vault index, in its order, each takes the next of three colours
export const CONTEXT_TINTS = ["ctx-a", "ctx-m", "ctx-p"] as const;
export const GENERAL = "Algemeen";
export const SHOWN_CONVERSATIONS = 5;
