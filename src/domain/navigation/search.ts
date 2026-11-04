// ⌘K's typed filters: `type:Document`, `in:Studio` (`in:"Client Work"`) and `#tag` narrow the notes, the rest is text.
// A filter becomes a pill once it is finished (a space typed after it); the backend reads the same words (related.rs
// `parse_query`), so what is sent is the pills and the text joined.

const FILTER = /^(type:|in:)("[^"]*"|\S+)$|^#\S+$/i;
/** Whether a whole word is a filter with a value. */
export const isFilter = (token: string) => FILTER.test(token) && !/^(type:|in:)$/i.test(token) && token !== "#";

/** The words of a text, a quoted value kept whole. */
function words(text: string) {
  const out: { token: string; end: number }[] = [];
  const re = /(?:[^\s"]|"[^"]*"?)+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ token: m[0], end: m.index + m[0].length });
  return out;
}

/** The finished filters of `typed` (each followed by whitespace), and what is left to type. */
export function takeFilters(typed: string): { filters: string[]; rest: string } {
  const filters: string[] = [];
  let rest = "";
  let at = 0;
  for (const { token, end } of words(typed)) {
    const start = end - token.length;
    const finished = end < typed.length && /\s/.test(typed[end]);
    if (finished && isFilter(token)) {
      filters.push(token);
      rest += typed.slice(at, start);
      at = end + 1;
    }
  }
  rest += typed.slice(at);
  return { filters, rest: rest.replace(/^\s+/, "") };
}

/** What the backend gets: the pills, then the text. */
export const queryOf = (filters: string[], typed: string) => [...filters, typed].join(" ").trim();

/** A word with a filter's prefix, e.g. `type:` or `in:Stu`, being typed: ⌘K says what it narrows by. */
export const filterPrefix = (typed: string) => /(^|\s)(type:|in:|#)\S*$/i.test(typed);

/** Whether an action's label holds every word of the text (words in any order, any case), "" matching none. */
export function matchesLabel(label: string, text: string) {
  const parts = text.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = label.toLowerCase();
  return parts.length > 0 && parts.every(part => lower.includes(part));
}
