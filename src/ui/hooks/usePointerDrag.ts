import { useEffect, useEffectEvent, useRef, useState } from "react";

// a press that moves less than this many pixels is a click, not a drag
const DRAG_THRESHOLD = 5;

/** A press or drag: what the component gave at the press, where the pointer started and is now, and `moving` once
 *  it has left the click tolerance. */
type PointerDrag<T> = T & { moving: boolean; startX: number; startY: number; x: number; y: number };

/** Dragging with pointer events (the Mac webview does not deliver HTML drag and drop reliably). `start(e, data)` on a
 *  pointerdown; the window's move, up and cancel listeners are registered once and read the drag from a ref, which is
 *  current even before React drew the last move. While it moves, the body has the `reordering` class (the grabbing
 *  cursor). `onMove` returns what to add to the drag (the target under the pointer); `onEnd` gets the drag and whether
 *  it was released (a cancel, the system taking the pointer, is not). A release that never moved is a click. */
export function usePointerDrag<T extends object>({
  onMove,
  onEnd,
}: {
  onMove?: (drag: PointerDrag<T>, e: PointerEvent) => Partial<T> | void;
  onEnd: (drag: PointerDrag<T>, released: boolean) => void;
}) {
  const [drag, setDrag] = useState<PointerDrag<T> | null>(null);
  const current = useRef<PointerDrag<T> | null>(null);
  const update = (next: PointerDrag<T> | null) => {
    current.current = next;
    setDrag(next);
  };
  const move = useEffectEvent((e: PointerEvent) => {
    const press = current.current;
    if (!press) return;
    if (!press.moving) {
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_THRESHOLD) return;
      document.body.classList.add("reordering");
    }
    const next = { ...press, moving: true, x: e.clientX, y: e.clientY };
    update({ ...next, ...(onMove?.(next, e) ?? {}) });
  });
  const end = useEffectEvent((released: boolean) => {
    const press = current.current;
    if (!press) return;
    update(null);
    document.body.classList.remove("reordering");
    onEnd(press, released);
  });
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => move(e);
    const onUp = () => end(true);
    const onCancel = () => end(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.classList.remove("reordering"); // leaving mid-drag
    };
  }, []);
  const start = (e: { clientX: number; clientY: number }, data: T) =>
    update({ ...data, moving: false, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY });
  return { drag, start };
}
