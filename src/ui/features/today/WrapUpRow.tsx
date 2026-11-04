import type { Owed } from "../../../domain/today/day";
import { openOwed } from "../../../application/today/day";
import { timeOf } from "../../../application/calendar/calendar";
import { useT } from "../../hooks/useT";

/** On top of the queue: the meetings of the last three days that ended without their summary, as one row. Wrap up opens
 *  the oldest of them on its Wrap-up step. */
export function WrapUpRow({ owed }: { owed: Owed[] }) {
  const { t, tn } = useT();
  if (!owed.length) return null;
  const [oldest] = owed;
  return (
    <div className="flex items-center gap-2.5 mt-1.5 mb-1 py-2 pl-2.5 pr-2 rounded-[10px] bg-fill">
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2 1.6"
        className="size-3.5 flex-none text-secondary"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="4.6" />
      </svg>
      <span className="flex-1 min-w-0 flex flex-col leading-snug">
        <span className="font-semibold">{tn("today.wrapUps", owed.length)}</span>
        <span className="text-xs text-secondary truncate">
          {oldest.title} ({timeOf(oldest.start)}){owed.length > 1 ? ` +${owed.length - 1}` : ""}
        </span>
      </span>
      <button
        className="flex-none h-7 px-3 rounded-lg border border-separator-strong bg-raised text-[13px] font-medium cursor-pointer hover:bg-fill"
        onClick={() => void openOwed(oldest)}
      >
        {t("today.wrapUp")}
      </button>
    </div>
  );
}
