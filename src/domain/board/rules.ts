import type { BoardProvider, BoardRef, Card, Column, Opt, View } from "./types";
import { matches, sameFilters, tidy, type Filters, type Preset } from "./filter.ts";

// A provider's board as a kanban or a list: pick a project and one of its boards, the columns and cards come from
// the provider. Moving a card to another column moves it in the tracker right away, it is the user's own
// action (decided 30/9). The board can be linked to a vault project (settings.boards): opening the board from that
// project shows it.
export type Board = {
  projects: Opt[] | null;
  boards: Opt[];
  columns: Column[];
  cards: Card[];
  views: View[]; // the board's saved views in the tracker, shown with the presets
  presets: Preset[]; // the filter sets saved in this app for the board shown
  project: string;
  board: string;
  err: string;
  busy: boolean;
  gen: number;
  loadedAt: number; // when the cards last came from the tracker, ms; 0 before that
  group: string; // the provider's grouping shown (Productive: task lists or statuses), "" when it has one
  q: string; // the search over title and number
  filters: Filters; // the facet filters (state, status, assignee, folder, task list, labels), see filter.ts
  view: "kanban" | "list";
};

/** The storage key prefix: Productive keeps the keys of before the providers, so the board opens where it was. */
export const storageKey = (provider: BoardProvider) => (provider.id === "productive" ? "pv" : provider.id);
/** A board as far as it is known before the tracker answers: the last project, board, grouping and layout. `gen`
 *  goes on from the board it replaces, so a load that board started never counts as live again. */
export const newBoard = (
  provider: BoardProvider,
  last: { project: string; board: string; group: string; view: string },
  gen = 0,
): Board => ({
  projects: null,
  boards: [],
  columns: [],
  cards: [],
  views: [],
  presets: [],
  project: last.project,
  board: last.board,
  err: "",
  busy: false,
  gen,
  loadedAt: 0,
  group: provider.groupings?.some(x => x.id === last.group) ? last.group : (provider.groupings?.[0].id ?? ""),
  q: "",
  filters: {},
  view: last.view === "list" ? "list" : "kanban",
});
export const refOf = (provider: BoardProvider, state: Board): BoardRef => ({
  provider: provider.id,
  project: state.project,
  board: state.board,
});

// a card's column in the grouping shown: the first grouping is `column`, the others come from `in`
const firstGroup = (provider: BoardProvider, state: Pick<Board, "group">) =>
  !provider.groupings || state.group === provider.groupings[0].id;
export const colOf = (provider: BoardProvider, state: Pick<Board, "group">, card: Card) =>
  firstGroup(provider, state) ? card.column : (card.in?.[state.group] ?? "");
export const withCol = (provider: BoardProvider, state: Pick<Board, "group">, card: Card, column: string): Card =>
  firstGroup(provider, state) ? { ...card, column } : { ...card, in: { ...card.in, [state.group]: column } };
/** The placement at the end of a column. */
export const endOf = (provider: BoardProvider, state: Board, column: string, except: string) =>
  Math.max(
    0,
    ...state.cards.filter(x => colOf(provider, state, x) === column && x.id !== except).map(x => x.placement),
  ) + 1;
/** A column's cards in the board's order. */
export const cardsIn = (provider: BoardProvider, state: Board, cards: Card[], column: string) =>
  cards.filter(card => colOf(provider, state, card) === column).sort((a, b) => a.placement - b.placement);

/** A card made on the board before the tracker answered: at the end of `column` in the grouping shown, coloured like it. */
export const draftCard = (provider: BoardProvider, state: Board, id: string, title: string, column: string): Card => {
  const lane = state.columns.find(c => c.id === column);
  return withCol(
    provider,
    state,
    {
      id,
      title,
      number: "",
      column: "",
      placement: endOf(provider, state, column, id),
      due: null,
      who: "",
      state: lane?.state,
      tone: lane?.tone,
    },
    column,
  );
};

/** The filters as they can apply: a value no card has any more (someone no longer on the board) is dropped, it would
 *  hide every card. Before the cards are known nothing is dropped. */
export const tidied = (state: Board, filters = state.filters) =>
  state.cards.length ? tidy(filters, state.cards) : filters;
/** The cards the search and the filters leave. */
export const filtered = (state: Board) => state.cards.filter(card => matches(card, state.q, state.filters));

/** Whether a saved view of the tracker is what the board shows: its filters, and its grouping and layout if it has them. */
export const viewOn = (state: Board, view: View) =>
  !!view.filters &&
  sameFilters(view.filters, state.filters) &&
  (!view.group || view.group === state.group) &&
  (!view.layout || view.layout === state.view);

/** Folded columns: what the user chose per column id; a column that is done starts folded. */
export const isFolded = (choices: Record<string, boolean> | undefined, column: Column) =>
  choices?.[column.id] ?? column.state === "done";

// ---------- which vault project a board belongs to: a vault project has at most one board
export const sameRef = (a: BoardRef | undefined, b: BoardRef) =>
  !!a && a.provider === b.provider && a.project === b.project && a.board === b.board;
/** The board links after linking `vaultProject` to `ref`, or dropping its board when `ref` is null. A vault project
 *  has at most one board and a board belongs to at most one vault project, so linking takes the board from any other
 *  project. */
export function link(
  boards: Record<string, BoardRef>,
  vaultProject: string,
  ref: BoardRef | null,
): Record<string, BoardRef> {
  const next = Object.fromEntries(
    Object.entries(boards).filter(([name, other]) => name !== vaultProject && !(ref && sameRef(other, ref))),
  );
  if (ref && vaultProject) next[vaultProject] = ref;
  return next;
}
