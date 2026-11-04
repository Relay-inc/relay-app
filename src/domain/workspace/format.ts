// Styling a page's text without writing markdown (ui/features/workspace/formatting.ts): wrapping a selection in
// **, *, ~~ or `, making it a link, changing a link's target and `[] ` becoming a to-do. Pure text in, text out: what is
// saved is the markdown Obsidian reads.

export type Mark = "**" | "*" | "~~" | "`";
export type Change = { from: number; to: number; insert: string };
/** What a command does to the text: the changes (in the old text's offsets, ascending) and the selection after them. */
export type Edit = { changes: Change[]; from: number; to: number };

const run = (text: string, at: number, step: 1 | -1, ch: string) => {
  let n = 0;
  for (let i = step === 1 ? at : at - 1; text[i] === ch; i += step) n++;
  return n;
};

/** Whether [from, to) sits inside the mark: the marks right around it, or a selection that includes them. A `*` next to
 *  another one is a bold's, not an italic's. */
function wrapped(text: string, from: number, to: number, mark: Mark) {
  const n = mark.length;
  if (mark === "*" || mark === "**") {
    const around = Math.min(run(text, from, -1, "*"), run(text, to, 1, "*"));
    return mark === "*" ? around % 2 === 1 : around >= 2;
  }
  return text.slice(from - n, from) === mark && text.slice(to, to + n) === mark;
}

/** The pieces of a selection a mark goes on: one per line, trimmed (` **x** ` is not bold in markdown), empty lines out. */
function pieces(text: string, from: number, to: number) {
  const out: [number, number][] = [];
  let start = from;
  for (;;) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 || nl > to ? to : nl;
    let a = start;
    let b = end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push([a, b]);
    if (end >= to) return out;
    start = end + 1;
  }
}

/** Whether the whole selection has the mark (the toolbar's button is down). */
export function hasMark(text: string, from: number, to: number, mark: Mark) {
  const parts = pieces(text, from, to);
  return parts.length > 0 && parts.every(([a, b]) => wrapped(text, a, b, mark));
}

// ponytail: a selection over several lines that includes the marks of the lines inside it (the one a wrap leaves) wraps
// again instead of unwrapping; select the lines' text to unwrap. Handle the marks at the pieces' ends if it is asked for.
/** ⌘B and the like: the selection wrapped in the mark, or unwrapped when it has it already. On a caret the pair goes in
 *  with the caret between. */
export function toggleMark(text: string, from: number, to: number, mark: Mark): Edit {
  const n = mark.length;
  const parts = pieces(text, from, to);
  if (!parts.length) {
    return {
      changes: [{ from, to: from, insert: mark + mark }],
      from: from + n,
      to: from + n,
    };
  }
  const off = parts.every(([a, b]) => wrapped(text, a, b, mark));
  const changes: Change[] = [];
  let shift = 0;
  let start = 0;
  let end = 0;
  parts.forEach(([a, b], i) => {
    if (off) {
      changes.push({ from: a - n, to: a, insert: "" }, { from: b, to: b + n, insert: "" });
      if (i === 0) start = a - n + shift;
      end = b - n + shift;
      shift -= 2 * n;
    } else {
      changes.push({ from: a, to: a, insert: mark }, { from: b, to: b, insert: mark });
      if (i === 0) start = a + n + shift;
      end = b + n + shift;
      shift += 2 * n;
    }
  });
  return { changes, from: start, to: end };
}

/** A link's address as markdown takes it: one with a space or a parenthesis goes between < >. */
export const urlText = (url: string) => (/[\s()]/.test(url) ? `<${url}>` : url);

/** The selection made a link to `url`. */
export function linkSelection(from: number, to: number, url: string): Edit {
  const close = `](${urlText(url)})`;
  return {
    changes: [
      { from, to: from, insert: "[" },
      { from: to, to, insert: close },
    ],
    from: from + 1,
    to: to + 1,
  };
}

const MD_LINK = /^\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^\s)]*)/;
const WIKI = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]$/;

/** The link as the text of its node reads: its target (the address, or a [[wikilink]]'s note and heading) and where that
 *  is in the text. */
export function linkOf(src: string): { kind: "link" | "wiki"; target: string; from: number; to: number } | null {
  const wiki = WIKI.exec(src);
  if (wiki) return { kind: "wiki", target: wiki[1], from: 2, to: 2 + wiki[1].length };
  const md = MD_LINK.exec(src);
  if (!md) return null;
  const to = md[0].length;
  const raw = md[2];
  const from = to - raw.length;
  return { kind: "link", target: raw.startsWith("<") ? raw.slice(1, -1) : raw, from, to };
}

/** The change to a link's text for another target (offsets in the link's own text); an empty one takes the link away,
 *  leaving what it showed. */
export function retarget(src: string, target: string): Change | null {
  const link = linkOf(src);
  if (!link) return null;
  const next = target.trim();
  if (!next) {
    const shown = label(src);
    return shown === null ? null : { from: 0, to: src.length, insert: shown };
  }
  return { from: link.from, to: link.to, insert: link.kind === "wiki" ? next : urlText(next) };
}
/** The link's text with another target. */
export function withTarget(src: string, target: string): string | null {
  const c = retarget(src, target);
  return c && src.slice(0, c.from) + c.insert + src.slice(c.to);
}

/** What a link shows: its text (a wikilink's alias, else its note). */
export function label(src: string): string | null {
  const wiki = WIKI.exec(src);
  if (wiki) return wiki[2] ?? wiki[1];
  return MD_LINK.exec(src)?.[1] ?? null;
}

/** `[] ` typed at the start of a line (after its indentation) is a to-do: the change for the space just typed at `col`
 *  of `line`, or null. */
export function todoRule(line: string, col: number): Change | null {
  const m = /^(\s*)\[ ?\]$/.exec(line.slice(0, col));
  return m ? { from: m[1].length, to: col, insert: "- [ ] " } : null;
}
