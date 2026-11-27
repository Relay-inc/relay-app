/** One setting row as the search sees it: its label and hint, the title of its section, the page it is on. */
export type SearchRow = { page: string; section: string; label: string; hint: string; extra?: string };
export type SearchHit<R extends SearchRow = SearchRow> = { row: R; rank: number };

/** Lower case without accents, one character for each character, so an offset in the folded text is an offset in
 *  the original. */
export const fold = (text: string) =>
  [...text]
    .map(c => {
      const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      return f.length === c.length ? f : c;
    })
    .join("");

/** The words of a query, folded. */
export const words = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/** The rows every word of the query is in (label, section, hint or the row's synonyms), the ones with a word in the
 *  label first, then the section, then the hint and synonyms. Ties keep the order the rows are on the pages. */
export function searchRows<R extends SearchRow>(rows: R[], query: string): SearchHit<R>[] {
  const ws = words(query);
  if (!ws.length) return [];
  return rows
    .map((row, i) => {
      const label = fold(row.label);
      const section = fold(row.section);
      const rest = fold(`${row.hint} ${row.extra ?? ""}`);
      let rank = 0;
      for (const w of ws) {
        const at = label.includes(w) ? 0 : section.includes(w) ? 1 : rest.includes(w) ? 2 : -1;
        if (at < 0) return null;
        rank = Math.max(rank, at);
      }
      return { row, rank, i };
    })
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
}

/** Where the words of a query are in a text: [start, end) pairs, in order, not overlapping. */
export function matchRanges(text: string, ws: string[]): [number, number][] {
  const folded = fold(text);
  const found: [number, number][] = [];
  for (const w of ws)
    for (let at = folded.indexOf(w); at >= 0; at = folded.indexOf(w, at + w.length)) found.push([at, at + w.length]);
  found.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [start, end] of found) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
