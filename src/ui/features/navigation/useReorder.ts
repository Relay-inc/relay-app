import { useRef, type PointerEvent, type RefObject } from "react";
import type { ReorderKind } from "../../../domain/navigation/sidebar";
import { reorder } from "../../../application/navigation/sidebar";
import { usePointerDrag } from "../../hooks/usePointerDrag";

export type Drop = "" | "before" | "after";
type Press = {
  kind: ReorderKind;
  id: string;
  group: string; // the context a project is dragged in, the project a conversation is dragged in
  target?: string;
  after?: boolean;
};

// what a dragged kind can be dropped on: the header's section, the other views, the other conversations of its project,
// the other projects of its section
const dropSelector = (kind: ReorderKind, group: string) => {
  if (kind === "sec") return "[data-drop]";
  if (kind === "view") return "[data-view]";
  if (kind === "conv") return `[data-kind="conv"][data-parent="${CSS.escape(group)}"]`;
  return `[data-kind="proj"][data-context="${CSS.escape(group)}"]`;
};
// the id a drop target stands for
const dropId = (kind: ReorderKind, target: HTMLElement) => {
  if (kind === "sec") return target.dataset.drop;
  if (kind === "view") return target.dataset.view;
  if (kind === "conv") return target.dataset.key;
  return target.dataset.project;
};

/** Reorder the sidebar by pressing and moving: a view among the views, a section header among headers, a project among
 *  the projects of its section, a conversation among those of its project. With `sideways` the views stand in a row of
 *  icons, so before or after is left or right of the middle. `press` goes on the row's pointerdown, `dropzone` says how a
 *  row is drawn meanwhile, and `unlessDragged` keeps the click that ends a drag from also selecting the row. */
export function useReorder(root: RefObject<HTMLElement | null>, sideways: boolean) {
  const justDragged = useRef(false);
  // the ids of the rows that can be reordered among each other, in screen order (sections reorder without them)
  const visibleIds = (press: Press) => {
    if (press.kind === "sec" || press.kind === "view" || !root.current) return [];
    const rows = root.current.querySelectorAll<HTMLElement>(dropSelector(press.kind, press.group));
    return [...rows].map(row => dropId(press.kind, row)!);
  };
  const { drag, start } = usePointerDrag<Press>({
    onMove: (press, e) => {
      const dropTarget = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>(dropSelector(press.kind, press.group));
      if (!dropTarget) return { target: undefined };
      const box = dropTarget.getBoundingClientRect();
      const after =
        press.kind === "view" && sideways ? e.clientX > box.left + box.width / 2 : e.clientY > box.top + box.height / 2;
      return { target: dropId(press.kind, dropTarget), after };
    },
    onEnd: (press, released) => {
      if (!press.moving) return;
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (released && press.target)
        reorder(press.kind, press.group, visibleIds(press), press.id, press.target, !!press.after);
    },
  });

  const press =
    (kind: ReorderKind, id: string, group = "") =>
    (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest("button")) return;
      e.preventDefault(); // no text selection starting from a row that can be dragged
      start(e, { kind, id, group });
    };
  const dropzone = (kind: ReorderKind, id: string): { dragging: boolean; drop: Drop } => {
    if (!drag?.moving || drag.kind !== kind) return { dragging: false, drop: "" };
    if (drag.target !== id) return { dragging: drag.id === id, drop: "" };
    return { dragging: drag.id === id, drop: drag.after ? "after" : "before" };
  };
  const unlessDragged = (action: () => void) => () => {
    if (!justDragged.current) action();
  };
  return { press, dropzone, unlessDragged, reordering: !!drag?.moving };
}
