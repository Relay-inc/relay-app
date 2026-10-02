import { useEffect, useEffectEvent, type RefObject } from "react";

/** While `open`: a press outside `ref` (or outside what `inside` accepts) or Escape calls `close`. `on` is the event
 *  that counts as a press outside: "click" (menus) or "pointerdown" (a picker that closes before the click lands). */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
  { on = "click", inside }: { on?: "click" | "pointerdown"; inside?: (target: Element) => boolean } = {},
) {
  const dismiss = useEffectEvent((e: Event) => {
    if (e instanceof KeyboardEvent) {
      if (e.key === "Escape") close();
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    const within = !!ref.current && e.composedPath().includes(ref.current);
    if (!within && !(target && inside?.(target))) close();
  });
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => dismiss(e);
    document.addEventListener(on, handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener(on, handler);
      document.removeEventListener("keydown", handler);
    };
  }, [open, on]);
}
