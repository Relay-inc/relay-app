import type { ReactNode } from "react";

const CELL = "w-24 flex flex-col items-end tabular-nums";
const COST = "text-[11px] text-secondary";

/** A token row: the name, then tokens with their cost under them, for today and for the week. `head` is the column
 *  headings, `strong` sets the label in medium weight for a total. */
export function UsageRow({
  label,
  today,
  todayCost = "",
  week,
  weekCost = "",
  title,
  head = false,
  strong = false,
}: {
  label?: ReactNode;
  today: string;
  todayCost?: string;
  week: string;
  weekCost?: string;
  title?: string;
  head?: boolean;
  strong?: boolean;
}) {
  if (head)
    return (
      <div className="flex items-baseline gap-3 pb-1.5 text-[11px] text-tertiary">
        <span className="flex-1 min-w-0">{label}</span>
        <span className="w-24 text-right">{today}</span>
        <span className="w-24 text-right">{week}</span>
      </div>
    );
  return (
    <div className="flex items-center gap-3 py-2 border-t border-separator" title={title || undefined}>
      <span className={`flex-1 min-w-0 truncate text-sm ${strong ? "font-medium" : ""}`}>{label}</span>
      <span className={CELL}>
        <span className="text-sm font-medium">{today}</span>
        {todayCost && <span className={COST}>{todayCost}</span>}
      </span>
      <span className={CELL}>
        <span className="text-sm font-medium">{week}</span>
        {weekCost && <span className={COST}>{weekCost}</span>}
      </span>
    </div>
  );
}
