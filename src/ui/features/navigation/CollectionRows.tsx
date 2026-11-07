import { openView, useCollectionsStore } from "../../../application/collections/collections";
import { togglePage } from "../../../application/navigation/pages";
import { useNavigationStore } from "../../../application/navigation/store";
import { COLLECTION_VIEW } from "../../../domain/navigation/views";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { SidebarRow } from "./SidebarRow";

/** The views saved in `.relay/views`, each reopening with its filters and sort; shown when there are any. Those made in
 *  a context (`context` given) are rows of that context's Collections folder, the others a folder of their own. */
export function SavedViewRows({ context = "" }: { context?: string }) {
  const { t } = useT();
  const folder = useDerived(() => activeFolder());
  const views = useCollectionsStore(s => s.views[folder])?.filter(v => (v.view.context ?? "") === context);
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen.has("coll:views"));
  const open = useCollectionsStore(s => s.name);
  const selected = useNavigationStore(s => s.selected === COLLECTION_VIEW);
  if (!views?.length) return null;
  const rows = views.map(saved => (
    <SidebarRow
      key={saved.name}
      kind="view"
      icon="rows"
      data-saved-view={saved.name}
      name={saved.name}
      selected={selected && open === saved.name}
      onClick={() => void openView(saved.name)}
    />
  ));
  if (context) return <>{rows}</>;
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
      {unfolded ? <div className="ml-4">{rows}</div> : null}
    </div>
  );
}
