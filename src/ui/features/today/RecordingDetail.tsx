import { useEffect, useRef } from "react";
import {
  cancelRecording,
  stopRecording,
  useRecordingStore,
  type LiveLine,
} from "../../../application/calendar/recording";
import { useT } from "../../hooks/useT";
import { clock, Meter } from "../conversations/RecordingBar";

/** A speaker's lines that follow each other as one turn, as in the transcript the vault gets. */
const turnsOf = (lines: LiveLine[]) =>
  lines.reduce<{ at: number; track: number; text: string }[]>((turns, line) => {
    const last = turns[turns.length - 1];
    if (last && last.track === line.track) last.text += ` ${line.text}`;
    else turns.push({ ...line });
    return turns;
  }, []);

/** The meeting being recorded in Today's big pane: the time, both levels, Stop and Cancel on top, the live transcript
 *  below. It follows the newest line unless you scrolled up to read. */
export function RecordingDetail() {
  const { t } = useT();
  const { meeting, phase, secs, me, others, system, lines, upto, live, progress } = useRecordingStore();
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const turns = turnsOf(lines);
  return (
    <div className="min-w-0 min-h-0 flex flex-col">
      <div className="flex-none flex flex-col gap-2.5 mx-10 pt-8 pb-5 border-b border-separator">
        <span className="flex items-center gap-2 text-xs text-tertiary">
          <span className={`size-2 rounded-full bg-late ${phase === "recording" ? "animate-pulse" : ""}`}></span>
          {phase === "recording" ? t("rec.recording") : t("rec.transcribingRest")}
        </span>
        <h1 className="m-0 text-2xl leading-snug font-semibold tracking-tight text-pretty select-text">
          {meeting?.title || t("wait.meetingUntitled")}
        </h1>
        {phase === "recording" ? (
          <div className="flex flex-wrap items-center gap-4 mt-1">
            <span className="text-[13px] tabular-nums text-secondary">{clock(secs)}</span>
            <Meter label={t("rec.me")} level={me} />
            {system ? <Meter label={t("rec.mac")} level={others} /> : null}
            <span className="flex-1"></span>
            <button className="btn cursor-pointer" onClick={cancelRecording}>
              {t("rec.cancel")}
            </button>
            <button className="btn btn-primary cursor-pointer" onClick={stopRecording}>
              {t("rec.stop")}
            </button>
          </div>
        ) : (
          <span className="text-[13px] tabular-nums text-secondary">{Math.round(progress * 100)}%</span>
        )}
      </div>
      <div
        ref={scroller}
        onScroll={e => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 min-h-0 overflow-y-auto px-10 pt-6 pb-8 select-text cursor-auto"
      >
        <div className="flex flex-col gap-4 max-w-170">
          {turns.length ? (
            turns.map(turn => (
              <p key={`${turn.track}-${turn.at}`} className="m-0 text-[15px] leading-relaxed">
                <span className="block text-xs text-tertiary">
                  <span className="tabular-nums">{clock(Math.floor(turn.at))}</span>{" "}
                  <span className="font-medium text-secondary">{t(turn.track ? "rec.others" : "rec.me")}</span>
                </span>
                {turn.text}
              </p>
            ))
          ) : (
            <p className="m-0 text-[13px] text-secondary">{t("rec.listening")}</p>
          )}
          {phase === "recording" ? (
            <p className="m-0 text-xs text-tertiary">
              {live ? t("rec.liveUpto", { time: clock(upto) }) : t("rec.liveStopped")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
