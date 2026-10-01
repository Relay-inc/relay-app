import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../core/i18n";
import type { Key } from "../../core/locales/en";
import { icon } from "../../core/icons";
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
  colOf,
  filtered,
  setFilter,
  toggleFilter,
  clearFilters,
  setView,
  presetsOf,
  savePresetAs,
  deletePreset,
  applyPreset,
  isFolded,
  toggleFold,
  pickGroup,
  NOBODY,
} from "../../domain/board";
import {
  FACETS,
  NO_LABEL,
  activeCount,
  facetsOf,
  matches,
  options,
  sameFilters,
  type Facet,
} from "../../domain/board-filter";
import { panel, cardAct, closeTicket, cardOf, type CardAct } from "../../domain/panel";
import { chat, newChat } from "../../domain/chats/state";
import { setTyped } from "../../domain/chats/actions";
import { select } from "../../domain/navigation";
import type { CardGrab } from "./board-card";
import { avatar, due, ring, updated } from "./format";
import "./board-column";
import "./relay-ticket";

type Pop = "" | "group" | "presets" | "filters";
const FACET_LABEL: Record<Facet, Key> = {
  state: "kb.facState",
  status: "kb.fStatus",
  who: "kb.fWho",
  folder: "kb.facFolder",
  list: "kb.fList",
  label: "kb.fLabels",
};

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
  @state() private pop: Pop = "";
  @state() private naming = false; // "Save current filters…" asks for a name

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKey);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKey);
    this.drag = null;
    document.body.classList.remove("reordering");
  }

  // load when shown, and again once resetBoard (new credentials, a new language) has cleared what was known
  override willUpdate(changed: PropertyValues) {
    if (this.provider && (changed.has("provider") || !boards.states.has(this.provider.id))) showBoard(this.provider);
  }

  // Escape closes the open popover
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.pop) this.closePop();
  };
  private closePop = () => {
    this.pop = "";
    this.naming = false;
  };
  private togglePop(pop: Pop) {
    this.naming = false;
    this.pop = this.pop === pop ? "" : pop;
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
    if (card && drag.overColumn && drag.overColumn !== colOf(this.provider, boardState(this.provider), card))
      moveCard(this.provider, card, drag.overColumn);
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

  private facetName = (facet: Facet, value: string) =>
    facet === "state"
      ? t(`kb.state.${value}` as Key)
      : value === NOBODY
        ? t("kb.unassigned")
        : value === NO_LABEL
          ? t("kb.noLabels")
          : value;

  private btn(on: boolean) {
    return `inline-flex items-center gap-1.5 h-7.5 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap border cursor-default hover:bg-fill ${on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong bg-transparent text-label"}`;
  }
  private renderPopover(width: string, body: unknown) {
    return html`<div class="fixed inset-0 z-10" @click=${this.closePop}></div>
      <div
        class="absolute top-full right-0 mt-1.5 z-20 ${width} rounded-xl bg-raised shadow-md ring-1 ring-separator-strong"
      >
        ${body}
      </div>`;
  }
  private popHeading = (text: string) =>
    html`<div class="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider uppercase text-tertiary">${text}</div>`;
  private popRow = "flex items-center gap-2 h-7.5 px-2 rounded-md hover:bg-fill-2 cursor-default";

  private renderToolbar(provider: BoardProvider) {
    const data = boardState(provider);
    const { cards } = filtered(data);
    const total = data.cards.length;
    const groups = provider.groupings ?? [];
    const group = groups.find(g => g.id === data.group);
    const preset = presetsOf(provider).find(p => sameFilters(p.filters, data.filters));
    const n = activeCount(data.filters);
    return html`<div class="relative flex items-center gap-2 mb-3">
      <label class="flex-1 min-w-0 flex items-center gap-2 h-7.5 px-2.5 rounded-lg bg-fill-2 text-tertiary">
        ${icon("search", "glyph size-3.5")}
        <input
          class="flex-1 min-w-0 border-0 outline-none bg-transparent text-[13px] text-label p-0"
          type="search"
          placeholder=${t("kb.search")}
          .value=${data.q}
          @input=${(e: Event) => setFilter(provider, { q: (e.target as HTMLInputElement).value })}
        />
        <span class="text-xs tabular-nums whitespace-nowrap"
          >${cards.length === total ? t("kb.tasks", { n: total }) : t("kb.tasksOf", { n: cards.length, total })}</span
        >
      </label>
      <div class="seg">
        ${(["kanban", "list"] as const).map(view => html`<button class="${data.view === view ? "on" : ""} w-7.5 px-0 inline-grid place-items-center" title=${t(`kb.view.${view}` as Key)} @click=${() => setView(provider, view)}>${icon(view === "kanban" ? "kanban" : "rows", "glyph size-4")}</button>`)}
      </div>
      ${
        groups.length > 1
          ? html`<div class="relative">
              <button class=${this.btn(false)} title=${t("kb.groupBy")} @click=${() => this.togglePop("group")}>
                ${icon("kanban", "glyph size-3.5 text-secondary")}${group ? t(`${provider.id}.${group.label}` as never) : t("kb.groupBy")}
              </button>
              ${
                this.pop === "group"
                  ? this.renderPopover(
                      "w-55 p-1",
                      html`${this.popHeading(t("kb.groupBy"))}
                      ${groups.map(
                        g =>
                          html`<div
                            class=${this.popRow}
                            @click=${() => {
                              this.closePop();
                              pickGroup(provider, g.id);
                            }}
                          >
                            <span class="flex-1">${t(`${provider.id}.${g.label}` as never)}</span
                            >${g.id === data.group ? icon("check", "glyph size-3.5") : nothing}
                          </div>`,
                      )}`,
                    )
                  : nothing
              }
            </div>`
          : nothing
      }
      <div class="relative">
        <button class=${this.btn(!!preset)} @click=${() => this.togglePop("presets")}>
          ${icon("bookmark", "glyph size-3.5")}${preset?.name ?? t("kb.presets")}
        </button>
        ${this.pop === "presets" ? this.renderPopover("w-60 p-1", this.renderPresets(provider)) : nothing}
      </div>
      <div class="relative">
        <button class=${this.btn(n > 0)} @click=${() => this.togglePop("filters")}>
          ${icon("filter", "glyph size-3.5")}${t("kb.filters")}${n ? html`<span class="min-w-4 h-4 px-1 rounded-full bg-accent text-on-accent text-[10px] inline-grid place-items-center tabular-nums">${n}</span>` : nothing}
        </button>
        ${this.pop === "filters" ? this.renderPopover("w-85", this.renderFacets(provider)) : nothing}
      </div>
    </div>`;
  }

  private renderPresets(provider: BoardProvider) {
    const data = boardState(provider);
    const presets = presetsOf(provider);
    const hasFilters = activeCount(data.filters) > 0;
    const save = (e: Event) => {
      const input = (e.target as HTMLElement).closest("div")!.querySelector("input")!;
      if (!input.value.trim()) return;
      savePresetAs(provider, input.value);
      this.closePop();
    };
    return html`${this.popHeading(t("kb.presets"))}
      ${
        presets.length
          ? presets.map(
              p =>
                html`<div
                  class="group ${this.popRow}"
                  @click=${() => {
                    applyPreset(provider, p);
                    this.closePop();
                  }}
                >
                  <span class="flex-1 truncate">${p.name}</span
                  ><span class="text-xs text-tertiary tabular-nums"
                    >${data.cards.filter(c => matches(c, "", p.filters)).length}</span
                  >
                  ${sameFilters(p.filters, data.filters) ? icon("check", "glyph size-3.5") : nothing}
                  <button
                    class="hidden group-hover:inline-grid btn-icon size-5 rounded-sm"
                    title=${t("kb.presetDelete")}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      deletePreset(provider, p.name);
                    }}
                  >
                    ${icon("close", "glyph size-3")}
                  </button>
                </div>`,
            )
          : html`<div class="px-2 py-1.5 text-xs text-secondary">${t("kb.noPresets")}</div>`
      }
      <div class="h-px bg-separator my-1"></div>
      ${
        this.naming
          ? html`<div class="flex items-center gap-1.5 p-1">
              <input
                class="field flex-1 min-w-0 h-7"
                placeholder=${t("kb.presetName")}
                autofocus
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") save(e);
                }}
              /><button class="btn btn-primary h-7 px-2.5" @click=${save}>${t("kb.save")}</button>
            </div>`
          : html`<div
              class="${this.popRow} ${hasFilters ? "" : "opacity-50"}"
              @click=${() => {
                if (hasFilters) this.naming = true;
              }}
            >
              ${icon("plus", "glyph size-3.5")}${t("kb.presetSave")}
            </div>`
      }`;
  }

  private renderFacets(provider: BoardProvider) {
    const data = boardState(provider);
    const { cards } = filtered(data);
    return html`<div class="max-h-130 overflow-y-auto rounded-t-xl">
        <div class="flex flex-col gap-3.5 p-3.5">
          ${facetsOf(data.cards).map(
            facet =>
              html`<div class="flex flex-col gap-1.5">
                <div class="text-[11px] font-semibold tracking-wider uppercase text-tertiary">
                  ${t(FACET_LABEL[facet])}
                </div>
                <div class="flex flex-wrap gap-1.5">
                  ${options(data.cards, data.q, data.filters, facet).map(([value, count]) => {
                    const on = data.filters[facet]?.includes(value);
                    return html`<button
                      class="inline-flex items-center gap-1.5 h-6.5 px-2.5 rounded-md border text-xs font-medium cursor-default ${on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong text-label hover:bg-fill"}"
                      @click=${() => toggleFilter(provider, facet, value)}
                    >
                      ${this.facetName(facet, value)}<span class="text-[11px] text-tertiary tabular-nums"
                        >${count}</span
                      >
                    </button>`;
                  })}
                </div>
              </div>`,
          )}
        </div>
      </div>
      <div class="flex items-center gap-2 px-3.5 py-2.5 border-t border-separator">
        <button
          class="h-7 px-2.5 border-0 rounded-md bg-transparent text-secondary text-xs font-medium hover:bg-fill-2 hover:text-label"
          @click=${() => clearFilters(provider)}
        >
          ${t("kb.clearAll")}
        </button>
        <span class="flex-1"></span>
        <button class="btn btn-primary h-7 px-3 text-xs" @click=${this.closePop}>
          ${t("kb.show", { n: cards.length })}
        </button>
      </div>`;
  }

  // the active filters as chips under the toolbar
  private renderChips(provider: BoardProvider) {
    const data = boardState(provider);
    const active = FACETS.filter(facet => data.filters[facet]?.length);
    if (!active.length) return nothing;
    return html`<div class="flex items-center flex-wrap gap-1.5 mb-3">
      ${active.map(
        facet =>
          html`<span
            class="inline-flex items-center gap-1.5 h-6 pl-2.5 pr-1 rounded-md bg-accent-soft text-accent-text text-xs"
          >
            <span class="text-secondary">${t(FACET_LABEL[facet])}</span
            ><b class="font-medium">${data.filters[facet]!.map(v => this.facetName(facet, v)).join(", ")}</b>
            <button
              class="size-4.5 grid place-items-center border-0 rounded-sm bg-transparent text-secondary hover:text-label"
              title=${t("kb.remove")}
              @click=${() => clearFilters(provider, facet)}
            >
              ${icon("close", "glyph size-3")}
            </button></span
          >`,
      )}
      <button
        class="h-6 px-2 border-0 rounded-md bg-transparent text-secondary text-xs font-medium hover:bg-fill-2 hover:text-label"
        @click=${() => clearFilters(provider)}
      >
        ${t("kb.clear")}
      </button>
    </div>`;
  }

  // the card shown in the ticket window, to mark it on the board
  private get selectedId() {
    const open = panel.modal ? cardOf(panel.modal) : undefined;
    return open && open.provider.id === this.provider.id ? open.id : "";
  }

  private renderColumn(column: Column, cards: Card[]) {
    const state = boardState(this.provider);
    const columnCards = cards
      .filter(card => colOf(this.provider, state, card) === column.id)
      .sort((a, b) => a.placement - b.placement);
    const hovered = !!this.drag?.moving && this.drag.overColumn === column.id;
    return html`<relay-board-column
      data-list=${column.id}
      .column=${column}
      .cards=${columnCards}
      .selected=${this.selectedId}
      ?over=${hovered}
      ?folded=${isFolded(this.provider, column)}
    ></relay-board-column>`;
  }

  private renderList(provider: BoardProvider, cards: Card[]) {
    const data = boardState(provider);
    const selected = this.selectedId;
    return html`<div class="-mx-4">
      ${data.columns.map(column => {
        const inLane = cards
          .filter(card => colOf(provider, data, card) === column.id)
          .sort((a, b) => a.placement - b.placement);
        const open = !isFolded(provider, column);
        return html`<div
            class="sticky top-0 z-1 flex items-center gap-2 h-9 pl-3.5 pr-5 bg-bg border-b border-separator text-xs font-semibold hover:bg-fill cursor-default"
            @click=${() => toggleFold(provider, column)}
          >
            <span
              class="inline-flex text-tertiary transition-transform duration-150 ease-out ${open ? "" : "-rotate-90"}"
              >${icon("down", "glyph size-3")}</span
            >
            ${column.state ? ring(column.state) : icon("folder", "glyph size-3.5 text-secondary")}
            <span>${column.name}</span><span class="text-tertiary font-medium tabular-nums">${inLane.length}</span>
          </div>
          ${open ? inLane.map(card => this.renderRow(provider, card, card.id === selected)) : nothing}`;
      })}
    </div>`;
  }

  private renderRow(provider: BoardProvider, card: Card, selected: boolean) {
    const day = due(card.due);
    return html`<div
      class="flex items-center gap-3 h-10 pl-9 pr-5 border-b border-separator cursor-default ${selected ? "bg-accent-soft" : "hover:bg-fill"}"
      @click=${() => openBoardCard(provider, card.id)}
    >
      ${ring(card.state)}
      <span class="w-14 flex-none font-mono text-[11px] text-tertiary truncate"
        >${/^\d+$/.test(card.number) ? "#" : ""}${card.number}</span
      >
      <span class="flex-1 min-w-0 truncate text-[13px] font-medium">${card.title}</span>
      ${(card.labels ?? []).map(name => html`<span class="h-4.5 px-1.5 rounded-sm bg-fill-2 text-[11px] text-secondary inline-flex items-center">${name}</span>`)}
      <span class="w-32 flex-none truncate text-[11px] text-tertiary"
        >${[card.folder, card.list].filter(Boolean).join(" › ")}</span
      >
      <span class="w-13 flex-none text-[11px] font-medium tabular-nums ${day?.tone ?? ""}">${day?.short ?? ""}</span>
      <span class="w-5 flex-none inline-flex">${avatar(card.who)}</span>
      <span class="w-11 flex-none text-right text-[11px] text-tertiary tabular-nums">${updated(card.updated)}</span>
    </div>`;
  }

  private renderColumns(provider: BoardProvider) {
    const boardData = boardState(provider);
    if (!boardData.board) return nothing;
    if (!boardData.columns.length) {
      if (boardData.busy || boardData.err) return nothing;
      return html`<div class="text-secondary text-sm text-center">${t("kb.noCols")}</div>`;
    }
    const { cards } = filtered(boardData);
    const body =
      boardData.view === "list"
        ? this.renderList(provider, cards)
        : html`<div
            class="flex gap-2.5 items-start overflow-x-auto pb-2"
            @board-card-grab=${this.onGrab}
            @column-fold=${(e: CustomEvent<Column>) => toggleFold(provider, e.detail)}
          >
            ${repeat(
              boardData.columns,
              column => column.id,
              column => this.renderColumn(column, cards),
            )}
          </div>`;
    return html`${this.renderToolbar(provider)}${this.renderChips(provider)}${body}`;
  }

  // the card open in the ticket window: its data from the provider, previous and next among the cards shown
  private renderTicket(provider: BoardProvider) {
    const open = panel.modal ? cardOf(panel.modal) : undefined;
    if (!open || open.provider.id !== provider.id || !open.detail.view) return nothing;
    const view = open.detail.view;
    const data = boardState(provider);
    const { cards } = filtered(data);
    const order = data.columns.flatMap(column =>
      cards.filter(card => colOf(provider, data, card) === column.id).sort((a, b) => a.placement - b.placement),
    );
    const at = order.findIndex(card => card.id === open.id);
    const detail = panel.detail[panel.modal];
    const number = data.cards.find(card => card.id === open.id)?.number ?? "";
    const startChat = () => {
      const task = detail ? view(detail) : undefined;
      const key = newChat(linkedProject(provider) || null);
      chat.typed[key] = [`${number} ${task?.title ?? ""}`.trim(), task?.url].filter(Boolean).join("\n");
      closeTicket();
      select(key).then(() => setTyped(chat.typed[key]));
    };
    return html`<relay-ticket
      .view=${detail ? view(detail) : null}
      .err=${panel.err}
      .actErr=${panel.actErr}
      ?acting=${panel.acting}
      .providerName=${provider.name}
      .projectName=${data.projects?.find(p => p.id === data.project)?.name ?? ""}
      .number=${number}
      .position=${at >= 0 ? t("kb.tasksOf", { n: at + 1, total: order.length }) : ""}
      ?first=${at <= 0}
      ?last=${at < 0 || at >= order.length - 1}
      @ticket-close=${closeTicket}
      @ticket-step=${(e: CustomEvent<number>) => order[at + e.detail] && openBoardCard(provider, order[at + e.detail].id)}
      @ticket-chat=${startChat}
      @detail-act=${(e: CustomEvent<CardAct>) => cardAct(panel.modal, e.detail)}
    ></relay-ticket>`;
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
    ${this.renderGhost(provider)}${this.renderTicket(provider)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-board": RelayBoard;
  }
}
