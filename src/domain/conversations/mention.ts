import { fileName } from "./files.ts";

/** The `@name` the caret is in the middle of: where it starts and what follows the `@`. Only at the start of the
 *  text or after a space, so an e-mail address does not open the list. */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const found = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return found ? { from: caret - found[2].length - 1, query: found[2] } : null;
}

/** A note's name: the file without its folders and `.md`. */
export const noteLabel = (path: string) => fileName(path).replace(/\.md$/i, "");

/** The notes for what follows the `@`: names that start with it first, then names that contain it, then paths that do. */
export function matchNotes(paths: string[], query: string, max = 8): string[] {
  const q = query.toLowerCase();
  const rank = (path: string) => {
    const name = noteLabel(path).toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return path.toLowerCase().includes(q) ? 2 : -1;
  };
  return paths
    .map(path => ({ path, rank: rank(path) }))
    .filter(match => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank || noteLabel(a.path).localeCompare(noteLabel(b.path)))
    .slice(0, max)
    .map(match => match.path);
}
