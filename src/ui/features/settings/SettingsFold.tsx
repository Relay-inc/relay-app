import type { ReactNode } from "react";
import { Switch } from "./Switch";

/** A row of a list that folds open to its settings (`children`, rendered only when open): icon, name, a status line,
 *  an optional on/off switch (`onSwitch`, with `on`) and a chevron. A switched-off row stays in the list, dimmed, and
 *  does not open. The page keeps which rows are open. A `nav` row opens a page of its own instead of folding: no
 *  expanded state, never shows the children. */
export function SettingsFold({
  id,
  open = false,
  nav = false,
  on = true,
  icon,
  name,
  status,
  onToggle,
  onSwitch,
  children,
}: {
  id: string;
  open?: boolean;
  nav?: boolean;
  on?: boolean;
  icon: ReactNode;
  name: ReactNode;
  status: ReactNode;
  onToggle: () => void;
  onSwitch?: (on: boolean) => void;
  children?: ReactNode;
}) {
  const toggle = () => on && onToggle();
  // a hairline between the rows, none above the first
  return (
    <div className="border-t border-s-border first:border-t-0">
      <div className={`group flex items-center gap-3 px-3.5 py-3 hover:bg-fill ${open ? "bg-fill" : ""}`}>
        <button
          className={`flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${on ? "" : "opacity-55"}`}
          onClick={toggle}
          aria-expanded={nav ? undefined : open}
        >
          <span className="grid size-7.5 flex-none place-items-center rounded-lg bg-fill-2">{icon}</span>
          <span className="min-w-0 flex-1">
            <b className="flex items-center gap-1.5 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap">
              {name}
            </b>
            <div className="mt-px flex">{status}</div>
          </span>
        </button>
        {onSwitch && (
          <Switch id={`row-${id}`} on={on} label={typeof name === "string" ? name : undefined} onToggle={onSwitch} />
        )}
        <svg
          className={`size-3.5 flex-none fill-none stroke-tertiary stroke-2 transition-transform duration-150 ease-in-out glyph group-hover:stroke-s-fg ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
          onClick={toggle}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
      {open && !nav && <div className="grid grid-cols-1 gap-3 px-3.5 pt-3 pb-3.5 pl-13">{children}</div>}
    </div>
  );
}
