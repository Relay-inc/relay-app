import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { PageFolder } from "../../../domain/navigation/pages";
import { noteName } from "../../../domain/navigation/pages";
import { CONTEXT_TINTS } from "../../../domain/navigation/sidebar";
import {
  copyPagePath,
  duplicatePage,
  isProjectNote,
  openPage,
  openPagePath,
  pagesView,
  revealPage,
  togglePage,
} from "../../../application/navigation/pages";
import { toast } from "../../../application/navigation/navigation";
import { workspaces } from "../../../application/navigation/workspaces";
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

const RECENT = "pages:recent";
const FOLDERS = "pages:folders";
// unfolded like a folder (pagesOpen), so it starts folded on every start
const SYSTEM = "pages:system";

/** The sidebar's Pages tab: the notes of the workspace shown. Recent, its contexts with their projects (a project
 *  unfolds to its folder), then its top folders; the search lists the notes it finds instead. A note opens as a page.
 *  An admin finds the notes the vault runs on (CLAUDE.md, rules, scripts, templates) folded under System, a member not.
 *  Right-click: new page or folder, rename, move, duplicate, delete (to the trash, with Undo); on a project, move or
 *  copy it to another workspace. A page or folder dragged onto a folder moves there. */
export function PagesView() {
  const { t } = useT();
  const { model, system, recent, found } = useDerived(() => pagesView());
  const open = useDerived(() => openPagePath());
  const unfolded = useNavigationStore(s => s.sidebar.pagesOpen);
  const collapsed = useNavigationStore(s => s.sidebar.collapsed);
  const icons = useWorkspaceStore(s => s.icons);
  type MenuKind = "note" | "folder" | "top" | "project";
  // `path` is the project's key on a project row
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; kind: MenuKind } | null>(null);
  const [ask, setAsk] = useState<PageFileAsk | null>(null);
  const [migrating, setMigrating] = useState<{ project: string; to: string; mode: "move" | "copy" } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  useDismiss(menuElement, !!menu, () => setMenu(null));

  const onMenu = (path: string, kind: MenuKind) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // one workspace: a project has nowhere to go
    if (kind === "project" && !migrateItems(path).length) return;
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
  const fileItems = (kind: "note" | "folder" | "top"): MenuItem[] => [
    ...(kind !== "note"
      ? [
          { id: "page", label: t("pages.newPage"), icon: "file" },
          { id: "folder", label: t("pages.newFolder"), icon: "folder" },
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
  const menuItems = (kind: MenuKind, path: string): MenuItem[] =>
    kind === "project" ? migrateItems(path) : fileItems(kind);
  // a project's own note keeps its name and place: the project is known by it
  const guarded = (path: string, then: () => void) => (isProjectNote(path) ? toast(t("pages.projectNote")) : then());
  const pick = (target: { path: string; kind: MenuKind }, id: string) => {
    setMenu(null);
    const { path } = target;
    if (target.kind === "project") {
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
  const note = (path: string) => (
    <SidebarRow
      key={path}
      kind="view"
      icon="file"
      data-page={path}
      name={noteName(path)}
      selected={open === path}
      onClick={() => openPage(path)}
      onContextMenu={onMenu(path, "note")}
      {...drag(path)}
    />
  );
  // a folder's subfolders, then its notes, one step in; `skip` is the note its project row already opens
  // `scope` keeps a folder's unfolding apart when System shows a folder the tree has too (Resources)
  const contents = (folder: PageFolder, skip = "", scope = "") => (
    <div className="ml-4">
      {folder.folders.map(sub => renderFolder(sub, scope))}
      {folder.notes.filter(path => path !== skip).map(path => note(path))}
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
                        onContextMenu={onMenu(project.key, "project")}
                      />
                      {isOpen && project.folder ? contents(project.folder, project.note) : null}
                    </div>
                  );
                })}
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
            {model.top.notes.map(path => note(path))}
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
