import { html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "./i18n";
import type { Key } from "./locales/en";
import { PROVIDERS, type BoardProvider, type BoardRef, type Card, type Column, type Opt } from "./providers";
import { RelayElement, changed, styles } from "./lib/store";
import { S } from "./app/state";
import { boardHelpers } from "./app/actions";
import css from "./board.css?inline";

// A provider's board as a kanban: pick a project and one of its boards, the columns and cards come from
// the provider (src/providers/). Dragging a card to another column moves it in the tracker right away,
// it is the user's own action (decided 30/9). The backend holds the token.
// The board can be linked to a vault project (settings.boards): opening the board from that project shows it.
type State = { projects: Opt[] | null; boards: Opt[]; columns: Column[]; cards: Card[]; project: string; board: string };

const ls = { get: (k: string) => localStorage.getItem(k) || "", set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
// the Productive keys of before the providers, so the board opens where it was
const lsKey = (p: BoardProvider) => p.id === "productive" ? "pv" : p.id;
const states = new Map<string, State>();
// bumped by resetBoard: an open board sees it is behind and starts over
let resets = 0;

/** new credentials or a new language: start over */
export function resetBoard() { states.clear(); resets++; PROVIDERS.forEach(p => p.reset?.()); changed(); }

const sameRef = (a: BoardRef | undefined, b: BoardRef) => !!a && a.provider === b.provider && a.project === b.project && a.board === b.board;
type Drag = { id: string; x: number; y: number; dx: number; dy: number; w: number; on: boolean; px: number; py: number; over?: string };

export class RelayBoard extends RelayElement {
  static styles = styles(css);
  static properties = { provider: { attribute: false } };
  declare provider: BoardProvider;

  private s!: State;
  private err = "";
  private busy = false;
  private gen = 0;
  private seen = resets;
  // dragging a card: pointer events, the Mac webview does not deliver HTML drag and drop reliably
  private drag: Drag | null = null;

  private get pv() { return this.provider; }
  private get h() { return boardHelpers(this.provider); }
  private ref = (): BoardRef => ({ provider: this.pv.id, project: this.s.project, board: this.s.board });

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onMove); window.addEventListener("pointerup", this.onUp);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onMove); window.removeEventListener("pointerup", this.onUp);
    this.drag = null; document.body.classList.remove("reordering");
  }

  willUpdate(ch: PropertyValues) {
    if (!this.provider) return;
    if (ch.has("provider") || this.seen !== resets) { this.seen = resets; this.show(S.lastP ? S.settings.boards?.[S.lastP] : undefined); }
  }

  // one load at a time: a newer choice makes the answer of an older one irrelevant
  private async run(fn: (live: () => boolean) => Promise<void>) {
    const g = ++this.gen, live = () => g === this.gen;
    this.busy = true; this.err = ""; this.requestUpdate();
    try { await fn(live); } catch (x) { if (live()) this.err = String(x); }
    if (live()) { this.busy = false; this.requestUpdate(); }
  }
  private remember() { const p = this.pv; ls.set(`${lsKey(p)}Project`, this.s.project); ls.set(`${lsKey(p)}Board`, this.s.board); }
  private async loadCards(live: () => boolean, b: string) {
    const { pv, s } = this, ctx = this.h.ctx(), r = { ...this.ref(), board: b };
    const [cols, cs] = b ? await Promise.all([pv.columns(ctx, r), pv.cards(ctx, r)]) : [[], []];
    if (!live()) return false;
    s.board = b; s.columns = cols; s.cards = cs; this.remember();
    return true;
  }

  /** Show the provider's board from what is known right away, then fresh from the tracker. `prefer` is the board to open. */
  private show(prefer?: BoardRef) {
    const p = this.pv;
    if (!states.has(p.id)) states.set(p.id, { projects: null, boards: [], columns: [], cards: [], project: ls.get(`${lsKey(p)}Project`), board: ls.get(`${lsKey(p)}Board`) });
    const s = this.s = states.get(p.id)!;
    if (prefer?.provider === p.id && (prefer.project !== s.project || prefer.board !== s.board)) {
      s.project = prefer.project; s.board = prefer.board; s.boards = []; s.columns = []; s.cards = [];
    }
    this.run(async live => {
      const ctx = this.h.ctx();
      const ps = s.projects ?? await p.projects(ctx); if (!live()) return;
      s.projects = ps;
      if (!ps.some(x => x.id === s.project)) { s.project = ""; s.board = ""; }
      const bs = s.project ? await p.boards(ctx, s.project) : []; if (!live()) return;
      s.boards = bs;
      await this.loadCards(live, bs.some(b => b.id === s.board) ? s.board : bs[0]?.id || "");
    });
  }

  private pickProject(e: Event) {
    const p = (e.target as HTMLSelectElement).value, s = this.s;
    this.run(async live => {
      const bs = p ? await this.pv.boards(this.h.ctx(), p) : []; if (!live()) return;
      s.project = p; s.boards = bs; s.columns = []; s.cards = [];
      await this.loadCards(live, bs[0]?.id || "");
    });
  }
  private pickBoard(e: Event) {
    const b = (e.target as HTMLSelectElement).value;
    this.run(live => this.loadCards(live, b).then(() => {}));
  }

  private onDown(e: PointerEvent, c: Card) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.drag = { id: c.id, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, on: false, px: e.clientX, py: e.clientY };
  }
  private onMove = (e: PointerEvent) => {
    const d = this.drag; if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.on = true; document.body.classList.add("reordering");
    }
    d.px = e.clientX; d.py = e.clientY;
    d.over = this.shadowRoot!.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".kcol")?.dataset.list;
    this.requestUpdate();
  };
  private onUp = () => {
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (!d.on) { this.h.open(d.id, this.ref()); return; }
    document.body.classList.remove("reordering");
    const c = this.s.cards.find(x => x.id === d.id);
    if (c && d.over && d.over !== c.column) this.move(c, d.over); else this.requestUpdate();
  };

  // shown in the new column at once, back where it was when the tracker refuses
  private async move(c: Card, to: string) {
    const from = c.column, was = c.placement;
    c.column = to; c.placement = Math.max(0, ...this.s.cards.filter(x => x.column === to && x !== c).map(x => x.placement)) + 1; this.err = ""; this.requestUpdate();
    try {
      const placed = await this.pv.move(this.h.ctx(), this.ref(), c, to);
      if (placed != null) c.placement = placed;
    } catch (x) { c.column = from; c.placement = was; this.err = t("kb.moveFailed", { e: String(x) }); }
    this.requestUpdate();
  }

  private pick(cls: string, opts: Opt[], cur: string, empty: string, on: (e: Event) => void, always = false) {
    return html`<select class="kbsel ${cls}" @change=${on}>${cur && !always ? nothing : html`<option value="">${empty}</option>`}${opts.map(o => html`<option value=${o.id} ?selected=${o.id === cur}>${o.name}</option>`)}</select>`;
  }
  private card(c: Card, ghost = false) {
    const d = this.drag;
    return html`<div class="kcard${ghost ? " kghost" : d?.on && d.id === c.id ? " dragging" : ""}" style=${ghost ? `width:${d!.w}px;transform:translate(${d!.px - d!.dx}px,${d!.py - d!.dy}px)` : nothing}
      @pointerdown=${ghost ? nothing : (e: PointerEvent) => this.onDown(e, c)}><div class="kt">${c.title}</div>
      <div class="km">${c.number ? html`<span>${/^\d+$/.test(c.number) ? "#" : ""}${c.number}</span>` : nothing}${c.priority && c.priority <= 4 ? html`<span class="kprio p${c.priority}">${t(`kb.prio${c.priority}` as Key)}</span>` : nothing}${c.who ? html`<span>${c.who}</span>` : nothing}${c.due ? html`<span>${c.due.split("-").reverse().slice(0, 2).map(Number).join("/")}</span>` : nothing}</div></div>`;
  }
  private col(l: Column) {
    const cs = this.s.cards.filter(c => c.column === l.id).sort((a, b) => a.placement - b.placement), d = this.drag;
    return html`<div class="kcol${d?.on && d.over === l.id ? " over" : ""}" data-list=${l.id}><div class="kh"><span>${l.name}</span><span class="count">${cs.length}</span></div>
      <div class="kcards">${repeat(cs, c => c.id, c => this.card(c))}</div></div>`;
  }

  render() {
    const s = this.s; if (!s) return nothing;
    // which vault project this board belongs to: a vault project has at most one board
    const h = this.h, vps: [string, string][] = h.vaultProjects(), cur = Object.entries(h.linked()).find(([, r]) => sameRef(r, this.ref()))?.[0] ?? "";
    const link = s.board && vps.length ? html`<span class="kblink" title=${t("kb.linkHelp")}>${t("kb.link")}</span>${this.pick("lnk", vps.map(([id, name]): Opt => ({ id, name })), cur, t("kb.linkNone"), e => h.link((e.target as HTMLSelectElement).value, this.ref()), true)}` : nothing;
    const ghost = this.drag?.on ? s.cards.find(c => c.id === this.drag!.id) : undefined;
    return html`<div class="kbhead">${this.pick("pvproj", s.projects || [], s.project, s.projects ? t("kb.pickProject") : t("pr.loading"), e => this.pickProject(e))}
      ${s.project ? this.pick("pvboard", s.boards, s.board, t("kb.noBoards"), e => this.pickBoard(e)) : nothing}
      <span class="sp"></span>${link}${this.busy ? html`<span class="spin"></span>` : nothing}<button class="btn" @click=${() => { s.projects = null; this.show(); }}>${t("pr.reload")}</button></div>
      ${this.err ? html`<div class="err">${this.err}</div>` : nothing}
      ${s.board && s.columns.length ? html`<div class="kb">${repeat(s.columns, l => l.id, l => this.col(l))}</div>` : s.board && !this.busy && !this.err ? html`<div class="note">${t("kb.noCols")}</div>` : nothing}
      ${ghost ? this.card(ghost, true) : nothing}`;
  }
}
customElements.define("relay-board", RelayBoard);
