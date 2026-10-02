import { useRef, useState, type ReactNode } from "react";
import type { Opt, State, Tone } from "../../../domain/board/types";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { Ring } from "./Ring";
import { POPOVER, POP_ROW } from "./toolbar";

const PILL = "inline-flex self-start items-center gap-2 h-6.5 px-2 -ml-2 rounded-[7px] text-[13px]";

/** The value as a pill that opens a menu of the choices under it when there are any, else plain. `none` is the label
 *  of an empty choice (unassigned). A current value the choices lack (someone who left the project) is put in front,
 *  so the menu shows it and every other choice, the empty one too, is a change. A choice with a state (a workflow
 *  status) shows its ring. Escape closes the menu, not the ticket window. */
export function TicketPicker({
  current,
  currentName,
  choices,
  none,
  label,
  onPick,
  children,
}: {
  current: string;
  currentName: string;
  choices: (Opt & { state?: State; tone?: Tone })[] | undefined;
  none?: string;
  label: string;
  onPick: (id: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  if (!choices) return <span className={`${PILL} font-medium`}>{children}</span>;
  const all = [
    ...(none !== undefined ? [{ id: "", name: none }] : []),
    ...(current && !choices.some(c => c.id === current) ? [{ id: current, name: currentName }] : []),
    ...choices,
  ];
  const pick = (id: string) => {
    setOpen(false);
    if (id !== current) onPick(id);
  };
  return (
    <div
      ref={root}
      className="relative self-start"
      onKeyDown={e => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        className={`${PILL} font-medium border-0 bg-transparent text-label cursor-default hover:bg-fill-2 ${open ? "bg-fill-2" : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {children}
        <Icon name="down" className="glyph size-[11px] text-tertiary stroke-2" />
      </button>
      {open && (
        <div
          className={`absolute top-full left-0 mt-1 z-30 w-60 max-h-72 overflow-y-auto p-1 rounded-[10px] ${POPOVER}`}
          role="menu"
          aria-label={label}
        >
          {all.map(choice => (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice.id === current}
              className={`w-full text-left text-[13px] ${POP_ROW}`}
              onClick={() => pick(choice.id)}
            >
              {"state" in choice && <Ring state={choice.state} tone={choice.tone} />}
              <span className={`flex-1 truncate ${choice.id ? "" : "text-secondary"}`}>{choice.name}</span>
              {choice.id === current && <Icon name="check" className="glyph size-3.5 text-accent-text stroke-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
