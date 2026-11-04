import { noteName } from "../../../domain/navigation/pages";
import { LAYER_KEYS, LINKED_SHOWN } from "../../../domain/workspace/linked";
import { LINKED } from "../../../domain/collections/rules";
import { openCollection, useCollectionsStore } from "../../../application/collections/collections";
import { linkedOf } from "../../../application/navigation/linked";
import { openPage, openPagePath, togglePage } from "../../../application/navigation/pages";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useNavigationStore } from "../../../application/navigation/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { StageGlyph } from "../today/StageGlyph";
import { SavedViewRows } from "./CollectionRows";
import { SidebarRow } from "./SidebarRow";

/** The "Collections" folder under a context or a project: the notes that point at it through `about:`, `context:` or
 *  `with:` as Meetings, Documents, People, Projects (a context only) and Threads, each unfolding to the newest four and
 *  "Show all", which opens the collection filtered on the same rule, so the table lists what the group counts. They are
 *  not in the project's folder: nothing moved, nothing written. A context's saved views are in its folder too. `base`
 *  keeps this layer's unfolding apart from the next one's; empty groups are not drawn, nor the folder when all are. */
export function Collections({
  layer,
  name,
  inside,
  base,
}: {
  layer: "context" | "project";
  name: string;
  inside: string;
  base: string;
}) {
  const { t } = useT();
  const context = layer === "context";
  const groups = useDerived(() => linkedOf(name, inside, context));
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen);
  const open = useDerived(() => openPagePath());
  const folder = useDerived(() => activeFolder());
  const hasViews = useCollectionsStore(s => context && !!s.views[folder]?.some(v => v.view.context === name));
  const shown = LAYER_KEYS[layer].filter(key => groups[key].length);
  if (!shown.length && !hasViews) return null;
  const id = `coll:${base}`;
  const isOpen = unfolded.has(id);
  return (
    <div data-collections={base}>
      <SidebarRow
        kind="folder"
        icon="rows"
        aria-expanded={isOpen}
        name={t("nav.collections")}
        onClick={() => togglePage(id)}
      />
      {isOpen ? (
        <div className="ml-4">
          {shown.map(key => {
            const groupId = `linked:${base}:${key}`;
            const groupOpen = unfolded.has(groupId);
            const notes = groups[key];
            const rows = notes.slice(0, LINKED_SHOWN);
            return (
              <div key={key}>
                <SidebarRow
                  kind="folder"
                  icon="folderLinked"
                  aria-expanded={groupOpen}
                  data-linked-group={key}
                  name={t(`coll.title.${key}`)}
                  meta={{ kind: "count", n: notes.length }}
                  onClick={() => togglePage(groupId)}
                />
                {groupOpen ? (
                  <div className="ml-4">
                    {rows.map(note => (
                      <SidebarRow
                        key={note.p}
                        kind="view"
                        icon="file"
                        lead={note.stage ? <StageGlyph glyph={{ stage: note.stage, followed: false }} /> : undefined}
                        data-page={note.p}
                        name={noteName(note.p)}
                        selected={open === note.p}
                        onClick={() => openPage(note.p)}
                      />
                    ))}
                    {rows.length < notes.length ? (
                      <SidebarRow
                        kind="fold"
                        name={t("pages.collAll", { n: notes.length })}
                        // the group's own rule as the filter, so the table lists exactly the notes the group counts
                        onClick={() =>
                          void openCollection(key, "", [
                            { key: LINKED, is: name, outside: inside, ...(context ? { apart: true } : {}) },
                          ])
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {context ? <SavedViewRows context={name} /> : null}
        </div>
      ) : null}
    </div>
  );
}
