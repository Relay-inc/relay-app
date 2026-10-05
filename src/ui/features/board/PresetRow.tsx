import type { KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { POP_ROW } from "./toolbar";

/** A preset or a saved view: how many cards it shows, a check when it is what the board shows. A view whose filters
 *  the board can't apply (`count` null) is dimmed and does nothing. */
export function PresetRow({
  name,
  count,
  on,
  onApply,
  onRemove,
}: {
  name: string;
  count: number | null;
  on: boolean;
  onApply: () => void;
  onRemove?: () => void;
}) {
  const { t } = useT();
  const apply = () => {
    if (count !== null) onApply();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    apply();
  };
  return (
    // a div, not a button: it holds the delete button
    <div
      className={`group ${POP_ROW} ${count === null ? "opacity-50" : ""}`}
      title={count === null ? t("kb.viewUnsupported") : ""}
      role="button"
      tabIndex={0}
      aria-disabled={count === null}
      onClick={apply}
      onKeyDown={onKey}
    >
      <span className="flex-1 truncate">{name}</span>
      {count !== null && <span className="text-xs text-tertiary tabular-nums">{count}</span>}
      {on && <Icon name="check" className="glyph size-3.5 text-accent-text stroke-2" />}
      {onRemove && (
        <button
          className="hidden group-hover:inline-grid btn-icon size-5 rounded-sm"
          title={t("kb.presetDelete")}
          aria-label={t("kb.presetDelete")}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="close" className="glyph size-3" />
        </button>
      )}
    </div>
  );
}
