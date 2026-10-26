// ---------- ⌘F in a conversation: where a query occurs in the text the log shows, as offsets into that text

/** Every occurrence of `query` in `text`, any case, as [start, end): offsets into `text` itself, so a letter whose
 *  lower case has another length does not shift them. */
export function occurrences(text: string, query: string): [number, number][] {
  if (!query) return [];
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return [...text.matchAll(re)].map(m => [m.index, m.index + m[0].length]);
}

/** The piece an offset falls in, given where each piece starts in the joined text (ascending, the first at 0), and
 *  the offset within it. An end offset on a seam stays in the piece before (`end`), so a range never ends at 0. */
export function locate(starts: number[], offset: number, end = false): [number, number] {
  let i = starts.length - 1;
  while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--;
  return [i, offset - starts[i]];
}
