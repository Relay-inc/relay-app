import type { ViewItem } from "./sidebar-views";

export { place, ordered } from "./sidebar-order.ts";

// The sidebar's rows as data: the view rows on top, then the sections with their projects and conversations.
// application/navigation/sidebar.ts builds them from the state, the order the user dragged is kept by these rules.
export type Trail = "" | "dot" | "spin";
/** The badge or count at the end of a view row. */
export type Meta = { kind: "badge" | "count" | "late" | "soon"; n: number; title?: string };
/** `unseen` and `trail` only on the orchestrator's coordinator, the one view that is a conversation. */
export type ViewRow = ViewItem & { meta?: Meta; unseen?: boolean; trail?: Trail };
export type ConvRow = {
  key: string;
  parent: string; // what it is reordered among: its folder, else its project ("" for Algemeen)
  project: string; // its project, "" for Algemeen
  folder: string; // its folder, "" for none
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
  vault?: string; // a general conversation in another vault than the main one: that vault's name, a hint after the title
  work?: boolean; // Today's work in progress (domain/today/work.ts): opens Today on it, not draggable, no menu
  icon?: string; // a work row's icon: a review, a mail, a meeting
};
/** A folder with its conversations, under a project or Algemeen (`project` ""). Shut, it shows its count. */
export type FolderBlock = {
  id: string;
  project: string;
  name: string;
  open: boolean;
  editing: boolean; // its name is being typed
  count: number;
  unseen: boolean;
  trail: Trail;
  convs: ConvRow[];
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
  folders: FolderBlock[];
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
  folders: FolderBlock[];
  convs: ConvRow[];
  projects: ProjectBlock[];
};
export type SidebarModel = { views: ViewRow[]; sections: Section[] };
export type ReorderKind = "sec" | "proj" | "conv" | "view";

// contexts come from the vault index, in its order, each takes the next of three colours
export const CONTEXT_TINTS = ["ctx-a", "ctx-m", "ctx-p"] as const;
export const GENERAL = "Algemeen";
export const SHOWN_CONVERSATIONS = 5;
