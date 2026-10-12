import type { BrainGraph, BrainNote, Folder, Glow, GraphNode, Touch } from "./types.ts";

/** A note's key in the view: the same id can exist in two brains. */
export const brainKey = (note: Pick<BrainNote, "brain" | "id">) => `${note.brain}\n${note.id}`;
/** A brain's name: the last folder of its path. */
export const brainName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;
/** The notes per brain, in the order the brains first appear. */
export const byBrain = (notes: BrainNote[]) => {
  const groups = new Map<string, BrainNote[]>();
  for (const note of notes) groups.set(note.brain, [...(groups.get(note.brain) ?? []), note]);
  return [...groups];
};

// ---------- the browse and graph modes

/** The notes in their folders: folders and notes each by name. */
export function folderTree(nodes: GraphNode[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], notes: [] };
  nodes.forEach((node, i) => {
    let at = root;
    const parts = node.p.split("/");
    for (const name of parts.slice(0, -1)) {
      const path = at.path ? `${at.path}/${name}` : name;
      let sub = at.folders.find(f => f.name === name);
      if (!sub) at.folders.push((sub = { name, path, folders: [], notes: [] }));
      at = sub;
    }
    at.notes.push(i);
  });
  const sort = (f: Folder) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name));
    f.notes.sort((a, b) => nodes[a].t.localeCompare(nodes[b].t));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}
/** How many notes a folder holds, its subfolders included. */
export const folderSize = (f: Folder): number => f.notes.length + f.folders.reduce((n, sub) => n + folderSize(sub), 0);

/** Each note's linked notes, both directions: [i] -> indexes. */
export function adjacency(graph: BrainGraph): number[][] {
  const out: number[][] = graph.nodes.map(() => []);
  for (let e = 0; e < graph.edges.length; e += 2) {
    out[graph.edges[e]].push(graph.edges[e + 1]);
    out[graph.edges[e + 1]].push(graph.edges[e]);
  }
  return out;
}

/** The kinds that get a colour: the six most common, hubs left out. Everything else is "other" (grey). */
export function topKinds(nodes: GraphNode[]): string[] {
  const count = new Map<string, number>();
  for (const node of nodes) if (!node.h && node.k) count.set(node.k, (count.get(node.k) ?? 0) + 1);
  return [...count]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([kind]) => kind);
}

/** The glow per note path of one folder: the touches in it at or after `since`, of one conversation when `key`. */
export function glowOf(touches: Touch[], root: string, since: number, key = ""): Map<string, Glow> {
  const out = new Map<string, Glow>();
  for (const touch of [...touches].sort((a, b) => b.at - a.at)) {
    if (touch.root !== root || touch.at < since || (key && touch.key !== key)) continue;
    const glow = out.get(touch.path);
    if (!glow) out.set(touch.path, { at: touch.at, write: touch.kind === "write", keys: [touch.key] });
    else {
      glow.write ||= touch.kind === "write";
      if (!glow.keys.includes(touch.key)) glow.keys.push(touch.key);
    }
  }
  return out;
}
/** How bright a glow is: 1 when just touched, fading to 0.3 at `days` old. */
export const glowLevel = (at: number, now: number, days: number) =>
  Math.max(0.3, 1 - (0.7 * (now - at)) / (days * 86400000));
/** The conversations that touched notes in a folder, the most recent first. */
export function touchedKeys(touches: Touch[], root: string): string[] {
  const last = new Map<string, number>();
  for (const touch of touches)
    if (touch.root === root) last.set(touch.key, Math.max(touch.at, last.get(touch.key) ?? 0));
  return [...last].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}
