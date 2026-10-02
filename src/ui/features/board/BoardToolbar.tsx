import { useRef, useState } from "react";
import type { Key } from "../../../shared/i18n";
import type { BoardProvider } from "../../../domain/board/types";
import { filtered, viewOn, type Board } from "../../../domain/board/rules";
import { activeCount, sameFilters } from "../../../domain/board/filter";
import { pickGroup, setFilter, setView } from "../../../application/board/board";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { BoardFacets } from "./BoardFacets";
import { BoardPopover } from "./BoardPopover";
import { BoardPresets } from "./BoardPresets";
import { PopHeading } from "./PopHeading";
import { POP_ROW, toolButton } from "./toolbar";

type Pop = "" | "group" | "presets" | "filters";

/** The row over the cards: the search with how many tasks it leaves, kanban or list, the grouping when the provider
 *  has more than one, the presets and the filters. Escape or a click outside closes the open popover. */
export function BoardToolbar({ provider, board }: { provider: BoardProvider; board: Board }) {
  const { t, pt } = useT();
  const [pop, setPop] = useState<Pop>("");
  const root = useRef<HTMLDivElement>(null);
  const close = () => setPop("");
  useDismiss(root, !!pop, close);
  const toggle = (next: Pop) => setPop(pop === next ? "" : next);

  const shown = filtered(board).length;
  const total = board.cards.length;
  const groups = provider.groupings ?? [];
  const group = groups.find(g => g.id === board.group);
  const n = activeCount(board.filters);
  // the preset or saved view the board shows, named on its button
  const preset =
    board.presets.find(p => sameFilters(p.filters, board.filters)) ??
    (n ? board.views.find(v => viewOn(board, v)) : undefined);
  return (
    <div ref={root} className="relative flex items-center gap-2 mb-3">
      <label className="flex-1 min-w-0 flex items-center gap-2 h-7.5 px-2.5 rounded-lg bg-fill-2 text-tertiary">
        <Icon name="search" className="glyph size-3.5" />
        <input
          className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[13px] text-label p-0"
          type="search"
          placeholder={t("kb.search")}
          value={board.q}
          onChange={e => setFilter(provider, { q: e.target.value })}
        />
        <span className="text-xs tabular-nums whitespace-nowrap">
          {shown === total ? t("kb.tasks", { n: total }) : t("kb.tasksOf", { n: shown, total })}
        </span>
      </label>
      <div className="seg">
        {(["kanban", "list"] as const).map(view => (
          <button
            key={view}
            className={`${board.view === view ? "on" : ""} w-7.5 px-0 inline-grid place-items-center`}
            title={t(`kb.view.${view}` as Key)}
            aria-label={t(`kb.view.${view}` as Key)}
            aria-pressed={board.view === view}
            onClick={() => setView(provider, view)}
          >
            <Icon name={view === "kanban" ? "kanban" : "rows"} className="glyph size-4" />
          </button>
        ))}
      </div>
      {groups.length > 1 && (
        <div className="relative">
          <button className={toolButton(false)} title={t("kb.groupBy")} onClick={() => toggle("group")}>
            <Icon name="kanban" className="glyph size-3.5 text-secondary" />
            {group ? pt(provider, group.label) : t("kb.groupBy")}
          </button>
          {pop === "group" && (
            <BoardPopover width="w-55 p-1" onClose={close}>
              <PopHeading>{t("kb.groupBy")}</PopHeading>
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  className={`w-full text-left ${POP_ROW}`}
                  onClick={() => {
                    close();
                    pickGroup(provider, g.id);
                  }}
                >
                  <span className="flex-1">{pt(provider, g.label)}</span>
                  {g.id === board.group && <Icon name="check" className="glyph size-3.5" />}
                </button>
              ))}
            </BoardPopover>
          )}
        </div>
      )}
      <div className="relative">
        <button className={toolButton(!!preset)} onClick={() => toggle("presets")}>
          <Icon name="bookmark" className="glyph size-3.5" />
          {preset?.name ?? t("kb.presets")}
        </button>
        {pop === "presets" && (
          <BoardPopover width="w-60 p-1" onClose={close}>
            <BoardPresets provider={provider} board={board} onClose={close} />
          </BoardPopover>
        )}
      </div>
      <div className="relative">
        <button className={toolButton(n > 0)} onClick={() => toggle("filters")}>
          <Icon name="filter" className="glyph size-3.5" />
          {t("kb.filters")}
          {!!n && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-accent text-on-accent text-[10px] inline-grid place-items-center tabular-nums">
              {n}
            </span>
          )}
        </button>
        {pop === "filters" && (
          <BoardPopover width="w-85" onClose={close}>
            <BoardFacets provider={provider} board={board} onClose={close} />
          </BoardPopover>
        )}
      </div>
    </div>
  );
}
