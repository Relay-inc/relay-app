import type { Card, Column } from "../../../domain/board/types";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BoardCard, type CardGrab } from "./BoardCard";
import { Ring } from "./Ring";

/** One column with its cards; `over` while a dragged card hovers it. A click on the header folds it; folded it is a
 *  narrow strip with its name upright, which still takes a dropped card (`data-list` is what the board hit-tests).
 *  `onAdd`: the header's + for a new task in this column, when the provider can make one. */
export function BoardColumn({
  column,
  cards,
  selected,
  over,
  folded,
  onFold,
  onAdd,
  onGrab,
  onOpen,
}: {
  column: Column;
  cards: Card[];
  selected: string;
  over: boolean;
  folded: boolean;
  onFold: () => void;
  onAdd?: () => void;
  onGrab: (grab: CardGrab) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useT();
  return (
    <div data-list={column.id} className={`flex flex-col ${folded ? "flex-[0_0_40px]" : "flex-[0_0_264px]"}`}>
      <div
        className={`flex-1 flex flex-col gap-1.5 bg-lane rounded-xl p-1.5 transition-shadow duration-150 ease-out ${over ? "ring-2 ring-inset ring-accent" : ""}`}
      >
        <div className={`flex ${folded ? "flex-col items-center" : "items-center h-7.5 pl-1.5"} gap-2`}>
          <button
            type="button"
            className={`flex ${folded ? "flex-col items-center py-1.5" : "flex-1 min-w-0 items-center h-full"} gap-2 text-xs font-semibold cursor-pointer`}
            title={column.name}
            onClick={onFold}
          >
            {column.state ? (
              <Ring state={column.state} tone={column.tone} />
            ) : (
              <Icon name="folder" className="glyph size-3.5 text-secondary" />
            )}
            <span className={folded ? "[writing-mode:vertical-rl] max-h-[60vh] truncate" : "truncate"}>
              {column.name}
            </span>
            <span className="text-tertiary font-medium tabular-nums">{cards.length}</span>
          </button>
          {onAdd && !folded && (
            <button
              type="button"
              className="size-5.5 flex-none grid place-items-center border-0 rounded-md bg-transparent text-tertiary hover:bg-fill-2 hover:text-label cursor-default"
              title={t("kb.newTaskIn", { name: column.name })}
              aria-label={t("kb.newTaskIn", { name: column.name })}
              onClick={onAdd}
            >
              <Icon name="add" className="glyph size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5 min-h-7" hidden={folded}>
          {cards.map(card => (
            <BoardCard
              key={card.id}
              card={card}
              selected={card.id === selected}
              onGrab={onGrab}
              onOpen={() => onOpen(card.id)}
            />
          ))}
          {!cards.length && <div className="pt-4.5 pb-5.5 text-center text-xs text-tertiary">{t("kb.noTasks")}</div>}
        </div>
      </div>
    </div>
  );
}
