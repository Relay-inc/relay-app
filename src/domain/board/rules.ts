import type { BoardProvider, BoardRef, Card, Column, Opt } from "./types";

// A provider's board as a kanban: pick a project and one of its boards, the columns and cards come from
// the provider. Moving a card to another column moves it in the tracker right away, it is the user's own
// action (decided 30/9). The board can be linked to a vault project (settings.boards): opening the board from that
// project shows it.
export type Board = {
  projects: Opt[] | null;
  boards: Opt[];
  columns: Column[];
  cards: Card[];
  project: string;
  board: string;
  err: string;
  busy: boolean;
  gen: number;
  group: string; // the provider's grouping shown (Productive: task lists or statuses), "" when it has one
  q: string; // the search over title and number
  who: string; // the assignee filter: a first name, NOBODY, or "" for everyone
};
export const NOBODY = "\u0001"; // the assignee filter's "unassigned"

/** The storage key prefix: Productive keeps the keys of before the providers, so the board opens where it was. */
export const storageKey = (provider: BoardProvider) => (provider.id === "productive" ? "pv" : provider.id);
/** A board as far as it is known before the tracker answers: the last project, board and grouping. */
export const newBoard = (provider: BoardProvider, last: { project: string; board: string; group: string }): Board => ({
  projects: null,
  boards: [],
  columns: [],
  cards: [],
  project: last.project,
  board: last.board,
  err: "",
  busy: false,
  gen: 0,
  group: provider.groupings?.some(x => x.id === last.group) ? last.group : (provider.groupings?.[0].id ?? ""),
  q: "",
  who: "",
});
export const refOf = (provider: BoardProvider, state: Board): BoardRef => ({
  provider: provider.id,
  project: state.project,
  board: state.board,
});

// a card's column in the grouping shown: the first grouping is `column`, the others come from `in`
const firstGroup = (provider: BoardProvider, state: Board) =>
  !provider.groupings || state.group === provider.groupings[0].id;
export const colOf = (provider: BoardProvider, state: Board, card: Card) =>
  firstGroup(provider, state) ? card.column : (card.in?.[state.group] ?? "");
export const withCol = (provider: BoardProvider, state: Board, card: Card, column: string): Card =>
  firstGroup(provider, state) ? { ...card, column } : { ...card, in: { ...card.in, [state.group]: column } };
/** The placement at the end of a column. */
export const endOf = (provider: BoardProvider, state: Board, column: string, except: string) =>
  Math.max(
    0,
    ...state.cards.filter(x => colOf(provider, state, x) === column && x.id !== except).map(x => x.placement),
  ) + 1;

/** The assignees on the board. */
const peopleOf = (cards: Card[]) => [...new Set(cards.map(card => card.who).filter(Boolean))].sort();
/** The assignee filter as it applies: one on someone not on this board is dropped, it would hide every card. */
export const whoOf = (state: Board) =>
  state.who && state.who !== NOBODY && !peopleOf(state.cards).includes(state.who) ? "" : state.who;
/** The assignees on the board, and the cards the filters leave. */
export function filtered(state: Board) {
  const people = peopleOf(state.cards);
  const who = whoOf(state);
  const q = state.q.toLowerCase();
  const cards = state.cards.filter(
    card =>
      (!q || `${card.title} ${card.number}`.toLowerCase().includes(q)) &&
      (!who || (who === NOBODY ? !card.who : card.who === who)),
  );
  return { people, cards, who };
}

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
