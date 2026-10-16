import { useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import { formatDuration } from "../../../domain/conversations/rules";
import "../../styles/conversations.css";

/** The agent is busy: the done line's divider with an accent band flowing along it towards what it is doing, so the
 *  turn ends where it ran. `label` is read out by assistive technology. `since`: when the turn started (ms), counted up
 *  every second next to the text. */
export function Working({ text = "", label = "", since }: { text?: string; label?: string; since?: number }) {
  const { t } = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!since) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
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
      {since ? <span className="tabular-nums">{formatDuration((now - since) / 1000)}</span> : null}
      <span className="flow rev flex-1 h-px"></span>
    </div>
  );
}
