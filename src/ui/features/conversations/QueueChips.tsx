import { useRef, useState } from "react";
import { editQueuedMessage, moveQueuedMessage, removeQueuedMessage } from "../../../application/conversations/actions";
import { useDraftsStore } from "../../../application/conversations/drafts";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { useT } from "../../hooks/useT";

/** What a press on a chip keeps: which one, and the place it hovers (its index among the chips). */
type Grab = { id: string; over?: number };

/** The messages Relay holds while a turn runs, above the composer, in the order they go out. A click edits one in
 *  place (Enter keeps it, Esc leaves it as it was), dragging puts it elsewhere in the row, × takes it out. */
export function QueueChips({ chatKey, className = "" }: { chatKey: string; className?: string }) {
  const { t } = useT();
  const queue = useDraftsStore(s => s.queue[chatKey]);
  const row = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState("");
  const { drag, start } = usePointerDrag<Grab>({
    // the place among the other chips: as many as have their middle left of the pointer
    onMove: (press, e) => {
      const others = [...(row.current?.querySelectorAll<HTMLElement>("[data-queued]") ?? [])].filter(
        chip => chip.dataset.queued !== press.id,
      );
      const box = (chip: HTMLElement) => chip.getBoundingClientRect();
      return { over: others.filter(chip => e.clientX > box(chip).left + box(chip).width / 2).length };
    },
    // a release without a move is a click: edit; a cancel does nothing
    onEnd: (press, released) => {
      if (!released) return;
      if (!press.moving) setEditing(press.id);
      else if (press.over !== undefined) moveQueuedMessage(chatKey, press.id, press.over);
    },
  });
  if (!queue?.length) return null;
  // the chip the dragged one lands before, ringed (none when it goes last)
  const others = queue.filter(x => x.id !== drag?.id);
  const before = drag?.moving && drag.over !== undefined ? others[drag.over]?.id : undefined;
  return (
    <div ref={row} className={`flex flex-wrap gap-1.5 ${className}`}>
      {queue.map(message =>
        editing === message.id ? (
          <input
            key={message.id}
            autoFocus
            defaultValue={message.text}
            aria-label={t("queue.edit")}
            className="h-7 w-60 px-2 rounded-lg border-0 ring-1 ring-accent bg-fill text-[13px] text-label outline-none"
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                e.stopPropagation();
                setEditing("");
              } else return;
              e.preventDefault();
            }}
            onBlur={e => {
              // Esc already left the field: the text is only kept by Enter or a click elsewhere
              if (editing === message.id) editQueuedMessage(chatKey, message.id, e.currentTarget.value);
              setEditing("");
            }}
          />
        ) : (
          <span
            key={message.id}
            data-queued={message.id}
            className={`group relative flex-none ${drag?.moving && drag.id === message.id ? "opacity-50" : ""}`}
          >
            <button
              className={`inline-flex items-center gap-1.5 max-w-60 h-7 pl-2.5 pr-2.5 rounded-lg border-0 ring-1 bg-fill text-[13px] text-label hover:bg-fill-2 cursor-default ${before === message.id ? "ring-accent" : "ring-separator"}`}
              title={`${message.text}\n${t("queue.drag")}`}
              onPointerDown={e => start(e, { id: message.id })}
            >
              <span className="truncate">{message.text || message.files[0]?.split("/").pop()}</span>
            </button>
            <button
              className="absolute -top-1.5 -right-1.5 hidden group-hover:grid focus-visible:grid size-4 rounded-full p-0 bg-label text-bg text-sm leading-none place-items-center cursor-default"
              title={t("queue.remove")}
              aria-label={t("queue.remove")}
              onClick={() => removeQueuedMessage(chatKey, message.id)}
            >
              ×
            </button>
          </span>
        ),
      )}
    </div>
  );
}
