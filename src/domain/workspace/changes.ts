import { diffLines, merge3 } from "./merge.ts";

// The Changes feed (lib.rs changes.rs): what Relay-run Claude jobs wrote to the vault, kept for review. An entry is one
// job, with the notes it changed as {before, after}; a note is open until the user keeps it or undoes it.

export type ChangeFile = {
  path: string;
  before: string | null;
  after: string | null;
  state: "open" | "kept" | "undone";
};
export type Change = {
  id: string;
  at: number;
  /** "capture" or "action:<name>" */
  source: string;
  /** The conversation's title, or the note's name */
  subject: string;
  reason: string;
  files: ChangeFile[];
};
/** The three texts of a note that was edited after the job (null: no such note). */
export type Merge = { current: string | null; before: string | null; after: string | null };

/** Entries with a note still to review are "open"; the rest are "Reviewed". */
export const isOpen = (c: Change) => c.files.some(f => f.state === "open");
export const openCount = (changes: Change[]) => changes.filter(isOpen).length;

export type DiffLine = { sign: " " | "+" | "-"; text: string };
/** A note's change as the lines of a unified diff, with `context` unchanged lines around each change. */
export function diffOf(before: string | null, after: string | null, context = 1): DiffLine[] {
  const a = before === null ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === null ? [] : after.replace(/\n$/, "").split("\n");
  const out: DiffLine[] = [];
  const same = (from: number, to: number) => {
    const run = a.slice(from, to).map((text): DiffLine => ({ sign: " ", text }));
    // a long unchanged run keeps its edge lines only
    return run.length > context * 2 + 1 ? [...run.slice(0, context), ...run.slice(-context)] : run;
  };
  let at = 0;
  const hunks = diffLines(a, b);
  for (const h of hunks) {
    const lead = same(at, h.from);
    out.push(...(out.length ? lead : lead.slice(-context)));
    out.push(...a.slice(h.from, h.to).map((text): DiffLine => ({ sign: "-", text })));
    out.push(...h.lines.map((text): DiffLine => ({ sign: "+", text })));
    at = h.to;
  }
  out.push(...same(at, a.length).slice(0, context));
  return out;
}
export const counts = (lines: DiffLine[]) => ({
  add: lines.filter(l => l.sign === "+").length,
  del: lines.filter(l => l.sign === "-").length,
});

/** What Undo makes of a note edited since the job: the job's change taken out of what is there now. `null` when the
 *  user's lines and the job's are the same lines (nothing is written then; the user keeps their text). */
export function undoMerge({ current, before, after }: Merge): string | null {
  if (current === null || after === null) return null;
  return merge3(after, current, before ?? "");
}
