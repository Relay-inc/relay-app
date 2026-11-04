import type { NotesGraph } from "../../domain/graph/types";
import { GRAPH } from "../../domain/navigation/views";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { select } from "./navigation";
import { loadRecent } from "./pages";
import { activeFolder } from "./workspaces";

// The Pages graph: every note of the workspace shown as a dot, its links as lines. The glow lights the notes Relay's
// conversations read and wrote this week, the same touches as Recent in the Pages tab.
type GraphState = {
  graphs: Record<string, NotesGraph>; // per workspace folder, loaded on opening the view
  err: string;
  hideHubs: boolean;
  glow: boolean;
  glowKey: string; // only this conversation's notes glow, "" for all
};
export const useGraphStore = makeStore<GraphState>(() => ({
  graphs: {},
  err: "",
  hideHubs: true,
  glow: false,
  glowKey: "",
}));
const set = useGraphStore.setState;
/** The days a glow lasts: the week Recent reads. */
export const GLOW_DAYS = 7;

/** The workspace shown's graph, and the touches when the glow is on. A graph only replaces the one shown when it
 *  changed, so a refresh does not move the dots. */
export async function loadGraph() {
  const folder = activeFolder();
  if (useGraphStore.getState().glow) void loadRecent();
  try {
    const graph = await backend.notesGraph(folder);
    const old = useGraphStore.getState().graphs[folder];
    if (old && JSON.stringify(old) === JSON.stringify(graph)) return;
    set(draft => {
      draft.graphs[folder] = graph;
      draft.err = "";
    });
  } catch (e) {
    set(draft => {
      draft.err = String(e);
    });
  }
}
export const toggleHubs = () =>
  set(draft => {
    draft.hideHubs = !draft.hideHubs;
  });
export function toggleGlow() {
  set(draft => {
    draft.glow = !draft.glow;
    draft.glowKey = "";
  });
  if (useGraphStore.getState().glow) void loadRecent();
}
export const setGlowKey = (key: string) =>
  set(draft => {
    draft.glowKey = key;
  });
/** From a conversation: the graph with only the notes that conversation read and wrote lit. */
export function showInGraph(key: string) {
  set(draft => {
    draft.glow = true;
    draft.glowKey = key;
  });
  return select(GRAPH);
}
