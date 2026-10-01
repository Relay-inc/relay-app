import { LitElement, css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, query, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import { origin } from "../../core/dom";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, USAGE } from "../../domain/ui";
import {
  sidebar,
  sidebarModel,
  setFind,
  toggleSection,
  toggleUnfold,
  reorder,
  GENERAL,
  type ConvRow,
  type ProjectBlock,
  type Section,
  type ViewRow,
} from "../../domain/sidebar";
import { select, openProject, openProjectPanel } from "../../domain/navigation";
import { newChat, closedOf } from "../../domain/chats/state";
import { closeChat, reopen } from "../../domain/chats/actions";
import { usageSummary } from "../../domain/usage";
import type { MenuItem } from "./sidebar-menu";
import "./sidebar-row";
import "./sidebar-head";
import "./sidebar-menu";
import "./sidebar-footer";

type Kind = "sec" | "proj" | "conv";
type Drag = {
  kind: Kind;
  id: string;
  group: string; // the context a project is dragged in, the project a conversation is dragged in
  startY: number;
  active: boolean;
  target?: string;
  after?: boolean;
};
type Dropzone = { dragging: boolean; drop: "" | "before" | "after" };
type MenuTarget = { x: number; y: number; chatKey: string; project: string | null; kind: "conv" | "proj" };

const SECTION_DROP_AFTER = "relative before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-accent";

// what a dragged kind can be dropped on: the header's section, the other conversations of its project, the other projects of its section
const dropSelector = (kind: Kind, group: string) => {
  if (kind === "sec") return "[data-drop]";
  if (kind === "conv") return `relay-sidebar-row[kind="conv"][data-parent="${CSS.escape(group)}"]`;
  return `relay-sidebar-row[kind="proj"][data-context="${CSS.escape(group)}"]`;
};

// the id a drop target stands for
const dropId = (kind: Kind, target: HTMLElement) => {
  if (kind === "sec") return target.dataset.drop;
  if (kind === "conv") return target.dataset.key;
  return target.dataset.project;
};

/** The whole left sidebar: search, the sections with their conversations, the footer buttons and the right-click menu.
 * The rows come from the domain (sidebarModel); the drag to reorder and the menu live here. */
@customElement("relay-sidebar")
export class RelaySidebar extends LitElement {
  static override styles = [
    tw,
    css`
      /* the frosted sidebar: the window is transparent with the macOS sidebar material behind it, only this lets it through */
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: transparent;
        -webkit-user-select: none;
        user-select: none;
      }
      :host([reordering]),
      :host([reordering]) * {
        cursor: grabbing !important;
        user-select: none;
      }
    `,
  ];

  protected store = new StoreController(this);
  @query("relay-sidebar-menu") private menuElement?: HTMLElement;
  @state() private menuTarget: MenuTarget | null = null;

  // drag reordering: the press, and what is shown while it moves (dragging row, drop indicator)
  @state() private drag: Drag | null = null;
  private justDragged = false;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("click", this.onOutside);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("click", this.onOutside);
  }

  // ---------- reorder by pressing and moving: a section header among headers, a project among the projects of its
  // section. Pointer events instead of HTML drag and drop, which the Mac webview does not deliver reliably.
  private press =
    (kind: Kind, id: string, group = "") =>
    (e: PointerEvent) => {
      if (e.button !== 0 || origin(e).closest("button")) return;
      e.preventDefault(); // no text selection starting from a row that can be dragged
      this.drag = { kind, id, group, startY: e.clientY, active: false };
    };
  private setReordering(on: boolean) {
    this.toggleAttribute("reordering", on);
    document.body.classList.toggle("reordering", on);
  }
  private onMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < 5) return;
      this.setReordering(true);
    }
    const hovered = this.shadowRoot!.elementFromPoint(e.clientX, e.clientY);
    const dropTarget = hovered?.closest<HTMLElement>(dropSelector(drag.kind, drag.group));
    if (!dropTarget) {
      this.drag = { ...drag, active: true, target: undefined };
      return;
    }
    const box = dropTarget.getBoundingClientRect();
    this.drag = {
      ...drag,
      active: true,
      after: e.clientY > box.top + box.height / 2,
      target: dropId(drag.kind, dropTarget),
    };
  };
  private onUp = () => {
    const drag = this.drag;
    this.drag = null;
    this.setReordering(false);
    if (!drag?.active) return;
    // the click that ends a drag must not also select the row
    this.justDragged = true;
    setTimeout(() => {
      this.justDragged = false;
    }, 0);
    if (!drag.target) return;
    reorder(drag.kind, drag.group, this.visibleIds(drag), drag.id, drag.target, !!drag.after);
  };
  // the ids of the rows that can be reordered among each other, in screen order (sections reorder without them)
  private visibleIds(drag: Drag) {
    if (drag.kind === "sec") return [];
    const rows = this.shadowRoot!.querySelectorAll<HTMLElement>(dropSelector(drag.kind, drag.group));
    return [...rows].map(row => dropId(drag.kind, row)!);
  }
  private dropzone(kind: Kind, id: string): Dropzone {
    const drag = this.drag;
    if (!drag?.active || drag.kind !== kind) return { dragging: false, drop: "" };
    if (drag.target !== id) return { dragging: drag.id === id, drop: "" };
    return { dragging: drag.id === id, drop: drag.after ? "after" : "before" };
  }

  // ---------- the right-click menu
  private onOutside = (e: MouseEvent) => {
    if (this.menuTarget && !e.composedPath().includes(this.menuElement!)) this.menuTarget = null;
  };
  private openMenu = (target: Omit<MenuTarget, "x" | "y">) => (e: MouseEvent) => {
    e.preventDefault();
    this.menuTarget = { ...target, x: e.clientX, y: e.clientY };
  };
  private menuItems(target: MenuTarget): MenuItem[] {
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
  }
  private pick = async (e: CustomEvent<string>) => {
    const target = this.menuTarget!;
    const itemId = e.detail;
    this.menuTarget = null;
    if (itemId === "assign") {
      await select(target.chatKey);
      openProjectPanel();
    } else if (itemId === "close") closeChat(target.chatKey);
    else if (itemId === "new") select(newChat(target.project));
    else reopen(itemId.slice("reopen:".length));
  };

  // a click that ends a drag is not a click
  private unlessDragged = (action: () => void) => () => {
    if (!this.justDragged) action();
  };
  private stopAndUnlessDragged = (action: () => void) => (e: Event) => {
    e.stopPropagation();
    if (!this.justDragged) action();
  };
  // middle-click on a conversation closes it, like a browser tab
  private closeOnMiddleClick = (chatKey: string) => (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    closeChat(chatKey);
  };

  // ---------- rows
  private renderView(view: ViewRow) {
    return html`<relay-sidebar-row
      .icon=${view.icon ?? ""}
      .svg=${view.svg ?? ""}
      .name=${view.name}
      .meta=${view.meta}
      .selected=${ui.selected === view.key}
      @click=${this.unlessDragged(() => select(view.key))}
    ></relay-sidebar-row>`;
  }
  private renderConversation(row: ConvRow, indent: boolean) {
    const { dragging, drop } = this.dropzone("conv", row.key);
    return html`<relay-sidebar-row
      kind="conv"
      data-key=${row.key}
      data-parent=${row.parent}
      title=${ifDefined(row.term ? t("nav.inTerminal") : undefined)}
      .icon=${row.term ? "term" : "chat"}
      .svg=${row.glyph}
      .name=${row.title}
      .selected=${row.selected}
      .unseen=${row.unseen}
      .indent=${indent}
      .closable=${row.closable}
      .trail=${row.trail}
      .subs=${row.subs}
      .subsTitle=${row.subsTitle}
      .dragging=${dragging}
      .drop=${drop}
      @pointerdown=${this.press("conv", row.key, row.parent)}
      @click=${this.unlessDragged(() => select(row.key))}
      @auxclick=${this.closeOnMiddleClick(row.key)}
      @contextmenu=${this.openMenu({ chatKey: row.key, project: null, kind: "conv" })}
      @closechat=${this.stopAndUnlessDragged(() => closeChat(row.key))}
    ></relay-sidebar-row>`;
  }
  private renderProject(project: ProjectBlock, tint: Section["tint"]) {
    const { dragging, drop } = this.dropzone("proj", project.name);
    return html`<relay-sidebar-row
        kind="proj"
        data-project=${project.name}
        data-context=${project.context}
        .tint=${tint}
        .name=${project.label}
        .img=${project.img ?? null}
        .emoji=${project.emoji ?? ""}
        .unseen=${project.unseen}
        .trail=${project.trail}
        .addTitle=${project.addTitle}
        .dragging=${dragging}
        .drop=${drop}
        @pointerdown=${this.press("proj", project.name, project.context)}
        @click=${this.unlessDragged(() => openProject(project.name))}
        @contextmenu=${this.openMenu({ chatKey: "", project: project.name, kind: "proj" })}
        @addchat=${this.stopAndUnlessDragged(() => select(newChat(project.name)))}
      ></relay-sidebar-row>
      ${project.convs.map(row => this.renderConversation(row, true))}
      ${project.fold ? this.renderFold(project.name, project.fold) : nothing}`;
  }
  private renderFold(projectName: string, label: string) {
    return html`<relay-sidebar-row
      kind="fold"
      indent
      .name=${label}
      @click=${this.unlessDragged(() => toggleUnfold(projectName))}
    ></relay-sidebar-row>`;
  }
  private renderSection(section: Section) {
    const { dragging, drop } = this.dropzone("sec", section.id);
    const dropLineAfter = drop === "after" ? SECTION_DROP_AFTER : "";
    const onMenu = section.id === GENERAL ? this.openMenu({ chatKey: "", project: null, kind: "proj" }) : nothing;
    return html`<div class="mt-1.5 ${dragging ? "opacity-40" : ""} ${dropLineAfter}" data-drop=${section.id}>
      <relay-sidebar-head
        .label=${section.label}
        .tint=${section.tint}
        .count=${section.count}
        .collapsed=${section.collapsed}
        ?addable=${section.add !== undefined}
        .dropBefore=${drop === "before"}
        @pointerdown=${this.press("sec", section.id)}
        @click=${this.unlessDragged(() => toggleSection(section.id))}
        @contextmenu=${onMenu}
        @addchat=${this.stopAndUnlessDragged(() => select(newChat(section.add || null)))}
      ></relay-sidebar-head>
      ${section.open ? this.renderSectionRows(section) : nothing}
    </div>`;
  }
  private renderSectionRows(section: Section) {
    return html`${section.convs.map(row => this.renderConversation(row, false))}${section.projects.map(project =>
      this.renderProject(project, section.tint),
    )}`;
  }
  private renderSearch() {
    return html`<label class="flex items-center gap-1.5 mx-3 mb-2.5 h-7 px-2 rounded-lg bg-fill text-secondary"
      >${icon("search", "glyph size-3.5 flex-none stroke-2")}
      <input
        class="min-w-0 flex-1 text-sm text-label outline-none select-text placeholder:text-secondary"
        .value=${sidebar.find}
        placeholder=${t("nav.search")}
        @input=${(e: Event) => setFind((e.target as HTMLInputElement).value)}
      />
    </label>`;
  }
  private renderFooter() {
    const usage = usageSummary();
    return html`<relay-sidebar-footer
      .selected=${ui.selected === USAGE}
      .level=${usage?.level ?? ""}
      .tip=${usage ? `${t("nav.usage")} — ${usage.label}` : t("nav.usage")}
      @usage=${() => select(USAGE)}
      @settings=${() => invoke("open_settings_window")}
    ></relay-sidebar-footer>`;
  }

  override render() {
    const { views, sections } = sidebarModel();
    const menu = this.menuTarget;
    return html` <div class="h-11 flex-none" data-tauri-drag-region></div>
      ${this.renderSearch()}
      <nav class="flex-1 overflow-y-auto px-2.5 pb-4">
        ${views.map(view => this.renderView(view))}${sections.map(section => this.renderSection(section))}
      </nav>
      ${this.renderFooter()}
      ${
        menu
          ? html`<relay-sidebar-menu
              .x=${menu.x}
              .y=${menu.y}
              .items=${this.menuItems(menu)}
              @pick=${this.pick}
            ></relay-sidebar-menu>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-sidebar": RelaySidebar;
  }
}
