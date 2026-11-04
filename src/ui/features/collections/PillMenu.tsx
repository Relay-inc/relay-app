import { useRef, useState, type ReactNode } from "react";
import { useDismiss } from "../../hooks/useDismiss";

export const PILL =
  "h-6 inline-flex items-center gap-1.25 px-2.25 rounded-xl border border-separator-strong text-xs cursor-pointer hover:bg-fill";

/** A pill that opens a small floating panel under it (Sort, Group by, + Filter): `children` get a `close`. */
export function PillMenu({
  label,
  value,
  className = PILL,
  align = "right",
  children,
}: {
  label: string;
  value?: string;
  className?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  return (
    <div ref={box} className="relative">
      <button className={className} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={value === undefined ? "" : "text-secondary"}>{label}</span>
        {value}
      </button>
      {open ? (
        <div
          className={`absolute top-7 z-20 min-w-44 p-1.5 rounded-xl bg-raised border border-separator shadow-md text-[12.5px] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** One line in a PillMenu's panel. */
export function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      role="option"
      aria-selected={!!selected}
      className={`w-full h-7 flex items-center gap-2 px-2 rounded-md text-left cursor-pointer hover:bg-fill ${selected ? "bg-accent-soft" : ""}`}
      onClick={onClick}
    >
      <span className="flex-1 truncate">{children}</span>
      {selected ? <span className="text-accent-text">✓</span> : null}
    </button>
  );
}
