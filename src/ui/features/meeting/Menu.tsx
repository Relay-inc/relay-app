import { useRef, useState, type ReactNode } from "react";
import { useDismiss } from "../../hooks/useDismiss";

/** A button that opens a small popover under it (the language pick, the recording's "…"). `children` draws what is in
 *  it and gets `close`. Esc and a press outside close it. */
export function Menu({
  label,
  trigger,
  className,
  right = false,
  children,
}: {
  label: string;
  trigger: ReactNode;
  className: string;
  right?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  return (
    <div ref={root} className="relative">
      <button
        aria-label={label}
        title={label}
        aria-expanded={open}
        className={className}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          className={`absolute top-full mt-1 z-20 min-w-36 p-1 rounded-lg border border-separator-strong bg-raised shadow-md ${right ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
