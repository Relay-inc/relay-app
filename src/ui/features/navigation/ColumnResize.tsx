import type { PointerEvent } from "react";
import {
  COLUMNS,
  clampColumn,
  columnWidth,
  keepColumnWidth,
  type Column,
} from "../../../application/navigation/columns";

// the grids read each column's width from its CSS variable (`--sidebar-w`, `--today-w`, ...)
const cssVar = (column: Column) => `--${column}-w`;
const apply = (column: Column, w: number) => document.documentElement.style.setProperty(cssVar(column), `${w}px`);
// set once on load, so the kept widths show before any drag
for (const column of Object.keys(COLUMNS) as Column[]) apply(column, columnWidth(column));

/** The inner edge of a column against the left or right of its grid: drag to make it wider or smaller, double-click
 *  to reset. The width is kept. It goes in the grid itself, which must be positioned; absolute, it takes no cell. */
export function ColumnResize({ column }: { column: Column }) {
  const { side, initial } = COLUMNS[column];
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const app = handle.closest<HTMLElement>(".relay-app");
    const grid = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    app?.setAttribute("data-resizing", "");
    let width = columnWidth(column); // a click without a move keeps what was there
    const move = (ev: globalThis.PointerEvent) => {
      width = clampColumn(column, side === "left" ? ev.clientX - grid.left : grid.right - ev.clientX);
      apply(column, width);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      app?.removeAttribute("data-resizing");
      keepColumnWidth(column, width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  };
  const reset = () => {
    apply(column, initial);
    keepColumnWidth(column, initial);
  };
  return (
    <div
      className="absolute inset-y-0 w-2 z-10 cursor-col-resize"
      style={{ [side]: `calc(var(${cssVar(column)}) - 4px)` }}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={down}
      onDoubleClick={reset}
    />
  );
}
