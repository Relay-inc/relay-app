// The Brain view: the vault's notes as a graph, a fictional team brain of 420 notes (fixture "brain" turns
// Commonwealth on), search, a note's text, and the notes conversations touched in the last days.
import { NOW, HOUR, DAY, rng } from "./util";
import { VAULT, notes as vaultNotes, projectNames } from "./vault";
import { conversations } from "./conversations";

export const BRAIN = "/Users/demo/projects/team-brain";
type Node = { p: string; t: string; k: string; g: string[]; h: boolean };

const vaultNodes: Node[] = vaultNotes.map(p => ({
  p,
  t: p.split("/").pop()!.replace(/\.md$/, ""),
  k: p.startsWith("Calendar/") ? "Journal" : p.includes("/Documents/") ? "Document" : p.endsWith("/Log.md") ? "Log" : "Product",
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
for (const p of vaultNotes.filter(p => p.includes("/Documents/") || p.startsWith("Calendar/") || p.startsWith("Resources/")))
  for (let k = 0; k < 3; k++) vaultEdges.push(iOf(p), r.int(0, projectNames.length - 1));

const PROJECTS = ["northwind-portal", "beacon-billing", "kestrel-api", "atlas-logistics", "harbor-crm", "infra", "people", "decisions"];
const WORDS = ["cache", "retry", "invoice", "export", "webhook", "migration", "pricing", "deploy", "auth", "queue", "sync", "report"];
const brainNodes: Node[] = [];
const brainEdges: number[] = [];
const rb = rng(11);
PROJECTS.forEach((project, pi) => {
  const hub = brainNodes.push({ p: `${project}/${project}.md`, t: project, k: "index", g: [], h: true }) - 1;
  const count = project === "people" ? 14 : 40 + pi * 6;
  for (let i = 0; i < count; i++) {
    const kind = project === "people" ? "person" : project === "decisions" ? "decision" : i % 7 === 0 ? "decision" : "memory";
    const title = `${WORDS[(i + pi) % WORDS.length]} ${kind === "person" ? "owner" : "note"} ${i + 1} in ${project}`;
    const at = brainNodes.push({ p: `${kind === "decision" ? "decisions" : project}/${project}-${i + 1}.md`, t: title, k: kind, g: [project], h: false }) - 1;
    brainEdges.push(hub, at);
    if (i > 2 && rb.next() < 0.6) brainEdges.push(at, at - rb.int(1, 3));
    if (rb.next() < 0.12) brainEdges.push(at, rb.int(0, brainNodes.length - 1));
  }
});

export const roots = (cw: boolean) => [
  { id: VAULT, name: "Vault", kind: "vault" },
  ...(cw ? [{ id: BRAIN, name: "team-brain", kind: "brain" }] : []),
];
export const graph = (root: string) =>
  root === BRAIN ? { nodes: brainNodes, edges: brainEdges } : { nodes: vaultNodes, edges: vaultEdges };
export const search = (root: string, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return graph(root)
    .nodes.filter(n => words.every(w => n.t.toLowerCase().includes(w)))
    .slice(0, 60)
    .map(n => ({ path: n.p, title: n.t, snippet: `…what the note says about ${n.t}, the context and the decision…` }));
};
export const note = (root: string, path: string) => {
  const g = graph(root);
  const i = g.nodes.findIndex(n => n.p === path);
  const linked: string[] = [];
  for (let e = 0; e < g.edges.length; e += 2)
    if (g.edges[e] === i) linked.push(g.nodes[g.edges[e + 1]].p);
    else if (g.edges[e + 1] === i) linked.push(g.nodes[g.edges[e]].p);
  const node = g.nodes[i];
  const links = linked.slice(0, 4).map(p => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`).join(", ");
  return {
    path,
    text: `---\nkind: ${node?.k ?? ""}\ntitle: '${node?.t ?? path}'\n---\nWhat the team learned about **${node?.t ?? path}**: the retry policy only applies to idempotent calls, so the export job checks for an existing invoice first.\n\nRelated: ${links || "none yet"}.\n`,
  };
};
// the newest conversations read and wrote a handful of notes in both folders
export const touches = () => {
  const keys = [...conversations].sort((a, b) => b.at - a.at).slice(0, 4).map(c => c.key);
  const out: { key: string; root: string; path: string; at: number; kind: "read" | "write" }[] = [];
  const add = (key: string, root: string, path: string, hoursAgo: number, kind: "read" | "write") =>
    out.push({ key, root, path, at: NOW - hoursAgo * HOUR, kind });
  vaultNodes.slice(0, 6).forEach((n, i) => add(keys[i % 4], VAULT, n.p, i * 9 + 1, i === 1 ? "write" : "read"));
  brainNodes.slice(20, 44).forEach((n, i) => add(keys[i % 4], BRAIN, n.p, (i * 7) % (6 * 24), i % 5 === 0 ? "write" : "read"));
  add(keys[0], BRAIN, brainNodes[100].p, 2 * 24 + 3, "read");
  return out.filter(t => t.at > NOW - 7 * DAY);
};
