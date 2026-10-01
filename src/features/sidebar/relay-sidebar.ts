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
import { select, openProject, openPop } from "../../domain/navigation";
import { newChat, closedOf } from "../../domain/chats/state";
import { closeChat, reopen } from "../../domain/chats/actions";
import { usageSummary } from "../../domain/usage";
import type { MenuItem } from "./sidebar-menu";
import "./sidebar-row";
import "./sidebar-head";
import "./sidebar-menu";
import "./sidebar-footer";

type Kind = "sec" | "proj" | "conv";
type Drag = { kind: Kind; id: string; ctx: string; y: number; on: boolean; target?: string; after?: boolean };
type Ctx = { x: number; y: number; k: string; p: string | null; kind: "conv" | "proj" };

// what a dragged kind can be dropped on: the header's section, the other conversations of its project, the other projects of its section
const dropSel = (kind: Kind, ctx: string) =>
  kind === "sec"
    ? "[data-drop]"
    : kind === "conv"
      ? `relay-sidebar-row[kind="conv"][data-parent="${CSS.escape(ctx)}"]`
      : `relay-sidebar-row[kind="proj"][data-ctx="${CSS.escape(ctx)}"]`;

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
  @query("relay-sidebar-menu") private menuEl?: HTMLElement;
  @state() private ctx: Ctx | null = null;

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
    (kind: Kind, id: string, ctx = "") =>
    (e: PointerEvent) => {
      if (e.button !== 0 || origin(e).closest("button")) return;
      e.preventDefault(); // no text selection starting from a row that can be dragged
      this.drag = { kind, id, ctx, y: e.clientY, on: false };
    };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.on) {
      if (Math.abs(e.clientY - d.y) < 5) return;
      this.toggleAttribute("reordering", true);
      document.body.classList.add("reordering");
    }
    const under = this.shadowRoot!.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const tgt = under?.closest<HTMLElement>(dropSel(d.kind, d.ctx));
    if (!tgt) {
      this.drag = { ...d, on: true, target: undefined };
      return;
    }
    const box = (d.kind === "sec" ? tgt.querySelector("relay-sidebar-head")! : tgt).getBoundingClientRect(),
      whole = tgt.getBoundingClientRect();
    const after = d.kind === "sec" ? e.clientY > whole.top + whole.height / 2 : e.clientY > box.top + box.height / 2;
    this.drag = {
      ...d,
      on: true,
      after,
      target: d.kind === "sec" ? tgt.dataset.drop : d.kind === "conv" ? tgt.dataset.k : tgt.dataset.p,
    };
  };
  private onUp = () => {
    const d = this.drag;
    this.drag = null;
    this.toggleAttribute("reordering", false);
    document.body.classList.remove("reordering");
    if (!d?.on) return;
    this.justDragged = true;
    setTimeout(() => {
      this.justDragged = false;
    }, 0);
    if (!d.target) return;
    const visible =
      d.kind === "sec"
        ? []
        : [...this.shadowRoot!.querySelectorAll<HTMLElement>(dropSel(d.kind, d.ctx))].map(
            r => (d.kind === "conv" ? r.dataset.k : r.dataset.p)!,
          );
    reorder(d.kind, d.ctx, visible, d.id, d.target, !!d.after);
  };
  private dz = (kind: Kind, id: string) => {
    const d = this.drag;
    return d?.on && d.kind === kind
      ? {
          dragging: d.id === id,
          drop: d.target === id ? ((d.after ? "after" : "before") as "after" | "before") : ("" as const),
        }
      : { dragging: false, drop: "" as const };
  };

  // ---------- the right-click menu
  private onOutside = (e: MouseEvent) => {
    if (this.ctx && !e.composedPath().includes(this.menuEl!)) this.ctx = null;
  };
  private menu = (c: Omit<Ctx, "x" | "y">) => (e: MouseEvent) => {
    e.preventDefault();
    this.ctx = { ...c, x: e.clientX, y: e.clientY };
  };
  private items(m: Ctx): MenuItem[] {
    if (m.kind === "conv")
      return [
        { id: "assign", label: t("ctx.assign") },
        { id: "close", label: t("nav.close") },
      ];
    const closed = closedOf(m.p);
    return [
      { id: "new", label: t("nav.newChat") },
      ...(closed.length
        ? [
            { id: "", label: t("ctx.recent"), head: true },
            ...closed.map(c => ({ id: `reopen:${c.key}`, label: c.title })),
          ]
        : [{ id: "", label: t("ctx.none"), head: true }]),
    ];
  }
  private pick = async (e: CustomEvent<string>) => {
    const m = this.ctx!,
      id = e.detail;
    this.ctx = null;
    if (id === "assign") {
      await select(m.k);
      openPop();
    } else if (id === "close") closeChat(m.k);
    else if (id === "new") select(newChat(m.p));
    else reopen(id.slice("reopen:".length));
  };

  private go = (f: () => void) => () => {
    if (!this.justDragged) f();
  };
  private stop = (f: () => void) => (e: Event) => {
    e.stopPropagation();
    if (!this.justDragged) f();
  };

  // ---------- rows
  private view(v: ViewRow) {
    return html`<relay-sidebar-row
      .icon=${v.icon ?? ""}
      .svg=${v.svg ?? ""}
      .name=${v.name}
      .meta=${v.meta}
      .selected=${ui.sel === v.key}
      @click=${this.go(() => select(v.key))}
    ></relay-sidebar-row>`;
  }
  private conv(r: ConvRow, indent: boolean) {
    const d = this.dz("conv", r.key);
    // middle-click on a conversation closes it, like a browser tab
    return html`<relay-sidebar-row
      kind="conv"
      data-k=${r.key}
      data-parent=${r.parent}
      title=${ifDefined(r.term ? t("nav.inTerminal") : undefined)}
      .icon=${r.term ? "term" : "chat"}
      .name=${r.title}
      .selected=${r.selected}
      .unseen=${r.unseen}
      .indent=${indent}
      .closable=${r.closable}
      .trail=${r.trail}
      .subs=${r.subs}
      .subsTitle=${r.subsTitle}
      .dragging=${d.dragging}
      .drop=${d.drop}
      @pointerdown=${this.press("conv", r.key, r.parent)}
      @click=${this.go(() => select(r.key))}
      @auxclick=${(e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          closeChat(r.key);
        }
      }}
      @contextmenu=${this.menu({ k: r.key, p: null, kind: "conv" })}
      @closechat=${this.stop(() => closeChat(r.key))}
    ></relay-sidebar-row>`;
  }
  private project(p: ProjectBlock, tint: Section["tint"]) {
    const d = this.dz("proj", p.name);
    return html`<relay-sidebar-row
        kind="proj"
        data-p=${p.name}
        data-ctx=${p.context}
        .tint=${tint}
        .name=${p.label}
        .img=${p.img ?? null}
        .emoji=${p.emoji ?? ""}
        .unseen=${p.unseen}
        .trail=${p.trail}
        .addTitle=${p.addTitle}
        .dragging=${d.dragging}
        .drop=${d.drop}
        @pointerdown=${this.press("proj", p.name, p.context)}
        @click=${this.go(() => openProject(p.name))}
        @contextmenu=${this.menu({ k: "", p: p.name, kind: "proj" })}
        @addchat=${this.stop(() => select(newChat(p.name)))}
      ></relay-sidebar-row>
      ${p.convs.map(r => this.conv(r, true))}
      ${p.fold ? html`<relay-sidebar-row kind="fold" indent .name=${p.fold} @click=${this.go(() => toggleUnfold(p.name))}></relay-sidebar-row>` : nothing}`;
  }
  private section(s: Section) {
    const d = this.dz("sec", s.id);
    return html`<div
      class="mt-1.5 ${d.dragging ? "opacity-40" : ""} ${d.drop === "after" ? "relative before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-accent" : ""}"
      data-drop=${s.id}
    >
      <relay-sidebar-head
        .label=${s.label}
        .tint=${s.tint}
        .count=${s.count}
        .collapsed=${s.collapsed}
        ?addable=${s.add !== undefined}
        .dropBefore=${d.drop === "before"}
        @pointerdown=${this.press("sec", s.id)}
        @click=${this.go(() => toggleSection(s.id))}
        @contextmenu=${s.id === GENERAL ? this.menu({ k: "", p: null, kind: "proj" }) : nothing}
        @addchat=${this.stop(() => select(newChat(s.add || null)))}
      ></relay-sidebar-head>
      ${s.open ? html`${s.convs.map(r => this.conv(r, false))}${s.projects.map(p => this.project(p, s.tint))}` : nothing}
    </div>`;
  }

  override render() {
    const { views, sections } = sidebarModel(),
      u = usageSummary(),
      m = this.ctx;
    return html` <div class="h-11 flex-none" data-tauri-drag-region></div>
      <label class="flex items-center gap-1.5 mx-3 mb-2.5 h-7 px-2 rounded-lg bg-fill text-secondary"
        >${icon("search", "glyph size-3.5 flex-none stroke-2")}
        <input
          class="min-w-0 flex-1 text-sm text-label outline-none select-text placeholder:text-secondary"
          .value=${sidebar.find}
          placeholder=${t("nav.search")}
          @input=${(e: Event) => setFind((e.target as HTMLInputElement).value)}
        />
      </label>
      <nav class="flex-1 overflow-y-auto px-2.5 pb-4">
        ${views.map(v => this.view(v))}${sections.map(s => this.section(s))}
      </nav>
      <relay-sidebar-footer
        .selected=${ui.sel === USAGE}
        .level=${u?.level ?? ""}
        .tip=${u ? `${t("nav.usage")} — ${u.label}` : t("nav.usage")}
        @usage=${() => select(USAGE)}
        @settings=${() => invoke("open_settings_window")}
      ></relay-sidebar-footer>
      ${m ? html`<relay-sidebar-menu .x=${m.x} .y=${m.y} .items=${this.items(m)} @pick=${this.pick}></relay-sidebar-menu>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-sidebar": RelaySidebar;
  }
}
