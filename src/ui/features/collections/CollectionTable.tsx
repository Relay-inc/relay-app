import { useState } from "react";
import { defOf, grouped, type Column, type Row, type View } from "../../../domain/collections/rules";
import type { Registry } from "../../../domain/types/registry";
import { useT } from "../../hooks/useT";
import { CellEditor, CellValue, editable } from "./CollectionCell";
import { columnLabel } from "./labels";

const ROW = 38; // px: h-9.5, the windowing's step
const OVERSCAN = 8;
// a column's width: the title takes what is left, the rest by what they hold
export const WIDTH: Record<Column["kind"], string> = {
  title: "minmax(12rem, 1fr)",
  date: "5.5rem",
  stage: "9.5rem",
  links: "11rem",
  people: "12rem",
  status: "7.5rem",
  text: "6rem",
  time: "5.5rem",
  followed: "6rem",
};
type Item = { head: string; count: number } | { row: Row };

/** The table (K8): one line per note, the columns of the collection, group headers when a key is picked. Only the lines
 *  in view are drawn, so a collection of thousands scrolls as one of ten. A click on a cell of a stored property edits
 *  it in place and writes that note's frontmatter. */
export function CollectionTable({
  rows,
  all,
  view,
  registry,
  today,
}: {
  rows: Row[];
  all: Row[];
  view: View;
  registry: Registry;
  today: string;
}) {
  const { t, any } = useT();
  const [top, setTop] = useState(0);
  const [editing, setEditing] = useState<{ path: string; key: string } | null>(null);
  const def = defOf(view.collection, registry);
  const template = def.columns.map(c => WIDTH[c.kind]).join(" ");
  const items: Item[] = grouped(rows, view.group, view.collection, today).flatMap(group => [
    ...(view.group ? [{ head: group.value, count: group.rows.length }] : []),
    ...group.rows.map(row => ({ row })),
  ]);
  const from = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const to = Math.min(items.length, from + Math.ceil(1000 / ROW) + OVERSCAN * 2);
  return (
    <div className="flex-1 min-h-0 overflow-auto" onScroll={e => setTop(e.currentTarget.scrollTop)}>
      <div className="min-w-max" role="table" aria-rowcount={items.length}>
        <div
          role="row"
          className="sticky top-0 z-10 bg-bg grid items-center gap-x-3 h-8.5 text-xs text-secondary font-medium"
          style={{ gridTemplateColumns: template }}
        >
          {def.columns.map(column => (
            <div key={column.key} role="columnheader">
              {columnLabel(any, column.key)}
            </div>
          ))}
        </div>
        {items.length ? (
          <div style={{ height: items.length * ROW, position: "relative" }}>
            {items.slice(from, to).map((item, i) => (
              <div
                key={"row" in item ? item.row.p : `head:${item.head}`}
                role="row"
                className={`absolute inset-x-0 grid items-center gap-x-3 h-9.5 border-t border-separator text-[13px] ${"head" in item ? "font-semibold" : ""}`}
                style={{ top: (from + i) * ROW, gridTemplateColumns: template }}
              >
                {"head" in item ? (
                  <div className="col-span-full flex items-center gap-2">
                    {item.head || t("coll.noValue", { key: columnLabel(any, view.group) })}
                    <span className="text-xs font-normal text-secondary">{item.count}</span>
                  </div>
                ) : (
                  def.columns.map(column => {
                    const edits = editable(view.collection, column);
                    const open = editing?.path === item.row.p && editing.key === column.key;
                    return (
                      <div
                        key={column.key}
                        role="cell"
                        data-cell={column.key}
                        className={`relative min-w-0 ${open ? "z-20" : "truncate"}`}
                      >
                        {open ? (
                          <CellEditor row={item.row} column={column} rows={all} onClose={() => setEditing(null)} />
                        ) : edits ? (
                          <div
                            className="-mx-1 px-1 py-1 rounded-md cursor-pointer hover:bg-fill min-h-7 flex items-center"
                            onClick={() => setEditing({ path: item.row.p, key: column.key })}
                          >
                            <CellValue row={item.row} column={column} today={today} />
                          </div>
                        ) : (
                          <CellValue row={item.row} column={column} today={today} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-secondary">{t("coll.empty")}</p>
        )}
      </div>
    </div>
  );
}
