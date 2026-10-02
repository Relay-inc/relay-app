import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { BUTTON_GLYPH, buttonClass } from "./blocks";

type MenuItem = { id: string; icon?: ReactNode; name: ReactNode; status?: ReactNode };

/** A button with a menu under it (or over it, `up`): the Add menu with what is not in the list yet (icon, name,
 *  status), and an integration's "…" menu with its rarer actions. Nothing at all when there is nothing to offer. */
export function SettingsMenu({
  label = "",
  tip = "",
  up = false,
  items,
  onPick,
}: {
  /** The text of the button; without it the button is the "…" glyph, titled `tip` */
  label?: string;
  tip?: string;
  up?: boolean;
  items: MenuItem[];
  onPick: (id: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, shown, () => setShown(false));

  if (!items.length) return null;
  const side = up ? "bottom-8 left-0" : "top-8 right-0";
  return (
    <div ref={root} className="relative">
      <button
        className={label ? buttonClass() : buttonClass("plain", true)}
        onClick={() => setShown(!shown)}
        title={tip || undefined}
        aria-expanded={shown}
      >
        {label || <Icon name="more" className={BUTTON_GLYPH} />}
      </button>
      {shown && (
        <div
          className={`absolute z-0 grid w-75 gap-0.5 rounded-md border border-s-border bg-s-bg p-1 shadow-lg ${side}`}
        >
          {items.map(item => (
            <button
              key={item.id}
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-s-hover focus-visible:bg-s-hover focus-visible:outline-none"
              onClick={() => {
                setShown(false);
                onPick(item.id);
              }}
            >
              {item.icon && <span className="mt-px grid size-4 flex-none place-items-center">{item.icon}</span>}
              <span className="grid min-w-0 gap-0.5">
                <b className="text-sm font-medium">{item.name}</b>
                {item.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
