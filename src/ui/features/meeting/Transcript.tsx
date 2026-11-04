import { useEffect, useRef, useState } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import { meetingLanguage } from "../../../domain/calendar/rules";
import { hhmm, othersLabel } from "../../../domain/calendar/meeting-view";
import { startRecording, useRecordingStore, type LiveLine } from "../../../application/calendar/recording";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** A speaker's lines that follow each other as one turn, as in the transcript the vault gets. */
const turnsOf = (lines: LiveLine[]) =>
  lines.reduce<{ at: number; track: number; text: string }[]>((turns, line) => {
    const last = turns[turns.length - 1];
    if (last && last.track === line.track) last.text += ` ${line.text}`;
    else turns.push({ ...line });
    return turns;
  }, []);

/** The live transcript next to the notes: newest at the bottom, following it until you scroll up (then "Jump to live").
 *  Each turn has the clock time it was said; Others is named in a 1:1. Hovering a turn offers to quote it into the
 *  notes. Without a recording: a quiet line and Record. */
export function Transcript({
  meeting,
  noteText,
  onQuote,
}: {
  meeting: Meeting;
  noteText: string;
  onQuote: (who: string, text: string) => void;
}) {
  const { t } = useT();
  const mine = useRecordingStore(s => s.phase !== "idle" && s.meeting?.id === meeting.id);
  const busy = useRecordingStore(s => s.phase !== "idle");
  const lines = useRecordingStore(s => (mine ? s.lines : []));
  const { secs, upto, live, startedAt } = useRecordingStore();
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const follow = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const others = othersLabel(meeting.people, t("rec.others"));
  const turns = turnsOf(lines);
  const language = meetingLanguage(noteText, "auto");
  const behind = Math.round(secs - upto);
  return (
    <section
      aria-label={t("meet.transcript")}
      className="min-w-0 min-h-0 flex flex-col border-l border-separator bg-sidebar"
    >
      <div className="flex-none h-10 flex items-center gap-2 px-4.5 border-b border-separator">
        <span className="font-semibold">{t("meet.transcript")}</span>
        <span className="text-xs text-secondary">
          {language ? language.toUpperCase() : t("meet.auto")} · {t("meet.onThisMac")}
        </span>
        {mine && behind > 30 && live ? (
          <span className="text-xs text-tertiary">{t("meet.behind", { n: behind })}</span>
        ) : null}
        <span className="flex-1" />
        {mine ? (
          following ? (
            <span className="text-xs text-secondary">{t("meet.following")}</span>
          ) : (
            <button
              className="text-xs font-medium text-accent-text cursor-pointer hover:underline"
              onClick={() => {
                const el = scroller.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
            >
              {t("meet.jump")}
            </button>
          )
        ) : null}
      </div>
      {mine ? (
        <div
          ref={scroller}
          onScroll={e => {
            const el = e.currentTarget;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            setFollowing(follow.current);
          }}
          className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-4.5 py-3.5 select-text cursor-auto"
        >
          {turns.length ? (
            <>
              {/* the newest turn sits at the bottom, a short list under the header's edge */}
              <span className="flex-1" />
              {turns.map(turn => {
                const who = turn.track ? others : t("rec.me");
                return (
                  <div key={`${turn.track}-${turn.at}`} className="group px-2.5 py-2 rounded-lg hover:bg-fill-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-semibold ${turn.track ? "text-label" : "text-accent-text"}`}>{who}</span>
                      <span className="font-mono text-[11px] text-tertiary">
                        {hhmm(new Date(startedAt + turn.at * 1000))}
                      </span>
                      <span className="flex-1" />
                      <button
                        className="hidden group-hover:inline-flex items-center gap-1.5 h-5.5 px-2 rounded-md border border-separator-strong bg-raised text-[11.5px] font-medium cursor-pointer"
                        onClick={() => onQuote(who, turn.text)}
                      >
                        <Icon name="text" className="glyph size-3" />
                        {t("meet.quote")}
                      </button>
                    </div>
                    <div className="mt-0.75 text-[13.5px] leading-normal">{turn.text}</div>
                  </div>
                );
              })}
            </>
          ) : (
            <p className="m-0 text-[13px] text-secondary">{t("rec.listening")}</p>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="m-0 text-[13px] text-secondary">{t("meet.notRecording")}</p>
          <button
            className="inline-flex items-center gap-2 h-8 px-3.5 rounded-lg border border-separator-strong text-[13px] font-medium cursor-pointer hover:bg-fill disabled:opacity-50"
            disabled={busy}
            onClick={() => startRecording(meeting.id, meeting)}
          >
            <span className="size-2 rounded-full bg-late" />
            {t("rec.record")}
          </button>
        </div>
      )}
    </section>
  );
}
