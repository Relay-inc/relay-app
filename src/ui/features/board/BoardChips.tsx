import type { BoardProvider } from "../../../domain/board/types";
import { FACETS, type Filters } from "../../../domain/board/filter";
import { clearFilters } from "../../../application/board/board";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { FACET_LABEL, facetName } from "./toolbar";

/** The active filters as chips under the toolbar, each with its own remove, and "Clear filters". */
export function BoardChips({ provider, filters }: { provider: BoardProvider; filters: Filters }) {
  const { t } = useT();
  const active = FACETS.filter(facet => filters[facet]?.length);
  if (!active.length) return null;
  return (
    <div className="flex-none flex items-center flex-wrap gap-1.5 px-4 py-2 border-b border-separator">
      {active.map(facet => (
        <span
          key={facet}
          className="inline-flex items-center gap-1.5 h-6 pl-[9px] pr-1 rounded-[7px] bg-accent-soft text-accent-text text-xs"
        >
          <span className="text-secondary">{t(FACET_LABEL[facet])}</span>
          <b className="font-medium">{filters[facet]!.map(v => facetName(t, facet, v)).join(", ")}</b>
          <button
            className="size-4.5 grid place-items-center border-0 rounded-[5px] bg-transparent text-accent-text hover:bg-accent-soft"
            title={t("kb.remove")}
            aria-label={t("kb.remove")}
            onClick={() => clearFilters(provider, facet)}
          >
            <Icon name="close" className="glyph size-[11px] stroke-2" />
          </button>
        </span>
      ))}
      <button
        className="h-6 px-2 border-0 rounded-md bg-transparent text-secondary text-xs font-medium hover:bg-fill-2 hover:text-label"
        onClick={() => clearFilters(provider)}
      >
        {t("kb.clear")}
      </button>
    </div>
  );
}
