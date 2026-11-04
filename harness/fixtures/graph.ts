// The Pages graph: the vault's notes and their links, and the notes conversations touched in the last days.
import { NOW, HOUR, DAY, rng } from "./util";
import { VAULT, notes as vaultNotes, projectNames } from "./vault";
import { conversations } from "./conversations";

type Node = { p: string; t: string; k: string; g: string[]; h: boolean };

const vaultNodes: Node[] = vaultNotes.map(p => ({
  p,
  t: p.split("/").pop()!.replace(/\.md$/, ""),
  k: p.startsWith("Calendar/")
    ? "Journal"
    : p.includes("/Documents/")
      ? "Document"
      : p.endsWith("/Log.md")
        ? "Log"
        : "Product",
  g: [],
  h: false,
}));
// a project note links its log, every document links two projects, the daily note links three
const vaultEdges: number[] = [];
const iOf = (p: string) => vaultNodes.findIndex(n => n.p === p);
for (const name of projectNames) {
  const own = vaultNodes.findIndex(n => n.t === name);
  const log = vaultNodes.findIndex(n => n.p.endsWith(`/${name}/Log.md`));
  vaultEdges.push(own, log);
}
const r = rng(7);
for (const p of vaultNotes.filter(
  p => p.includes("/Documents/") || p.startsWith("Calendar/") || p.startsWith("Resources/"),
))
  for (let k = 0; k < 3; k++) vaultEdges.push(iOf(p), r.int(0, projectNames.length - 1));

export const graph = () => ({ root: VAULT, nodes: vaultNodes, edges: vaultEdges });
// the newest conversations read and wrote a handful of notes
export const touches = () => {
  const keys = [...conversations]
    .sort((a, b) => b.at - a.at)
    .slice(0, 4)
    .map(c => c.key);
  const out: { key: string; root: string; path: string; at: number; kind: "read" | "write" }[] = [];
  const add = (key: string, root: string, path: string, hoursAgo: number, kind: "read" | "write") =>
    out.push({ key, root, path, at: NOW - hoursAgo * HOUR, kind });
  vaultNodes.slice(0, 6).forEach((n, i) => add(keys[i % 4], VAULT, n.p, i * 9 + 1, i === 1 ? "write" : "read"));
  return out.filter(t => t.at > NOW - 7 * DAY);
};
