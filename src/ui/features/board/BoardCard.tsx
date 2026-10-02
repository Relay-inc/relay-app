import type { KeyboardEvent, PointerEvent } from "react";
import type { Key } from "../../../shared/i18n";
import type { Card } from "../../../domain/board/types";
import { useT } from "../../hooks/useT";

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
const CARD_AT_REST = "shadow-xs ring-1 ring-separator";
const CARD_DRAGGED = "fixed left-0 top-0 z-40 pointer-events-none opacity-95 shadow-lg";

// 2026-10-03 shows as 3/10
const dueLabel = (due: string) => due.split("-").reverse().slice(0, 2).map(Number).join("/");

/** One card. Pressing it reports where it was grabbed (the board drags it with pointer events, the Mac webview does
 *  not deliver HTML drag and drop reliably), Enter or Space opens it. `ghost` is the copy that follows the pointer. */
export function BoardCard({
  card,
  ghost,
  onGrab,
  onOpen,
}: {
  card: Card;
  ghost?: { left: number; top: number; width: number };
  onGrab?: (grab: CardGrab) => void;
  onOpen?: () => void;
}) {
  const { t } = useT();
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
  return (
    <div
      className={`bg-bg rounded-md px-2.5 py-2 cursor-grab select-none ${ghost ? CARD_DRAGGED : CARD_AT_REST}`}
      style={ghost ? { width: `${ghost.width}px`, transform: `translate(${ghost.left}px,${ghost.top}px)` } : undefined}
      onPointerDown={ghost ? undefined : onDown}
      // a div, not a button, because it holds block content: the role and the keys make it one for the keyboard
      role={ghost ? undefined : "button"}
      tabIndex={ghost ? undefined : 0}
      onKeyDown={ghost ? undefined : onKey}
    >
      <div className="text-sm leading-snug">{card.title}</div>
      <div className="flex gap-2.5 mt-1 text-xs text-secondary tabular-nums">
        {number && (
          <span>
            {/^\d+$/.test(number) ? "#" : ""}
            {number}
          </span>
        )}
        {!!priority && priority <= 4 && (
          <span className={PRIORITY_CLASS[priority] ?? ""}>{t(`kb.prio${priority}` as Key)}</span>
        )}
        {card.who && <span>{card.who}</span>}
        {card.due && <span>{dueLabel(card.due)}</span>}
      </div>
    </div>
  );
}
