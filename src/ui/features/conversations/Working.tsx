import { useT } from "../../hooks/useT";
import "../../styles/conversations.css";

/** The agent is busy: the done line's divider with an accent band flowing along it towards what it is doing, so the
 *  turn ends where it ran. `label` is read out by assistive technology. */
export function Working({ text = "", label = "" }: { text?: string; label?: string }) {
  const { t } = useT();
  return (
    <div
      className="relay-working flex items-center gap-2.5 text-tertiary text-xs"
      role={label ? "status" : undefined}
      aria-label={label || undefined}
    >
      <span className="flow flex-1 h-px"></span>
      <span className="dots max-w-[70%] min-w-0 truncate [&_code]:font-mono [&_code]:text-[11px]">
        {text || t("bar.working")}
      </span>
      <span className="flow rev flex-1 h-px"></span>
    </div>
  );
}
