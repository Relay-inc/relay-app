import { Fragment, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  GENERAL,
  type ConvRow,
  type ProjectBlock,
  type Section,
  type ViewRow,
} from "../../../domain/navigation/sidebar";
import { USAGE } from "../../../domain/navigation/views";
import { useNavigationStore } from "../../../application/navigation/store";
import { select, openProject, openProjectPanel, openSettings } from "../../../application/navigation/navigation";
import { sidebarModel, setFind, toggleSection, toggleUnfold } from "../../../application/navigation/sidebar";
import { newChat } from "../../../application/conversations/chats";
import { closedOf } from "../../../application/conversations/selectors";
import { closeChat, reopen } from "../../../application/conversations/actions";
import { usageSummary } from "../../../application/usage/usage";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { SidebarRow } from "./SidebarRow";
import { SidebarHead } from "./SidebarHead";
import { SidebarMenu, type MenuItem } from "./SidebarMenu";
import { SidebarFooter } from "./SidebarFooter";
import { useReorder } from "./useReorder";
import { DROP_LINE_AFTER } from "./rows";
import "../../styles/navigation.css";

type MenuTarget = { x: number; y: number; chatKey: string; project: string | null; kind: "conv" | "proj" };

/** The whole left sidebar: search, the sections with their conversations, the footer buttons and the right-click menu.
 *  The rows come from the application (sidebarModel); the drag to reorder and the menu live here. */
export function NavigationView({ className }: { className: string }) {
  const { t } = useT();
  const { views, sections } = useDerived(() => sidebarModel());
  const usage = useDerived(() => usageSummary());
  const selected = useNavigationStore(s => s.selected);
  const find = useNavigationStore(s => s.sidebar.find);
  const root = useRef<HTMLDivElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const { press, dropzone, unlessDragged, reordering } = useReorder(root);

  // the selected row stays in sight, also when it is selected from elsewhere
  useEffect(() => {
    root.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // ---------- the right-click menu
  useDismiss(menuElement, !!menu, () => setMenu(null));
  const openMenu = (target: Omit<MenuTarget, "x" | "y">) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };
  const menuItems = (target: MenuTarget): MenuItem[] => {
    if (target.kind === "conv")
      return [
        { id: "assign", label: t("ctx.assign") },
        { id: "close", label: t("nav.close") },
      ];
    const closed = closedOf(target.project);
    const recent: MenuItem[] = closed.length
      ? [
          { id: "", label: t("ctx.recent"), head: true },
          ...closed.map(chat => ({ id: `reopen:${chat.key}`, label: chat.title })),
        ]
      : [{ id: "", label: t("ctx.none"), head: true }];
    return [{ id: "new", label: t("nav.newChat") }, ...recent];
  };
  const pick = async (target: MenuTarget, itemId: string) => {
    setMenu(null);
    if (itemId === "assign") {
      await select(target.chatKey);
      openProjectPanel();
    } else if (itemId === "close") closeChat(target.chatKey);
    else if (itemId === "new") select(newChat(target.project));
    else reopen(itemId.slice("reopen:".length));
  };

  // middle-click on a conversation closes it, like a browser tab
  const closeOnMiddleClick = (chatKey: string) => (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    closeChat(chatKey);
  };

  // ---------- rows
  const renderView = (view: ViewRow) => (
    <SidebarRow
      key={view.key}
      data-key={view.key}
      icon={view.icon ?? ""}
      svg={view.svg ?? ""}
      name={view.name}
      meta={view.meta}
      selected={selected === view.key}
      onClick={unlessDragged(() => select(view.key))}
    />
  );
  const renderConversation = (row: ConvRow, indent: boolean) => (
    <SidebarRow
      key={row.key}
      kind="conv"
      data-kind="conv"
      data-key={row.key}
      data-parent={row.parent}
      title={row.term ? t("nav.inTerminal") : undefined}
      icon={row.term ? "term" : "chat"}
      svg={row.glyph}
      name={row.title}
      selected={row.selected}
      unseen={row.unseen}
      indent={indent}
      closable={row.closable}
      trail={row.trail}
      subs={row.subs}
      subsTitle={row.subsTitle}
      {...dropzone("conv", row.key)}
      onPointerDown={press("conv", row.key, row.parent)}
      onClick={unlessDragged(() => select(row.key))}
      onAuxClick={closeOnMiddleClick(row.key)}
      onContextMenu={openMenu({ chatKey: row.key, project: null, kind: "conv" })}
      onClose={unlessDragged(() => closeChat(row.key))}
    />
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
        className={`mt-1.5 ${dragging ? "opacity-40" : ""} ${drop === "after" ? DROP_LINE_AFTER : ""}`}
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
            {section.convs.map(row => renderConversation(row, false))}
            {section.projects.map(project => renderProject(project, section.tint))}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={root} className={`relay-sidebar ${className}`} data-reordering={reordering || undefined}>
      <div className="h-11 flex-none" data-tauri-drag-region />
      <label className="flex items-center gap-1.5 mx-3 mb-2.5 h-7 px-2 rounded-lg bg-fill text-secondary">
        <Icon name="search" className="glyph size-3.5 flex-none stroke-2" />
        <input
          className="min-w-0 flex-1 text-sm text-label outline-none select-text placeholder:text-secondary"
          value={find}
          placeholder={t("nav.search")}
          onChange={e => setFind(e.target.value)}
        />
      </label>
      <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
        {views.map(renderView)}
        {sections.map(renderSection)}
      </nav>
      <SidebarFooter
        selected={selected === USAGE}
        level={usage?.level ?? ""}
        tip={usage ? `${t("nav.usage")}: ${usage.label}` : t("nav.usage")}
        onUsage={() => select(USAGE)}
        onSettings={openSettings}
      />
      {menu ? (
        <SidebarMenu ref={menuElement} x={menu.x} y={menu.y} items={menuItems(menu)} onPick={id => pick(menu, id)} />
      ) : null}
    </div>
  );
}
