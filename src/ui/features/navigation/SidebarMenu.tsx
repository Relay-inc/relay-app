import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { Icon } from "../../components/Icon";
import { Glyph } from "../../components/Glyph";

/** `icon` a named icon, or `mark`: a board's 24×24 glyph, drawn before the label. */
export type MenuItem = { id: string; label: string; head?: boolean; icon?: string; mark?: string };

const MARGIN = 8;
const ICON = "glyph size-3.75 flex-none text-secondary group-hover:text-on-accent";

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
  const own = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => own.current!);
  // a long menu opened low in the window moves up to fit (and one near the right edge left)
  useLayoutEffect(() => {
    const el = own.current!;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN))}px`;
    el.style.top = `${Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN))}px`;
  }, [x, y, items.length]);
  return (
    <div
      ref={own}
      className="fixed z-20 min-w-45 max-h-screen overflow-y-auto grid p-1 bg-bg border border-separator rounded-lg shadow-lg"
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
            className="group max-w-2xs flex items-center gap-2 px-2.5 py-1 rounded-sm text-sm text-left text-label hover:bg-accent hover:text-on-accent"
            onClick={() => onPick(item.id)}
          >
            {item.mark ? (
              <Glyph svg={item.mark} viewBox="0 0 24 24" className={ICON} />
            ) : item.icon ? (
              <Icon name={item.icon} className={ICON} />
            ) : null}
            <span className="truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
