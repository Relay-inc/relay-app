import { useRef, useState } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import { loadMeetingNote, saveNotes } from "../../../application/calendar/meeting-view";
import { useCalendarStore } from "../../../application/calendar/store";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { NotesEditor, type NotesApi } from "./NotesEditor";
import { Transcript } from "./Transcript";

/** The Live step: the notes on the left (the note's `## Notes`, saved as you type), the live transcript on the right.
 *  Works without a recording. When the notes were changed outside Relay a notice says so and nothing is overwritten. */
export function LiveStep({ meeting, notes }: { meeting: Meeting; notes: string }) {
  const { t } = useT();
  const api = useRef<NotesApi | null>(null);
  const [generation, setGeneration] = useState(0); // a Reload makes a fresh editor from the note
  const conflict = useCalendarStore(s => s.conflict);
  const error = useCalendarStore(s => s.error);
  const reload = async () => {
    api.current?.discard();
    await loadMeetingNote(meeting);
    setGeneration(g => g + 1);
  };
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[3fr_2fr]">
      <section aria-label={t("meet.notes")} className="min-w-0 min-h-0 flex flex-col px-7 pt-4.5">
        <div className="flex-none flex items-center mb-1.5">
          <h2 className="flex-1 m-0 text-[15px] font-semibold">{t("meet.notes")}</h2>
          <span className="text-xs text-secondary">{t("meet.saved")}</span>
        </div>
        {conflict ? (
          <div
            role="alert"
            className="flex-none flex items-center gap-3 px-3 py-2 mb-2 rounded-lg bg-fill-2 text-[13px]"
          >
            <span className="flex-1 text-label">{t("meet.conflict")}</span>
            <button className="btn cursor-pointer" onClick={reload}>
              {t("page.reload")}
            </button>
            <button
              className="btn btn-primary cursor-pointer"
              onClick={() => saveNotes(meeting, api.current?.text() ?? "", true)}
            >
              {t("page.keepMine")}
            </button>
          </div>
        ) : null}
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
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold">⌘1</span>
            <Icon name="forward" className="glyph size-3.5 text-accent-text" />
            {t("meet.action")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold">⌘2</span>
            <span className="size-2 rotate-45 bg-viz-4" />
            {t("meet.decision")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold">⌘3</span>
            <span className="font-bold">?</span>
            {t("meet.question")}
          </span>
        </div>
      </section>
      <Transcript meeting={meeting} onQuote={text => api.current?.quote(text)} />
    </div>
  );
}
