import type { Item, Pending } from "./types";

// Files attached by their path: the agent reads them where they are, nothing is copied. The paths go after the
// message between markers, so the conversation shows them as chips and a transcript gives them back.
export const FILES_OPEN = "<relay-files>";
export const FILES_CLOSE = "</relay-files>";
const FILES_RE = new RegExp(`\\s*${FILES_OPEN}\\n[^\\n]*\\n([\\s\\S]*?)\\n${FILES_CLOSE}\\s*$`);

/** The text the agent gets: `text` with the attached `paths` after it, one per line. */
export const withFiles = (text: string, paths: string[]) =>
  paths.length
    ? `${text}${text ? "\n\n" : ""}${FILES_OPEN}\nAttached files, read them from these paths:\n${paths.join("\n")}\n${FILES_CLOSE}`
    : text;
/** A sent text split back into what was typed and the attached paths. */
export function splitFiles(text: string): { text: string; files: string[] } {
  const found = text.match(FILES_RE);
  return found
    ? { text: text.slice(0, found.index), files: found[1].split("\n").filter(Boolean) }
    : { text, files: [] };
}
/** The name a path shows: its last part. */
export const fileName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** Every path attached in a conversation's messages. */
export const attachedIn = (items: Item[] | undefined) => (items ?? []).flatMap(item => item.files ?? []);
// a path that steps out of where it starts (`..`) or is not absolute never counts as attached
const plain = (path: string) => path.startsWith("/") && !/(^|\/)\.\.?(\/|$)/.test(path);
/** True when a permission card only asks to read what the user attached in that conversation: Read of an attached
 *  file, or Read, Glob or Grep inside an attached folder. Those go through without a card: the drop was the ask. */
export function readsAttached(request: Pending, attached: string[]) {
  if (!["Read", "Glob", "Grep"].includes(request.tool_name)) return false;
  const path = request.input?.file_path ?? request.input?.path;
  if (!path || !plain(path)) return false;
  return attached.some(file => plain(file) && (path === file || path.startsWith(file.replace(/\/+$/, "") + "/")));
}
