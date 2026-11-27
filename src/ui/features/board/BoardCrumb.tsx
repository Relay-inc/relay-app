import { useRef, useState } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import { linkedProject, pickBoard, pickProject } from "../../../application/board/board";
import { openProjectSettings } from "../../../application/navigation/navigation";
import { projectLabel } from "../../../application/workspace/vault";
import { useBoardStore } from "../../../application/board/store";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { PopHeading } from "./PopHeading";
import { POPOVER, POP_ROW } from "./toolbar";

/** The board's crumb in the title bar: "/ <board>", which opens the menu to switch to another board of the project or
 *  another project. Which project it belongs to is set in Settings › Projects; the menu says it and opens it there. */
export function BoardCrumb({ provider }: { provider: BoardProvider }) {
  const { t } = useT();
  const board = useBoardStore(s => s.states[provider.id]);
  // which vault project this board belongs to: a vault project has at most one board
  const linked = useDerived(() => linkedProject(provider));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const name = board.boards.find(b => b.id === board.board)?.name;
  const project = board.projects?.find(p => p.id === board.project)?.name;
  const row = (on: boolean, label: string, pick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      className={`w-full text-left ${POP_ROW}`}
      onClick={() => {
        setOpen(false);
        pick();
      }}
    >
      <span className="flex-1 truncate">{label}</span>
      {on && <Icon name="check" className="glyph size-3.5 text-accent-text stroke-2" />}
    </button>
  );
  return (
    <span ref={root} className="relative flex items-center gap-2 min-w-0">
      <span className="text-tertiary text-[13px]">/</span>
      <button
        type="button"
        className={`flex items-center gap-1 min-w-0 text-[13px] font-semibold text-label rounded-md px-1.5 py-0.75 -ml-1.5 hover:bg-fill cursor-default ${open ? "bg-fill" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={project ? `${project} · ${name ?? ""}` : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{name ?? project ?? (board.projects ? t("kb.pickProject") : t("pr.loading"))}</span>
        <Icon name="down" className="glyph size-[11px] text-tertiary stroke-2 flex-none" />
      </button>
      {open && (
        <div className={`absolute top-full left-0 mt-2 z-30 w-72 p-1 rounded-[10px] ${POPOVER}`} role="menu">
          {!!board.boards.length && (
            <>
              <PopHeading>{project ?? t("kb.boards")}</PopHeading>
              {board.boards.map(b => row(b.id === board.board, b.name, () => pickBoard(provider, b.id), b.id))}
              <div className="h-px bg-separator my-1"></div>
            </>
          )}
          <PopHeading>{t("kb.projects")}</PopHeading>
          <div className="max-h-56 overflow-y-auto">
            {(board.projects ?? []).map(p =>
              row(p.id === board.project, p.name, () => pickProject(provider, p.id), p.id),
            )}
          </div>
          {board.board && (
            <>
              <div className="h-px bg-separator my-1"></div>
              {row(
                false,
                linked ? t("kb.linkedTo", { project: projectLabel(linked) }) : t("kb.linkInSettings"),
                () => void openProjectSettings(linked),
                "link",
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
