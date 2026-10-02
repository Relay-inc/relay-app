import { useState } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import { viewOn, type Board } from "../../../domain/board/rules";
import { activeCount, matches, sameFilters, type Filters } from "../../../domain/board/filter";
import { applyPreset, applyView, deletePreset, savePresetAs } from "../../../application/board/board";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { PopHeading } from "./PopHeading";
import { PresetRow } from "./PresetRow";
import { POP_ROW } from "./toolbar";

/** The presets popover: the tracker's saved views (read only) above the presets kept in Relay, each under where it
 *  comes from, and "Save current filters…", which asks for a name. Applying one closes the popover. */
export function BoardPresets({
  provider,
  board,
  onClose,
}: {
  provider: BoardProvider;
  board: Board;
  onClose: () => void;
}) {
  const { t } = useT();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const hasFilters = activeCount(board.filters) > 0;
  const count = (filters: Filters | null) => (filters ? board.cards.filter(c => matches(c, "", filters)).length : null);
  const done = (act: () => void) => () => {
    act();
    onClose();
  };
  const save = () => {
    if (!name.trim()) return;
    savePresetAs(provider, name);
    onClose();
  };
  return (
    <>
      {!!board.views.length && (
        <>
          <PopHeading>{provider.name}</PopHeading>
          {board.views.map(view => (
            <PresetRow
              key={view.id}
              name={view.name}
              count={count(view.filters)}
              on={viewOn(board, view)}
              onApply={done(() => applyView(provider, view))}
            />
          ))}
          <div className="h-px bg-separator my-1"></div>
        </>
      )}
      <PopHeading>{board.views.length ? "Relay" : t("kb.presets")}</PopHeading>
      {board.presets.length ? (
        board.presets.map(preset => (
          <PresetRow
            key={preset.name}
            name={preset.name}
            count={count(preset.filters)}
            on={sameFilters(preset.filters, board.filters)}
            onApply={done(() => applyPreset(provider, preset))}
            onRemove={() => deletePreset(provider, preset.name)}
          />
        ))
      ) : (
        <div className="px-2 py-1.5 text-xs text-secondary">{t("kb.noPresets")}</div>
      )}
      <div className="h-px bg-separator my-1"></div>
      {naming ? (
        <div className="flex items-center gap-1.5 p-1">
          <input
            className="field flex-1 min-w-0 h-7"
            placeholder={t("kb.presetName")}
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") save();
            }}
          />
          <button className="btn btn-primary h-7 px-2.5" onClick={save}>
            {t("kb.save")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`w-full text-left ${POP_ROW} ${hasFilters ? "" : "opacity-50"}`}
          disabled={!hasFilters}
          onClick={() => setNaming(true)}
        >
          <Icon name="plus" className="glyph size-3.5" />
          {t("kb.presetSave")}
        </button>
      )}
    </>
  );
}
