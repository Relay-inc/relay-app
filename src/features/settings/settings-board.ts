import { html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { emit } from "../../core/dom";
import { pt, pth, t, th } from "../../core/i18n";
import type { BoardOpt, BoardProvider } from "../../domain/providers";
import { btn, ERRMSG, field, FIELD, foot, FOOT_ROW, HINT, HINT0, nc, SELECT, ST, sw, val } from "./blocks";
import "./settings-menu";
import { SettingsElement } from "./settings-element";
import { tws } from "./styles";
import type { Msg } from "./types";

declare global {
  interface HTMLElementTagNameMap { "relay-settings-board": SettingsBoard }
  interface HTMLElementEventMap {
    "board-field": CustomEvent<{ id: string; value: string | boolean }>;
    "board-save": CustomEvent<void>;
    "board-import": CustomEvent<void>;
    "board-clear": CustomEvent<void>;
    "board-map": CustomEvent<{ vp: string; value: string }>;
    "boards-load": CustomEvent<void>;
  }
}

/** A vault project's row in the board mapping: what its "none" option says, and the board of this provider it is on */
export type BoardRow = { vp: string; none: string; board?: string };

/** A board provider's body in the integrations list: the token, the fields of its config, its boards per vault project. */
@customElement("relay-settings-board")
export class SettingsBoard extends SettingsElement {
  static styles = [tws];

  @property({ attribute: false }) provider!: BoardProvider;
  @property({ attribute: false }) cfg: Record<string, any> = {};
  @property({ type: Boolean }) hasToken = false;
  /** The inputs read on Save, by id (the secrets, the fields); unsaved edits stay until then */
  @property({ attribute: false }) form: Record<string, string | boolean> = {};
  /** Can it take its credentials from Claude Code, and does Claude Code have them */
  @property({ attribute: false }) mcp?: { supported: boolean; found: boolean };
  @property({ type: Boolean }) setUp = false;
  @property({ attribute: false }) msg?: Msg;
  /** The provider lists all its boards in one call, and is set up: its boards map to the vault's projects */
  @property({ type: Boolean }) wantBoards = false;
  @property({ attribute: false }) boards?: { list: BoardOpt[] | null; err: string };
  @property({ attribute: false }) rows: BoardRow[] = [];

  updated(_: PropertyValues) { if (this.wantBoards && !this.boards) emit(this, "boards-load"); }

  private fstr(id: string, d: unknown = "") { const v = this.form[id]; return typeof v === "string" ? v : String(d ?? ""); }
  private inp = (id: string) => (e: Event) => emit(this, "board-field", { id, value: val(e) });

  private map() {
    const b = this.boards;
    if (!this.wantBoards || !b) return nothing;
    if (!b.list) return html`<div class=${HINT0}>${t("pr.loading")}</div>`;
    if (b.err) return html`<div class="flex items-center gap-2"><span class=${ERRMSG}>${b.err}</span></div>`;
    return html`<div class="mt-2 grid gap-0.5 border-t border-s-border pt-3"><b class="text-xs font-semibold">${t("int.boards")}</b><p class=${HINT}>${th("int.boardsHelp")}</p></div>
      ${this.rows.map(r => field(r.vp, html`<select class=${SELECT} @change=${(e: Event) => emit(this, "board-map", { vp: r.vp, value: val(e) })}><option value="">${r.none}</option>${b.list!.map(o =>
        html`<option value="${o.project}/${o.id}" ?selected=${r.board === o.id}>${o.group} › ${o.name}</option>`)}</select>`))}`;
  }

  render() {
    const p = this.provider, { cfg, mcp, msg } = this, id = p.id;
    const secretPh = this.hasToken ? t("int.tokenStored") : t("int.tokenPaste");
    const fields = p.settings.fields.map(f => { const fid = `f-${id}-${f.key}`;
      return f.check ? field(f.placeholder ? pt(p, f.placeholder) : pt(p, f.label), sw(fid, !!(this.form[fid] ?? cfg[f.key]), e => emit(this, "board-field", { id: fid, value: (e.target as HTMLInputElement).checked })), { id: fid })
        : field(nc(pt(p, f.label)), f.secret
          ? html`<input class=${FIELD} id=${fid} type="password" autocomplete="off" placeholder=${secretPh} .value=${live(this.fstr(fid))} @input=${this.inp(fid)} spellcheck="false">`
          : html`<input class=${FIELD} id=${fid} inputmode=${f.numeric ? "numeric" : nothing} .value=${live(this.fstr(fid, cfg[f.key]))} @input=${this.inp(fid)} placeholder=${f.placeholder ? pt(p, f.placeholder) : nothing} spellcheck="false">`, { id: fid }); });
    // the rarer actions behind "…": take the credentials from Claude Code, clear the token
    const items = [mcp?.supported ? { id: "import", name: t("int.importClaude"), state: html`<span class=${ST}>${t(mcp.found ? "int.importFound" : "int.importNone")}</span>` } : null,
      this.hasToken ? { id: "clear", name: t("int.clear") } : null].filter(x => x != null);
    const more = !items.length ? nothing : html`<relay-settings-menu up .tip=${t("int.more")} .items=${items} @menu-pick=${(e: CustomEvent<string>) => emit(this, e.detail === "import" ? "board-import" : "board-clear")}></relay-settings-menu>`;
    const found = !this.setUp && mcp?.found ? html`<div class="flex items-center gap-3 rounded-md border border-s-border bg-s-mutedbg/35 px-3 py-2.5 text-xs"><span class="flex-1">${t("int.foundClaudeLong", { name: p.name })}</span><button class=${btn("primary")} @click=${() => emit(this, "board-import")}>${t("int.import")}</button></div>` : nothing;
    return html`${found}<p class=${HINT0}>${pth(p, p.settings.help)}</p>
      ${field(nc(pt(p, p.settings.tokenLabel)), html`<input class=${FIELD} id="tok-${id}" type="password" autocomplete="off" placeholder=${secretPh} .value=${live(this.fstr(`tok-${id}`))} @input=${this.inp(`tok-${id}`)} spellcheck="false">`, { id: `tok-${id}` })}
      ${fields}
      <div class=${FOOT_ROW}><button class=${btn("ghost")} @click=${() => emit(this, "int-remove")}>${t("ag.remove")}</button>${more}${foot(msg ? msg.text : "", !!msg?.ok, html`<button class=${btn("primary")} @click=${() => emit(this, "board-save")}>${t("int.save")}</button>`)}</div>
      ${this.map()}`;
  }
}
