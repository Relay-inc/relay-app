import type { ReactNode } from "react";

const TOKENS = "w-16 text-right tabular-nums";
const COST = "w-16 text-right text-secondary tabular-nums";
// a heading wider than its column ("This week") stays on one line and overflows to the left, over the empty cost cell
const HEAD = "flex justify-end whitespace-nowrap";

/** A token row: the name, then tokens and cost for today and for the week. `head` is the column headings. */
export function UsageRow({
  label,
  today,
  todayCost = "",
  week,
  weekCost = "",
  title,
  head = false,
}: {
  label?: ReactNode;
  today: string;
  todayCost?: string;
  week: string;
  weekCost?: string;
  title?: string;
  head?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-3 text-sm py-2 border-b border-separator ${head ? "text-secondary font-medium" : ""}`}
      title={title || undefined}
    >
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className={head ? `${TOKENS} ${HEAD}` : TOKENS}>{today}</span>
      <span className={COST}>{todayCost}</span>
      <span className={head ? `${TOKENS} ${HEAD}` : TOKENS}>{week}</span>
      <span className={COST}>{weekCost}</span>
    </div>
  );
}
