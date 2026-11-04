import { useEffect, useRef, useState } from "react";
import { commonFolder, evaluate, scoped, valuesOf, type View } from "../../../domain/collections/rules";
import { loadRows, loadViews, saveView, useCollectionsStore } from "../../../application/collections/collections";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useNavigationStore } from "../../../application/navigation/store";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { Toast } from "../conversations/Toast";
import { CollectionBoard } from "./CollectionBoard";
import { CollectionTable } from "./CollectionTable";
import { CollectionToolbar } from "./CollectionToolbar";
import { columnLabel } from "./labels";

const NONE: never[] = [];

/** A collection (K8 table, K9 board): the notes of a type in a context, narrowed by filters, as one line each or as
 *  cards in lanes. Save view keeps what is shown as `.relay/views/<name>.json`. */
export function CollectionView({ className }: { className: string }) {
  const { t, tn } = useT();
  const folder = useDerived(() => activeFolder());
  const rows = useCollectionsStore(s => s.rows[folder]) ?? NONE;
  const view = useCollectionsStore(s => s.view);
  const name = useCollectionsStore(s => s.name);
  const toast = useNavigationStore(s => s.toast);
  useEffect(() => {
    void loadRows(folder);
    void loadViews(folder);
  }, [folder]);
  const today = new Date().toISOString().slice(0, 10);
  const inScope = scoped(rows, view);
  const shown = evaluate(rows, view);
  const about = view.filters.find(f => f.key === "about" && f.is !== undefined)?.is;
  const where = [
    view.context ? t("coll.in", { context: view.context }) : "",
    about && !view.context ? t("coll.about", { name: about }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const home = commonFolder(inScope);
  return (
    <div className={`${className} min-h-0 relative`}>
      <div className="h-full flex flex-col px-8 pt-10 pb-6">
        <header className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">{t(`coll.title.${view.collection}`)}</h1>
            <div className="text-secondary">
              {[
                where,
                `${tn("coll.notes", inScope.length)}${home ? ` ${t("coll.inFolder", { folder: home })}` : ""}`,
                t("coll.match", { n: shown.length }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          {name ? <span className="font-mono text-[11px] text-tertiary">{`.relay/views/${name}.json`}</span> : null}
          <SaveView view={view} name={name} />
        </header>
        <CollectionToolbar
          view={view}
          values={key => [...new Set(inScope.flatMap(row => valuesOf(row, key)))].sort()}
        />
        {view.layout === "table" ? (
          <CollectionTable rows={shown} all={rows} view={view} today={today} />
        ) : (
          <CollectionBoard rows={shown} view={view} today={today} />
        )}
        {view.layout === "table" ? (
          <p className="mt-2 text-xs text-secondary">{t("coll.hint", { n: inScope.length })}</p>
        ) : null}
      </div>
      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toast toast={toast} />
        </div>
      ) : null}
    </div>
  );
}

/** Save view: a name (the saved view's own when it came from one), then Save. */
function SaveView({ view, name }: { view: View; name: string }) {
  const { t, any } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  const suggestion =
    name ||
    [
      t(`coll.title.${view.collection}`),
      ...view.filters.map(f => (f.is !== undefined ? f.is : columnLabel(any, f.key))),
    ].join(" ");
  return (
    <div ref={box} className="relative">
      <button className="btn h-7 px-3 cursor-pointer" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("coll.save")}
      </button>
      {open ? (
        <form
          className="absolute right-0 top-9 z-20 w-72 p-3 rounded-xl bg-raised border border-separator shadow-md flex flex-col gap-2 text-[13px]"
          onSubmit={e => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("name");
            if (typeof value === "string" && value.trim()) {
              void saveView(value.trim());
              setOpen(false);
            }
          }}
        >
          <label className="text-xs text-secondary" htmlFor="coll-view-name">
            {t("coll.viewName")}
          </label>
          <input
            id="coll-view-name"
            name="name"
            autoFocus
            defaultValue={suggestion}
            className="h-7 px-2 rounded-md bg-fill-2 outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-7 px-2 rounded-md text-secondary hover:bg-fill"
              onClick={() => setOpen(false)}
            >
              {t("props.cancel")}
            </button>
            <button className="btn btn-primary h-7 px-3 cursor-pointer">{t("coll.saveButton")}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
