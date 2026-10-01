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
  static styles = [tw, css`:host{display:block;cursor:default}`];

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

  private glyph(cls: string) {
    return this.svg ? glyphSvg(this.svg, cls) : icon(this.icon, cls);
  }
  private btn(e: Event, name: "closechat" | "addchat") { e.stopPropagation(); emit(this, name); }

  render() {
    const sel = this.selected, sub = this.indent, proj = this.kind === "proj", fold = this.kind === "fold";
    // the drop line wins over the subrow's guide line, which a selected row drops
    const shadow = this.drop === "before" ? "shadow-[inset_0_2px_0_var(--accent)]" : this.drop === "after" ? "shadow-[inset_0_-2px_0_var(--accent)]"
      : sub && !sel ? "shadow-[inset_1px_0_0_var(--separator)]" : "";
    const row = sel ? "bg-accent text-on-accent" : `hover:bg-fill ${sub ? (this.unseen ? "text-label" : "text-secondary") : ""}`;
    const sz = sub ? "size-[13px]" : "size-[15px]";
    const gl = `glyph ${sz} flex-none [stroke-width:1.4] ${sel ? "text-on-accent" : proj ? TINT[this.tint] : "text-secondary"}`;
    const lead = !proj ? this.glyph(gl) : isImg(this.img) ? iconImg(this.img, "size-[15px] flex-none object-contain rounded-[3px]")
      : this.emoji ? html`<span class="w-[15px] flex-none text-center text-sm leading-none">${this.emoji}</span>` : icon("folder", gl);
    const m = this.meta;
    return html`<div class="group flex ${sub ? "h-[26px]" : "h-7"} items-center gap-2 px-2 rounded-md cursor-default transition-[background-color] duration-150 ease-out
      ${row} ${proj ? "mt-0.5 font-medium" : ""} ${sub ? `ml-[15px] pl-2.5 ${sel ? "" : "rounded-l-none"}` : ""} ${shadow} ${this.dragging ? "opacity-40" : ""}">
      ${fold ? nothing : lead}
      <span class="flex-1 overflow-hidden whitespace-nowrap text-ellipsis ${this.unseen ? "font-semibold" : ""}">${this.name}</span>
      ${m ? html`<span title=${m.title ?? ""} class=${m.kind === "badge" ? "min-w-[18px] h-4 px-[5px] rounded-lg bg-accent text-on-accent text-2xs font-semibold grid place-items-center"
        : `tabular-nums ${m.kind === "late" || m.kind === "soon" ? (sel ? "text-on-accent font-semibold" : m.kind === "late" ? "due-late" : "due-soon") : "text-secondary"}`}>${m.n}</span>` : nothing}
      ${this.subs ? html`<span class="min-w-4 h-4 px-1 flex-none rounded-lg text-2xs font-semibold grid place-items-center tabular-nums ${sel ? "bg-on-accent/25 text-on-accent" : "bg-fill text-secondary"}" title=${this.subsTitle}>${this.subs}</span>` : nothing}
      ${this.trail === "dot" ? html`<span class="size-2 rounded-full group-hover:hidden ${sel ? "bg-on-accent" : "bg-accent"}"></span>` : this.trail === "spin" ? html`<span class="spinner group-hover:hidden"></span>` : nothing}
      ${this.closable ? html`<button class="hidden group-hover:grid place-items-center size-[18px] ml-1 flex-none rounded-sm text-md leading-none cursor-[inherit] hover:bg-fill ${sel ? "text-on-accent" : "text-secondary hover:text-label"}"
        title=${t("nav.close")} @click=${(e: Event) => this.btn(e, "closechat")}>×</button>` : nothing}
      ${this.addTitle ? html`<button class="hidden group-hover:block ml-1 w-5 h-[18px] rounded-md text-lg leading-none cursor-[inherit] hover:bg-fill ${sel ? "text-on-accent" : "text-secondary hover:text-label"}"
        title=${this.addTitle} @click=${(e: Event) => this.btn(e, "addchat")}>+</button>` : nothing}
    </div>`;
  }
}
