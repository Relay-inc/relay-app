import { invoke } from "@tauri-apps/api/core";
import { noteOf, setNoteCheck } from "../core/markdown";
import { config } from "./config";

// Vault notes named in a conversation open in the right panel. Only notes that exist link: the vault's paths
// (vault_notes, refreshed with the snapshot) and their names for [[wikilinks]].
let vaultRoot = "", notePaths = new Set<string>(), noteNames = new Set<string>();
export async function loadNotes() {
  try {
    const r = await invoke<{ root: string; notes: string[] }>("vault_notes");
    vaultRoot = r.root; notePaths = new Set(r.notes); noteNames = new Set(r.notes.map(p => p.split("/").pop()!));
  } catch { notePaths = new Set(); noteNames = new Set(); }
  setNoteCheck(noteKnown);
}
export function noteKnown(target: string) {
  let t = target;
  for (const v of [vaultRoot, config.value.vault]) if (v && t.startsWith(v.replace(/\/$/, "") + "/")) t = t.slice(v.replace(/\/$/, "").length + 1);
  if (!/\.md$/i.test(t)) t += ".md";
  return notePaths.has(t) || (!t.includes("/") && noteNames.has(t));
}
/** A path from a tool call that names an existing note, or "". */
export const notePath = (p?: string) => p && /\.md$/i.test(noteOf(p)) && noteKnown(noteOf(p)) ? p : "";
/** The key of a note in the right panel (src/domain/panel.ts). */
export const noteKey = (target: string) => `note:${target}`;
export { noteOf };
