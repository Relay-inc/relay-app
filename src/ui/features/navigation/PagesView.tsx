import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import type { PageFolder } from "../../../domain/navigation/pages";
import { noteName, sortPages } from "../../../domain/navigation/pages";
import { CONTEXT_TINTS } from "../../../domain/navigation/sidebar";
import {
  addToConversation,
  clearRecent,
  copyPagePath,
  duplicatePage,
  isProjectNote,
  openPage,
  openPagePath,
  pagesView,
  placeIn,
  removeRecent,
  projectEntry,
  PROJECT_STATES,
  revealPage,
  setProjectState,
  togglePage,
} from "../../../application/navigation/pages";
import { isFavourite, loadFavourites, toggleFavourite } from "../../../application/navigation/favourites";
import {
  loadTemplates,
  loadTimes,
  newFromTemplate,
  openDailyNote,
  setSort,
  sortOf,
  sortsByModified,
  templatesOf,
  useKbStore,
} from "../../../application/navigation/kb";
import { newChatHere } from "../../../application/conversations/chats";
import { select } from "../../../application/navigation/navigation";
import { GRAPH, INBOX_VIEW } from "../../../domain/navigation/views";
import { loadInboxNotes, useInboxStore } from "../../../application/inbox/inbox";
import { loadTypes, loadViews } from "../../../application/collections/collections";
import { SavedViewRows } from "./CollectionRows";
import { toast } from "../../../application/navigation/navigation";
import { activeFolder, workspaces } from "../../../application/navigation/workspaces";
import { loadLinked } from "../../../application/navigation/linked";
import { projectVault as homeOf } from "../../../application/navigation/migrate";
import { toggleSection } from "../../../application/navigation/sidebar";
import { useNavigationStore } from "../../../application/navigation/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { SidebarHead } from "./SidebarHead";
import { SidebarRow } from "./SidebarRow";
import { SidebarMenu, type MenuItem } from "./SidebarMenu";
import { PageFileDialog, type PageFileAsk } from "./PageFileDialog";
import { MigrateDialog } from "./MigrateDialog";
import { ProjectDialog, type ProjectAsk } from "./ProjectDialog";
import { VaultCheckDialog } from "./VaultCheckDialog";
import { Collections } from "./Collections";

const FAVOURITES = "pages:favourites";
const NO_TIMES: Record<string, number> = {};
// separates the parts of a menu item's id that hold a template or folder name
const SEP = "\u001f";
const RECENT = "pages:recent";
const FOLDERS = "pages:folders";
// unfolded like a folder (pagesOpen)
const SYSTEM = "pages:system";

/** The sidebar's Pages tab: the notes of the workspace shown. Recent, its contexts with their projects (a project
 *  unfolds to its folder), then its top folders; the search lists the notes it finds instead. A note opens as a page,
 *  and Graph on top draws them all with their links.
 *  An admin finds the notes the vault runs on (CLAUDE.md, rules, scripts, templates) folded under System, a member not.
 *  Right-click: new page or folder, rename, move, duplicate, delete (to the trash, with Undo); on a context a new
 *  project, on the top a new context; on a project its state, a new conversation, a delete, a move or copy to another
 *  workspace. A context without projects still shows, with New project. A page or folder dragged onto a folder moves there. */
export function PagesView() {
  const { t } = useT();
  const { model, system, recent, found, favourites } = useDerived(() => pagesView());
  const open = useDerived(() => openPagePath());
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen);
  const collapsed = useNavigationStore(s => s.sidebar.collapsed);
  const icons = useWorkspaceStore(s => s.icons);
  const selected = useNavigationStore(s => s.selected);
  type MenuKind = "note" | "folder" | "top" | "project" | "context";
  // `path` is the project's key on a project row, the context's name on a context heading
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; kind: MenuKind } | null>(null);
  const [ask, setAsk] = useState<PageFileAsk | null>(null);
  const [projectAsk, setProjectAsk] = useState<ProjectAsk | null>(null);
  const [checking, setChecking] = useState(false);
  const [migrating, setMigrating] = useState<{ project: string; to: string; mode: "move" | "copy" } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  // what points at the projects and contexts (their virtual groups): read again when the notes that exist change
  const notesVersion = useWorkspaceStore(s => s.notesVersion);
  const workspaceShown = useDerived(() => activeFolder());
  useEffect(() => {
    void loadLinked();
  }, [notesVersion, workspaceShown]);
  // the pinned notes and the templates of the workspace shown; the times a folder sorted by modified needs
  useKbStore(s => s.templates); // the menus list them once read
  const sorts = useKbStore(s => s.sorts);
  const times = useKbStore(s => s.times[workspaceShown]) ?? NO_TIMES;
  useEffect(() => {
    void loadFavourites();
    void loadTemplates();
  }, [workspaceShown]);
  useEffect(() => {
    if (sortsByModified()) void loadTimes();
  }, [notesVersion, workspaceShown, sorts]);
  useDismiss(menuElement, !!menu, () => setMenu(null));
  // the Inbox's count: read again when the notes that exist change
  const inboxCount = useInboxStore(s => s.notes[workspaceShown]?.length ?? 0);
  useEffect(() => {
    void loadInboxNotes(workspaceShown);
  }, [notesVersion, workspaceShown]);
  useEffect(() => {
    void loadTypes(workspaceShown);
    void loadViews(workspaceShown);
  }, [workspaceShown]);

  const onMenu = (path: string, kind: MenuKind) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path, kind });
  };
  // a project goes to one of the other workspaces, as on the Chats tab
  const migrateItems = (project: string): MenuItem[] => {
    const others = workspaces().filter(w => w.folder !== homeOf(project));
    if (!others.length) return [];
    return (["move", "copy"] as const).flatMap(mode => [
      { id: "", label: t(mode === "move" ? "mig.moveTo" : "mig.copyTo"), head: true },
      ...others.map(w => ({ id: `${mode}:${w.folder}`, label: w.name })),
    ]);
  };
  // New ▸ from a template: one item per template of the vault, made in the type's home or in this folder
  const templateItems = (folder: string): MenuItem[] => {
    const list = templatesOf();
    return list.length
      ? [
          { id: "", label: t("pages.fromTemplate"), head: true },
          ...list.map(name => ({ id: `tpl${SEP}${name}${SEP}${folder}`, label: name, icon: "file" })),
        ]
      : [];
  };
  const fileItems = (kind: "note" | "folder" | "top", path = ""): MenuItem[] => [
    ...(kind === "note"
      ? [
          { id: "fav", label: t(isFavourite(path) ? "pages.unfavourite" : "pages.favourite"), icon: "star" },
          { id: "addchat", label: t("pages.addToChat"), icon: "talk" },
        ]
      : []),
    ...(kind !== "note"
      ? [
          { id: "page", label: t("pages.newPage"), icon: "file" },
          { id: "folder", label: t("pages.newFolder"), icon: "folder" },
          ...templateItems(path),
        ]
      : []),
    ...(kind !== "note"
      ? [
          {
            id: `sort${SEP}${path}${SEP}${sortOf(path) === "name" ? "modified" : "name"}`,
            label: t(sortOf(path) === "name" ? "pages.sortModified" : "pages.sortName"),
          },
        ]
      : []),
    ...(kind !== "top"
      ? [
          { id: "rename", label: t("pages.rename") },
          { id: "move", label: t("pages.moveTo") },
          ...(kind === "note" ? [{ id: "duplicate", label: t("pages.duplicate") }] : []),
          { id: "reveal", label: t("pages.reveal") },
          { id: "copy", label: t("pages.copyPath") },
          { id: "delete", label: t("pages.delete") },
        ]
      : []),
  ];
  const where = (folder: string): MenuItem[] =>
    [
      { id: "reveal", label: t("pages.reveal") },
      { id: "copy", label: t("pages.copyPath") },
    ].map(item => ({ ...item, id: `${item.id}:${folder}` }));
  const inFolder = (folder: string): MenuItem[] => [
    { id: `page:${folder}`, label: t("pages.newPage"), icon: "file" },
    { id: `folder:${folder}`, label: t("pages.newFolder"), icon: "folder" },
  ];
  const contextItems = (name: string): MenuItem[] => {
    const folder = model.contexts.find(context => context.name === name)?.folder ?? "";
    return [
      { id: "project", label: t("pages.newProject") },
      ...(folder ? [...inFolder(folder), ...templateItems(folder), ...where(folder)] : []),
    ];
  };
  const projectItems = (key: string): MenuItem[] => {
    const project = projectEntry(key);
    if (!project) return migrateItems(key);
    const folder = project.folder?.path ?? "";
    return [
      ...(folder ? inFolder(folder) : []),
      ...templateItems(folder || project.note.split("/").slice(0, -1).join("/")),
      { id: "open", label: t("pages.openNote") },
      { id: "chat", label: t("nav.newChat") },
      { id: "", label: t("pages.projectState"), head: true },
      ...PROJECT_STATES.map(state => ({
        id: `state:${state}`,
        label: state,
        // no such icon: an empty one, so the names line up under the check
        icon: state === project.state ? "check" : "blank",
      })),
      { id: "", label: project.label, head: true },
      ...where(folder || project.note),
      ...migrateItems(key),
      { id: "deleteproject", label: t("pages.deleteProject") },
    ];
  };
  const menuItems = (kind: MenuKind, path: string): MenuItem[] =>
    kind === "project"
      ? projectItems(path)
      : kind === "context"
        ? contextItems(path)
        : kind === "top"
          ? [{ id: "context", label: t("pages.newContext") }, ...fileItems(kind), { id: "check", label: t("vc.menu") }]
          : fileItems(kind, path);
  // a project's own note keeps its name and place: the project is known by it
  const guarded = (path: string, then: () => void) => (isProjectNote(path) ? toast(t("pages.projectNote")) : then());
  const pick = (target: { path: string; kind: MenuKind }, id: string) => {
    setMenu(null);
    const { path } = target;
    const arg = id.slice(id.indexOf(":") + 1);
    const [verb, one, two] = id.split(SEP);
    if (verb === "tpl") void newFromTemplate(one, placeIn(two));
    else if (verb === "sort") setSort(one, two as "name" | "modified");
    else if (id === "fav") void toggleFavourite(path);
    else if (id === "addchat") void addToConversation(path);
    else if (id.startsWith("page:") || id.startsWith("folder:"))
      setAsk({ kind: id.startsWith("page:") ? "page" : "folder", folder: arg });
    else if (id.startsWith("reveal:")) void revealPage(arg);
    else if (id.startsWith("copy:")) void copyPagePath(arg);
    else if (id === "context") setProjectAsk({ kind: "context" });
    else if (id === "check") setChecking(true);
    else if (id === "project") setProjectAsk({ kind: "project", context: path });
    else if (target.kind === "project" && id === "open") openPage(projectEntry(path)?.note ?? "");
    else if (target.kind === "project" && id === "chat") select(newChatHere(path));
    else if (id.startsWith("state:")) void setProjectState(path, arg);
    else if (id === "deleteproject") setProjectAsk({ kind: "delete", key: path });
    else if (target.kind === "project") {
      const mode = id.startsWith("move:") ? "move" : "copy";
      if (id) setMigrating({ project: path, mode, to: id.slice(id.indexOf(":") + 1) });
    } else if (id === "page" || id === "folder") setAsk({ kind: id, folder: path });
    else if (id === "rename") guarded(path, () => setAsk({ kind: "rename", path }));
    else if (id === "move") guarded(path, () => setAsk({ kind: "move", path }));
    else if (id === "duplicate") void duplicatePage(path);
    else if (id === "reveal") void revealPage(path);
    else if (id === "copy") void copyPagePath(path);
    else if (id === "delete") setAsk({ kind: "delete", path });
  };
  // drag a page or folder onto a folder (or the Folders heading: the top) to move it there
  const drag = (path: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/x-relay-page", path);
      e.dataTransfer.effectAllowed = "move";
    },
  });
  const drop = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("text/x-relay-page")) return;
      e.preventDefault();
      setDropOn(folder);
    },
    onDragLeave: () => setDropOn(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const path = e.dataTransfer.getData("text/x-relay-page");
      if (!path || path === folder || folder.startsWith(`${path}/`)) return;
      guarded(path, () => setAsk({ kind: "move", path, into: folder }));
    },
  });

  // rows a level deeper sit in a wrapper one step in, not SidebarRow's own `indent`, so a tree goes as deep as it is
  const note = (path: string, onRemove?: () => void) => (
    <SidebarRow
      key={path}
      kind="view"
      icon="file"
      data-page={path}
      name={noteName(path)}
      selected={open === path}
      closable={!!onRemove}
      closeTitle={t("pages.recentRemove")}
      onClose={onRemove}
      onClick={() => openPage(path)}
      onContextMenu={onMenu(path, "note")}
      {...drag(path)}
    />
  );
  // a folder's subfolders, then its notes, one step in; `skip` is the note its project row already opens
  // `scope` keeps a folder's unfolding apart when System shows a folder the tree has too (Resources)
  const contents = (folder: PageFolder, skip = "", scope = "", extra: ReactNode = null) => (
    <div className="ml-4">
      {folder.folders.map(sub => renderFolder(sub, scope))}
      {sortPages(
        folder.notes.filter(path => path !== skip),
        sorts[`${workspaceShown}|${folder.path}`] ?? "name",
        times,
      ).map(path => note(path))}
      {extra}
    </div>
  );
  const renderFolder = (folder: PageFolder, scope = "") => {
    const isOpen = unfolded.has(scope + folder.path);
    return (
      <div key={folder.path} className={dropOn === folder.path ? "rounded-md ring-2 ring-accent" : ""}>
        <SidebarRow
          kind="folder"
          icon="folder"
          aria-expanded={isOpen}
          data-folder={folder.path}
          name={folder.name}
          meta={{ kind: "count", n: folder.count }}
          onClick={() => togglePage(scope + folder.path)}
          onContextMenu={onMenu(folder.path, "folder")}
          {...drag(folder.path)}
          {...drop(folder.path)}
        />
        {isOpen ? contents(folder, "", scope) : null}
      </div>
    );
  };
  const head = (
    id: string,
    label: string,
    tint: (typeof CONTEXT_TINTS)[number] | "" = "",
    onContextMenu?: (e: MouseEvent) => void,
    action?: { label: string; onClick: () => void },
  ) => (
    <SidebarHead
      label={label}
      tint={tint}
      count={0}
      collapsed={!!collapsed[id]}
      dropBefore={false}
      onClick={() => toggleSection(id)}
      onContextMenu={onContextMenu}
      action={action}
    />
  );

  const overlays = (
    <>
      {menu ? (
        <SidebarMenu
          ref={menuElement}
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.kind, menu.path)}
          onPick={id => pick(menu, id)}
        />
      ) : null}
      {ask ? <PageFileDialog ask={ask} onClose={() => setAsk(null)} /> : null}
      {projectAsk ? <ProjectDialog ask={projectAsk} onClose={() => setProjectAsk(null)} /> : null}
      {checking ? (
        <VaultCheckDialog workspace={workspaces().find(w => w.active)?.name ?? ""} onClose={() => setChecking(false)} />
      ) : null}
      {migrating ? (
        <MigrateDialog {...migrating} from={homeOf(migrating.project)} onClose={() => setMigrating(null)} />
      ) : null}
    </>
  );
  if (found)
    return (
      <div className="mt-3">
        {found.length ? found.map(path => note(path)) : <p className="px-2 text-tertiary">{t("pages.none")}</p>}
        {overlays}
      </div>
    );
  return (
    <>
      <SidebarRow
        kind="view"
        data-graph
        icon="graph"
        name={t("nav.graph")}
        selected={selected === GRAPH}
        onClick={() => select(GRAPH)}
      />
      <SidebarRow
        kind="view"
        data-today-note
        icon="cal"
        name={t("pages.todayNote")}
        onClick={() => void openDailyNote()}
      />
      {favourites.length ? (
        <div className="mt-3" data-section={FAVOURITES}>
          {head(FAVOURITES, t("pages.favourites"))}
          {collapsed[FAVOURITES] ? null : favourites.map(path => note(path))}
        </div>
      ) : null}
      {recent.length ? (
        <div className="mt-3" data-section={RECENT}>
          {head(RECENT, t("pages.recent"), "", undefined, { label: t("pages.recentClear"), onClick: clearRecent })}
          {collapsed[RECENT]
            ? null
            : recent.map(path => (
                // Delete or Backspace on a focused row takes it off Recent, as its ×
                <div
                  key={path}
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget.firstElementChild || (e.key !== "Delete" && e.key !== "Backspace"))
                      return;
                    e.preventDefault();
                    removeRecent(path);
                  }}
                >
                  {note(path, () => removeRecent(path))}
                </div>
              ))}
        </div>
      ) : null}
      <SidebarRow
        kind="view"
        data-inbox
        icon="inbox"
        name={t("nav.inbox")}
        selected={selected === INBOX_VIEW}
        meta={inboxCount ? { kind: "badge", n: inboxCount } : undefined}
        onClick={() => select(INBOX_VIEW)}
      />
      <SavedViewRows />
      {model.contexts.map(context => {
        const id = `pages:ctx:${context.name}`;
        const tint = CONTEXT_TINTS[context.index % CONTEXT_TINTS.length];
        return (
          <div key={context.name} className="mt-3">
            {head(id, context.name, tint, onMenu(context.name, "context"))}
            {collapsed[id] ? null : !context.projects.length ? (
              <SidebarRow
                kind="fold"
                name={t("pages.newProject")}
                onClick={() => setProjectAsk({ kind: "project", context: context.name })}
              />
            ) : (
              context.projects.map(project => {
                // a flat project (just its note) unfolds too, to the notes that point at it
                const at = project.folder?.path ?? project.note;
                const isOpen = unfolded.has(at);
                return (
                  <div key={project.key}>
                    <SidebarRow
                      kind="proj"
                      tint={tint}
                      aria-expanded={isOpen}
                      data-project={project.key}
                      name={project.label}
                      img={icons[project.key]?.img ?? null}
                      emoji={icons[project.key]?.icon ?? ""}
                      selected={open === project.note}
                      meta={project.count > 1 ? { kind: "count", n: project.count } : undefined}
                      // opens its note and unfolds; a click on it open again folds it
                      onClick={() => {
                        togglePage(at, !(isOpen && open === project.note));
                        openPage(project.note);
                      }}
                      onContextMenu={onMenu(project.key, "project")}
                    />
                    {isOpen && project.folder ? (
                      contents(
                        project.folder,
                        project.note,
                        "",
                        <Collections
                          layer="project"
                          name={noteName(project.note)}
                          inside={project.folder.path}
                          base={project.folder.path}
                        />,
                      )
                    ) : isOpen ? (
                      <div className="ml-4">
                        <Collections layer="project" name={noteName(project.note)} inside="" base={project.note} />
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            {collapsed[id] ? null : (
              <Collections layer="context" name={context.name} inside="" base={`ctx:${context.name}`} />
            )}
          </div>
        );
      })}
      <div
        className={`mt-3 ${dropOn === "" ? "rounded-md ring-2 ring-accent" : ""}`}
        onContextMenu={onMenu("", "top")}
        {...drop("")}
      >
        {head(FOLDERS, t("pages.folders"))}
        {collapsed[FOLDERS] ? null : (
          <>
            {model.top.folders.map(folder => renderFolder(folder))}
            {sortPages(model.top.notes, sorts[`${workspaceShown}|`] ?? "name", times).map(path => note(path))}
          </>
        )}
      </div>
      {system ? (
        <div className="mt-3" data-section={SYSTEM}>
          <SidebarHead
            label={t("pages.system")}
            tint=""
            count={0}
            collapsed={!unfolded.has(SYSTEM)}
            dropBefore={false}
            onClick={() => togglePage(SYSTEM)}
          />
          {unfolded.has(SYSTEM) ? (
            <>
              {system.folders.map(folder => renderFolder(folder, `${SYSTEM}/`))}
              {system.notes.map(path => note(path))}
            </>
          ) : null}
        </div>
      ) : null}
      {overlays}
    </>
  );
}
