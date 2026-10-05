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
import { noteKey } from "../../../domain/navigation/keys";
import { openDetail } from "../../../application/navigation/panel";
import { useNavigationStore } from "../../../application/navigation/store";
import { useConversationsStore } from "../../../application/conversations/store";
import { useRelatedStore } from "../../../application/related/store";
import { loadRelated } from "../../../application/related/related";

/** The vault notes closest to the open conversation, from the full-text index: a compact list under the editor. */
function RelatedNotes() {
  const { t } = useT();
  const key = useNavigationStore(s => s.selected);
  const count = useConversationsStore(s => s.messages[key]?.length);
  const hits = useRelatedStore(s => s.hits[key]);

  useEffect(() => {
    if (count) loadRelated(key);
  }, [key, count]);

  return (
    <div className="flex-none mt-2 pt-2 border-t border-separator max-h-48 overflow-y-auto">
      <div className="text-xs font-semibold text-secondary mb-1">{t("notes.related")}</div>
      {count === undefined ? (
        <div className="text-xs text-secondary">{t("notes.noChat")}</div>
      ) : !hits ? (
        <div className="text-xs text-secondary">{t("pr.loading")}</div>
      ) : !hits.length ? (
        <div className="text-xs text-secondary">{t("notes.noRelated")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {hits.map(hit => (
            <button
              key={hit.path}
              className="block text-left cursor-pointer"
              title={hit.path}
              onClick={() => openDetail(noteKey(hit.path))}
            >
              <div className="vlink text-[13px] font-medium truncate">{hit.title}</div>
              <div className="text-xs text-secondary line-clamp-2">{hit.snippet}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Plain-text scratch notes of one project: a list on top, the open note below as a monospace field that saves as you
 *  type, and the notes related to the open conversation under it. */
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
      <RelatedNotes />
    </div>
  );
}
