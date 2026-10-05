import { Fragment } from "react";
import type { BoardProvider, Card } from "../../../domain/board/types";
import { cardsIn, isFolded, type Board } from "../../../domain/board/rules";
import { openBoardCard, toggleFold } from "../../../application/board/board";
import { Icon } from "../../components/Icon";
import { BoardRow } from "./BoardRow";
import { Ring } from "./Ring";

/** The list view: per column a sticky header that folds it, then its cards as rows. */
export function BoardList({
  provider,
  board,
  cards,
  folds,
  selected,
}: {
  provider: BoardProvider;
  board: Board;
  cards: Card[];
  folds: Record<string, boolean> | undefined;
  selected: string;
}) {
  return (
    <div className="pt-1 pb-5">
      {board.columns.map(column => {
        const inLane = cardsIn(provider, board, cards, column.id);
        const open = !isFolded(folds, column);
        return (
          <Fragment key={column.id}>
            <button
              type="button"
              className="sticky top-0 z-1 w-full flex items-center gap-2 h-9 pl-3.5 pr-5 bg-bg border-b border-separator text-xs font-semibold hover:bg-fill cursor-default"
              onClick={() => toggleFold(provider, column)}
            >
              <span
                className={`inline-flex text-tertiary transition-transform duration-150 ease-out ${open ? "" : "-rotate-90"}`}
              >
                <Icon name="down" className="glyph size-3 stroke-2" />
              </span>
              {column.state ? (
                <Ring state={column.state} tone={column.tone} />
              ) : (
                <Icon name="folder" className="glyph size-3.5 text-secondary" />
              )}
              <span>{column.name}</span>
              <span className="text-tertiary font-medium tabular-nums">{inLane.length}</span>
            </button>
            {open &&
              inLane.map(card => (
                <BoardRow
                  key={card.id}
                  card={card}
                  selected={card.id === selected}
                  onOpen={() => openBoardCard(provider, card.id)}
                />
              ))}
          </Fragment>
        );
      })}
    </div>
  );
}
