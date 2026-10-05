import type { ComponentProps, MouseEvent } from "react";
import type { Section } from "../../../domain/navigation/sidebar";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { DROP_LINE_BEFORE, clickOnKey } from "./rows";

const TINT: Record<Section["tint"], string> = {
  "": "bg-tertiary",
  "ctx-a": "bg-ctx-a",
  "ctx-m": "bg-ctx-m",
  "ctx-p": "bg-ctx-p",
};

type Props = Omit<ComponentProps<"div">, "className"> & {
  label: string;
  tint: Section["tint"];
  count: number;
  collapsed: boolean;
  dropBefore: boolean;
  onAdd?: () => void; // the "+" for a new conversation, only when given
};

/** A section header: a square in the context's colour, the name, the count while folded, the "+" for a new conversation
 *  and the fold chevron. */
export function SidebarHead({ label, tint, count, collapsed, dropBefore, onAdd, ...rest }: Props) {
  const { t } = useT();
  const add = (e: MouseEvent) => {
    e.stopPropagation();
    onAdd?.();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      onKeyDown={clickOnKey}
      {...rest}
      className={`group flex items-center gap-2 h-7 px-2 rounded-md text-[11px] font-semibold uppercase tracking-wider text-tertiary hover:text-secondary cursor-default ${dropBefore ? DROP_LINE_BEFORE : ""}`}
    >
      <span className={`size-1.5 flex-none rounded-xs ${TINT[tint]}`} />
      <span>{label}</span>
      {collapsed && count ? <span className="font-medium tabular-nums">{count}</span> : null}
      <span className="flex-1" />
      {onAdd ? (
        <button
          className="hidden group-hover:block w-5 h-4 rounded-md text-base leading-none text-secondary cursor-default hover:bg-fill hover:text-label"
          title={t("nav.newChat")}
          aria-label={t("nav.newChat")}
          onClick={add}
        >
          +
        </button>
      ) : null}
      <Icon
        name="chevron"
        className={`glyph size-3 flex-none stroke-2 transition-transform duration-150 ease-out ${collapsed ? "-rotate-90" : ""}`}
      />
    </div>
  );
}
