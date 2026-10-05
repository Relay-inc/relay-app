import type { KeyboardEvent, PointerEvent } from "react";
import type { Key } from "../../../shared/i18n";
import type { Card } from "../../../domain/board/types";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { Avatar } from "../../components/Avatar";
import { Ring } from "./Ring";
import { due, numbered, updated } from "./format";

/** where a card was grabbed: the pointer, and the pointer's offset inside the card */
export type CardGrab = {
  id: string;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  width: number;
};

// priorities 1 and 2 are coloured, 3 and 4 only named
const PRIORITY_CLASS: Record<number, string> = { 1: "text-late", 2: "text-soon", 3: "", 4: "" };
const CARD_AT_REST = "border border-card-edge shadow-card hover:border-card-edge-hover hover:shadow-card-hover";
const CARD_SELECTED = "border border-accent shadow-[0_0_0_.5px_var(--accent),0_0_0_4px_var(--accent-soft)]";
const CARD_DRAGGED = "fixed left-0 top-0 z-40 pointer-events-none opacity-95 shadow-lg";

/** One card. Pressing it reports where it was grabbed (the board drags it with pointer events, the Mac webview does
 *  not deliver HTML drag and drop reliably), Enter or Space opens it. `ghost` is the copy that follows the pointer,
 *  `selected` the card shown in the ticket window. */
export function BoardCard({
  card,
  selected,
  ghost,
  onGrab,
  onOpen,
}: {
  card: Card;
  selected?: boolean;
  ghost?: { left: number; top: number; width: number };
  onGrab?: (grab: CardGrab) => void;
  onOpen?: () => void;
}) {
  const { t, locale } = useT();
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !onGrab) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    onGrab({
      id: card.id,
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: e.clientX - box.left,
      offsetY: e.clientY - box.top,
      width: box.width,
    });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpen?.();
  };
  const { number, priority } = card;
  const path = [card.folder, card.list].filter(Boolean).join(" › ");
  const dueDay = due(card.due, locale);
  const touched = updated(card.updated, locale);
  const look = ghost ? `${CARD_DRAGGED} border border-card-edge` : selected ? CARD_SELECTED : CARD_AT_REST;
  // a card made on the board that the tracker has not confirmed yet
  const draft = card.id.startsWith("new:");
  return (
    <div
      className={`bg-raised rounded-[9px] px-3 py-2.5 flex flex-col gap-1.5 cursor-grab select-none transition-[box-shadow,border-color] duration-150 ${look} ${draft ? "opacity-60 pointer-events-none" : ""}`}
      style={ghost ? { width: `${ghost.width}px`, transform: `translate(${ghost.left}px,${ghost.top}px)` } : undefined}
      onPointerDown={ghost ? undefined : onDown}
      // a div, not a button, because it holds block content: the role and the keys make it one for the keyboard
      role={ghost ? undefined : "button"}
      tabIndex={ghost ? undefined : 0}
      onKeyDown={ghost ? undefined : onKey}
    >
      <div className="flex items-center gap-1.5 h-5 font-mono text-[11px] text-secondary">
        {number && <span>{numbered(number)}</span>}
        {!!priority && priority <= 4 && (
          <span className={PRIORITY_CLASS[priority] ?? ""}>{t(`kb.prio${priority}` as Key)}</span>
        )}
        <span className="flex-1"></span>
        <Avatar name={card.whoName || card.who} self={card.me} />
      </div>
      <div className="flex gap-2 items-start">
        {card.state && (
          <span className="mt-0.5 inline-flex">
            <Ring state={card.state} tone={card.tone} />
          </span>
        )}
        <div className="text-[13px] font-medium leading-[1.4] text-pretty">{card.title}</div>
      </div>
      {path && <div className={`text-[11px] text-secondary ${card.state ? "pl-5.5" : ""}`}>{path}</div>}
      {(!!card.labels?.length || dueDay || touched) && (
        <div
          className={`flex items-center gap-1.5 text-[11px] text-secondary tabular-nums ${card.state ? "pl-5.5" : ""}`}
        >
          {(card.labels ?? []).map((name, i) => (
            <span key={`${i}:${name}`} className="h-4.5 px-1.5 rounded-[5px] bg-fill-2 inline-flex items-center">
              {name}
            </span>
          ))}
          {dueDay && (
            <span className={`inline-flex items-center gap-1 font-medium ${dueDay.tone}`}>
              <Icon name="cal" className="glyph size-3" />
              {dueDay.short}
            </span>
          )}
          <span className="flex-1"></span>
          <span>{touched}</span>
        </div>
      )}
    </div>
  );
}
