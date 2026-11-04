import { COLLECTIONS } from "../../../domain/collections/rules";
import { openCollection, openView, useCollectionsStore } from "../../../application/collections/collections";
import { togglePage } from "../../../application/navigation/pages";
import { useNavigationStore } from "../../../application/navigation/store";
import { COLLECTION_VIEW } from "../../../domain/navigation/views";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { SidebarRow } from "./SidebarRow";

/** A context's built-in collections (Meetings, Documents, People, Projects, Threads): each opens the table of the
 *  notes of that type whose `context:` is this one. */
export function CollectionRows({ context }: { context: string }) {
  const { t } = useT();
  const id = `coll:${context}`;
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen.has(id));
  const selected = useNavigationStore(s => s.selected === COLLECTION_VIEW);
  const view = useCollectionsStore(s => s.view);
  return (
    <div data-collections={context}>
      <SidebarRow
        kind="folder"
        icon="rows"
        aria-expanded={unfolded}
        name={t("nav.collections")}
        onClick={() => togglePage(id)}
      />
      {unfolded ? (
        <div className="ml-4">
          {COLLECTIONS.map(collection => (
            <SidebarRow
              key={collection}
              kind="view"
              icon="rows"
              data-collection={collection}
              name={t(`coll.title.${collection}`)}
              selected={selected && view.collection === collection && view.context === context && !view.filters.length}
              onClick={() => void openCollection(collection, context)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The views saved in `.relay/views`, each reopening with its filters and sort; shown when there are any. */
export function SavedViewRows() {
  const { t } = useT();
  const folder = useDerived(() => activeFolder());
  const views = useCollectionsStore(s => s.views[folder]);
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen.has("coll:views"));
  const open = useCollectionsStore(s => s.name);
  const selected = useNavigationStore(s => s.selected === COLLECTION_VIEW);
  if (!views?.length) return null;
  return (
    <div data-saved-views>
      <SidebarRow
        kind="folder"
        icon="filter"
        aria-expanded={unfolded}
        name={t("coll.savedViews")}
        meta={{ kind: "count", n: views.length }}
        onClick={() => togglePage("coll:views")}
      />
      {unfolded ? (
        <div className="ml-4">
          {views.map(saved => (
            <SidebarRow
              key={saved.name}
              kind="view"
              icon="rows"
              data-saved-view={saved.name}
              name={saved.name}
              selected={selected && open === saved.name}
              onClick={() => void openView(saved.name)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
