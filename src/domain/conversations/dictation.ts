/** Dictated `text` put in `value` in place of `start`..`end`, a space added where it would touch a word, and where the
 *  cursor goes after it. */
export function insertDictated(value: string, start: number, end: number, text: string) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const head = before + lead + text;
  return { value: head + trail + after, cursor: head.length };
}
