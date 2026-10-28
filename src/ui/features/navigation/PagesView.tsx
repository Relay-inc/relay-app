import type { PageFolder } from "../../../domain/navigation/pages";
import { noteName } from "../../../domain/navigation/pages";
import { CONTEXT_TINTS } from "../../../domain/navigation/sidebar";
import { openPage, openPagePath, pagesView, togglePage } from "../../../application/navigation/pages";
import { toggleSection } from "../../../application/navigation/sidebar";
import { useNavigationStore } from "../../../application/navigation/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { SidebarHead } from "./SidebarHead";
import { SidebarRow } from "./SidebarRow";

const RECENT = "pages:recent";
const FOLDERS = "pages:folders";

/** The sidebar's Pages tab: the notes of the workspace shown. Recent, its contexts with their projects (a project
 *  unfolds to its folder), then its top folders; the search lists the notes it finds instead. A note opens in the
 *  right drawer. */
export function PagesView() {
  const { t } = useT();
  const { model, recent, found } = useDerived(() => pagesView());
  const open = useDerived(() => openPagePath());
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen);
  const collapsed = useNavigationStore(s => s.sidebar.collapsed);
  const icons = useWorkspaceStore(s => s.icons);

  // rows a level deeper sit in a wrapper one step in, not SidebarRow's own `indent`, so a tree goes as deep as it is
  const note = (path: string) => (
    <SidebarRow
      key={path}
      kind="view"
      icon="file"
      data-page={path}
      name={noteName(path)}
      selected={open === path}
      onClick={() => openPage(path)}
    />
  );
  // a folder's subfolders, then its notes, one step in; `skip` is the note its project row already opens
  const contents = (folder: PageFolder, skip = "") => (
    <div className="ml-4">
      {folder.folders.map(sub => renderFolder(sub))}
      {folder.notes.filter(path => path !== skip).map(path => note(path))}
    </div>
  );
  const renderFolder = (folder: PageFolder) => {
    const isOpen = unfolded.has(folder.path);
    return (
      <div key={folder.path}>
        <SidebarRow
          kind="folder"
          icon="folder"
          aria-expanded={isOpen}
          data-folder={folder.path}
          name={folder.name}
          meta={{ kind: "count", n: folder.count }}
          onClick={() => togglePage(folder.path)}
        />
        {isOpen ? contents(folder) : null}
      </div>
    );
  };
  const head = (id: string, label: string, tint: (typeof CONTEXT_TINTS)[number] | "" = "") => (
    <SidebarHead
      label={label}
      tint={tint}
      count={0}
      collapsed={!!collapsed[id]}
      dropBefore={false}
      onClick={() => toggleSection(id)}
    />
  );

  if (found)
    return (
      <div className="mt-3">
        {found.length ? found.map(path => note(path)) : <p className="px-2 text-tertiary">{t("pages.none")}</p>}
      </div>
    );
  return (
    <>
      {recent.length ? (
        <div className="mt-3">
          {head(RECENT, t("pages.recent"))}
          {collapsed[RECENT] ? null : recent.map(path => note(path))}
        </div>
      ) : null}
      {model.contexts.map(context => {
        const id = `pages:ctx:${context.name}`;
        const tint = CONTEXT_TINTS[context.index % CONTEXT_TINTS.length];
        return (
          <div key={context.name} className="mt-3">
            {head(id, context.name, tint)}
            {collapsed[id]
              ? null
              : context.projects.map(project => {
                  const isOpen = !!project.folder && unfolded.has(project.folder.path);
                  return (
                    <div key={project.key}>
                      <SidebarRow
                        kind="proj"
                        tint={tint}
                        aria-expanded={project.folder ? isOpen : undefined}
                        data-project={project.key}
                        name={project.label}
                        img={icons[project.key]?.img ?? null}
                        emoji={icons[project.key]?.icon ?? ""}
                        selected={open === project.note}
                        meta={project.count > 1 ? { kind: "count", n: project.count } : undefined}
                        // opens its note and unfolds; a click on it open again folds it
                        onClick={() => {
                          if (project.folder) togglePage(project.folder.path, !(isOpen && open === project.note));
                          openPage(project.note);
                        }}
                      />
                      {isOpen && project.folder ? contents(project.folder, project.note) : null}
                    </div>
                  );
                })}
          </div>
        );
      })}
      <div className="mt-3">
        {head(FOLDERS, t("pages.folders"))}
        {collapsed[FOLDERS] ? null : (
          <>
            {model.top.folders.map(renderFolder)}
            {model.top.notes.map(path => note(path))}
          </>
        )}
      </div>
    </>
  );
}
