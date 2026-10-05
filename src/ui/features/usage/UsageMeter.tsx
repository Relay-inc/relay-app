import { Html } from "../../components/Html";

type Level = "" | "soon" | "late";
// the fill and the percentage follow how close the limit is (the reminders' urgency colours)
const FILL = { "": "bg-secondary", soon: "bg-soon", late: "bg-late" };
const PCT = { "": "font-medium", soon: "font-semibold text-soon", late: "font-semibold text-late" };
export const DOT = { "": "bg-ok", soon: "bg-soon", late: "bg-late" };

/** A bar filled to `percent`. */
export function UsageBar({ percent, level }: { percent: number; level: Level }) {
  return (
    <div className="h-1.5 rounded-xs bg-fill-2 overflow-hidden">
      <span
        className={`block h-full rounded-xs ${FILL[level]}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      ></span>
    </div>
  );
}

/** One limit window: its name (`label`, markup from the provider's strings), the share used, a bar and when it
 *  resets. */
export function UsageMeter({
  label,
  percent,
  level,
  resets,
}: {
  label: string;
  percent: number;
  level: Level;
  resets: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-3 text-sm">
        <Html className="flex-1 min-w-0 truncate" html={label} />
        <span className={`tabular-nums ${PCT[level]}`}>{Math.round(percent)}%</span>
      </div>
      <UsageBar percent={percent} level={level} />
      {resets && <div className="text-xs text-secondary">{resets}</div>}
    </div>
  );
}
