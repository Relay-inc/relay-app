import type { Card, Column } from "../../../domain/board/types";
import { BoardCard, type CardGrab } from "./BoardCard";

/** One column with its cards; `over` while a dragged card hovers it. A click on the header folds it; folded it is a
 *  narrow strip with its name upright, which still takes a dropped card (`data-list` is what the board hit-tests). */
export function BoardColumn({
  column,
  cards,
  over,
  folded,
  onFold,
  onGrab,
  onOpen,
}: {
  column: Column;
  cards: Card[];
  over: boolean;
  folded: boolean;
  onFold: () => void;
  onGrab: (grab: CardGrab) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div data-list={column.id} className={folded ? "flex-[0_0_40px]" : "flex-[0_0_264px]"}>
      <div
        className={`flex flex-col max-h-160 bg-fill rounded-lg p-2 transition-shadow duration-150 ease-out ${over ? "ring-2 ring-inset ring-accent" : ""}`}
      >
        <button
          type="button"
          className={`flex ${folded ? "flex-col items-center" : "justify-between"} gap-2 px-1 pt-0.5 pb-2 text-sm font-semibold cursor-pointer`}
          title={column.name}
          onClick={onFold}
        >
          <span className={folded ? "[writing-mode:vertical-rl] max-h-[60vh] truncate" : ""}>{column.name}</span>
          <span className="text-secondary tabular-nums">{cards.length}</span>
        </button>
        <div className="flex flex-col gap-1.5 min-h-7 overflow-y-auto" hidden={folded}>
          {cards.map(card => (
            <BoardCard key={card.id} card={card} onGrab={onGrab} onOpen={() => onOpen(card.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
