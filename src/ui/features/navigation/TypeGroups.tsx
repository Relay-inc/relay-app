import { noteName } from "../../../domain/navigation/pages";
import { LINKED_SHOWN, typedIn } from "../../../domain/workspace/linked";
import { typeOf } from "../../../domain/workspace/noteTypes";
import { useLinkedStore } from "../../../application/navigation/linked";
import { openPage, openPagePath, togglePage } from "../../../application/navigation/pages";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useNavigationStore } from "../../../application/navigation/store";
import { useCollectionsStore } from "../../../application/collections/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { SidebarRow } from "./SidebarRow";

/** A context's own typed notes, the ones in no project (a `context:` and no `about:`): a group per type, the newest
 *  four and "Show all". `skip`: notes the tree lists already (the projects'). Nothing is drawn when there are none. */
export function TypeGroups({ context, skip }: { context: string; skip: Set<string> }) {
  const { t } = useT();
  const notes = useLinkedStore(s => s.by[activeFolder()]);
  // the registry is read after the tree is drawn: follow it
  useCollectionsStore(s => s.types);
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen);
  const open = useDerived(() => openPagePath());
  const groups = typedIn(notes ?? [], context, kind => typeOf(kind)?.name ?? kind, skip);
  return (
    <>
      {groups.map(({ type, notes: list }) => {
        const id = `type:${context}:${type}`;
        const all = unfolded.has(`${id}:all`);
        const rows = all ? list : list.slice(0, LINKED_SHOWN);
        return (
          <div key={type}>
            <SidebarRow
              kind="folder"
              icon="folderLinked"
              aria-expanded={unfolded.has(id)}
              data-type-group={type}
              name={type}
              meta={{ kind: "count", n: list.length }}
              onClick={() => togglePage(id)}
            />
            {unfolded.has(id) ? (
              <div className="ml-4">
                {rows.map(note => (
                  <SidebarRow
                    key={note.p}
                    kind="view"
                    icon="file"
                    data-page={note.p}
                    name={noteName(note.p)}
                    selected={open === note.p}
                    onClick={() => openPage(note.p)}
                  />
                ))}
                {rows.length < list.length ? (
                  <SidebarRow
                    kind="fold"
                    name={t("pages.collAll", { n: list.length })}
                    onClick={() => togglePage(`${id}:all`, true)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
