import type { Ref } from "react";

export type MenuItem = { id: string; label: string; head?: boolean };

/** The right-click menu at the pointer: buttons, and small headings between them. `onPick` gets the item's id. */
export function SidebarMenu({
  x,
  y,
  items,
  onPick,
  ref,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onPick: (id: string) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className="fixed z-20 min-w-45 grid p-1 bg-bg border border-separator rounded-lg shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.head ? (
          <div key={i} className="px-2.5 pt-1.5 pb-0.5 text-xs font-semibold text-secondary">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            className="max-w-2xs px-2.5 py-1 rounded-sm text-sm text-left text-label truncate hover:bg-accent hover:text-on-accent"
            onClick={() => onPick(item.id)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
