import { useEffect } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import { colOf, filtered } from "../../../domain/board/rules";
import { dropCard, openBoardCard, showBoard, toggleFold } from "../../../application/board/board";
import { useBoardStore } from "../../../application/board/store";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { useT } from "../../hooks/useT";
import { BoardToolbar } from "./BoardToolbar";
import { BoardColumn } from "./BoardColumn";
import { BoardCard, type CardGrab } from "./BoardCard";

/** What the board keeps of a pressed card: which one, where it was grabbed, and the column it hovers. */
type Grab = { id: string; offsetX: number; offsetY: number; width: number; overColumn?: string };

// the column under the pointer (the dragged copy lets the pointer through)
const columnAt = (e: PointerEvent) =>
  document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-list]")?.dataset.list;

/** A provider's board as a kanban: the head row and the columns. Dragging a card to another column moves it in the
 *  tracker, a click opens it. */
export function BoardView({ provider }: { provider: BoardProvider }) {
  const { t } = useT();
  const board = useBoardStore(s => s.states[provider.id]);
  const foldedColumns = useBoardStore(s => s.folded[provider.id]);
  const resets = useBoardStore(s => s.resets);
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
    const { cards } = filtered(board);
    return (
      <div className="flex gap-3 items-start overflow-x-auto pb-2">
        {board.columns.map(column => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={cards
              .filter(card => colOf(provider, board, card) === column.id)
              .sort((a, b) => a.placement - b.placement)}
            over={!!drag?.moving && drag.overColumn === column.id}
            folded={!!foldedColumns?.includes(column.id)}
            onFold={() => toggleFold(provider, column.id)}
            onGrab={onGrab}
            onOpen={id => openBoardCard(provider, id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div>
      <BoardToolbar provider={provider} board={board} />
      {board.err && <div className="err-box mb-3">{board.err}</div>}
      {columns()}
      {drag && ghost && (
        <BoardCard
          card={ghost}
          ghost={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
        />
      )}
    </div>
  );
}
