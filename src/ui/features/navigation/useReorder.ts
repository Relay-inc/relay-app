import { useRef, type PointerEvent, type RefObject } from "react";
import { GENERAL, type ReorderKind } from "../../../domain/navigation/sidebar";
import { reorder } from "../../../application/navigation/sidebar";
import { moveChat } from "../../../application/conversations/actions";
import { usePointerDrag } from "../../hooks/usePointerDrag";

export type Drop = "" | "before" | "after" | "in";
/** Where a dragged conversation lands: its project ("" Algemeen) and folder ("" none), and with `scope` the
 *  conversations it is placed among (dropped on one of them, before or after it). */
type Into = { project: string; folder: string; scope?: string };
type Press = {
  kind: ReorderKind;
  id: string;
  group: string; // the context a project is dragged in, the folder or project a conversation is dragged in
  target?: string;
  after?: boolean;
  into?: Into;
};

// what a dragged kind can be dropped on: the header's section, the other views, any conversation, project, folder or
// Algemeen (a conversation goes there), the other projects of its section
const dropSelector = (kind: ReorderKind, group: string) => {
  if (kind === "sec") return "[data-drop]";
  if (kind === "view") return "[data-view]";
  if (kind === "conv")
    return `[data-kind="conv"], [data-kind="proj"], [data-kind="folder"], [data-drop="${CSS.escape(GENERAL)}"]`;
  return `[data-kind="proj"][data-context="${CSS.escape(group)}"]`;
};
// the id a drop target stands for
const dropId = (kind: ReorderKind, target: HTMLElement) => {
  if (kind === "sec") return target.dataset.drop;
  if (kind === "view") return target.dataset.view;
  if (kind === "conv")
    return target.dataset.key ?? target.dataset.folder ?? target.dataset.project ?? target.dataset.drop;
  return target.dataset.project;
};
// where a conversation dropped on `target` goes: among the conversations there, or into the folder, project or Algemeen
const intoOf = (target: HTMLElement): Into => {
  const { kind, project = "", folder = "", parent } = target.dataset;
  if (kind === "conv") return { project, folder, scope: parent };
  if (kind === "folder") return { project, folder };
  if (kind === "proj") return { project, folder: "" };
  return { project: "", folder: "" };
};
const conversationRows = (root: HTMLElement, scope: string) =>
  root.querySelectorAll<HTMLElement>(`[data-kind="conv"][data-parent="${CSS.escape(scope)}"]`);

/** Reorder the sidebar by pressing and moving: a view among the views, a section header among headers, a project among
 *  the projects of its section, a conversation among those of its project or folder. A conversation dropped elsewhere
 *  moves: onto another project, a folder or Algemeen, or among another project's or folder's conversations. With
 *  `sideways` the views stand in a row of icons, so before or after is left or right of the middle. `press` goes on the
 *  row's pointerdown, `dropzone` says how a row is drawn meanwhile, and `unlessDragged` keeps the click that ends a drag
 *  from also selecting the row. */
export function useReorder(root: RefObject<HTMLElement | null>, sideways: boolean) {
  const justDragged = useRef(false);
  // the ids of the rows that can be reordered among each other, in screen order (sections reorder without them)
  const visibleIds = (kind: ReorderKind, group: string) => {
    if (kind === "sec" || kind === "view" || !root.current) return [];
    const rows =
      kind === "conv"
        ? conversationRows(root.current, group)
        : root.current.querySelectorAll<HTMLElement>(dropSelector(kind, group));
    return [...rows].map(row => (kind === "conv" ? row.dataset.key! : dropId(kind, row)!));
  };
  const drop = async (press: Press) => {
    const { kind, group, id, target, after, into } = press;
    if (!target) return;
    if (kind !== "conv" || !into) return reorder(kind, group, visibleIds(kind, group), id, target, !!after);
    if (into.scope === group) return reorder(kind, group, visibleIds(kind, group), id, target, !!after);
    // ids before the move: the dragged one is not among them yet, `place` puts it next to the target
    const among = into.scope === undefined ? [] : visibleIds(kind, into.scope);
    if (!(await moveChat(id, into.project || null, into.folder))) return;
    if (into.scope !== undefined) reorder(kind, into.scope, among, id, target, !!after);
  };
  const { drag, start } = usePointerDrag<Press>({
    onMove: (press, e) => {
      const dropTarget = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>(dropSelector(press.kind, press.group));
      if (!dropTarget) return { target: undefined, into: undefined };
      const box = dropTarget.getBoundingClientRect();
      const after =
        press.kind === "view" && sideways ? e.clientX > box.left + box.width / 2 : e.clientY > box.top + box.height / 2;
      return {
        target: dropId(press.kind, dropTarget),
        after,
        into: press.kind === "conv" ? intoOf(dropTarget) : undefined,
      };
    },
    onEnd: (press, released) => {
      if (!press.moving) return;
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (released) void drop(press);
    },
  });

  const press =
    (kind: ReorderKind, id: string, group = "") =>
    (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest("button")) return;
      e.preventDefault(); // no text selection starting from a row that can be dragged
      start(e, { kind, id, group });
    };
  const dropzone = (kind: ReorderKind | "folder", id: string): { dragging: boolean; drop: Drop } => {
    if (!drag?.moving) return { dragging: false, drop: "" };
    // a conversation held over a project, a folder or Algemeen goes into it
    if (drag.kind === "conv" && kind !== "conv")
      return { dragging: false, drop: drag.into && drag.into.scope === undefined && drag.target === id ? "in" : "" };
    if (drag.kind !== kind) return { dragging: false, drop: "" };
    if (drag.target !== id) return { dragging: drag.id === id, drop: "" };
    return { dragging: drag.id === id, drop: drag.after ? "after" : "before" };
  };
  const unlessDragged = (action: () => void) => () => {
    if (!justDragged.current) action();
  };
  return { press, dropzone, unlessDragged, reordering: !!drag?.moving };
}
