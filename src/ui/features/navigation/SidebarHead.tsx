import type { ComponentProps, MouseEvent } from "react";
import type { Section } from "../../../domain/navigation/sidebar";
import { useT } from "../../hooks/useT";
import { TINT, DROP_LINE_BEFORE, clickOnKey } from "./rows";

type Props = Omit<ComponentProps<"div">, "className"> & {
  label: string;
  tint: Section["tint"];
  count: number;
  collapsed: boolean;
  dropBefore: boolean;
  onAdd?: () => void; // the "+" for a new conversation, only when given
};

/** A section header: the fold chevron, the name in its context colour, the count while folded, and the "+" for a new conversation. */
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
      className={`flex items-center gap-1.5 px-2 pt-3 pb-1 text-xs font-semibold text-secondary tracking-wide cursor-default ${dropBefore ? DROP_LINE_BEFORE : ""}`}
    >
      <span
        className={`w-0 h-0 border-l-4 border-l-secondary border-y-3 border-y-transparent transition-transform duration-150 ease-out ${collapsed ? "" : "rotate-90"}`}
      />
      <span className={TINT[tint]}>{label}</span>
      {collapsed && count ? <span className="font-normal tabular-nums">{count}</span> : null}
      {onAdd ? (
        <button
          className="ml-auto w-5 h-4 rounded-md text-base leading-none text-secondary cursor-default hover:bg-fill hover:text-label"
          title={t("nav.newChat")}
          aria-label={t("nav.newChat")}
          onClick={add}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
