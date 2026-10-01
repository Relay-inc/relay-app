import { invoke } from "@tauri-apps/api/core";
import { changed } from "../core/store";

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

export const brain = {
  status: null as BrainStatus | null,
  notes: null as BrainNote[] | null,
  open: "", // the key of the note shown
  err: "",
  busy: false,
  acting: false,
};
export const brainOn = () => !!brain.status?.plugin;
export const brainKey = (note: Pick<BrainNote, "brain" | "id">) => `${note.brain}\n${note.id}`;
export const brainName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;
export const openNote = () => brain.notes?.find(note => brainKey(note) === brain.open);

// refreshed every 5 minutes, on focus and on opening the view
export async function loadBrain() {
  if (brain.busy) return;
  brain.busy = true;
  changed();
  try {
    brain.status = await invoke<BrainStatus>("commonwealth_status");
    brain.notes = brain.status.plugin ? await invoke<BrainNote[]>("commonwealth_notes") : null;
    if (!brain.notes?.some(note => brainKey(note) === brain.open)) brain.open = "";
    brain.err = "";
  } catch (e) {
    brain.err = String(e);
  }
  brain.busy = false;
  changed();
}
export async function brainAct(note: BrainNote, verb: "promote" | "reject") {
  if (brain.acting) return;
  brain.acting = true;
  brain.err = "";
  changed();
  try {
    await invoke("commonwealth_act", { brain: note.brain, verb, ids: [note.id] });
  } catch (e) {
    brain.err = String(e);
  }
  brain.acting = false;
  await loadBrain();
}
