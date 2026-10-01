import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../core/i18n";
import { emit } from "../../core/dom";
import { icon, glyphSvg, iconImg, isImg } from "../../core/icons";
import { tw } from "../../core/styles";
import type { Meta, Trail } from "../../domain/sidebar";

declare global {
  interface HTMLElementEventMap {
    closechat: CustomEvent<void>;
    addchat: CustomEvent<void>;
  }
}

const TINT = { "": "text-secondary", "ctx-a": "text-ctx-a", "ctx-m": "text-ctx-m", "ctx-p": "text-ctx-p" };

/** One row of the sidebar: a view, a project, a conversation or terminal session, or the "n more" fold. The click, press and
 * context menu belong to the container (they bubble out of the host); only the two buttons are events of their own. */
@customElement("relay-sidebar-row")
export class SidebarRow extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
        cursor: default;
      }
    `,
  ];

  @property() kind: "view" | "proj" | "conv" | "fold" = "view";
  @property() name = "";
  @property() icon = ""; // a named icon, or `svg`: a provider's own glyph
  @property() svg = "";
  @property() img: string | null = null; // a project's icon: an image, else an emoji, else the folder
  @property() emoji = "";
  @property() tint: keyof typeof TINT = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: Boolean }) unseen = false;
  @property({ type: Boolean }) indent = false; // under its project
  @property({ type: Boolean }) closable = false;
  @property() trail: Trail = "";
  @property({ type: Number }) subs = 0; // subagents working
  @property() subsTitle = "";
  @property({ attribute: false }) meta?: Meta;
  @property() addTitle = ""; // the "+" of a project row
  @property({ type: Boolean }) dragging = false;
  @property() drop: "" | "before" | "after" = "";

  private glyph(classes: string) {
    return this.svg ? glyphSvg(this.svg, classes) : icon(this.icon, classes);
  }
  private emitFromButton(e: Event, name: "closechat" | "addchat") {
    e.stopPropagation();
    emit(this, name);
  }

  private get dropLineClass() {
    if (this.drop === "before")
      return "relative before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent";
    if (this.drop === "after")
      return "relative before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-accent";
    return "";
  }
  private get rowClass() {
    if (this.selected) return "bg-accent-soft";
    const subrowText = this.unseen ? "text-label" : "text-secondary hover:text-label";
    return `hover:bg-fill ${this.indent ? subrowText : ""}`;
  }
  private get glyphColor() {
    if (this.selected) return "text-accent-text";
    return this.kind === "proj" ? TINT[this.tint] : "text-secondary";
  }
  private metaClass(meta: Meta) {
    if (meta.kind === "badge")
      return "min-w-4.5 h-4.5 px-1.25 rounded-full bg-accent text-on-accent text-[11px] font-semibold grid place-items-center tabular-nums";
    if (meta.kind === "late") return "tabular-nums text-xs font-medium text-late";
    if (meta.kind === "soon") return "tabular-nums text-xs font-medium text-soon";
    return "tabular-nums text-xs font-medium text-secondary";
  }

  private renderLead() {
    const glyphClass = `glyph ${this.indent ? "size-3.5" : "size-4"} flex-none ${this.glyphColor}`;
    if (this.kind !== "proj") return this.glyph(glyphClass);
    if (isImg(this.img)) return iconImg(this.img, "size-4 flex-none object-contain rounded-xs");
    if (this.emoji) return html`<span class="w-4 flex-none text-center text-sm leading-none">${this.emoji}</span>`;
    return icon("folder", glyphClass);
  }
  private renderMeta() {
    const meta = this.meta;
    if (!meta) return nothing;
    return html`<span title=${meta.title ?? ""} class=${this.metaClass(meta)}>${meta.n}</span>`;
  }
  private renderSubs() {
    if (!this.subs) return nothing;
    return html`<span
      class="min-w-4 h-4 px-1 flex-none rounded-lg text-xs font-semibold grid place-items-center tabular-nums bg-fill-2 text-secondary"
      title=${this.subsTitle}
      >${this.subs}</span
    >`;
  }
  private renderTrail() {
    if (this.trail === "dot")
      return html`<span class="size-2 flex-none rounded-full bg-accent group-hover:hidden"></span>`;
    if (this.trail === "spin") return html`<span class="spinner group-hover:hidden"></span>`;
    return nothing;
  }
  private renderClose() {
    if (!this.closable) return nothing;
    return html`<button
      class="hidden group-hover:grid place-items-center size-4 ml-1 flex-none rounded-sm text-sm leading-none cursor-default text-secondary hover:bg-fill-2 hover:text-label"
      title=${t("nav.close")}
      @click=${(e: Event) => this.emitFromButton(e, "closechat")}
    >
      ×
    </button>`;
  }
  private renderAdd() {
    if (!this.addTitle) return nothing;
    return html`<button
      class="hidden group-hover:block ml-1 w-5 h-4 rounded-md text-base leading-none cursor-default text-secondary hover:bg-fill-2 hover:text-label"
      title=${this.addTitle}
      @click=${(e: Event) => this.emitFromButton(e, "addchat")}
    >
      +
    </button>`;
  }

  override render() {
    const sub = this.indent;
    const subClass = sub ? "ml-4.5" : "";
    return html`<div
      class="group flex ${sub ? "h-6.5 gap-2" : "h-7 gap-2.5"} items-center px-2 rounded-md cursor-default transition-colors duration-150 ease-out
      ${this.rowClass} ${subClass} ${this.dropLineClass} ${this.dragging ? "opacity-40" : ""}"
    >
      ${this.kind === "fold" ? nothing : this.renderLead()}
      <span class="flex-1 overflow-hidden whitespace-nowrap text-ellipsis ${this.unseen ? "font-semibold" : ""}"
        >${this.name}</span
      >
      ${this.renderMeta()}${this.renderSubs()}${this.renderTrail()}${this.renderClose()}${this.renderAdd()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-sidebar-row": SidebarRow;
  }
}
