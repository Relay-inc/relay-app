import { useState } from "react";
import { defOf, range, type Column, type Filter, type View } from "../../../domain/collections/rules";
import type { Registry } from "../../../domain/types/registry";
import { addFilter, removeFilter, setGroup, setLayout, setSort } from "../../../application/collections/collections";
import { useT } from "../../hooks/useT";
import { MenuItem, PILL, PillMenu } from "./PillMenu";
import { columnLabel } from "./labels";

/** Table | Board, the filter chips with "+ Filter", then Sort and Group by (K8, K9). */
export function CollectionToolbar({
  view,
  registry,
  values,
}: {
  view: View;
  registry: Registry;
  values: (key: string) => string[];
}) {
  const { t, any } = useT();
  const def = defOf(view.collection, registry);
  const sort = view.sort ?? def.sort;
  const group = view.group || (view.layout === "board" ? def.board : "");
  return (
    <div className="flex items-center flex-wrap gap-2 mt-3.5 pb-3 border-b border-separator text-xs">
      <div role="tablist" aria-label={t("coll.layout")} className="flex p-0.5 rounded-lg bg-fill-2 text-[13px]">
        {(["table", "board"] as const).map(layout => (
          <button
            key={layout}
            role="tab"
            aria-selected={view.layout === layout}
            className={`h-6 px-3 rounded-md font-medium cursor-pointer ${view.layout === layout ? "bg-raised shadow-sm" : "text-secondary"}`}
            onClick={() => setLayout(layout)}
          >
            {t(`coll.${layout}`)}
          </button>
        ))}
      </div>
      <span className="w-px h-4.5 bg-separator mx-0.5" />
      <span className="text-secondary">{t("coll.filter")}</span>
      {view.filters.map(filter => (
        <span
          key={filter.key}
          data-filter={filter.key}
          className="h-6 inline-flex items-center gap-1.25 px-2 rounded-xl bg-accent-soft text-accent-text"
        >
          <span className="opacity-75">{columnLabel(any, filter.key)}:</span>
          {filterText(t, filter)}
          <button
            className="cursor-pointer"
            aria-label={`${t("props.remove")}: ${filter.key}`}
            onClick={() => removeFilter(filter.key)}
          >
            ×
          </button>
        </span>
      ))}
      <AddFilter columns={def.columns} values={values} />
      <span className="flex-1" />
      <PillMenu label={t("coll.sort")} value={`${columnLabel(any, sort.key)} ${sort.dir === "asc" ? "↑" : "↓"}`}>
        {close =>
          def.columns.map(column => (
            <MenuItem
              key={column.key}
              selected={sort.key === column.key}
              onClick={() => {
                setSort({ key: column.key, dir: sort.key === column.key && sort.dir === "desc" ? "asc" : "desc" });
                close();
              }}
            >
              {columnLabel(any, column.key)}
            </MenuItem>
          ))
        }
      </PillMenu>
      <PillMenu label={t("coll.group")} value={group ? columnLabel(any, group) : t("coll.none")}>
        {close => (
          <>
            {view.layout === "table" ? (
              <MenuItem
                selected={!group}
                onClick={() => {
                  setGroup("");
                  close();
                }}
              >
                {t("coll.none")}
              </MenuItem>
            ) : null}
            {def.columns
              .filter(column => column.key !== "title")
              .map(column => (
                <MenuItem
                  key={column.key}
                  selected={group === column.key}
                  onClick={() => {
                    setGroup(column.key);
                    close();
                  }}
                >
                  {columnLabel(any, column.key)}
                </MenuItem>
              ))}
          </>
        )}
      </PillMenu>
    </div>
  );
}

const filterText = (t: ReturnType<typeof useT>["t"], f: Filter) =>
  f.is !== undefined ? f.is : f.from || f.to ? `${f.from ?? ""} – ${f.to ?? ""}` : t("coll.none");

const TODAY = () => new Date().toISOString().slice(0, 10);

/** "+ Filter": a property, then its value (a date's range as a preset, else typed with the values the notes have). */
function AddFilter({ columns, values }: { columns: Column[]; values: (key: string) => string[] }) {
  const { t, any } = useT();
  const [key, setKey] = useState("");
  const column = columns.find(c => c.key === key);
  return (
    <PillMenu
      label={t("coll.addFilter")}
      className="h-6 px-1.5 text-xs text-secondary cursor-pointer hover:text-label"
      align="left"
    >
      {close =>
        !column ? (
          columns
            .filter(c => c.kind !== "title" && c.kind !== "time")
            .map(c => (
              <MenuItem key={c.key} onClick={() => setKey(c.key)}>
                {columnLabel(any, c.key)}
              </MenuItem>
            ))
        ) : column.kind === "date" ? (
          (["month", "quarter", "days30"] as const).map(preset => (
            <MenuItem
              key={preset}
              onClick={() => {
                addFilter(range(column.key, preset, TODAY()));
                setKey("");
                close();
              }}
            >
              {t(`coll.range.${preset}`)}
            </MenuItem>
          ))
        ) : (
          <form
            className="p-1"
            onSubmit={e => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("value");
              if (typeof value === "string" && value.trim()) addFilter({ key: column.key, is: value.trim() });
              setKey("");
              close();
            }}
          >
            <input
              name="value"
              autoFocus
              list="coll-values"
              onKeyDown={e => {
                // WebKit gives Enter to the open suggestion list: submit the form ourselves
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={`${columnLabel(any, column.key)}…`}
              aria-label={columnLabel(any, column.key)}
              className="h-7 w-full px-2 rounded-md bg-fill-2 outline-none"
            />
            <datalist id="coll-values">
              {values(column.key).map(v => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </form>
        )
      }
    </PillMenu>
  );
}

export { PILL };
