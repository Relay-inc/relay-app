import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";

// the fill follows how close the limit is (the reminders' urgency colours)
const FILL = { "": "bg-secondary", soon: "bg-soon", late: "bg-late" };

/** One limit window: its name (`label`, markup from the provider's strings), the share used, a thin bar and when it
 *  resets. */
export function UsageMeter({
  label,
  percent,
  level,
  resets,
}: {
  label: string;
  percent: number;
  level: "" | "soon" | "late";
  resets: string;
}) {
  const { t } = useT();
  return (
    <div className="pt-2 pb-2.5 border-b border-separator">
      <div className="flex items-baseline gap-3 text-sm">
        <Html className="flex-1 min-w-0 truncate" html={label} />
        <span className="tabular-nums">{t("usage.used", { pct: Math.round(percent) })}</span>
      </div>
      <div className="h-1 rounded-xs bg-fill mt-1.5 mb-1 overflow-hidden">
        <span
          className={`block h-full rounded-xs ${FILL[level]}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        ></span>
      </div>
      <div className="text-sm text-secondary">{resets}</div>
    </div>
  );
}
