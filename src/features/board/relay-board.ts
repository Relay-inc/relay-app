import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import type { BoardProvider, Opt } from "../../domain/providers";
import {
  boards,
  boardState,
  showBoard,
  pickProject,
  pickBoard,
  moveCard,
  openBoardCard,
  vaultProjects,
  linkedProject,
  linkBoard,
} from "../../domain/board";
import "./board-column";

type Drag = {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  on: boolean;
  px: number;
  py: number;
  over?: string;
};

/** A provider's board as a kanban: the head row (pickers, link to a vault project, reload) and the columns. Dragging a card to another column moves it in the tracker. */
@customElement("relay-board")
export class RelayBoard extends LitElement {
  static styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  protected store = new StoreController(this);
  @property({ attribute: false }) provider!: BoardProvider;
  // dragging a card: pointer events, the Mac webview does not deliver HTML drag and drop reliably
  @state() private drag: Drag | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.drag = null;
    document.body.classList.remove("reordering");
  }

  // load when shown, and again once resetBoard (new credentials, a new language) has cleared what was known
  willUpdate(ch: PropertyValues) {
    if (this.provider && (ch.has("provider") || !boards.states.has(this.provider.id))) showBoard(this.provider);
  }

  private onDown = (e: CustomEvent<{ id: string; x: number; y: number; dx: number; dy: number; w: number }>) => {
    const { id, x, y, dx, dy, w } = e.detail;
    this.drag = { id, x, y, dx, dy, w, on: false, px: x, py: y };
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      document.body.classList.add("reordering");
    }
    // the columns are components: from here the hit is the column element itself
    const over = this.shadowRoot!.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("relay-board-column")
      ?.dataset.list;
    this.drag = { ...d, on: true, px: e.clientX, py: e.clientY, over };
  };
  private onUp = () => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.on) {
      openBoardCard(this.provider, d.id);
      return;
    }
    document.body.classList.remove("reordering");
    const c = boardState(this.provider).cards.find(x => x.id === d.id);
    if (c && d.over && d.over !== c.column) moveCard(this.provider, c, d.over);
  };

  private pick(opts: Opt[], cur: string, empty: string, on: (v: string) => void, always = false, cls = "") {
    return html`<select
      class="field max-w-2xs ${cls}"
      @change=${(e: Event) => on((e.target as HTMLSelectElement).value)}
    >
      ${cur && !always ? nothing : html`<option value="">${empty}</option>`}${opts.map(o => html`<option value=${o.id} ?selected=${o.id === cur}>${o.name}</option>`)}
    </select>`;
  }

  render() {
    const p = this.provider;
    if (!p) return nothing;
    const s = boardState(p),
      d = this.drag;
    // which vault project this board belongs to: a vault project has at most one board
    const vps = vaultProjects();
    const link =
      s.board && vps.length
        ? html`<span class="text-xs text-label opacity-75" title=${t("kb.linkHelp")}>${t("kb.link")}</span>${this.pick(
              vps.map(([id, name]): Opt => ({ id, name })),
              linkedProject(p),
              t("kb.linkNone"),
              v => linkBoard(p, v),
              true,
            )}`
        : nothing;
    const ghost = d?.on ? s.cards.find(c => c.id === d.id) : undefined;
    return html`<div class="flex items-center gap-2 mb-3.5">
        ${this.pick(s.projects || [], s.project, s.projects ? t("kb.pickProject") : t("pr.loading"), v => pickProject(p, v))}
        ${s.project ? this.pick(s.boards, s.board, t("kb.noBoards"), v => pickBoard(p, v)) : nothing}
        <span class="flex-1"></span>${link}${s.busy ? html`<span class="spinner"></span>` : nothing}<button
          class="btn"
          @click=${() => showBoard(p, true)}
        >
          ${t("pr.reload")}
        </button>
      </div>
      ${s.err ? html`<div class="err-box mb-3">${s.err}</div>` : nothing}
      ${
        s.board && s.columns.length
          ? html`<div class="flex gap-3 items-start overflow-x-auto pb-2" @board-card-grab=${this.onDown}>
              ${repeat(
                s.columns,
                l => l.id,
                l =>
                  html`<relay-board-column
                    data-list=${l.id}
                    .column=${l}
                    .cards=${s.cards.filter(c => c.column === l.id).sort((a, b) => a.placement - b.placement)}
                    ?over=${!!d?.on && d.over === l.id}
                  ></relay-board-column>`,
              )}
            </div>`
          : s.board && !s.busy && !s.err
            ? html`<div class="text-secondary text-sm text-center">${t("kb.noCols")}</div>`
            : nothing
      }
      ${ghost && d ? html`<relay-board-card .card=${ghost} .ghost=${{ x: d.px - d.dx, y: d.py - d.dy, w: d.w }}></relay-board-card>` : nothing}`;
  }
}
