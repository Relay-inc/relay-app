import { useEffect } from "react";
import {
  dismissRecordingError,
  hideKept,
  keptStart,
  loadKept,
  retryRecording,
  useRecordingStore,
} from "../../../application/calendar/recording";
import { sentAt } from "../../../shared/format";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

export const clock = (secs: number) =>
  `${Math.floor(secs / 3600) ? Math.floor(secs / 3600) + ":" : ""}${String(Math.floor(secs / 60) % 60).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
// a level meter: a short bar that fills with the loudest sound of the last quarter second
export const Meter = ({ label, level }: { label: string; level: number }) => (
  <span className="flex items-center gap-1.5 text-xs text-secondary">
    {label}
    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-fill-2">
      <span className="block h-full bg-ok" style={{ width: `${Math.min(100, Math.sqrt(level) * 100)}%` }}></span>
    </span>
  </span>
);

/** The recording being written out, on top of Today's queue: the transcription's progress, or why it failed, or a kept
 *  recording to try again. */
export function RecordingBar() {
  const { t, locale } = useT();
  const { title, phase, progress, error, retry, kept } = useRecordingStore();
  useEffect(() => {
    loadKept();
  }, []);
  // the one being recorded is in the card above Today's queue (and in its Meeting view, with Cancel)
  if ((phase === "idle" || phase === "recording") && !error && !kept.length) return null;
  return (
    <section className="grid grid-cols-1 gap-2 rounded-xl border border-separator-strong bg-raised p-3.5">
      {phase === "saving" ? (
        <>
          <div className="flex items-center gap-2.5 text-[13px] text-secondary">
            <Icon name="mic" className="glyph size-4 animate-pulse" />
            <span className="flex-1 truncate">{t("rec.saving", { title: title })}</span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <p className="text-xs text-secondary">{t("rec.keepOpen")}</p>
        </>
      ) : !error ? (
        <div className="flex items-center gap-2.5 text-xs text-secondary">
          <Icon name="mic" className="glyph size-4 flex-none" />
          <span className="min-w-0 flex-1">
            {t("rec.kept", { time: sentAt(keptStart(kept[0]).getTime(), locale) })}
          </span>
          <button className="btn cursor-pointer" onClick={() => retryRecording(kept[0])}>
            {t("rec.transcribe")}
          </button>
          <button
            className="grid size-5 place-items-center rounded border-0 bg-transparent text-secondary hover:bg-fill-2"
            aria-label={t("nav.close")}
            onClick={hideKept}
          >
            <Icon name="close" className="glyph size-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 text-xs text-late">
          <span className="min-w-0 flex-1 wrap-anywhere">{t("rec.failed", { error })}</span>
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
      )}
    </section>
  );
}
