import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { BUTTON_GLYPH, buttonClass } from "./blocks";

/** `checked` makes it a checkable item: a check in front of it while on, room for one while off. `tip` is its tooltip. */
type MenuItem = { id: string; icon?: ReactNode; name: ReactNode; status?: ReactNode; checked?: boolean; tip?: string };

/** A button with a menu under it (or over it, `up`): the Add menu with what is not in the list yet (icon, name,
 *  status), and an integration's "…" menu with its rarer actions. Nothing at all when there is nothing to offer. */
export function SettingsMenu({
  label = "",
  tip = "",
  trigger,
  up = false,
  width = "w-75",
  items,
  onPick,
}: {
  /** The text of the button; without it the button is the "…" glyph, titled `tip` */
  label?: string;
  tip?: string;
  /** Instead of the text or the "…": what the button shows (an icon and a chevron), named by `tip` */
  trigger?: ReactNode;
  /** Where the menu opens: under the button, right-aligned (the default), or over it */
  up?: boolean;
  /** The menu's width class */
  width?: string;
  items: MenuItem[];
  onPick: (id: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, shown, () => setShown(false));

  if (!items.length) return null;
  const side = up ? "bottom-8 left-0" : "top-8 right-0";
  const checks = items.some(item => item.checked !== undefined);
  return (
    <div ref={root} className="relative">
      <button
        className={
          label ? buttonClass() : trigger ? buttonClass().replace("px-3", "px-1.5") : buttonClass("plain", true)
        }
        onClick={() => setShown(!shown)}
        title={tip || undefined}
        aria-label={!label && tip ? tip : undefined}
        aria-expanded={shown}
      >
        {label || trigger || <Icon name="more" className={BUTTON_GLYPH} />}
      </button>
      {shown && (
        <div
          className={`absolute z-0 grid ${width} gap-0.5 rounded-md border border-s-border bg-s-bg p-1 shadow-lg ${side}`}
        >
          {items.map(item => (
            <button
              key={item.id}
              title={item.tip}
              role={item.checked === undefined ? undefined : "menuitemcheckbox"}
              aria-checked={item.checked}
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-s-hover focus-visible:bg-s-hover focus-visible:outline-none"
              onClick={() => {
                setShown(false);
                onPick(item.id);
              }}
            >
              {(item.icon || checks) && (
                <span className="mt-px grid size-4 flex-none place-items-center">
                  {item.checked ? (
                    <Icon name="check" className="size-3.5 fill-none stroke-current stroke-2" />
                  ) : (
                    item.icon
                  )}
                </span>
              )}
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
