// Commonwealth, the team brain: detected, never configured. On when its Claude Code plugin is installed. The view
// lists the notes staged for review in the brains the vault's projects resolve to; Promote and Reject go through the CLI.
export type BrainNote = {
  brain: string;
  id: string;
  kind: string;
  title: string;
  created: string;
  author: string;
  source: string;
  body: string;
};
export type BrainStatus = {
  plugin: boolean;
  cli: string | null;
  hint: string;
  projects: { project: string; brain: string | null; name: string | null }[];
};

// The Brain view's folders: the vault, and each brain when Commonwealth is on. `id` is the folder's path.
export type BrainRoot = { id: string; name: string; kind: "vault" | "brain" };
/** A note in the graph: path, title, kind, tags, and whether it is a hub that links everything (an index note). */
export type GraphNode = { p: string; t: string; k: string; g: string[]; h: boolean };
/** Every note of a folder and its links, as pairs of indexes into `nodes`: [from, to, from, to, …]. */
export type BrainGraph = { nodes: GraphNode[]; edges: number[] };
export type SearchHit = { path: string; title: string; snippet: string };
/** A note a conversation (`key`) read or wrote, at `at` (ms). */
export type Touch = { key: string; root: string; path: string; at: number; kind: "read" | "write" };
/** A note's glow: the last touch, whether any touch wrote it, and the conversations, newest first. */
export type Glow = { at: number; write: boolean; keys: string[] };
/** The folder tree of the Browse mode: a folder's subfolders and its notes (indexes into the graph's nodes). */
export type Folder = { name: string; path: string; folders: Folder[]; notes: number[] };
