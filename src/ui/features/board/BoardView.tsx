import { useEffect } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import { cardsIn, filtered, isFolded } from "../../../domain/board/rules";
import { dropCard, openBoardCard, showBoard, toggleFold } from "../../../application/board/board";
import { useBoardStore } from "../../../application/board/store";
import { cardOf } from "../../../application/navigation/panel";
import { useNavigationStore } from "../../../application/navigation/store";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { useT } from "../../hooks/useT";
import { BoardHead } from "./BoardHead";
import { BoardToolbar } from "./BoardToolbar";
import { BoardChips } from "./BoardChips";
import { BoardColumn } from "./BoardColumn";
import { BoardList } from "./BoardList";
import { BoardCard, type CardGrab } from "./BoardCard";
import { BoardTicket } from "./BoardTicket";

/** What the board keeps of a pressed card: which one, where it was grabbed, and the column it hovers. */
type Grab = { id: string; offsetX: number; offsetY: number; width: number; overColumn?: string };

// the column under the pointer (the dragged copy lets the pointer through)
const columnAt = (e: PointerEvent) =>
  document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-list]")?.dataset.list;

/** A provider's board: the head row, the toolbar with its filter chips, the columns as a kanban or a list, and the
 *  ticket window over it. Dragging a card to another column moves it in the tracker, a click opens it. */
export function BoardView({ provider }: { provider: BoardProvider }) {
  const { t } = useT();
  const board = useBoardStore(s => s.states[provider.id]);
  const folds = useBoardStore(s => s.folded[provider.id]);
  const resets = useBoardStore(s => s.resets);
  // the card open in the ticket window, marked on the board
  const modal = useNavigationStore(s => s.panel.modal);
  const open = modal ? cardOf(modal) : undefined;
  const selected = open?.provider.id === provider.id ? open.id : "";
  const { drag, start } = usePointerDrag<Grab>({
    onMove: (_, e) => ({ overColumn: columnAt(e) }),
    // a release opens the card or drops it, a cancel does neither
    onEnd: (press, released) => {
      if (!released) return;
      if (!press.moving) openBoardCard(provider, press.id);
      else if (press.overColumn) dropCard(provider, press.id, press.overColumn);
    },
  });

  // load when shown, and again once resetBoard (new credentials, a new language) has cleared what was known
  useEffect(() => {
    showBoard(provider);
  }, [provider, resets]);

  const onGrab = (grab: CardGrab) =>
    start(
      { clientX: grab.pointerX, clientY: grab.pointerY },
      { id: grab.id, offsetX: grab.offsetX, offsetY: grab.offsetY, width: grab.width },
    );
  const ghost = drag?.moving ? board.cards.find(x => x.id === drag.id) : undefined;

  const columns = () => {
    if (!board.board) return null;
    if (!board.columns.length) {
      if (board.busy || board.err) return null;
      return <div className="text-secondary text-sm text-center">{t("kb.noCols")}</div>;
    }
    const cards = filtered(board);
    return (
      <>
        <BoardToolbar provider={provider} board={board} />
        <BoardChips provider={provider} filters={board.filters} />
        {board.view === "list" ? (
          <BoardList provider={provider} board={board} cards={cards} folds={folds} selected={selected} />
        ) : (
          <div className="flex gap-2.5 items-start overflow-x-auto pb-2">
            {board.columns.map(column => (
              <BoardColumn
                key={column.id}
                column={column}
                cards={cardsIn(provider, board, cards, column.id)}
                selected={selected}
                over={!!drag?.moving && drag.overColumn === column.id}
                folded={isFolded(folds, column)}
                onFold={() => toggleFold(provider, column)}
                onGrab={onGrab}
                onOpen={id => openBoardCard(provider, id)}
              />
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div>
      <BoardHead provider={provider} board={board} />
      {board.err && <div className="err-box mb-3">{board.err}</div>}
      {columns()}
      {drag && ghost && (
        <BoardCard
          card={ghost}
          ghost={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
        />
      )}
      <BoardTicket provider={provider} board={board} />
    </div>
  );
}
