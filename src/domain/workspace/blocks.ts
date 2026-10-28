// Notion-like editing on a page's markdown (ui/features/workspace/blocks.ts): what the / menu inserts, turning a block
// into another kind, moving a block, and adding a row or column to a table. Pure text in, text out: the markdown stays
// what Obsidian reads.

export type BlockKind =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "todo"
  | "bullet"
  | "number"
  | "quote"
  | "callout"
  | "code"
  | "table"
  | "divider"
  | "link";

/** What a / item puts on its (empty) line, and where the cursor goes in it. */
export const SLASH: { kind: BlockKind; insert: string; caret: number }[] = [
  { kind: "h1", insert: "# ", caret: 2 },
  { kind: "h2", insert: "## ", caret: 3 },
  { kind: "h3", insert: "### ", caret: 4 },
  { kind: "todo", insert: "- [ ] ", caret: 6 },
  { kind: "bullet", insert: "- ", caret: 2 },
  { kind: "number", insert: "1. ", caret: 3 },
  { kind: "quote", insert: "> ", caret: 2 },
  { kind: "callout", insert: "> [!note]\n> ", caret: 12 },
  { kind: "code", insert: "```\n\n```", caret: 4 },
  { kind: "table", insert: "| Column | Column |\n| --- | --- |\n|  |  |", caret: 36 },
  { kind: "divider", insert: "---\n", caret: 4 },
  { kind: "link", insert: "[[", caret: 2 },
];

// a line's block marker: a heading's #s, a to-do's or list's mark, a quote's >
const MARKER = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)?/;
const PREFIX: Partial<Record<BlockKind, string>> = {
  text: "",
  h1: "# ",
  h2: "## ",
  h3: "### ",
  todo: "- [ ] ",
  bullet: "- ",
  quote: "> ",
};
/** The kinds a block can be turned into from its menu. */
export const TURN_INTO: BlockKind[] = ["text", "h1", "h2", "h3", "todo", "bullet", "number", "quote"];

/** The lines of a block as another kind: each line's marker swapped (a numbered list counts up). A callout's first line
 *  becomes the quote's text. */
export function turnInto(lines: string, kind: BlockKind): string {
  let n = 0;
  return lines
    .split("\n")
    .map(line => {
      const text = line.replace(MARKER, "$1").replace(/^(\s*)\[!\w+\]\s*/, "$1");
      const indent = /^\s*/.exec(text)![0];
      const prefix = kind === "number" ? `${++n}. ` : (PREFIX[kind] ?? "");
      return indent + prefix + text.slice(indent.length);
    })
    .join("\n");
}

/** The text with the block [from, to) (whole lines, `to` at its last line's end) moved to `at`: the start of a line
 *  outside it, or the end of the text. `spaced` blocks keep a blank line on each side, as markdown needs between two
 *  paragraphs; list items move without one. A drop on the block itself changes nothing. */
export function moveBlock(text: string, from: number, to: number, at: number, spaced = true): string {
  // the block and the line break after it (or before it, at the end); a spaced one takes a blank line along
  let cutFrom = from;
  let cutTo = to;
  if (text[to] === "\n") cutTo = to + 1;
  else if (from > 0) cutFrom = from - 1;
  if (spaced) {
    if (cutTo > to && text[cutTo] === "\n") cutTo++;
    else if (cutFrom < from && text[cutFrom - 1] === "\n") cutFrom--;
  }
  if (at >= cutFrom && at <= cutTo) return text;
  const block = text.slice(from, to);
  const rest = text.slice(0, cutFrom) + text.slice(cutTo);
  const pos = at > from ? at - (cutTo - cutFrom) : at;
  const sep = spaced ? "\n\n" : "\n";
  if (pos >= rest.length) {
    const end = /\n*$/.exec(rest)![0].length;
    return rest.slice(0, rest.length - end) + sep + block + (text.endsWith("\n") ? "\n" : "");
  }
  if (rest[pos] === "\n") return rest.slice(0, pos) + (spaced ? "\n" : "") + block + "\n" + rest.slice(pos); // on a blank line
  const after = pos >= 2 && rest[pos - 2] !== "\n" && spaced ? "\n" : ""; // the line before is text: a blank line first
  return rest.slice(0, pos) + after + block + sep + rest.slice(pos);
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|").length;

/** An empty row for a table whose header is `header`. */
export const tableRow = (header: string) => "|" + "  |".repeat(cells(header));

/** A table's lines with a column added at the end. */
export function tableAddColumn(table: string): string {
  return table
    .split("\n")
    .map((row, i) => {
      const trimmed = row.replace(/\s+$/, "");
      const base = trimmed.endsWith("|") ? trimmed : trimmed + " |";
      return base + (i === 0 ? " Column |" : i === 1 ? " --- |" : "  |");
    })
    .join("\n");
}

/** Where each cell of a table row starts: after its | and the space after it. */
export function cellStarts(row: string): number[] {
  const end = row.replace(/\s+$/, "").length;
  const starts: number[] = [];
  for (let i = row.indexOf("|"); i >= 0 && i < end - 1; i = row.indexOf("|", i + 1))
    starts.push(row[i + 1] === " " ? i + 2 : i + 1);
  return starts;
}
/** Tab in a table row: the start of the next cell, or null in the last one. `col` is the cursor's offset in the row. */
export const nextCell = (row: string, col: number) => cellStarts(row).find(start => start > col) ?? null;
/** Shift-Tab: the start of the cell before the cursor's, or null in the first one. */
export function prevCell(row: string, col: number): number | null {
  const starts = cellStarts(row).filter(start => start <= col);
  return starts.length > 1 ? starts[starts.length - 2] : null;
}

/** A pasted URL over selected text makes a link of it. */
export const pasteLink = (selected: string, pasted: string) =>
  selected && /^https?:\/\/\S+$/.test(pasted.trim()) && !selected.includes("\n")
    ? `[${selected}](${pasted.trim()})`
    : null;
