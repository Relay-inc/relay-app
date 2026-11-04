import { useRef, useState } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import { loadMeetingNote, saveNotes } from "../../../application/calendar/meeting-view";
import { useCalendarStore } from "../../../application/calendar/store";
import { useT } from "../../hooks/useT";
import { MarkerIcon } from "./MarkerIcon";
import { MyPoints } from "./MyPoints";
import { NotesEditor, type NotesApi } from "./NotesEditor";
import { Transcript } from "./Transcript";

/** The Live step: the notes on the left (the note's `## Notes`, saved as you type) under the briefing's My points, the
 *  live transcript on the right. Works without a recording. When the notes were changed outside Relay a notice says so
 *  and nothing is overwritten. */
export function LiveStep({ meeting, notes, noteText }: { meeting: Meeting; notes: string; noteText: string }) {
  const { t } = useT();
  const api = useRef<NotesApi | null>(null);
  const [generation, setGeneration] = useState(0); // a Reload makes a fresh editor from the note
  const conflict = useCalendarStore(s => s.conflict);
  const saving = useCalendarStore(s => s.saving);
  const error = useCalendarStore(s => s.error);
  const reload = async () => {
    api.current?.discard();
    await loadMeetingNote(meeting);
    setGeneration(g => g + 1);
  };
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[3fr_2fr]">
      <section aria-label={t("meet.notes")} className="min-w-0 min-h-0 flex flex-col px-7 pt-4.5">
        <MyPoints meeting={meeting} note={noteText} />
        <div className="flex-none flex items-center gap-3 mt-1.5 mb-1.5">
          <h2 className="flex-1 m-0 text-[15px] font-semibold">{t("meet.notes")}</h2>
          {conflict ? (
            <span role="alert" className="flex items-center gap-2 text-xs text-secondary">
              {t("meet.conflict")}
              <button className="font-medium text-accent-text cursor-pointer hover:underline" onClick={reload}>
                {t("page.reload")}
              </button>
              <button
                className="font-medium text-accent-text cursor-pointer hover:underline"
                onClick={() => saveNotes(meeting, api.current?.text() ?? "", true)}
              >
                {t("page.keepMine")}
              </button>
            </span>
          ) : (
            <span className="text-xs text-secondary">{saving ? t("meet.saving") : t("meet.saved")}</span>
          )}
        </div>
        {error ? <div className="err-box mb-2">{error}</div> : null}
        {/* a click below the last line puts the cursor there */}
        <div
          className="flex-1 min-h-0 overflow-y-auto cursor-text"
          onClick={e => e.target === e.currentTarget && api.current?.focus()}
        >
          <NotesEditor
            key={`${meeting.id}:${generation}`}
            initial={notes}
            apiRef={api}
            onSave={text => void saveNotes(meeting, text)}
          />
        </div>
        <div className="flex-none h-9.5 flex items-center gap-4 border-t border-separator text-xs text-secondary">
          {(["action", "decision", "question"] as const).map((kind, i) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className="font-semibold">⌘{i + 1}</span>
              <MarkerIcon kind={kind} />
              {t(`meet.${kind}`)}
            </span>
          ))}
        </div>
      </section>
      <Transcript meeting={meeting} noteText={noteText} onQuote={(who, text) => api.current?.quote(who, text)} />
    </div>
  );
}
