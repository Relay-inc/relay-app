import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { cellValues, readBase, showBase, viewOf } from "../../../domain/collections/bases";
import { kindOfKey, type Column, type Row } from "../../../domain/collections/rules";
import { loadRows, useCollectionsStore } from "../../../application/collections/collections";
import { activeFolder } from "../../../application/navigation/workspaces";
import { loadTypes, registryOf } from "../../../application/types/types";
import { openLink } from "../../../application/settings/window";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { CellValue } from "../collections/CollectionCell";
import { columnLabel } from "../collections/labels";
import { WIDTH } from "../collections/CollectionTable";

// A view inside a page (issue 421): an Obsidian base, from a fenced `base` block or an embedded `.base` file, drawn as
// a read-only table over the collections' rows. `this` is the page it is in. A base Relay can't draw exactly shows
// "Open in Obsidian" instead. The rows come from the collections store, so the view follows every edit made there.

const NONE: Row[] = [];
/** The most rows a page shows of one view; the rest are a count. */
const MAX_ROWS = 25;

/** A column of a base (`file.name`, `note.status`, `date`) as a collection column, and the row as that column reads it:
 *  the frontmatter only (a base has no derived `stage`, no `date` from the file name). */
function columnOf(id: string, registry: ReturnType<typeof registryOf>): Column {
  if (id === "file.name" || id === "file.basename") return { key: "title", kind: "title" };
  if (id === "file.mtime") return { key: "updated", kind: "time" };
  if (id.startsWith("file.")) return { key: id, kind: "text" };
  const key = id.replace(/^note\./, "");
  return { key, kind: kindOfKey(key, registry) };
}
const asBase = (row: Row, order: string[]): Row => ({
  ...row,
  t: row.p.split("/").pop()!.replace(/\.md$/i, ""),
  k: row.props.type?.[0] ?? "",
  date: row.props.date?.[0] ?? "",
  stage: "",
  props: {
    ...row.props,
    ...Object.fromEntries(order.filter(id => id.startsWith("file.")).map(id => [id, cellValues(row, id)])),
  },
});

/** The note path of `page` in the workspace `folder` (a page of another workspace is `<folder>/<path>`). */
const relOf = (folder: string, page: string) => (page.startsWith(`${folder}/`) ? page.slice(folder.length + 1) : page);

export function BaseView({ page, source, viewName }: { page: string; source: string; viewName: string }) {
  const { t, tn, any } = useT();
  const folder = useDerived(() => activeFolder());
  const rows = useCollectionsStore(s => s.rows[folder]) ?? NONE;
  const registry = useDerived(() => registryOf(folder));
  useEffect(() => {
    void loadRows(folder);
    void loadTypes(folder);
  }, [folder]);
  const path = relOf(folder, page);
  const obsidian = () => void openLink(`obsidian://open?path=${encodeURIComponent(`${folder}/${path}`)}`);
  const read = readBase(source);
  const base = "base" in read ? read.base : null;
  const view = base ? viewOf(base, viewName) : null;
  const shown = base && view ? showBase(base, view, rows, { path, row: rows.find(r => r.p === path) }) : null;
  if (!base || !view || !shown || "unsupported" in shown)
    return (
      <div className="cm-base-unsupported" role="group">
        <span>
          {t("base.unsupported", {
            what: "unsupported" in read ? read.unsupported : shown && "unsupported" in shown ? shown.unsupported : "",
          })}
        </span>
        <button type="button" className="cm-embed-link" onClick={obsidian}>
          {t("base.openObsidian")}
        </button>
      </div>
    );
  const { names } = base;
  const order = view.order;
  const columns = order.map(id => columnOf(id, registry));
  const template = columns.map(c => WIDTH[c.kind]).join(" ");
  const capped = new Set(shown.rows.slice(0, MAX_ROWS));
  const groups = shown.groups.map(g => ({ ...g, rows: g.rows.filter(r => capped.has(r)) })).filter(g => g.rows.length);
  const more = shown.rows.length - Math.min(shown.rows.length, MAX_ROWS);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="cm-base" role="group" aria-label={view.name}>
      <div className="cm-embed-note-head">
        <span className="cm-embed-sub">{`${view.name} · ${tn("coll.notes", shown.total)}`}</span>
      </div>
      <div role="table" className="text-[13px]" aria-rowcount={shown.rows.length}>
        <div
          role="row"
          className="grid items-center gap-x-3 h-8 text-xs text-secondary font-medium"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c, i) => (
            <div key={order[i]} role="columnheader" className="truncate">
              {names[order[i]] ?? columnLabel(any, c.key)}
            </div>
          ))}
        </div>
        {groups.map(group => (
          <div key={group.value} role="rowgroup">
            {view.groupBy ? (
              <div role="row" className="h-8 flex items-center gap-2 border-t border-separator font-semibold">
                {group.value ||
                  t("coll.noValue", { key: columnLabel(any, columnOf(view.groupBy.property, registry).key) })}
                <span className="text-xs font-normal text-secondary">{group.rows.length}</span>
              </div>
            ) : null}
            {group.rows.map(row => {
              const shadow = asBase(row, order);
              return (
                <div
                  key={row.p}
                  role="row"
                  className="grid items-center gap-x-3 h-9 border-t border-separator"
                  style={{ gridTemplateColumns: template }}
                >
                  {columns.map((c, i) => (
                    <div key={order[i]} role="cell" className="min-w-0 truncate">
                      <CellValue row={shadow} column={c} today={today} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        {!shown.rows.length ? <p className="py-3 text-secondary">{t("coll.empty")}</p> : null}
        {more > 0 ? (
          <button type="button" className="cm-embed-link mt-1" onClick={obsidian}>
            {t("base.more", { n: more })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The view drawn into `dom` (a widget of the editor); the function returned takes it down again. */
export function mountBase(dom: HTMLElement, props: { page: string; source: string; viewName: string }) {
  const root = createRoot(dom);
  root.render(createElement(BaseView, props));
  return () => root.unmount();
}
