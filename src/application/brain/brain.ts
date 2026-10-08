import { brainKey } from "../../domain/brain/rules";
import type { BrainNote } from "../../domain/brain/types";
import * as backend from "../../infrastructure/backend";
import { cwOn } from "../../domain/settings/types";
import { settings } from "../settings/settings";
import { useBrainStore, type BrainMode } from "./store";
import { useNavigationStore } from "../navigation/store";
import { BRAIN } from "../../domain/navigation/views";
import { newChat } from "../conversations/chats";
import { typeInto } from "../conversations/actions";
import { select } from "../navigation/navigation";

const set = useBrainStore.setState;

/** Once its Claude Code plugin is installed, unless switched off in Settings. */
export const brainOn = () => !!useBrainStore.getState().status?.plugin && cwOn(settings());
/** The plugin's state and the CLI, for Settings. */
export async function loadBrainStatus() {
  try {
    const status = await backend.commonwealthStatus();
    set(draft => {
      draft.status = status;
    });
  } catch (e) {
    set(draft => {
      draft.installErr = String(e);
    });
  }
}
/** Refreshed every 5 minutes, on focus and on opening the view. The view's own data only while it is open. */
export async function loadBrain() {
  if (useNavigationStore.getState().selected === BRAIN) loadView();
  if (useBrainStore.getState().busy) return;
  set(draft => {
    draft.busy = true;
  });
  try {
    const status = await backend.commonwealthStatus();
    const notes = status.plugin ? await backend.commonwealthNotes() : null;
    set(draft => {
      draft.status = status;
      draft.notes = notes;
      if (!notes?.some(note => brainKey(note) === draft.open)) draft.open = "";
      draft.err = "";
    });
  } catch (e) {
    set(draft => {
      draft.err = String(e);
    });
  }
  set(draft => {
    draft.busy = false;
  });
}
export const openNote = (key: string) =>
  set(draft => {
    draft.open = key;
  });
export async function brainAct(note: BrainNote, verb: "promote" | "reject") {
  if (useBrainStore.getState().acting) return;
  set(draft => {
    draft.acting = true;
    draft.err = "";
  });
  try {
    await backend.commonwealthAct(note.brain, verb, [note.id]);
  } catch (e) {
    set(draft => {
      draft.err = String(e);
    });
  }
  set(draft => {
    draft.acting = false;
  });
  await loadBrain();
}
export async function installCommonwealth() {
  set(draft => {
    draft.installing = true;
    draft.installErr = "";
  });
  try {
    await backend.commonwealthInstall();
  } catch (e) {
    set(draft => {
      draft.installErr = String(e);
    });
  }
  set(draft => {
    draft.installing = false;
  });
  await loadBrainStatus();
}

// ---------- browse and graph: the vault, and each brain when Commonwealth is on

const brain = () => useBrainStore.getState();
/** The folders as tabs: the vault, then the brains while Commonwealth is on. */
export const visibleRoots = () => (brain().roots ?? []).filter(root => root.kind === "vault" || brainOn());
/** The tab shown: the one picked, else the vault. */
export const currentRoot = () => {
  const roots = visibleRoots();
  return roots.find(root => root.id === brain().tab) ?? roots[0];
};
/** The days a glow lasts. */
export const GLOW_DAYS = 7;

/** The tabs, the shown folder's graph, and the glow when it is on. A graph only replaces the one shown when it
 *  changed, so a refresh does not move the dots. */
async function loadView() {
  try {
    const roots = await backend.brainRoots();
    set(draft => {
      draft.roots = roots;
    });
  } catch (e) {
    set(draft => {
      draft.graphErr = String(e);
    });
    return;
  }
  await loadGraph();
  if (brain().glow) await loadTouches();
}
async function loadGraph() {
  const root = currentRoot();
  if (!root) return;
  try {
    const graph = await backend.brainGraph(root.id);
    const old = brain().graphs[root.id];
    if (old && JSON.stringify(old) === JSON.stringify(graph)) return;
    set(draft => {
      draft.graphs[root.id] = graph;
      draft.graphErr = "";
    });
  } catch (e) {
    set(draft => {
      draft.graphErr = String(e);
    });
  }
}
async function loadTouches() {
  try {
    const touches = await backend.brainTouches(GLOW_DAYS);
    set(draft => {
      draft.touches = touches;
      draft.touchesSince = Date.now() - GLOW_DAYS * 86400000;
    });
  } catch (e) {
    set(draft => {
      draft.graphErr = String(e);
    });
  }
}
export function setTab(id: string) {
  if (id === currentRoot()?.id) return;
  set(draft => {
    draft.tab = id;
    draft.query = "";
    draft.hits = null;
    draft.glowKey = "";
    if (draft.mode === "review" && draft.roots?.find(root => root.id === id)?.kind !== "brain") draft.mode = "browse";
  });
  loadGraph();
}
export const setMode = (mode: BrainMode) =>
  set(draft => {
    draft.mode = mode;
  });
export const toggleHubs = () =>
  set(draft => {
    draft.hideHubs = !draft.hideHubs;
  });
export function toggleGlow() {
  set(draft => {
    draft.glow = !draft.glow;
    draft.glowKey = "";
  });
  if (brain().glow) loadTouches();
}
export const setGlowKey = (key: string) =>
  set(draft => {
    draft.glowKey = key;
  });

/** A note of the shown folder in Browse. */
export async function openBrainNote(path: string) {
  const root = currentRoot();
  if (!root) return;
  try {
    const { text } = await backend.brainNote(root.id, path);
    set(draft => {
      draft.note = { root: root.id, path, text };
      draft.mode = "browse";
    });
  } catch (e) {
    set(draft => {
      draft.graphErr = String(e);
    });
  }
}
/** A [[link]] in a note: the note of the shown folder it names (its path without .md, else its file name, like
 *  Obsidian), opened in Browse. Nothing when it names none. */
export function followLink(target: string) {
  const graph = graphOf();
  if (!graph) return;
  const want = target.replace(/\.md$/i, "").toLowerCase();
  const name = want.split("/").pop();
  const stem = (p: string) => p.replace(/\.md$/i, "").toLowerCase();
  const hit = graph.nodes.find(n => stem(n.p) === want) ?? graph.nodes.find(n => stem(n.p).split("/").pop() === name);
  if (hit) openBrainNote(hit.p);
}
/** The shown folder's graph, undefined until loaded. */
export const graphOf = () => {
  const root = currentRoot();
  return root ? brain().graphs[root.id] : undefined;
};

// a search answers only when it is still the latest
let searchRun = 0;
/** What was typed in Browse's search; searched after a pause by the view. */
export const setQuery = (query: string) =>
  set(draft => {
    draft.query = query;
    if (!query.trim()) draft.hits = null;
  });
export async function runSearch() {
  const root = currentRoot();
  const query = brain().query.trim();
  if (!root || !query) return;
  const run = ++searchRun;
  try {
    const hits = await backend.brainSearch(root.id, query);
    if (run === searchRun)
      set(draft => {
        draft.hits = hits;
      });
  } catch (e) {
    set(draft => {
      draft.graphErr = String(e);
    });
  }
}

/** From a conversation: the Brain view's graph with only that conversation's notes lit, in the folder it touched
 *  most (the vault when it touched none). */
export async function showInBrain(key: string) {
  set(draft => {
    draft.glow = true;
    draft.glowKey = key;
    draft.mode = "graph";
  });
  await loadTouches();
  const count = new Map<string, number>();
  for (const touch of brain().touches ?? []) if (touch.key === key) count.set(touch.root, (count.get(touch.root) ?? 0) + 1);
  const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best && visibleRoots().some(root => root.id === best))
    set(draft => {
      draft.tab = best;
    });
}

/** A new conversation with the note's path typed in its composer: relative in the vault (where conversations run),
 *  absolute in a brain. */
export function askAbout(root: string, path: string, kind: "vault" | "brain") {
  const key = newChat(null);
  typeInto(key, `\`${kind === "vault" ? path : `${root}/${path}`}\` `);
  select(key);
}
