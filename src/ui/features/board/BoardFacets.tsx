import type { BoardProvider } from "../../../domain/board/types";
import { filtered, type Board } from "../../../domain/board/rules";
import { facetsOf, options } from "../../../domain/board/filter";
import { clearFilters, toggleFilter } from "../../../application/board/board";
import { useT } from "../../hooks/useT";
import { FACET_LABEL, facetName } from "./toolbar";

/** The filters popover: per facet the board's cards have, its values as toggles with how many cards each would show
 *  given the search and the other facets; "Clear all" and "Show n tasks", which closes it. */
export function BoardFacets({
  provider,
  board,
  onClose,
}: {
  provider: BoardProvider;
  board: Board;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <div className="max-h-130 overflow-y-auto rounded-t-xl">
        <div className="flex flex-col gap-3.5 p-3.5">
          {facetsOf(board.cards).map(facet => (
            <div key={facet} className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-wider uppercase text-tertiary">
                {t(FACET_LABEL[facet])}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {options(board.cards, board.q, board.filters, facet).map(([value, count]) => {
                  const on = board.filters[facet]?.includes(value);
                  return (
                    <button
                      key={value}
                      className={`inline-flex items-center gap-1.5 h-6.5 px-[9px] rounded-[7px] border text-xs font-medium cursor-default ${on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong text-label hover:bg-fill"}`}
                      aria-pressed={!!on}
                      onClick={() => toggleFilter(provider, facet, value)}
                    >
                      {facetName(t, facet, value)}
                      <span className="text-[11px] text-tertiary tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="sticky bottom-0 flex items-center gap-2 px-3.5 py-2.5 border-t border-separator bg-raised rounded-b-xl">
        <button
          className="h-7 px-2.5 border-0 rounded-[7px] bg-transparent text-secondary text-xs font-medium hover:bg-fill-2 hover:text-label"
          onClick={() => clearFilters(provider)}
        >
          {t("kb.clearAll")}
        </button>
        <span className="flex-1"></span>
        <button className="btn btn-primary h-7 px-3 text-xs rounded-[7px]" onClick={onClose}>
          {t("kb.show", { n: filtered(board).length })}
        </button>
      </div>
    </>
  );
}
