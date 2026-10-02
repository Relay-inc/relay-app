import type { Key } from "../../../shared/i18n";
import { NOBODY, NO_LABEL, type Facet } from "../../../domain/board/filter";

// What the toolbar, its popovers and the chips share.

export const FACET_LABEL: Record<Facet, Key> = {
  state: "kb.facState",
  status: "kb.fStatus",
  who: "kb.fWho",
  folder: "kb.facFolder",
  list: "kb.fList",
  label: "kb.fLabels",
};
/** A facet's value as shown: the state's name, "Unassigned" and "No labels" for the empty values, else the value. */
export const facetName = (t: (key: Key) => string, facet: Facet, value: string) =>
  facet === "state"
    ? t(`kb.state.${value}` as Key)
    : value === NOBODY
      ? t("kb.unassigned")
      : value === NO_LABEL
        ? t("kb.noLabels")
        : value;
/** A toolbar button, accented while what it opens is in effect. */
export const toolButton = (on: boolean) =>
  `inline-flex items-center gap-1.5 h-7.5 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap border cursor-default hover:bg-fill ${on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong bg-transparent text-label"}`;
/** A row in a popover. */
export const POP_ROW = "flex items-center gap-2 h-7.5 px-2 rounded-md hover:bg-fill-2 cursor-default";
