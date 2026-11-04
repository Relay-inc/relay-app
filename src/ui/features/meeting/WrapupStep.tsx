import { useState } from "react";
import { notesIn } from "../../../domain/calendar/meeting-view";
import { summaryIn, transcriptIn } from "../../../domain/calendar/wrapup";
import type { Meeting } from "../../../domain/calendar/types";
import { generateDraft, useWrapupStore } from "../../../application/calendar/wrapup";
import { openDetail } from "../../../application/navigation/panel";
import { noteKey } from "../../../domain/navigation/keys";
import { useT } from "../../hooks/useT";
import { WrapDraft } from "./WrapDraft";
import { WrapSteps } from "./WrapSteps";
import { PRIMARY, OUTLINE } from "./buttons";

/** The Wrap-up step: the summary draft on the left with Accept, the next steps and decisions on the right. A meeting
 *  whose note already has its summary shows it as saved; one with something to summarise and no draft yet offers to
 *  write it. */
export function WrapupStep({
  meeting,
  note,
  onNotes,
}: {
  meeting: Meeting;
  note: { path: string; text: string } | null;
  onNotes: () => void;
}) {
  const { t } = useT();
  const wrap = useWrapupStore(s => s.wraps[meeting.id]);
  const saved = note ? summaryIn(note.text) : null;
  const has = !!note && (!!notesIn(note.text)?.trim() || !!transcriptIn(note.text));
  // opening a draft that is still being written is nothing new; after a restart nothing remembers it
  const [asked, setAsked] = useState(false);
  if (!wrap && saved === null)
    return (
      <div className="flex-1 min-h-0 px-8 pt-8">
        <div className="max-w-120 flex flex-col items-start gap-3 p-4 rounded-xl border border-dashed border-separator-strong bg-sidebar">
          <p className="m-0 text-[13px] text-secondary">{has ? t("meet.wrap.offer") : t("meet.wrap.nothing")}</p>
          {has ? (
            <button
              className={PRIMARY}
              disabled={asked}
              onClick={() => {
                setAsked(true);
                void generateDraft(meeting);
              }}
            >
              {t("meet.wrap.write")}
            </button>
          ) : (
            <button className={OUTLINE} onClick={onNotes}>
              {t("meet.wrap.toNotes")}
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[3fr_2fr]">
      <WrapDraft
        meeting={meeting}
        wrap={wrap}
        noteText={note?.text ?? ""}
        onOpen={() => note && openDetail(noteKey(note.path))}
      />
      <WrapSteps meeting={meeting} wrap={wrap} noteText={note?.text ?? ""} />
    </div>
  );
}
