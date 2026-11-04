import { dismissRecordingError, retryRecording, useRecordingStore } from "../../../application/calendar/recording";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

/** Why a recording did not start or end, under the title bar, with the way to try again. */
export function RecordingError() {
  const { t } = useT();
  const { error, retry } = useRecordingStore();
  if (!error) return null;
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
}
