import type { ReactNode } from "react";

/** A row of a list that folds open to its settings (`children`, rendered only when open): icon, name, a status line,
 *  and a chevron. The page keeps which rows are open. A `nav` row opens a page of its own instead of folding: no
 *  expanded state, never shows the children. */
export function SettingsFold({
  open = false,
  nav = false,
  icon,
  name,
  status,
  onToggle,
  children,
}: {
  open?: boolean;
  nav?: boolean;
  icon: ReactNode;
  name: ReactNode;
  status: ReactNode;
  onToggle: () => void;
  children?: ReactNode;
}) {
  // a hairline between the rows, none above the first
  return (
    <div className="border-t border-s-border first:border-t-0">
      <button
        className={`group flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-fill focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${open ? "bg-fill" : ""}`}
        onClick={onToggle}
        aria-expanded={nav ? undefined : open}
      >
        <span className="grid size-7.5 flex-none place-items-center rounded-lg bg-fill-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap">
            {name}
          </b>
          <div className="mt-px flex">{status}</div>
        </span>
        <svg
          className={`size-3.5 flex-none fill-none stroke-tertiary stroke-2 transition-transform duration-150 ease-in-out glyph group-hover:stroke-s-fg ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      {open && !nav && <div className="grid grid-cols-1 gap-3 px-3.5 pb-3.5 pl-13">{children}</div>}
    </div>
  );
}
