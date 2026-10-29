import { Document, isMap, isScalar, isSeq, parseDocument } from "yaml";

// A page's properties: its frontmatter as rows to edit. An edit rewrites only the lines of the key it touches, the
// rest of the frontmatter (comments, quoting, order, keys Relay does not understand) stays byte for byte.

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export type PropertyKind = "text" | "date" | "list" | "link" | "check" | "raw";
export type PropertyValue = string | number | boolean | null | string[];
export type Property = { key: string; value: PropertyValue; kind: PropertyKind };

const LINK = /^\[\[[^\]\n]+\]\]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The kind of editor a value gets: a checkbox for true/false, a date picker for YYYY-MM-DD, a link for one [[note]],
 *  chips for a list; nested maps and lists of lists stay raw text. */
export function kindOf(value: unknown): PropertyKind {
  if (typeof value === "boolean") return "check";
  if (Array.isArray(value)) return value.every(v => typeof v !== "object" || v === null) ? "list" : "raw";
  if (typeof value === "string") return LINK.test(value) ? "link" : DATE.test(value) ? "date" : "text";
  if (value === null || typeof value === "number") return "text";
  return "raw";
}

/** The frontmatter between the `---` lines of a head (what comes before a page's body), or null when it has none. */
export const frontmatterOf = (head: string) => FRONTMATTER.exec(head)?.[1] ?? null;

/** Replace the frontmatter of a head with `yaml`; a head without one gets it on top. */
export function withFrontmatter(head: string, yaml: string) {
  const block = yaml.trim() ? `---\n${yaml.replace(/\n+$/, "")}\n---\n` : "";
  const match = FRONTMATTER.exec(head);
  return match ? block + head.slice(match[0].length) : block + head;
}

type Span = { key: string; start: number; end: number; value: PropertyValue; kind: PropertyKind };
const KEY = /^([^\s#\-:][^:\n]*):(?:[ \t\n]|$)/;
/** Each top-level key with where its lines start and end in `src` (which ends in a newline): its own line and the
 *  indented or `- ` lines under it. Comment and blank lines between keys belong to no key, so they stay in place. Each
 *  key's lines are parsed on their own: a line the YAML parser refuses (an unquoted `: ` in a description, as hand-written
 *  notes have) becomes that key's text, and the other keys stay editable. Null when a line fits none of this. */
function spans(src: string): Span[] | null {
  const out: Span[] = [];
  let at = 0;
  while (at < src.length) {
    const next = src.indexOf("\n", at) + 1 || src.length;
    const line = src.slice(at, next);
    if (!line.trim() || line.startsWith("#")) {
      at = next;
      continue;
    }
    const key = KEY.exec(line);
    if (!key) return null;
    let end = next;
    while (end < src.length && /^([ \t]+\S|- )/.test(src.slice(end, end + 3)))
      end = src.indexOf("\n", end) + 1 || src.length;
    out.push({ key: key[1].trim(), start: at, end, ...valueOf(src.slice(at, end), key[0].length) });
    at = end;
  }
  return out;
}
/** A key's value and kind from its own lines. */
function valueOf(lines: string, after: number): { value: PropertyValue; kind: PropertyKind } {
  const doc = parseDocument(lines);
  const pair =
    !doc.errors.length && isMap(doc.contents) && doc.contents.items.length === 1 ? doc.contents.items[0] : null;
  if (!pair) {
    const text = lines.slice(after).trim();
    return text.includes("\n") ? { value: text, kind: "raw" } : { value: text || null, kind: "text" };
  }
  const node = pair.value;
  if (node !== null && !isSeq(node) && !isScalar(node)) return { value: String(node).trim(), kind: "raw" };
  const value = (node === null ? null : node.toJSON()) as PropertyValue;
  const kind = kindOf(value);
  return { value: kind === "raw" ? JSON.stringify(value) : value, kind };
}

/** The frontmatter's keys in order with their values and editor kinds; null when it can't be edited safely. */
export function readProperties(yaml: string): Property[] | null {
  return spans(yaml + "\n")?.map(({ key, value, kind }) => ({ key, value, kind })) ?? null;
}

/** One key's lines as Relay writes them: a [[link]] double-quoted, an empty value as `key:`. */
export function pairText(key: string, value: PropertyValue) {
  if (Array.isArray(value) && !value.length) return `${key}:\n`;
  const text = new Document({ [key]: value }).toString({ lineWidth: 0, nullStr: "" });
  return text.replace(/^([^\n]*):[ ]+\n/, "$1:\n");
}

const edit = (yaml: string, f: (src: string, list: Span[]) => string) => {
  const src = yaml + "\n";
  const list = spans(src);
  return list ? f(src, list).replace(/\n$/, "") : yaml;
};

/** Set a key's value: its own lines rewritten, every other byte kept; a new key goes at the end. */
export const setProperty = (yaml: string, key: string, value: PropertyValue) =>
  edit(yaml, (src, list) => {
    const at = list.find(s => s.key === key);
    if (!at) return (src.trim() ? src : "") + pairText(key, value);
    return src.slice(0, at.start) + pairText(key, value) + src.slice(at.end);
  });

/** Remove a key and its lines. */
export const removeProperty = (yaml: string, key: string) =>
  edit(yaml, (src, list) => {
    const at = list.find(s => s.key === key);
    return at ? src.slice(0, at.start) + src.slice(at.end) : src;
  });

/** Move a key's lines (as written) in front of `before`, or to the end when `before` is null. */
export const moveProperty = (yaml: string, key: string, before: string | null) =>
  edit(yaml, (src, list) => {
    const at = list.find(s => s.key === key);
    if (!at || key === before) return src;
    const lines = src.slice(at.start, at.end);
    const rest = src.slice(0, at.start) + src.slice(at.end);
    const target = before === null ? undefined : spans(rest)?.find(s => s.key === before);
    if (before !== null && !target) return src;
    const pos = target ? target.start : rest.length;
    return rest.slice(0, pos) + lines + rest.slice(pos);
  });
