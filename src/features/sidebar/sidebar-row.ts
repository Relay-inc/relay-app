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
    const shadow = this.drop === "before" ? "relative before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent" : this.drop === "after" ? "relative before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-accent"
      : sub && !sel ? "border-l border-separator" : "";
    const row = sel ? "bg-accent text-on-accent" : `hover:bg-fill ${sub ? (this.unseen ? "text-label" : "text-secondary") : ""}`;
    const sz = sub ? "size-3" : "size-4";
    const gl = `glyph ${sz} flex-none ${sel ? "text-on-accent" : proj ? TINT[this.tint] : "text-secondary"}`;
    const lead = !proj ? this.glyph(gl) : isImg(this.img) ? iconImg(this.img, "size-4 flex-none object-contain rounded-xs")
      : this.emoji ? html`<span class="w-4 flex-none text-center text-sm leading-none">${this.emoji}</span>` : icon("folder", gl);
    const m = this.meta;
    return html`<div class="group flex ${sub ? "h-6" : "h-7"} items-center gap-2 px-2 rounded-md cursor-default transition-colors duration-150 ease-out
      ${row} ${proj ? "mt-0.5 font-medium" : ""} ${sub ? `ml-4 pl-2.5 ${sel ? "" : "rounded-l-none"}` : ""} ${shadow} ${this.dragging ? "opacity-40" : ""}">
      ${fold ? nothing : lead}
      <span class="flex-1 overflow-hidden whitespace-nowrap text-ellipsis ${this.unseen ? "font-semibold" : ""}">${this.name}</span>
      ${m ? html`<span title=${m.title ?? ""} class=${m.kind === "badge" ? "min-w-4 h-4 px-1 rounded-lg bg-accent text-on-accent text-xs font-semibold grid place-items-center"
        : `tabular-nums ${m.kind === "late" || m.kind === "soon" ? (sel ? "text-on-accent font-semibold" : m.kind === "late" ? "due-late" : "due-soon") : "text-secondary"}`}>${m.n}</span>` : nothing}
      ${this.subs ? html`<span class="min-w-4 h-4 px-1 flex-none rounded-lg text-xs font-semibold grid place-items-center tabular-nums ${sel ? "bg-on-accent/25 text-on-accent" : "bg-fill text-secondary"}" title=${this.subsTitle}>${this.subs}</span>` : nothing}
      ${this.trail === "dot" ? html`<span class="size-2 rounded-full group-hover:hidden ${sel ? "bg-on-accent" : "bg-accent"}"></span>` : this.trail === "spin" ? html`<span class="spinner group-hover:hidden"></span>` : nothing}
      ${this.closable ? html`<button class="hidden group-hover:grid place-items-center size-4 ml-1 flex-none rounded-sm text-sm leading-none cursor-default hover:bg-fill ${sel ? "text-on-accent" : "text-secondary hover:text-label"}"
        title=${t("nav.close")} @click=${(e: Event) => this.btn(e, "closechat")}>×</button>` : nothing}
      ${this.addTitle ? html`<button class="hidden group-hover:block ml-1 w-5 h-4 rounded-md text-base leading-none cursor-default hover:bg-fill ${sel ? "text-on-accent" : "text-secondary hover:text-label"}"
        title=${this.addTitle} @click=${(e: Event) => this.btn(e, "addchat")}>+</button>` : nothing}
    </div>`;
  }
}
