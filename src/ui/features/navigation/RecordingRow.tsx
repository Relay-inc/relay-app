import { useEffect, useState } from "react";
import { recordingNow } from "../../../application/navigation/recording-status";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";

const clock = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
};

/** Above the footer while Relay records: a red dot, what is recorded, the time (or the transcribing), and a click to
 *  where it happens. Nothing while the microphone is free. */
export function RecordingRow() {
  const { t } = useT();
  const now = useDerived(recordingNow);
  const counting = now?.since !== undefined;
  const [clockNow, setClockNow] = useState(Date.now);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  if (!now) return null;
  const detail =
    now.progress !== undefined
      ? t("rec.transcribingPct", { pct: Math.round(now.progress * 100) })
      : now.since !== undefined
        ? clock(clockNow - now.since)
        : "";
  return (
    <button
      className="mx-2 mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs enabled:hover:bg-fill-2"
      title={now.open ? t("rec.goTo") : now.label}
      disabled={!now.open}
      onClick={now.open}
    >
      <span className="size-2 flex-none animate-pulse rounded-full bg-late"></span>
      <span className="min-w-0 flex-1 truncate text-label">{now.label}</span>
      <span className="flex-none tabular-nums text-secondary">{detail}</span>
    </button>
  );
}
