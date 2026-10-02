import { useEffect } from "react";
import { scratchTitle } from "../../../domain/scratch/rules";
import { useScratchStore } from "../../../application/scratch/store";
import {
  deleteScratch,
  editScratch,
  loadScratch,
  newScratch,
  selectScratch,
} from "../../../application/scratch/scratch";
import { useT } from "../../hooks/useT";

/** Plain-text scratch notes of one project: a list on top, the open note below as a monospace field that saves as you
 *  type. */
export function ScratchPanel({ project }: { project: string }) {
  const { t } = useT();
  const notes = useScratchStore(s => s.notes);
  const openKey = useScratchStore(s => s.open);
  const open = notes.find(note => note.key === openKey);

  useEffect(() => {
    if (project && project !== useScratchStore.getState().project) loadScratch(project);
  }, [project]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-2">
        <button className="btn btn-primary h-7.5 px-3 rounded-lg text-[13px] cursor-pointer" onClick={newScratch}>
          + {t("notes.new")}
        </button>
        {open ? (
          <button
            className="btn h-7.5 px-3 rounded-lg text-[13px] cursor-pointer ml-auto"
            onClick={() => deleteScratch(open.key)}
          >
            {t("notes.delete")}
          </button>
        ) : null}
      </div>
      <div className="flex flex-col max-h-40 overflow-y-auto mb-2">
        {notes.map(note => (
          <button
            key={note.key}
            className={`text-left text-[13px] px-2 py-1 rounded-md cursor-pointer truncate ${
              note.key === openKey ? "bg-fill-2" : "hover:bg-fill"
            }`}
            onClick={() => selectScratch(note.key)}
          >
            {scratchTitle(note.text) || t("notes.untitled")}
          </button>
        ))}
      </div>
      {open ? (
        <textarea
          key={open.key}
          className="flex-1 min-h-0 w-full resize-none rounded-lg bg-fill p-3 font-mono text-[13px] outline-none focus:outline-2 focus:outline-accent/45"
          value={open.text}
          placeholder={t("notes.placeholder")}
          onChange={e => editScratch(open.key, e.target.value)}
        />
      ) : (
        <div className="text-secondary">{t("notes.empty")}</div>
      )}
    </div>
  );
}
