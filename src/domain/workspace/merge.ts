// A page open in the editor and its file changed by someone else: a line-based three-way merge (diff3) of what Relay
// last read or wrote (base), what is typed (ours) and the file now (theirs).

/** A changed run of lines: base lines [from, to) became `lines`. */
export type Hunk = { from: number; to: number; lines: string[] };

const LCS_CELLS = 4_000_000; // ponytail: past this the changed middle is one hunk, a finer diff when big notes need it

/** The changes from `a` to `b`, as hunks over a's lines, in order. */
export function diffLines(a: string[], b: string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (!n && !m) return [];
  if (!n || !m || n * m > LCS_CELLS) return [{ from: start, to: endA, lines: b.slice(start, endB) }];
  // longest common subsequence of the middles, then walk it into hunks
  const len = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      len[i][j] = a[start + i] === b[start + j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      close();
      i++;
      j++;
    } else if (j < m && (i === n || len[i][j + 1] >= len[i + 1][j])) {
      open ??= { from: start + i, to: start + i, lines: [] };
      open.lines.push(b[start + j++]);
    } else {
      open ??= { from: start + i, to: start + i, lines: [] };
      open.to = start + ++i;
    }
  }
  close();
  return hunks;
}

const same = (x: Hunk, y: Hunk) => x.from === y.from && x.to === y.to && x.lines.join("\n") === y.lines.join("\n");
// two hunks touch the same base lines, or insert at the same place
const clash = (x: Hunk, y: Hunk) => (x.from < y.to && y.from < x.to) || x.from === y.from || x.to === y.to;

/** base + both sides' changes, or null when they changed the same lines differently (the user decides). */
export function merge3(base: string, ours: string, theirs: string): string | null {
  if (ours === base) return theirs;
  if (theirs === base || theirs === ours) return ours;
  const lines = base.split("\n");
  const mine = diffLines(lines, ours.split("\n"));
  const other = diffLines(lines, theirs.split("\n"));
  for (const x of mine) for (const y of other) if (clash(x, y) && !same(x, y)) return null;
  const all = [...mine, ...other.filter(y => !mine.some(x => same(x, y)))].sort(
    (x, y) => x.from - y.from || x.to - y.to,
  );
  const out: string[] = [];
  let at = 0;
  for (const h of all) {
    out.push(...lines.slice(at, h.from), ...h.lines);
    at = h.to;
  }
  out.push(...lines.slice(at));
  return out.join("\n");
}

/** `before` → `after` as character changes, one per changed run of lines (for an editor: what is typed between them
 *  keeps its place), in order, positions in `before`. */
export function lineChanges(before: string, after: string): { from: number; to: number; insert: string }[] {
  const lines = before.split("\n");
  const at = [0];
  for (const line of lines) at.push(at[at.length - 1] + line.length + 1);
  const n = lines.length;
  return diffLines(lines, after.split("\n")).map(({ from, to, lines: put }) => {
    if (to < n) return { from: at[from], to: at[to], insert: put.map(l => l + "\n").join("") };
    if (from < n && (put.length || !from)) return { from: at[from], to: before.length, insert: put.join("\n") };
    if (from < n) return { from: at[from] - 1, to: before.length, insert: "" }; // the last lines removed with their break
    return { from: before.length, to: before.length, insert: "\n" + put.join("\n") };
  });
}

/** The one change that turns `before` into `after`: what they share at the start and the end stays. */
export function oneChange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** A Yjs text delta (retain, insert, delete) applied to where a text's head ends (`head` characters in): text inserted
 *  before that end grows the head, text removed from it shrinks it. What lands exactly at the end belongs to the body. */
export function headAfter(delta: { retain?: number; insert?: unknown; delete?: number }[], head: number): number {
  let at = 0;
  for (const d of delta) {
    if (d.retain) at += d.retain;
    else if (d.insert !== undefined) {
      const n = typeof d.insert === "string" ? d.insert.length : 1;
      if (at < head) head += n;
      at += n;
    } else if (d.delete && at < head) head -= Math.min(at + d.delete, head) - at;
  }
  return head;
}
