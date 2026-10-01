import { html, nothing, type TemplateResult } from "lit";
import { invoke } from "@tauri-apps/api/core";
import { t, tn } from "../i18n";
import { RelayElement, styles, origin, changed } from "../lib/store";
import { icon, glyphSvg } from "../icons";
import { iconImg, isImg } from "../project-icons";
import { unread } from "../mail";
import { usageSummary } from "../usage";
import {
  S, WAIT, REM, PRS, MAIL, USAGE, VIEWS, boardKey, contexts, chatsOf, closedOf, ghOn, mailOn, newChat, pLabel, projOf,
  readyBoards, runningSubs, shownTitle, terms, waitCount, waits, type Chat, type Term,
} from "../app/state";
import { select, openProject, closeChat, reopen, toggleSection, toggleUnfold, reorder, openPop } from "../app/actions";
import css from "./nav.css?inline";

type Kind = "sec" | "proj" | "conv";
type Drag = { kind: Kind; id: string; ctx: string; y: number; on: boolean; target?: string; after?: boolean };
type Row = { key: string; tpl: TemplateResult };

// contexts come from the vault index, in its order, each takes the next of three colours
const CTX = ["ctx-a", "ctx-m", "ctx-p"];
// sidebar glyphs, the way Mail and Finder put one in front of each row
const trailOf = (keys: string[]) => keys.some(waits) ? html`<span class="dot"></span>` : keys.some(k => S.status[k] === "busy") ? html`<span class="spin"></span>` : nothing;
const subBadge = (k: string) => { const n = runningSubs(k); return n ? html`<span class="acount" title=${tn("nav.agentsWorking", n)}>${n}</span>` : nothing; };

/** The whole left sidebar: search, the sections with their conversations, the footer buttons and the right-click menu. */
export class RelayNav extends RelayElement {
  static styles = styles(css);

  // drag reordering: the press, and what is shown while it moves (dragging row, drop indicator)
  private drag: Drag | null = null;
  private justDragged = false;
  private ctx: { x: number; y: number; k: string; p: string | null; kind: "conv" | "proj" } | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("click", this.onOutside);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("click", this.onOutside);
  }

  // ---------- reorder by pressing and moving: a section header among headers, a project among the projects of its
  // section. Pointer events instead of HTML drag and drop, which the Mac webview does not deliver reliably.
  private press = (kind: Kind, id: string, ctx = "") => (e: PointerEvent) => {
    if (e.button !== 0 || origin(e).closest("button")) return;
    e.preventDefault(); // no text selection starting from a row that can be dragged
    this.drag = { kind, id, ctx, y: e.clientY, on: false };
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag; if (!d) return;
    if (!d.on) { if (Math.abs(e.clientY - d.y) < 5) return; d.on = true; this.toggleAttribute("reordering", true); document.body.classList.add("reordering"); }
    const under = this.shadowRoot!.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const tgt = d.kind === "sec" ? under?.closest<HTMLElement>(".sec[data-drop]")
      : d.kind === "conv" ? under?.closest<HTMLElement>(`.row.conv[data-parent="${CSS.escape(d.ctx)}"]`)
      : under?.closest<HTMLElement>(`.prow[data-ctx="${CSS.escape(d.ctx)}"]`);
    if (!tgt) { d.target = undefined; this.requestUpdate(); return; }
    const box = (d.kind === "sec" ? tgt.querySelector(".grp")! : tgt).getBoundingClientRect(), whole = tgt.getBoundingClientRect();
    d.after = d.kind === "sec" ? e.clientY > whole.top + whole.height / 2 : e.clientY > box.top + box.height / 2;
    d.target = d.kind === "sec" ? tgt.dataset.drop : d.kind === "conv" ? tgt.dataset.k : tgt.dataset.p;
    this.requestUpdate();
  };
  private onUp = () => {
    const d = this.drag; this.drag = null;
    this.toggleAttribute("reordering", false); document.body.classList.remove("reordering");
    if (!d?.on) return;
    this.requestUpdate();
    this.justDragged = true; setTimeout(() => { this.justDragged = false; }, 0);
    if (!d.target) return;
    const sel = d.kind === "conv" ? `.row.conv[data-parent="${CSS.escape(d.ctx)}"]` : `.prow[data-ctx="${CSS.escape(d.ctx)}"]`;
    const visible = d.kind === "sec" ? [] : [...this.shadowRoot!.querySelectorAll<HTMLElement>(sel)].map(r => (d.kind === "conv" ? r.dataset.k : r.dataset.p)!);
    reorder(d.kind, d.ctx, visible, d.id, d.target, !!d.after);
  };
  private dz = (kind: Kind, id: string) => {
    const d = this.drag; if (!d?.on || d.kind !== kind) return "";
    return `${d.id === id ? " dragging" : ""}${d.target === id ? (d.after ? " dropafter" : " dropbefore") : ""}`;
  };

  // ---------- the right-click menu
  private onOutside = (e: MouseEvent) => {
    if (this.ctx && !e.composedPath().includes(this.shadowRoot!.querySelector(".ctx")!)) { this.ctx = null; this.requestUpdate(); }
  };
  private menu = (e: MouseEvent, c: Omit<NonNullable<RelayNav["ctx"]>, "x" | "y">) => { e.preventDefault(); this.ctx = { ...c, x: e.clientX, y: e.clientY }; this.requestUpdate(); };
  private pick = (f: () => void) => () => { this.ctx = null; this.requestUpdate(); f(); };

  private go = (f: () => void) => () => { if (!this.justDragged) f(); };
  private stop = (f: () => void) => (e: Event) => { e.stopPropagation(); if (!this.justDragged) f(); };

  // ---------- rows
  private x = (k: string) => html`<button class="x" title=${t("nav.close")} @click=${this.stop(() => closeChat(k))}>×</button>`;
  // middle-click on a conversation closes it, like a browser tab
  private aux = (k: string) => (e: MouseEvent) => { if (e.button !== 1 || VIEWS.includes(k)) return; e.preventDefault(); closeChat(k); };
  private conv(c: Chat, indent: boolean): Row {
    const k = c.key;
    return { key: k, tpl: html`<div class="row conv${indent ? " subrow" : ""}${S.sel === k ? " sel" : ""}${S.unseen.has(k) ? " new" : ""}${this.dz("conv", k)}" data-k=${k} data-parent=${c.project ?? ""}
      @pointerdown=${this.press("conv", k, c.project ?? "")} @click=${this.go(() => select(k))} @auxclick=${this.aux(k)}
      @contextmenu=${(e: MouseEvent) => this.menu(e, { k, p: null, kind: "conv" })}>${icon("chat")}<span class="nm">${shownTitle(c.title)}</span>${subBadge(k)}${trailOf([k])}${c.draft && !S.typed[k] ? nothing : this.x(k)}</div>` };
  }
  private term(tm: Term, indent: boolean): Row {
    const k = tm.key;
    return { key: k, tpl: html`<div class="row conv${indent ? " subrow" : ""} term${S.sel === k ? " sel" : ""}${this.dz("conv", k)}" data-k=${k} data-parent=${tm.project ?? ""} title=${t("nav.inTerminal")}
      @pointerdown=${this.press("conv", k, tm.project ?? "")} @click=${this.go(() => select(k))} @auxclick=${this.aux(k)}
      @contextmenu=${(e: MouseEvent) => this.menu(e, { k, p: null, kind: "conv" })}>${icon("term")}<span class="nm">${tm.title}</span>${subBadge(k)}${tm.status === "busy" ? html`<span class="spin"></span>` : tm.state === "blocked" ? html`<span class="dot"></span>` : nothing}${this.x(k)}</div>` };
  }
  // conversations in the order the user dragged, the rest after them in their default order
  private byConv(parent: string, rows: Row[]) {
    const o = S.convOrder[parent] || [];
    return rows.map((r, i) => ({ ...r, i })).sort((a, b) => { const ia = o.indexOf(a.key), ib = o.indexOf(b.key);
      return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : a.i - b.i; }).map(r => r.tpl);
  }
  // the open draft shows as "Nieuw gesprek" under its project, its title follows what is typed
  private listed = (p: string | null) => [...Object.values(S.chats).filter(c => c.draft && !c.closed && c.project === p && (c.key === S.sel || S.typed[c.key])), ...chatsOf(p)];
  private head(id: string, label: string, n: number, add?: string, onCtx?: (e: MouseEvent) => void) {
    return html`<div class="grp${S.collapsed[id] ? " shut" : ""}" data-sec=${id} @pointerdown=${this.press("sec", id)} @click=${this.go(() => toggleSection(id))} @contextmenu=${onCtx ?? nothing}>
      <span class="chev"></span><span class="gl">${label}</span>${S.collapsed[id] && n ? html`<span class="gn">${n}</span>` : nothing}${add !== undefined ? html`<button class="add" title=${t("nav.newChat")} @click=${this.stop(() => select(newChat(add || null)))}>+</button>` : nothing}</div>`;
  }
  private lead(p: string) {
    const ic = S.icons[p];
    return isImg(ic?.img) ? iconImg(ic.img) : ic?.icon ? html`<span class="emo">${ic.icon}</span>` : icon("folder");
  }
  private view(k: string, glyph: TemplateResult, name: string | TemplateResult, extra: unknown = nothing) {
    return html`<div class="row${S.sel === k ? " sel" : ""}" @click=${this.go(() => select(k))}>${glyph}<span class="nm">${name}</span>${extra}</div>`;
  }

  private projRows(list: any[], T: Term[]) {
    return list.flatMap(p => {
      const cs = this.listed(p.name), ts = T.filter(tm => tm.project === p.name), keys = [...cs.map(c => c.key), ...ts.map(tm => tm.key)];
      const unfolded = S.unfolded.has(p.name);
      return [html`<div class="row prow${keys.some(k => S.unseen.has(k)) ? " new" : ""}${this.dz("proj", p.name)}" data-p=${p.name} data-ctx=${p.context}
        @pointerdown=${this.press("proj", p.name, p.context)} @click=${this.go(() => openProject(p.name))}
        @contextmenu=${(e: MouseEvent) => this.menu(e, { k: "", p: p.name, kind: "proj" })}>${this.lead(p.name)}<span class="nm">${pLabel(p.name).replace(/^\S+ (?=.)/, s => S.settings.projects[p.name]?.icon ? "" : s)}</span>${trailOf(keys)}<button class="add" title=${t("nav.newChatAbout", { name: p.name })} @click=${this.stop(() => select(newChat(p.name)))}>+</button></div>`,
        ...this.byConv(p.name, [...ts.map(tm => this.term(tm, true)), ...cs.slice(0, unfolded ? cs.length : 5).map(c => this.conv(c, true))]),
        cs.length > 5 ? html`<div class="row subrow fold" @click=${this.go(() => toggleUnfold(p.name))}><span class="nm">${unfolded ? t("nav.less") : t("nav.more", { n: cs.length - 5 })}</span></div>` : nothing];
    });
  }

  private nav() {
    const q = S.find.toLowerCase(), selP = projOf(S.sel), T = terms();
    const w = waitCount(), due = S.snap.reminders.filter((r: any) => r.days <= 0).length;
    const top = html`${this.view(WAIT, icon("bell"), t("nav.waiting"), w ? html`<span class="badge">${w}</span>` : nothing)}
      ${this.view(REM, icon("list"), t("nav.reminders"), due ? html`<span class="count ${S.snap.reminders.some((r: any) => r.days < 0) ? "due-late" : "due-soon"}">${due}</span>` : nothing)}
      ${readyBoards().map(p => this.view(boardKey(p.id), glyphSvg(p.glyph), p.name))}
      ${ghOn() ? this.view(PRS, icon("pr"), t("nav.prs"), S.prs?.review.length ? html`<span class="count" title=${t("nav.prsReview")}>${S.prs.review.length}</span>` : nothing) : nothing}
      ${mailOn() ? this.view(MAIL, icon("mail"), t("nav.mail"), S.mails?.some(unread) ? html`<span class="count">${S.mails.filter(unread).length}</span>` : nothing) : nothing}`;

    const gc = this.listed(null).filter(c => !q || c.title.toLowerCase().includes(q)), gt = T.filter(tm => !tm.project && (!q || tm.title.toLowerCase().includes(q)));
    const general = html`<div class="sec${this.dz("sec", "Algemeen")}" data-drop="Algemeen">${this.head("Algemeen", t("general").toUpperCase(), gc.length + gt.length, "",
      e => this.menu(e, { k: "", p: null, kind: "proj" }))}
      ${S.collapsed.Algemeen && !q ? nothing : this.byConv("", [...gc.map(c => this.conv(c, false)), ...gt.map(tm => this.term(tm, false))])}</div>`;

    // an app conversation stays until the user closes it, a terminal session as long as it is open
    const open = (p: any) => T.some(tm => tm.project === p.name) || chatsOf(p.name).length > 0;
    const lastAt = (n: string) => Math.max(0, ...chatsOf(n).map(c => c.at), ...T.filter(tm => tm.project === n).map(tm => tm.mtime));
    const match = (p: any) => p.name.toLowerCase().includes(q) || pLabel(p.name).toLowerCase().includes(q);
    const byRecent = (a: any, b: any) => lastAt(b.name) - lastAt(a.name);
    // manual order from dragging comes first, the rest follows by recency
    const ordered = (ctx: string, list: any[]) => { const o: string[] = S.projOrder[ctx] || [];
      return [...list].sort((a, b) => { const ia = o.indexOf(a.name), ib = o.indexOf(b.name);
        return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : byRecent(a, b); }); };
    const secs: Record<string, TemplateResult> = { Algemeen: general };
    contexts().forEach((ctx, i) => {
      const shown = ordered(ctx, S.snap.projects.filter((p: any) => p.context === ctx && match(p) && (q || open(p) || p.name === selP)));
      if (shown.length) secs[ctx] = html`<div class="sec ${CTX[i % CTX.length]}${this.dz("sec", ctx)}" data-drop=${ctx}>${this.head(ctx, ctx.toUpperCase(), shown.length)}${S.collapsed[ctx] && !q ? nothing : this.projRows(shown, T)}</div>`;
    });
    // sections the user never dragged follow in the index order
    return html`${top}${[...S.secOrder, ...Object.keys(secs).filter(k => !S.secOrder.includes(k))].filter(k => secs[k]).map(k => secs[k])}`;
  }

  private menuTpl() {
    const m = this.ctx; if (!m) return nothing;
    const body = m.kind === "conv" ? html`<button @click=${this.pick(async () => { await select(m.k); openPop(); })}>${t("ctx.assign")}</button><button @click=${this.pick(() => closeChat(m.k))}>${t("nav.close")}</button>`
      : (() => { const closed = closedOf(m.p);
        return html`<button @click=${this.pick(() => select(newChat(m.p)))}>${t("nav.newChat")}</button>${closed.length ? html`<div class="ctxh">${t("ctx.recent")}</div>${closed.map(c =>
          html`<button @click=${this.pick(() => reopen(c.key))}>${c.title}</button>`)}` : html`<div class="ctxh">${t("ctx.none")}</div>`}`; })();
    return html`<div class="ctx" style="left:${m.x}px;top:${m.y}px">${body}</div>`;
  }

  render() {
    const u = usageSummary(), title = u ? `${t("nav.usage")} — ${u.label}` : t("nav.usage");
    return html`
      <div class="drag" data-tauri-drag-region></div>
      <label class="search">${icon("search", "i")}<input .value=${S.find} placeholder=${t("nav.search")} @input=${(e: Event) => { S.find = (e.target as HTMLInputElement).value; changed(); }}></label>
      <nav class="nav">${this.nav()}</nav>
      <div class="foot">
        <button class="icon-btn${S.sel === USAGE ? " sel" : ""}" title=${title} aria-label=${title} @click=${() => select(USAGE)}>${icon("gauge")}<span class="usage-dot${u?.level ? " on" : ""}${u?.level === "soon" ? " soon" : ""}${u?.level === "late" ? " late" : ""}"></span></button>
        <button class="icon-btn" title=${t("nav.settingsTooltip")} aria-label=${t("nav.settingsLabel")} @click=${() => invoke("open_settings_window")}>${icon("gear")}</button>
      </div>
      ${this.menuTpl()}`;
  }
}
customElements.define("relay-nav", RelayNav);
