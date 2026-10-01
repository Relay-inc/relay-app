import { invoke } from "@tauri-apps/api/core";
import { S } from "./state";

// a vault note named in the text (a markdown link without a scheme, [[wikilink]], `path.md:12`) opens in the right panel
// only notes that exist link: the vault's paths (vault_notes, refreshed with the snapshot) and their names for [[wikilinks]]
let vaultRoot = "", notePaths = new Set<string>(), noteNames = new Set<string>();
export async function loadNotes() {
  try {
    const r = await invoke<{ root: string; notes: string[] }>("vault_notes");
    vaultRoot = r.root; notePaths = new Set(r.notes); noteNames = new Set(r.notes.map(p => p.split("/").pop()!));
  } catch { notePaths = new Set(); noteNames = new Set(); }
}
export const noteOf = (s: string) => { try { s = decodeURI(s); } catch {} return s.replace(/[#|].*$/, "").replace(/:\d+(-\d+)?$/, "").trim(); };
export function noteKnown(target: string) {
  let t = target;
  for (const v of [vaultRoot, S.settings.vault]) if (v && t.startsWith(v.replace(/\/$/, "") + "/")) t = t.slice(v.replace(/\/$/, "").length + 1);
  if (!/\.md$/i.test(t)) t += ".md";
  return notePaths.has(t) || (!t.includes("/") && noteNames.has(t));
}
export const isNotePath = (s: string) => /\.md$/i.test(noteOf(s));
/** The key of a note in the right panel, for openPr. */
export const noteKey = (target: string) => `note:${target}`;
