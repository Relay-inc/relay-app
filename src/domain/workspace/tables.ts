// Tables on a page (ui/features/workspace/tables.ts): a GFM markdown table as rows of cells and back. Pure text in, text
// out, so every edit stays a plain text change of the page and the file stays what Obsidian reads. Row 0 is the header.

export type Align = "left" | "center" | "right" | null;
export type Table = { rows: string[][]; align: Align[] };

/** Where the cells of one table line are: `pipe` is the `|` that opens the cell, `start`..`end` its trimmed text,
 *  `close` the `|` that ends it (the line's end when it has none). */
export type CellSpan = { pipe: number; start: number; end: number; close: number };

/** Where the unescaped pipes of a line are. */
export function pipes(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") out.push(i);
  }
  return out;
}

/** The cells of a line that starts with `|` (after at most 3 spaces); null for any other line. A cell holds the spaces
 *  typed at its end up to the offset `keep` (the caret): they are not trimmed while it is there. */
export function rowCells(line: string, keep = -1): CellSpan[] | null {
  const marks = pipes(line);
  if (!marks.length || line.slice(0, marks[0]).trim() || marks[0] > 3) return null;
  const closed = marks[marks.length - 1] === line.replace(/\s+$/, "").length - 1;
  const opening = closed ? marks.slice(0, -1) : marks;
  const cells: CellSpan[] = [];
  opening.forEach((pipe, k) => {
    const close = k + 1 < marks.length ? marks[k + 1] : line.length;
    const raw = line.slice(pipe + 1, close);
    const lead = raw.length - raw.trimStart().length;
    if (lead === raw.length) {
      const at = pipe + 1 + (raw.length > 0 ? 1 : 0);
      cells.push({ pipe, start: at, end: at, close });
    } else cells.push({ pipe, start: pipe + 1 + lead, end: pipe + 1 + raw.trimEnd().length, close });
    const cell = cells[cells.length - 1];
    if (keep > cell.end && (keep < close || close === line.length)) cell.end = keep;
  });
  return cells;
}

/** The text of the cells of a line. */
export const splitRow = (line: string): string[] | null => rowCells(line)?.map(c => line.slice(c.start, c.end)) ?? null;

/** The alignments a delimiter row says (`:--`, `:-:`, `--:`), or null when the line is not one. */
export function parseDelimiter(line: string): Align[] | null {
  const cells = splitRow(line);
  if (!cells?.length || !cells.every(c => /^:?-+:?$/.test(c))) return null;
  return cells.map(c => (c.startsWith(":") ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : null));
}

/** A table from its lines (header, delimiter, rows); null when they are not one. Rows are cut or padded to the header. */
export function parseTable(lines: string[]): Table | null {
  const head = splitRow(lines[0] ?? "");
  const align = parseDelimiter(lines[1] ?? "");
  if (!head || !align || align.length !== head.length) return null;
  const rows = [head, ...lines.slice(2).map(l => splitRow(l) ?? [])].map(r => head.map((_, i) => r[i] ?? ""));
  return { rows, align };
}

/** Whether every line has exactly the header's cells: only then is the table rewritten without losing text. */
export const isTidy = (lines: string[]) => {
  const n = splitRow(lines[0] ?? "")?.length;
  return !!n && lines.every((l, i) => (i === 1 ? parseDelimiter(l)?.length === n : splitRow(l)?.length === n));
};

/** Text as a cell holds it: a pipe is `\|`, a line break a space. */
export const escapeCell = (text: string) =>
  text
    .replace(/\r?\n/g, " ")
    .replace(/\\\|/g, "|") // already escaped once: not twice
    .replace(/\|/g, "\\|");

/** The table as aligned lines, every column as wide as its widest cell (3 at least, for the delimiter row). */
export function formatTable({ rows, align }: Table): string[] {
  const width = rows[0].map((_, c) => Math.max(3, ...rows.map(r => r[c].length)));
  const pad = (text: string, c: number) => text + " ".repeat(width[c] - text.length); // a trailing gap only: typing never shifts text before it
  const delimiter = width.map((w, c) => {
    const a = align[c];
    const dashes = "-".repeat(w - (a === "center" ? 2 : a ? 1 : 0));
    return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
  });
  const line = (cells: string[]) => "| " + cells.join(" | ") + " |";
  return [
    line(rows[0].map((t, c) => pad(t, c))),
    line(delimiter),
    ...rows.slice(1).map(r => line(r.map((t, c) => pad(t, c)))),
  ];
}

const blank = (n: number) => Array<string>(n).fill("");
const swap = <T>(a: T[], i: number, j: number) => {
  [a[i], a[j]] = [a[j], a[i]];
};

/** A row inserted at `at` (1 = right under the header). */
export const addRow = (t: Table, at: number): Table => ({
  ...t,
  rows: [...t.rows.slice(0, Math.max(1, at)), blank(t.rows[0].length), ...t.rows.slice(Math.max(1, at))],
});
/** A row removed; the header stays. */
export const deleteRow = (t: Table, at: number): Table =>
  at < 1 || t.rows.length < 3 ? t : { ...t, rows: t.rows.filter((_, i) => i !== at) };
/** A body row moved up (-1) or down (1). */
export function moveRow(t: Table, at: number, by: -1 | 1): Table {
  const to = at + by;
  if (at < 1 || to < 1 || to >= t.rows.length) return t;
  const rows = t.rows.map(r => [...r]);
  swap(rows, at, to);
  return { ...t, rows };
}
/** A column inserted at `at` (0 = first). */
export const addColumn = (t: Table, at: number): Table => ({
  rows: t.rows.map(r => [...r.slice(0, at), "", ...r.slice(at)]),
  align: [...t.align.slice(0, at), null, ...t.align.slice(at)],
});
export const deleteColumn = (t: Table, at: number): Table =>
  t.rows[0].length < 2
    ? t
    : { rows: t.rows.map(r => r.filter((_, i) => i !== at)), align: t.align.filter((_, i) => i !== at) };
export function moveColumn(t: Table, at: number, by: -1 | 1): Table {
  const to = at + by;
  if (to < 0 || to >= t.align.length) return t;
  const rows = t.rows.map(r => [...r]);
  rows.forEach(r => swap(r, at, to));
  const align = [...t.align];
  swap(align, at, to);
  return { rows, align };
}
export const setAlign = (t: Table, at: number, align: Align): Table => ({
  ...t,
  align: t.align.map((a, i) => (i === at ? align : a)),
});

/** Tab-separated data (a copy from Sheets, Excel, Numbers) as cells; null when it is not that: every line needs a tab.
 *  ponytail: a quoted cell with a line break inside is split into two rows. */
export function parseTsv(text: string): string[][] | null {
  const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
  if (!lines.every(l => l.includes("\t"))) return null;
  const unquote = (c: string) => (/^".*"$/.test(c) ? c.slice(1, -1).replace(/""/g, '"') : c);
  return lines.map(l => l.split("\t").map(c => escapeCell(unquote(c).trim())));
}

/** Tab-separated rows as a table, the first row its header. */
export function tsvToTable(grid: string[][]): Table {
  const n = Math.max(...grid.map(r => r.length));
  return { rows: grid.map(r => [...r, ...blank(n - r.length)]), align: Array(n).fill(null) };
}

/** Pasted cells put into the table from cell (row, col) on; rows and columns are added where they run out. */
export function fillCells(t: Table, row: number, col: number, grid: string[][]): Table {
  let next = t;
  const cols = Math.max(...grid.map(r => r.length));
  while (next.align.length < col + cols) next = addColumn(next, next.align.length);
  while (next.rows.length < row + grid.length) next = addRow(next, next.rows.length);
  const rows = next.rows.map(r => [...r]);
  grid.forEach((r, i) => r.forEach((text, j) => (rows[row + i][col + j] = text)));
  return { ...next, rows };
}

/** A new table of `cols` columns and `body` empty rows, with the header named. */
export const newTable = (header: string[], body: number): Table => ({
  rows: [header, ...Array.from({ length: body }, () => blank(header.length))],
  align: header.map(() => null),
});
