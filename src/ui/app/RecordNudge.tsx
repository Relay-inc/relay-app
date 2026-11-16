import { answerNudge, useNudgeStore } from "../../application/calendar/nudge-window";
import { useT } from "../hooks/useT";

/** The meeting that started without a recording, with Skip and Record (application/calendar/nudge-window.ts). */
export function RecordNudge() {
  const { t } = useT();
  const meeting = useNudgeStore(s => s.meeting);
  if (!meeting) return null;
  return (
    <div className="h-screen p-1.5 select-none">
      <div
        data-tauri-drag-region
        className="h-full flex items-center gap-3 rounded-xl border border-separator-strong bg-bg px-3.5 text-label shadow-lg"
      >
        <span className="size-2.5 flex-none rounded-full bg-late animate-pulse"></span>
        <div data-tauri-drag-region className="flex-1 min-w-0">
          <p data-tauri-drag-region className="text-[13px] font-semibold truncate">
            {t("cal.nudge")}
          </p>
          <p data-tauri-drag-region className="text-xs text-secondary truncate">
            {meeting.time} · {meeting.title}
          </p>
        </div>
        <button className="btn px-2.5 cursor-pointer" onClick={() => answerNudge(false)}>
          {t("cal.nudgeSkip")}
        </button>
        <button className="btn btn-primary px-3 cursor-pointer" onClick={() => answerNudge(true)}>
          {t("rec.record")}
        </button>
      </div>
    </div>
  );
}
