import { openDetail } from "../../../application/navigation/panel";
import { noteKey } from "../../../domain/navigation/keys";
import { useT } from "../../hooks/useT";

/** The Wrap-up step, for now one line: after Stop the summary is written into the meeting note by the conversation
 *  that opens; this links to the note. */
export function WrapupStep({ note }: { note: { path: string } | null }) {
  const { t } = useT();
  return (
    <div className="flex-1 min-h-0 px-14 pt-6">
      <div className="flex items-center gap-3 max-w-180 text-sm text-secondary">
        <span>{note ? t("meet.wrapup") : t("meet.wrapupNone")}</span>
        {note ? (
          <button className="btn cursor-pointer" onClick={() => openDetail(noteKey(note.path))}>
            {t("today.openNote")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
