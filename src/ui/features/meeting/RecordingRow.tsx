import {
  cancelRecording,
  dismissRecordingError,
  retryRecording,
  stopRecording,
  useRecordingStore,
} from "../../../application/calendar/recording";
import { othersLabel } from "../../../domain/calendar/meeting-view";
import type { Meeting } from "../../../domain/calendar/types";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { clock, Meter } from "../conversations/RecordingBar";

/** What the recording of this meeting is doing, above its header: the red dot and the time, both levels, Stop; the
 *  transcribing after Stop; or why it did not start. Nothing while it is not being recorded. */
export function RecordingRow({ meeting }: { meeting: Meeting }) {
  const { t } = useT();
  const { phase, secs, me, others, system, heard, why, progress, error, retry } = useRecordingStore();
  const mine = useRecordingStore(s => s.meeting?.id === meeting.id);
  if (error)
    return (
      <div className="flex-none flex items-start gap-3 px-7 py-2.5 border-b border-separator text-xs text-late">
        <span className="flex-1 min-w-0 wrap-anywhere">{t("rec.failed", { error })}</span>
        {retry ? (
          <button className="btn cursor-pointer" onClick={() => retryRecording()}>
            {t("rec.retry")}
          </button>
        ) : null}
        <button
          className="grid size-5 place-items-center rounded border-0 bg-transparent text-secondary hover:bg-fill-2"
          aria-label={t("nav.close")}
          onClick={dismissRecordingError}
        >
          <Icon name="close" className="glyph size-3" />
        </button>
      </div>
    );
  if (phase === "idle" || !mine) return null;
  return (
    <div className="flex-none flex flex-col justify-center gap-1 px-7 py-2 min-h-11 border-b border-separator">
      <div className="flex items-center gap-4">
        <span className="inline-flex items-center gap-2 font-semibold text-late">
          <span className={`size-2.25 rounded-full bg-late ${phase === "recording" ? "animate-pulse" : ""}`} />
          {phase === "recording" ? (
            <span className="font-mono text-[13px] tabular-nums">{clock(secs)}</span>
          ) : (
            <span className="font-normal text-secondary">{t("rec.transcribingRest")}</span>
          )}
        </span>
        {phase === "recording" ? (
          <>
            <Meter label={t("rec.me")} level={me} />
            {system ? <Meter label={othersLabel(meeting.people, t("rec.others"))} level={others} /> : null}
            <span className="flex-1" />
            <button className="btn cursor-pointer" onClick={cancelRecording}>
              {t("rec.cancel")}
            </button>
            <button
              className="inline-flex items-center gap-2 h-7.5 px-3 rounded-lg bg-late text-white text-[13px] font-semibold cursor-pointer"
              onClick={stopRecording}
            >
              <span className="size-2 rounded-xs bg-white" />
              {t("rec.stop")}
            </button>
          </>
        ) : (
          <span className="text-[13px] tabular-nums text-secondary">{Math.round(progress * 100)}%</span>
        )}
      </div>
      {phase === "recording" ? (
        <p className="m-0 text-xs text-secondary">
          {!system
            ? t("rec.noSystem", { why: why || "?" })
            : !heard && secs >= 15
              ? t("rec.silentMac")
              : t("rec.consent")}
        </p>
      ) : null}
    </div>
  );
}
