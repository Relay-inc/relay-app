// The unified inbox: every account's loaded rows in one list, newest first.
type Row = { account: string; date: string };
const time = (row: Row) => Date.parse(row.date) || 0;

/** Newest first. */
export const newestFirst = <T extends Row>(rows: T[]) => [...rows].sort((a, b) => time(b) - time(a));

/**
 * The rows that are safe to show. An account with older pages still to load has a gap below its oldest loaded
 * row, so the merged list is only complete down to the highest of those edges (`more` = account -> has older pages).
 * Rows below stay in the state and show up after "more".
 */
export function visible<T extends Row>(rows: T[], more: Record<string, boolean>) {
  const oldest = new Map<string, number>();
  for (const row of rows)
    if (more[row.account]) oldest.set(row.account, Math.min(oldest.get(row.account) ?? Infinity, time(row)));
  const watermark = Math.max(-Infinity, ...oldest.values());
  return rows.filter(row => time(row) >= watermark);
}
