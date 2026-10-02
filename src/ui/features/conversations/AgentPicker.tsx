import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { agent } from "../../../shared/plugins";
import { useDismiss } from "../../hooks/useDismiss";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";

const glyphOf = (id: string, className: string) => {
  const svg = agent(id)?.glyph;
  return svg ? <Glyph svg={svg} className={className} /> : null;
};

/** The composer's agent before the first message: a pill with the agent's glyph that opens a menu of the agents
 *  switched on. Arrows move through the menu, Enter picks, Escape closes it and gives the focus back to the pill. */
export function AgentPicker({
  agents,
  value,
  label,
  onPick,
}: {
  agents: { id: string; name: string }[];
  value: string;
  label: string;
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
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
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
  const current = agents.find(option => option.id === value);
  return (
    <span ref={root} className="relative inline-flex">
      <button
        ref={trigger}
        className="inline-flex items-center gap-1.5 h-6.5 px-2 rounded-[7px] border-0 bg-fill-2 text-xs text-label hover:bg-separator-strong"
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKey}
      >
        {glyphOf(value, "glyph size-3.25 flex-none")}
        {current?.name ?? value}
        <Icon name="down" className="glyph size-2.75 stroke-2 text-secondary" />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className="absolute bottom-full left-0 mb-1.5 z-20 min-w-40 grid p-1 bg-bg border border-separator rounded-lg shadow-lg"
          onKeyDown={onMenuKey}
        >
          {agents.map(option => (
            <button
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === value}
              className="flex items-center gap-2 px-2.5 py-1 rounded-sm border-0 bg-transparent text-sm text-left text-label outline-none focus:bg-accent focus:text-on-accent"
              onMouseEnter={e => e.currentTarget.focus()}
              onClick={() => {
                onPick(option.id);
                close();
              }}
            >
              {glyphOf(option.id, "glyph size-3.5 flex-none")}
              <span className="flex-1 truncate">{option.name}</span>
              {option.id === value ? <Icon name="check" className="glyph size-3.5 flex-none stroke-2" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
