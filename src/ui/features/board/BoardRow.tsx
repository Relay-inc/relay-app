import type { Card } from "../../../domain/board/types";
import { useT } from "../../hooks/useT";
import { Avatar } from "../../components/Avatar";
import { Ring } from "./Ring";
import { due, numbered, updated } from "./format";

/** One card as a row of the list view; `selected` while it is open in the ticket window. */
export function BoardRow({ card, selected, onOpen }: { card: Card; selected: boolean; onOpen: () => void }) {
  const { locale } = useT();
  const day = due(card.due, locale);
  return (
    <button
      type="button"
      className={`w-full text-left flex items-center gap-3 h-10 pl-9 pr-5 border-b border-separator cursor-default ${selected ? "bg-accent-soft" : "hover:bg-fill"}`}
      onClick={onOpen}
    >
      <Ring state={card.state} />
      <span className="w-14 flex-none font-mono text-[11px] text-secondary truncate">{numbered(card.number)}</span>
      <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{card.title}</span>
      {(card.labels ?? []).map((name, i) => (
        <span
          key={`${i}:${name}`}
          className="h-4.5 px-1.5 rounded-sm bg-fill-2 text-[11px] text-secondary inline-flex items-center"
        >
          {name}
        </span>
      ))}
      <span className="w-32 flex-none truncate text-[11px] text-secondary">
        {[card.folder, card.list].filter(Boolean).join(" › ")}
      </span>
      <span className={`w-13 flex-none text-[11px] font-medium tabular-nums ${day?.tone ?? ""}`}>
        {day?.short ?? ""}
      </span>
      <span className="w-5 flex-none inline-flex">
        <Avatar name={card.who} />
      </span>
      <span className="w-11 flex-none text-right text-[11px] text-secondary tabular-nums">
        {updated(card.updated, locale)}
      </span>
    </button>
  );
}
