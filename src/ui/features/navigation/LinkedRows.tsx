import { noteName } from "../../../domain/navigation/pages";
import { LINKED_KEYS, LINKED_SHOWN } from "../../../domain/workspace/linked";
import { openCollection } from "../../../application/collections/collections";
import { linkedOf } from "../../../application/navigation/linked";
import { openPage, openPagePath, togglePage } from "../../../application/navigation/pages";
import { useNavigationStore } from "../../../application/navigation/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { StageGlyph } from "../today/StageGlyph";
import { SidebarRow } from "./SidebarRow";

/** The notes that point at a project or a context through `about:`, `context:` or `with:`, under a thin "linked here"
 *  divider: Meetings, Documents, Threads and People, each a folder of its own that unfolds to the newest four and
 *  "Show all", which opens the collection (a table of those notes). They are not in the project's folder: nothing moved, nothing written. `base` keeps this project's unfolding
 *  apart from the next one's. */
export function LinkedRows({ name, inside, base }: { name: string; inside: string; base: string }) {
  const { t } = useT();
  const groups = useDerived(() => linkedOf(name, inside));
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen);
  const open = useDerived(() => openPagePath());
  const shown = LINKED_KEYS.filter(key => groups[key].length);
  if (!shown.length) return null;
  return (
    <div data-linked={base}>
      <div className="flex items-center gap-2 h-4.5 px-2 text-xs text-tertiary select-none">
        <span>{t("pages.linkedHere")}</span>
        <span className="flex-1 h-px bg-separator" />
      </div>
      {shown.map(key => {
        const id = `linked:${base}:${key}`;
        const isOpen = unfolded.has(id);
        const notes = groups[key];
        const rows = notes.slice(0, LINKED_SHOWN);
        return (
          <div key={key}>
            <SidebarRow
              kind="folder"
              icon="folderLinked"
              aria-expanded={isOpen}
              data-linked-group={key}
              name={t(`pages.linked.${key}`)}
              meta={{ kind: "count", n: notes.length }}
              onClick={() => togglePage(id)}
            />
            {isOpen ? (
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
                    name={t("pages.linkedAll", { n: notes.length })}
                    onClick={() =>
                      // a context's group is the context's notes, a project's the notes about it
                      void (base.startsWith("ctx:")
                        ? openCollection(key, name)
                        : openCollection(key, "", [{ key: "about", is: name }]))
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
