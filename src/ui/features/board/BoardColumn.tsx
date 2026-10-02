import type { Card, Column } from "../../../domain/board/types";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BoardCard, type CardGrab } from "./BoardCard";
import { Ring } from "./Ring";

/** One column with its cards; `over` while a dragged card hovers it. A click on the header folds it; folded it is a
 *  narrow strip with its name upright, which still takes a dropped card (`data-list` is what the board hit-tests). */
export function BoardColumn({
  column,
  cards,
  selected,
  over,
  folded,
  onFold,
  onGrab,
  onOpen,
}: {
  column: Column;
  cards: Card[];
  selected: string;
  over: boolean;
  folded: boolean;
  onFold: () => void;
  onGrab: (grab: CardGrab) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useT();
  return (
    <div data-list={column.id} className={folded ? "flex-[0_0_40px]" : "flex-[0_0_264px]"}>
      <div
        className={`flex flex-col gap-1.5 max-h-160 bg-well border border-separator rounded-xl p-1.5 transition-shadow duration-150 ease-out ${over ? "ring-2 ring-inset ring-accent" : ""}`}
      >
        <button
          type="button"
          className={`flex ${folded ? "flex-col items-center py-1.5" : "items-center h-7.5 px-1.5"} gap-2 text-xs font-semibold cursor-pointer`}
          title={column.name}
          onClick={onFold}
        >
          {column.state ? (
            <Ring state={column.state} />
          ) : (
            <Icon name="folder" className="glyph size-3.5 text-secondary" />
          )}
          <span className={folded ? "[writing-mode:vertical-rl] max-h-[60vh] truncate" : "truncate"}>
            {column.name}
          </span>
          <span className="text-tertiary font-medium tabular-nums">{cards.length}</span>
        </button>
        <div className="flex flex-col gap-1.5 min-h-7 overflow-y-auto" hidden={folded}>
          {cards.map(card => (
            <BoardCard
              key={card.id}
              card={card}
              selected={card.id === selected}
              onGrab={onGrab}
              onOpen={() => onOpen(card.id)}
            />
          ))}
          {!cards.length && <div className="py-4 text-center text-xs text-tertiary">{t("kb.noTasks")}</div>}
        </div>
      </div>
    </div>
  );
}
