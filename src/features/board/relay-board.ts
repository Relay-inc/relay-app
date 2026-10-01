import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../core/i18n";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import type { BoardProvider, Card, Column, Opt } from "../../domain/providers";
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
import type { CardGrab } from "./board-card";
import "./board-column";

/** A card being pressed or dragged: where the pointer started and is now, and the column it hovers. `moving` once it has left the click tolerance. */
type Drag = CardGrab & {
  moving: boolean;
  currentX: number;
  currentY: number;
  overColumn?: string;
};

// a press that moves less than this many pixels is a click, not a drag
const DRAG_THRESHOLD = 5;

/** A provider's board as a kanban: the head row (pickers, link to a vault project, reload) and the columns. Dragging a card to another column moves it in the tracker. */
@customElement("relay-board")
export class RelayBoard extends LitElement {
  static override styles = [
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

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.drag = null;
    document.body.classList.remove("reordering");
  }

  // load when shown, and again once resetBoard (new credentials, a new language) has cleared what was known
  override willUpdate(changed: PropertyValues) {
    if (this.provider && (changed.has("provider") || !boards.states.has(this.provider.id))) showBoard(this.provider);
  }

  private onGrab = (e: CustomEvent<CardGrab>) => {
    this.drag = { ...e.detail, moving: false, currentX: e.detail.pointerX, currentY: e.detail.pointerY };
  };

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.pointerX, e.clientY - drag.pointerY) < DRAG_THRESHOLD) return;
      document.body.classList.add("reordering");
    }
    this.drag = { ...drag, moving: true, currentX: e.clientX, currentY: e.clientY, overColumn: this.columnAt(e) };
  };

  // the columns are components: from here the hit is the column element itself
  private columnAt(e: PointerEvent) {
    return this.shadowRoot!.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("relay-board-column")?.dataset
      .list;
  }

  private onPointerUp = () => {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (!drag.moving) {
      openBoardCard(this.provider, drag.id);
      return;
    }
    document.body.classList.remove("reordering");
    this.dropCard(drag);
  };

  private dropCard(drag: Drag) {
    const card = boardState(this.provider).cards.find(x => x.id === drag.id);
    if (card && drag.overColumn && drag.overColumn !== card.column) moveCard(this.provider, card, drag.overColumn);
  }

  private renderSelect(
    options: Opt[],
    current: string,
    emptyLabel: string,
    onChange: (value: string) => void,
    alwaysShowEmpty = false,
  ) {
    const showEmpty = !current || alwaysShowEmpty;
    return html`<select
      class="field max-w-2xs"
      @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
    >
      ${showEmpty ? html`<option value="">${emptyLabel}</option>` : nothing}${options.map(option => html`<option value=${option.id} ?selected=${option.id === current}>${option.name}</option>`)}
    </select>`;
  }

  // which vault project this board belongs to: a vault project has at most one board
  private renderLink(provider: BoardProvider) {
    const projects = vaultProjects();
    if (!boardState(provider).board || !projects.length) return nothing;
    const options = projects.map(([id, name]): Opt => ({ id, name }));
    return html`<span class="text-xs text-label opacity-75" title=${t("kb.linkHelp")}>${t("kb.link")}</span
      >${this.renderSelect(
        options,
        linkedProject(provider),
        t("kb.linkNone"),
        projectId => linkBoard(provider, projectId),
        true,
      )}`;
  }

  private renderHead(provider: BoardProvider) {
    const boardData = boardState(provider);
    const projectEmptyLabel = boardData.projects ? t("kb.pickProject") : t("pr.loading");
    return html`<div class="flex items-center gap-2 mb-3.5">
      ${this.renderSelect(boardData.projects || [], boardData.project, projectEmptyLabel, projectId => pickProject(provider, projectId))}
      ${boardData.project ? this.renderSelect(boardData.boards, boardData.board, t("kb.noBoards"), boardId => pickBoard(provider, boardId)) : nothing}
      <span class="flex-1"></span
      >${this.renderLink(provider)}${boardData.busy ? html`<span class="spinner"></span>` : nothing}<button
        class="btn"
        @click=${() => showBoard(provider, true)}
      >
        ${t("pr.reload")}
      </button>
    </div>`;
  }

  private renderColumn(column: Column, cards: Card[]) {
    const columnCards = cards.filter(card => card.column === column.id).sort((a, b) => a.placement - b.placement);
    const hovered = !!this.drag?.moving && this.drag.overColumn === column.id;
    return html`<relay-board-column
      data-list=${column.id}
      .column=${column}
      .cards=${columnCards}
      ?over=${hovered}
    ></relay-board-column>`;
  }

  private renderColumns(provider: BoardProvider) {
    const boardData = boardState(provider);
    if (!boardData.board) return nothing;
    if (!boardData.columns.length) {
      if (boardData.busy || boardData.err) return nothing;
      return html`<div class="text-secondary text-sm text-center">${t("kb.noCols")}</div>`;
    }
    return html`<div class="flex gap-3 items-start overflow-x-auto pb-2" @board-card-grab=${this.onGrab}>
      ${repeat(
        boardData.columns,
        column => column.id,
        column => this.renderColumn(column, boardData.cards),
      )}
    </div>`;
  }

  // the copy of the dragged card that follows the pointer
  private renderGhost(provider: BoardProvider) {
    const drag = this.drag;
    if (!drag?.moving) return nothing;
    const card = boardState(provider).cards.find(x => x.id === drag.id);
    if (!card) return nothing;
    const position = { left: drag.currentX - drag.offsetX, top: drag.currentY - drag.offsetY, width: drag.width };
    return html`<relay-board-card .card=${card} .ghost=${position}></relay-board-card>`;
  }

  override render() {
    const provider = this.provider;
    if (!provider) return nothing;
    const boardData = boardState(provider);
    return html`${this.renderHead(provider)}
    ${boardData.err ? html`<div class="err-box mb-3">${boardData.err}</div>` : nothing} ${this.renderColumns(provider)}
    ${this.renderGhost(provider)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board": RelayBoard;
  }
}
