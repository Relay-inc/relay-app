import { useState, type KeyboardEvent } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import type { Board } from "../../../domain/board/rules";
import { closeComposer, createCard } from "../../../application/board/board";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";

/** The New task dialog: the column it goes in (the lane whose + opened it, or the first), a title and an optional
 *  description. Enter in the title or Cmd-Enter creates it, at once on the board and then in the tracker. Escape or a
 *  click on the backdrop closes it. The board keys it per opening, so it starts empty. */
export function BoardNewTask({ provider, board, column }: { provider: BoardProvider; board: Board; column: string }) {
  const { t } = useT();
  const [lane, setLane] = useState(column);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = () => {
    if (!title.trim()) return;
    closeComposer();
    createCard(provider, lane, title, description);
  };
  // the dialog's keys stay in it: the app's Esc would close the board or stop a turn
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeComposer();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === "INPUT")) {
      e.preventDefault();
      create();
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,10,14,.32)]"
      onClick={e => {
        if (e.target === e.currentTarget) closeComposer();
      }}
    >
      <div
        className="ticket-window w-110 max-w-[calc(100vw-48px)] flex flex-col gap-3 p-5 bg-bg rounded-[14px]"
        role="dialog"
        aria-label={t("kb.newTask")}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-[15px] font-semibold flex-1">{t("kb.newTask")}</h2>
          <Select
            className="field max-w-50"
            aria-label={t("kb.newTaskLane")}
            options={board.columns.map(c => ({ id: c.id, name: c.name }))}
            value={lane}
            onChange={setLane}
          />
        </div>
        <input
          className="field"
          placeholder={t("kb.newTaskTitle")}
          aria-label={t("kb.newTaskTitle")}
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <textarea
          className="field min-h-24 resize-y py-2"
          placeholder={t("kb.newTaskDesc")}
          aria-label={t("kb.newTaskDesc")}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <div className="flex items-center justify-end gap-2">
          <button className="btn h-8 rounded-lg" onClick={closeComposer}>
            {t("kb.cancel")}
          </button>
          <button className="btn btn-primary h-8 rounded-lg" disabled={!title.trim()} onClick={create}>
            {t("kb.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
