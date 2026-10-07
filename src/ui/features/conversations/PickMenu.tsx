import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDismiss } from "../../hooks/useDismiss";
import { Icon } from "../../components/Icon";

type Option = { id: string; name: string; icon?: ReactNode; disabled?: boolean };

/** A composer pick that opens its own menu, for options a native select can't show (a glyph, a status dot). `pill`
 *  is the agent's look with the current option's icon, otherwise it looks like the composer's selects. Arrows move
 *  through the menu, Enter picks, Escape closes it and gives the focus back to the trigger. */
export function PickMenu({
  options,
  value,
  label,
  title = label,
  pill = false,
  below = false,
  disabled = false,
  onPick,
}: {
  options: Option[];
  value: string;
  label: string;
  title?: string;
  pill?: boolean;
  below?: boolean; // opens downwards, for a pick at the top of a pane
  disabled?: boolean;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(root, open, () => setOpen(false));
  // the menu opens on the agent picked now
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setOpen(true);
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to =
      e.key === "ArrowDown"
        ? (at + 1) % items.length
        : e.key === "ArrowUp"
          ? (at - 1 + items.length) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") setOpen(false);
  };
  const current = options.find(option => option.id === value);
  return (
    <span ref={root} className="relative inline-flex">
      <button
        ref={trigger}
        className={`inline-flex items-center gap-1.5 h-6.5 px-2 whitespace-nowrap rounded-[7px] border-0 text-xs disabled:opacity-50 ${pill ? "bg-fill-2 text-label hover:bg-separator-strong" : "bg-transparent text-secondary enabled:hover:bg-fill-2 enabled:hover:text-label"}`}
        title={title}
        aria-label={label}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKey}
      >
        {pill ? current?.icon : null}
        {current?.name ?? value}
        <Icon name="down" className="glyph size-2.75 stroke-2 text-secondary" />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className={`absolute ${below ? "top-full mt-1.5 right-0" : "bottom-full mb-1.5 left-0"} z-20 min-w-40 grid p-1 bg-bg border border-separator rounded-lg shadow-lg`}
          onKeyDown={onMenuKey}
        >
          {options.map(option => (
            <button
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === value}
              disabled={option.disabled}
              className="flex items-center gap-2 px-2.5 py-1 rounded-sm border-0 bg-transparent text-sm text-left text-label outline-none focus:bg-accent focus:text-on-accent disabled:text-tertiary"
              onMouseEnter={e => e.currentTarget.focus()}
              onClick={() => {
                onPick(option.id);
                close();
              }}
            >
              {option.icon}
              <span className="flex-1 truncate">{option.name}</span>
              {option.id === value ? <Icon name="check" className="glyph size-3.5 flex-none stroke-2" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
