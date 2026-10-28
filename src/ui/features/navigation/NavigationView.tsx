import { Fragment, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  GENERAL,
  type ConvRow,
  type FolderBlock,
  type ProjectBlock,
  type Section,
  type ViewRow,
} from "../../../domain/navigation/sidebar";
import { USAGE } from "../../../domain/navigation/views";
import { useNavigationStore } from "../../../application/navigation/store";
import { select, openProject, openProjectPanel, openSettings } from "../../../application/navigation/navigation";
import {
  sidebarModel,
  setFind,
  toggleSection,
  toggleUnfold,
  setSidebar,
  setViewHidden,
  sidebarCfg,
  viewsLayout,
  moreOn,
  hiddenViews,
  isDark,
  toggleTheme,
  addFolder,
  editFolder,
  renameFolder,
  deleteFolder,
} from "../../../application/navigation/sidebar";
import { newChat } from "../../../application/conversations/chats";
import { chatsOf, closedOf, sessionIdOf, terminalSessions } from "../../../application/conversations/selectors";
import { closeAll, closeChat, reopen } from "../../../application/conversations/actions";
import { usageSummary } from "../../../application/usage/usage";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { SidebarRow } from "./SidebarRow";
import { SidebarHead } from "./SidebarHead";
import { SidebarMenu, type MenuItem } from "./SidebarMenu";
import { SidebarFooter } from "./SidebarFooter";
import { FolderName } from "./FolderName";
import { useReorder } from "./useReorder";
import { DROP_LINE_AFTER } from "./rows";
import { closeWork, openWork } from "../../../application/today/work";
import { activeFolder } from "../../../application/navigation/workspaces";
import { vaultName } from "../../../application/workspace/vault";
import "../../styles/navigation.css";

// a view's menu has its key in `chatKey`, a folder's its id
type MenuTarget = {
  x: number;
  y: number;
  chatKey: string;
  project: string | null;
  kind: "conv" | "proj" | "folder" | "view" | "more";
};

/** The whole left sidebar: search, the sections with their conversations, the footer buttons and the right-click menu.
 *  The rows come from the application (sidebarModel); the drag to reorder and the menu live here. */
export function NavigationView({ className }: { className: string }) {
  const { t } = useT();
  const { views, sections } = useDerived(() => sidebarModel());
  const usage = useDerived(() => usageSummary());
  const layout = useDerived(() => viewsLayout());
  const hidden = useDerived(() => hiddenViews());
  const more = useDerived(() => moreOn());
  const dark = useDerived(() => isDark());
  const workspace = useDerived(() => vaultName(activeFolder()));
  const selected = useNavigationStore(s => s.selected);
  const update = useNavigationStore(s => s.update);
  const find = useNavigationStore(s => s.sidebar.find);
  const root = useRef<HTMLDivElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const { press, dropzone, unlessDragged, reordering } = useReorder(root, layout === "icons");

  // the selected row stays in sight, also when it is selected from elsewhere
  useEffect(() => {
    root.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // ---------- the right-click menu
  // the "…" toggles its own dropdown: the click that opens it must not also close it
  useDismiss(menuElement, !!menu, () => setMenu(null), { inside: target => !!target.closest("[data-more]") });
  const openMenu = (target: Omit<MenuTarget, "x" | "y">) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };
  const viewMenuItems = (target: MenuTarget): MenuItem[] => {
    const name = views.find(view => view.key === target.chatKey)?.name ?? "";
    return [
      { id: "hide", label: t("nav.hide", { name }) },
      { id: "layout", label: t(layout === "icons" ? "nav.asList" : "nav.asIcons") },
      ...(sidebarCfg().order?.length ? [{ id: "resetorder", label: t("nav.resetOrder") }] : []),
      ...(hidden.length
        ? [
            { id: "more", label: t(more ? "nav.hideMore" : "nav.showMore") },
            { id: "", label: t("nav.hidden"), head: true },
            ...hidden.map(view => ({ id: `show:${view.key}`, label: t("nav.show", { name: view.name }) })),
          ]
        : []),
      { id: "sidebarsettings", label: t("nav.sidebarSettings") },
    ];
  };
  const pickView = (target: MenuTarget, itemId: string) => {
    if (itemId === "hide") setViewHidden(target.chatKey, true);
    else if (itemId === "layout") setSidebar({ layout: layout === "icons" ? "list" : "icons" });
    else if (itemId === "resetorder") setSidebar({ order: [] });
    else if (itemId === "more") setSidebar({ more: !more });
    else if (itemId === "sidebarsettings") openSettings();
    else setViewHidden(itemId.slice("show:".length), false);
  };
  const menuItems = (target: MenuTarget): MenuItem[] => {
    if (target.kind === "view") return viewMenuItems(target);
    if (target.kind === "more")
      return hidden.map(view => ({ id: view.key, label: view.name, icon: view.icon, mark: view.mark }));
    if (target.kind === "folder")
      return [
        { id: "new", label: t("nav.newChat") },
        { id: "renamefolder", label: t("nav.renameFolder") },
        { id: "deletefolder", label: t("nav.deleteFolder") },
      ];
    if (target.kind === "conv")
      return [
        { id: "assign", label: t("ctx.assign") },
        ...(sessionIdOf(target.chatKey) ? [{ id: "copyid", label: t("ctx.copyId") }] : []),
        { id: "close", label: t("nav.close") },
      ];
    const closed = closedOf(target.project);
    const recent: MenuItem[] = closed.length
      ? [
          { id: "", label: t("ctx.recent"), head: true },
          ...closed.map(chat => ({ id: `reopen:${chat.key}`, label: chat.title })),
        ]
      : [{ id: "", label: t("ctx.none"), head: true }];
    const anyOpen =
      chatsOf(target.project).length > 0 || terminalSessions().some(session => session.project === target.project);
    return [
      { id: "new", label: t("nav.newChat") },
      { id: "newfolder", label: t("nav.newFolder") },
      ...(anyOpen ? [{ id: "closeall", label: t("ctx.closeAll") }] : []),
      ...recent,
    ];
  };
  const pick = async (target: MenuTarget, itemId: string) => {
    setMenu(null);
    if (target.kind === "view") pickView(target, itemId);
    else if (target.kind === "more") select(itemId);
    else if (target.kind === "folder") pickFolder(target, itemId);
    else if (itemId === "assign") {
      await select(target.chatKey);
      openProjectPanel();
    } else if (itemId === "copyid") copyText(sessionIdOf(target.chatKey));
    else if (itemId === "close") closeChat(target.chatKey);
    else if (itemId === "new") select(newChat(target.project));
    else if (itemId === "newfolder") addFolder(target.project ?? "");
    else if (itemId === "closeall") closeAll(target.project);
    else reopen(itemId.slice("reopen:".length));
  };

  const pickFolder = (target: MenuTarget, itemId: string) => {
    if (itemId === "new") select(newChat(target.project, target.chatKey));
    else if (itemId === "renamefolder") editFolder(target.chatKey);
    else deleteFolder(target.chatKey);
  };

  // middle-click on a conversation closes it, like a browser tab
  const closeOnMiddleClick = (chatKey: string) => (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    closeChat(chatKey);
  };

  // ---------- rows
  const renderView = (view: ViewRow, tile: boolean) => (
    <SidebarRow
      key={view.key}
      kind={tile ? "tile" : "view"}
      data-key={view.key}
      data-view={view.key}
      icon={view.icon ?? ""}
      svg={view.mark ?? ""}
      box="0 0 24 24"
      name={view.name}
      meta={view.meta}
      unseen={view.unseen}
      trail={view.trail}
      selected={selected === view.key}
      {...dropzone("view", view.key)}
      onPointerDown={press("view", view.key)}
      onClick={unlessDragged(() => select(view.key))}
      onContextMenu={openMenu({ chatKey: view.key, project: null, kind: "view" })}
    />
  );
  // the switched-off views stay reachable: "…" after the views opens them in a dropdown below it
  const openMore = (e: MouseEvent<HTMLElement>) => {
    if (menu?.kind === "more") return setMenu(null);
    const box = e.currentTarget.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom + 2, chatKey: "", project: null, kind: "more" });
  };
  const renderMore = (tile: boolean) =>
    hidden.length && more ? (
      <SidebarRow
        kind={tile ? "tile" : "view"}
        data-more
        icon="more"
        name={t("nav.moreViews")}
        selected={hidden.some(view => view.key === selected)}
        onClick={openMore}
      />
    ) : null;
  // the views on top: rows with their names, or a row of icons
  const renderViews = () =>
    layout === "icons" ? (
      <div className="flex flex-wrap gap-0.5 pb-1.5">
        {views.map(view => renderView(view, true))}
        {renderMore(true)}
      </div>
    ) : (
      <>
        {views.map(view => renderView(view, false))}
        {renderMore(false)}
      </>
    );
  const renderConversation = (row: ConvRow, indent: boolean, nested = false) =>
    row.work ? (
      // Today's work in progress: opens Today on it, closing discards it; not dragged, no conversation menu
      <SidebarRow
        key={row.key}
        kind="conv"
        data-kind="work"
        data-key={row.key}
        icon={row.icon ?? "chat"}
        name={row.title}
        selected={row.selected}
        unseen={false}
        indent={indent}
        closable={row.closable}
        closing={false}
        trail={row.trail}
        subs={0}
        subsTitle=""
        mark=""
        onClick={() => openWork(row.key)}
        onClose={() => closeWork(row.key)}
      />
    ) : (
      <SidebarRow
        key={row.key}
        kind="conv"
        data-kind="conv"
        data-key={row.key}
        data-parent={row.parent}
        data-project={row.project}
        data-folder={row.folder}
        title={row.term ? t("nav.inTerminal") : undefined}
        icon={row.term ? "term" : "chat"}
        svg={row.glyph}
        name={row.title}
        selected={row.selected}
        unseen={row.unseen}
        indent={indent}
        nested={nested}
        closable={row.closable}
        closing={row.closing}
        trail={row.trail}
        subs={row.subs}
        subsTitle={row.subsTitle}
        mark={row.orch ? t("nav.orchWorker") : ""}
        {...dropzone("conv", row.key)}
        onPointerDown={press("conv", row.key, row.parent)}
        onClick={unlessDragged(() => select(row.key))}
        onAuxClick={closeOnMiddleClick(row.key)}
        onContextMenu={openMenu({ chatKey: row.key, project: null, kind: "conv" })}
        onClose={unlessDragged(() => closeChat(row.key))}
      />
    );
  // a folder under a project (`indent`) or under Algemeen, its conversations one step further in; the folder's name typed
  // in place while it is being named
  const renderFolder = (folder: FolderBlock, indent: boolean) => (
    <Fragment key={folder.id}>
      {folder.editing ? (
        <FolderName name={folder.name} indent={indent} onDone={name => renameFolder(folder.id, name)} />
      ) : (
        <SidebarRow
          kind="folder"
          data-kind="folder"
          data-folder={folder.id}
          data-project={folder.project}
          aria-expanded={folder.open}
          icon="folder"
          name={folder.name}
          indent={indent}
          unseen={!folder.open && folder.unseen}
          trail={folder.open ? "" : folder.trail}
          meta={!folder.open && folder.count ? { kind: "count", n: folder.count } : undefined}
          addTitle={t("nav.newChatIn", { name: folder.name })}
          {...dropzone("folder", folder.id)}
          onClick={unlessDragged(() => toggleSection(folder.id))}
          onContextMenu={openMenu({ chatKey: folder.id, project: folder.project || null, kind: "folder" })}
          onAdd={unlessDragged(() => select(newChat(folder.project || null, folder.id)))}
        />
      )}
      {folder.open ? folder.convs.map(row => renderConversation(row, true, indent)) : null}
    </Fragment>
  );
  const renderProject = (project: ProjectBlock, tint: Section["tint"]) => (
    <Fragment key={project.name}>
      <SidebarRow
        kind="proj"
        data-kind="proj"
        data-project={project.name}
        data-context={project.context}
        tint={tint}
        name={project.label}
        img={project.img ?? null}
        emoji={project.emoji ?? ""}
        unseen={project.unseen}
        trail={project.trail}
        addTitle={project.addTitle}
        {...dropzone("proj", project.name)}
        onPointerDown={press("proj", project.name, project.context)}
        onClick={unlessDragged(() => openProject(project.name))}
        onContextMenu={openMenu({ chatKey: "", project: project.name, kind: "proj" })}
        onAdd={unlessDragged(() => select(newChat(project.name)))}
      />
      {project.folders.map(folder => renderFolder(folder, true))}
      {project.convs.map(row => renderConversation(row, true))}
      {project.fold ? (
        <SidebarRow kind="fold" indent name={project.fold} onClick={unlessDragged(() => toggleUnfold(project.name))} />
      ) : null}
    </Fragment>
  );
  const renderSection = (section: Section) => {
    const { dragging, drop } = dropzone("sec", section.id);
    return (
      <div
        key={section.id}
        className={`mt-3 ${dragging ? "opacity-40" : ""} ${drop === "after" ? DROP_LINE_AFTER : ""} ${drop === "in" ? "rounded-md ring-1 ring-inset ring-accent" : ""}`}
        data-drop={section.id}
      >
        <SidebarHead
          label={section.label}
          tint={section.tint}
          count={section.count}
          collapsed={section.collapsed}
          dropBefore={drop === "before"}
          onPointerDown={press("sec", section.id)}
          onClick={unlessDragged(() => toggleSection(section.id))}
          onContextMenu={section.id === GENERAL ? openMenu({ chatKey: "", project: null, kind: "proj" }) : undefined}
          onAdd={section.add === undefined ? undefined : unlessDragged(() => select(newChat(section.add || null)))}
        />
        {section.open ? (
          <>
            {section.folders.map(folder => renderFolder(folder, false))}
            {section.convs.map(row => renderConversation(row, false))}
            {section.projects.map(project => renderProject(project, section.tint))}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={root} className={`relay-sidebar ${className}`} data-reordering={reordering || undefined}>
      <div className="h-12 flex-none flex items-center justify-end pr-2.5" data-tauri-drag-region>
        <button
          className="btn-icon"
          title={t("nav.newChat")}
          aria-label={t("nav.newChat")}
          onClick={() => select(newChat(null))}
        >
          <Icon name="compose" className="glyph size-4" />
        </button>
      </div>
      <label className="flex items-center gap-2 mx-3 mb-1.5 h-7.5 px-2.5 rounded-lg bg-fill-2 text-tertiary">
        <Icon name="search" className="glyph size-3.5 flex-none stroke-2" />
        <input
          className="min-w-0 flex-1 text-[13px] text-label outline-none select-text placeholder:text-tertiary"
          value={find}
          placeholder={t("nav.searchIn", { name: workspace })}
          onChange={e => setFind(e.target.value)}
        />
      </label>
      <nav className="flex-1 overflow-y-auto px-2 pt-1.5 pb-4 flex flex-col gap-px">
        {renderViews()}
        {sections.map(renderSection)}
      </nav>
      <SidebarFooter
        selected={selected === USAGE}
        level={usage?.level ?? ""}
        tip={usage ? `${t("nav.usage")}: ${usage.label}` : t("nav.usage")}
        dark={dark}
        onUsage={() => select(USAGE)}
        onTheme={toggleTheme}
        onSettings={openSettings}
        update={update}
      />
      {menu ? (
        <SidebarMenu ref={menuElement} x={menu.x} y={menu.y} items={menuItems(menu)} onPick={id => pick(menu, id)} />
      ) : null}
    </div>
  );
}
