// The Pages graph: every note of a workspace as a dot, its links as lines, lit by what conversations read and wrote.

/** A note in the graph: path, title, kind, tags, and whether it is a hub that links everything (an index note). */
export type GraphNode = { p: string; t: string; k: string; g: string[]; h: boolean };
/** Every note of a workspace and its links, as pairs of indexes into `nodes`: [from, to, from, to, …]. `root` is the
 *  workspace's folder as the touches name it (canonical). */
export type NotesGraph = { root: string; nodes: GraphNode[]; edges: number[] };
/** A note a conversation (`key`) read or wrote, at `at` (ms). */
export type Touch = { key: string; root: string; path: string; at: number; kind: "read" | "write" };
/** A note's glow: the last touch, whether any touch wrote it, and the conversations, newest first. */
export type Glow = { at: number; write: boolean; keys: string[] };
