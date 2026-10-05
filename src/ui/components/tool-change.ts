import type { ToolInput } from "../../domain/conversations/types";
import type { Hunk } from "../../domain/agents/types";

/** What an edit removed and added, as lines, when the call carries the old and new text (Edit, MultiEdit) or the
 *  content (Write). */
export function changeOf(name: string, input: ToolInput | undefined) {
  const args = input || {};
  const split = (text: unknown) => (typeof text === "string" && text ? text.split("\n") : []);
  if (name === "Write") return args.content === undefined ? null : { del: [], add: split(args.content) };
  if (name !== "Edit" && name !== "MultiEdit") return null;
  const edits: ToolInput[] = name === "MultiEdit" && Array.isArray(args.edits) ? args.edits : [args];
  const pairs = edits.filter(edit => typeof edit?.old_string === "string" && typeof edit?.new_string === "string");
  if (!pairs.length) return null;
  return { del: pairs.flatMap(edit => split(edit.old_string)), add: pairs.flatMap(edit => split(edit.new_string)) };
}

/** A row of the diff block: a line with its number (the old file's for a removed line, the new file's otherwise), or
 *  `gap` between two hunks. */
export type DiffRow = { sign: " " | "-" | "+"; n: number; text: string } | { gap: true };

/** Hunks as rows, with one unchanged line of context before and after each change. */
export function hunkRows(hunks: Hunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of hunks) {
    const lines = hunk.lines.filter(line => !line.startsWith("\\")); // "\ No newline at end of file"
    let oldN = hunk.oldStart;
    let newN = hunk.newStart;
    const all = lines.map(line => {
      const sign = line[0] === "-" || line[0] === "+" ? line[0] : " ";
      const row = { sign, n: sign === "-" ? oldN : newN, text: line.slice(1) } as const;
      if (sign !== "+") oldN++;
      if (sign !== "-") newN++;
      return row;
    });
    const first = all.findIndex(row => row.sign !== " ");
    if (first < 0) continue;
    let last = all.length - 1;
    while (all[last].sign === " ") last--;
    if (rows.length) rows.push({ gap: true });
    rows.push(...all.slice(Math.max(0, first - 1), last + 2));
  }
  return rows;
}
