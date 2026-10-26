// A file's patch as GitHub gives it (unified diff hunks) as lines to draw and to comment on: a hunk header, or a line
// with its number in the old and the new file. A comment goes on the new line (RIGHT), or on the old one for a
// line that was removed (LEFT), as GitHub's review API wants it.

export type DiffLine =
  | { kind: "hunk"; text: string }
  | { kind: "add" | "del" | "ctx"; old: number | null; new: number | null; text: string };
export type Side = "LEFT" | "RIGHT";

export function parsePatch(patch: string | null | undefined): DiffLine[] {
  const out: DiffLine[] = [];
  let old = 0;
  let neu = 0;
  for (const raw of (patch ?? "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      old = Number(hunk[1]);
      neu = Number(hunk[2]);
      out.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("\\")) continue; // "\\ No newline at end of file"
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") out.push({ kind: "add", old: null, new: neu++, text });
    else if (sign === "-") out.push({ kind: "del", old: old++, new: null, text });
    else if (out.length) out.push({ kind: "ctx", old: old++, new: neu++, text });
  }
  return out;
}

/** A row of the side-by-side view: a hunk header, or the old line on the left and the new one on the right. A run of
 *  removed lines pairs up with the added run after it, line by line, the longer run's rest against nothing. */
export type SplitRow = { kind: "hunk"; text: string } | { kind: "pair"; left: DiffLine | null; right: DiffLine | null };

export function splitRows(lines: DiffLine[]): SplitRow[] {
  const out: SplitRow[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.kind === "hunk") {
      out.push({ kind: "hunk", text: line.text });
      i++;
    } else if (line.kind === "ctx") {
      out.push({ kind: "pair", left: line, right: line });
      i++;
    } else {
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (lines[i]?.kind === "del") dels.push(lines[i++]);
      while (lines[i]?.kind === "add") adds.push(lines[i++]);
      for (let n = 0; n < Math.max(dels.length, adds.length); n++)
        out.push({ kind: "pair", left: dels[n] ?? null, right: adds[n] ?? null });
    }
  }
  return out;
}

/** Where a comment on the line goes: the new line, or the old one for a removed line. */
export const anchorOf = (line: DiffLine): { line: number; side: Side } | null =>
  line.kind === "hunk"
    ? null
    : line.kind === "del"
      ? { line: line.old!, side: "LEFT" }
      : { line: line.new!, side: "RIGHT" };

/** Whether a line of a file is in its patch, on that side (a finding Claude places elsewhere cannot be a comment). */
export const inPatch = (lines: DiffLine[], line: number, side: Side) =>
  lines.some(
    l =>
      l.kind !== "hunk" && (side === "LEFT" ? l.kind === "del" && l.old === line : l.kind !== "del" && l.new === line),
  );
