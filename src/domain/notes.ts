import { invoke } from "@tauri-apps/api/core";
import { noteOf, setNoteCheck } from "../core/markdown";
import { config } from "./config";
import { noteKey } from "./keys";

// Vault notes named in a conversation open in the right panel. Only notes that exist link: the vault's paths
// (vault_notes, refreshed with the snapshot) and their names for [[wikilinks]].
let vaultRoot = "";
let notePaths = new Set<string>();
let noteNames = new Set<string>();
export async function loadNotes() {
  try {
    const answer = await invoke<{ root: string; notes: string[] }>("vault_notes");
    vaultRoot = answer.root;
    notePaths = new Set(answer.notes);
    noteNames = new Set(answer.notes.map(path => path.split("/").pop()!));
  } catch {
    notePaths = new Set();
    noteNames = new Set();
  }
  setNoteCheck(noteKnown);
}
// the target relative to the vault folder, with its .md
function relativeNote(target: string) {
  let path = target;
  for (const root of [vaultRoot, config.value.vault]) {
    const prefix = root.replace(/\/$/, "") + "/";
    if (root && path.startsWith(prefix)) path = path.slice(prefix.length);
  }
  return /\.md$/i.test(path) ? path : path + ".md";
}
export function noteKnown(target: string) {
  const path = relativeNote(target);
  return notePaths.has(path) || (!path.includes("/") && noteNames.has(path));
}
/** A path from a tool call that names an existing note, or "". */
export const notePath = (path?: string) => (path && /\.md$/i.test(noteOf(path)) && noteKnown(noteOf(path)) ? path : "");
export { noteOf, noteKey };
