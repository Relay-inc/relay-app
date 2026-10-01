import { invoke } from "@tauri-apps/api/core";
import { t, currentLocale } from "../core/i18n";
import { changed } from "../core/store";
import {
  PROVIDERS,
  ctxOf,
  ready as providerReady,
  type BoardProvider,
  type BoardRef,
  type Card,
  type Column,
  type Opt,
} from "./providers";
import { config, type Settings } from "./config";
import { ui } from "./ui";
import { vault, projectLabel } from "./vault";
import { openCard } from "./panel";

// A provider's board as a kanban: pick a project and one of its boards, the columns and cards come from
// the provider (src/domain/providers.ts). Moving a card to another column moves it in the tracker right away,
// it is the user's own action (decided 30/9). The backend holds the token.
// The board can be linked to a vault project (settings.boards): opening the board from that project shows it.
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

export const boards = {
  ready: [] as string[], // a board row only shows once its integration is switched on and set up, with a token in the keychain
  states: new Map<string, Board>(), // per provider: what it shows, kept while switching views
};
export const checkBoards = async () => {
  const ids = await Promise.all(PROVIDERS.map(async x => ((await providerReady(x)) ? x.id : "")));
  boards.ready = ids.filter(Boolean);
};
export const readyBoards = () => PROVIDERS.filter(x => boards.ready.includes(x.id));

const lsGet = (key: string) => localStorage.getItem(key) || "";
const lsSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};
// the Productive keys of before the providers, so the board opens where it was
const lsKey = (provider: BoardProvider) => (provider.id === "productive" ? "pv" : provider.id);
const ctx = (provider: BoardProvider) => ctxOf(provider, config.value.integrations);
export const refOf = (provider: BoardProvider, state: Board): BoardRef => ({
  provider: provider.id,
  project: state.project,
  board: state.board,
});

// a card's column in the grouping shown: the first grouping is `column`, the others come from `in`
const firstGroup = (provider: BoardProvider, state: Board) => !provider.groupings || state.group === provider.groupings[0].id;
export const colOf = (provider: BoardProvider, state: Board, card: Card) =>
  firstGroup(provider, state) ? card.column : card.in?.[state.group] ?? "";
const withCol = (provider: BoardProvider, state: Board, card: Card, column: string): Card =>
  firstGroup(provider, state) ? { ...card, column } : { ...card, in: { ...card.in, [state.group]: column } };
/** The assignees on the board, and the cards the filters leave. A filter on someone not on this board is dropped: it would hide every card. */
export function filtered(state: Board) {
  const people = [...new Set(state.cards.map(card => card.who).filter(Boolean))].sort();
  if (state.who && state.who !== NOBODY && !people.includes(state.who)) state.who = "";
  const q = state.q.toLowerCase();
  const cards = state.cards.filter(card =>
    (!q || `${card.title} ${card.number}`.toLowerCase().includes(q)) &&
    (!state.who || (state.who === NOBODY ? !card.who : card.who === state.who)));
  return { people, cards };
}
export function setFilter(provider: BoardProvider, filter: { q?: string; who?: string }) {
  Object.assign(boardState(provider), filter);
  changed();
}
// folded columns, by column id, kept across sessions
export const folded = (provider: BoardProvider) => new Set<string>(JSON.parse(lsGet(`${lsKey(provider)}Folded`) || "[]"));
export function toggleFold(provider: BoardProvider, column: string) {
  const set = folded(provider);
  if (!set.delete(column)) set.add(column);
  lsSet(`${lsKey(provider)}Folded`, JSON.stringify([...set]));
  changed();
}

/** new credentials or a new language: start over */
export function resetBoard() {
  boards.states.clear();
  PROVIDERS.forEach(provider => provider.reset?.());
  changed();
}
/** The provider's board, from what is known right away. */
export function boardState(provider: BoardProvider): Board {
  const group = lsGet(`${lsKey(provider)}Group`);
  if (!boards.states.has(provider.id))
    boards.states.set(provider.id, {
      projects: null,
      boards: [],
      columns: [],
      cards: [],
      project: lsGet(`${lsKey(provider)}Project`),
      board: lsGet(`${lsKey(provider)}Board`),
      err: "",
      busy: false,
      gen: 0,
      group: provider.groupings?.some(x => x.id === group) ? group : provider.groupings?.[0].id ?? "",
      q: "",
      who: "",
    });
  return boards.states.get(provider.id)!;
}

// one load at a time: a newer choice makes the answer of an older one irrelevant
async function run(state: Board, load: (live: () => boolean) => Promise<void>) {
  const generation = ++state.gen;
  const live = () => generation === state.gen;
  state.busy = true;
  state.err = "";
  changed();
  try {
    await load(live);
  } catch (e) {
    if (live()) state.err = String(e);
  }
  if (live()) {
    state.busy = false;
    changed();
  }
}
async function loadCards(provider: BoardProvider, state: Board, live: () => boolean, boardId: string) {
  const ref = { ...refOf(provider, state), board: boardId };
  const [columns, cards] = boardId
    ? await Promise.all([provider.columns(ctx(provider), ref, state.group || undefined), provider.cards(ctx(provider), ref)])
    : [[], []];
  if (!live()) return;
  state.board = boardId;
  state.columns = columns;
  state.cards = cards;
  lsSet(`${lsKey(provider)}Project`, state.project);
  lsSet(`${lsKey(provider)}Board`, state.board);
}

// the board linked to the vault project last shown, when it is another one than what the state shows: switch to it
function followLinkedBoard(provider: BoardProvider, state: Board) {
  const linked = ui.lastProject ? config.value.boards?.[ui.lastProject] : undefined;
  if (linked?.provider !== provider.id) return;
  if (linked.project === state.project && linked.board === state.board) return;
  state.project = linked.project;
  state.board = linked.board;
  state.boards = [];
  state.columns = [];
  state.cards = [];
}

/** Show the provider's board fresh from the tracker: the board linked to the vault project last shown when there is one. */
export function showBoard(provider: BoardProvider, reload = false) {
  const state = boardState(provider);
  if (reload) state.projects = null;
  followLinkedBoard(provider, state);
  run(state, async live => {
    const projects = state.projects ?? (await provider.projects(ctx(provider)));
    if (!live()) return;
    state.projects = projects;
    if (!projects.some(project => project.id === state.project)) {
      state.project = "";
      state.board = "";
    }
    const boardList = state.project ? await provider.boards(ctx(provider), state.project) : [];
    if (!live()) return;
    state.boards = boardList;
    const keepBoard = boardList.some(board => board.id === state.board);
    await loadCards(provider, state, live, keepBoard ? state.board : boardList[0]?.id || "");
  });
}
export function pickProject(provider: BoardProvider, projectId: string) {
  const state = boardState(provider);
  run(state, async live => {
    const boardList = projectId ? await provider.boards(ctx(provider), projectId) : [];
    if (!live()) return;
    state.project = projectId;
    state.boards = boardList;
    state.columns = [];
    state.cards = [];
    await loadCards(provider, state, live, boardList[0]?.id || "");
  });
}
export const pickBoard = (provider: BoardProvider, boardId: string) => {
  const state = boardState(provider);
  run(state, live => loadCards(provider, state, live, boardId));
};
/** Lay the columns out by another grouping: only the columns load again, the cards carry their column in each. */
export function pickGroup(provider: BoardProvider, group: string) {
  const state = boardState(provider);
  run(state, async live => {
    const columns = state.board ? await provider.columns(ctx(provider), refOf(provider, state), group) : [];
    if (!live()) return;
    state.group = group;
    state.columns = columns;
    lsSet(`${lsKey(provider)}Group`, group);
  });
}
// a card goes to the end of its new column
const endOf = (provider: BoardProvider, state: Board, column: string, except: string) =>
  Math.max(0, ...state.cards.filter(x => colOf(provider, state, x) === column && x.id !== except).map(x => x.placement)) + 1;
// shown in the new column at once, back where it was when the tracker refuses
// (a card is replaced, not changed: the components only redraw for a new object)
export async function moveCard(provider: BoardProvider, card: Card, column: string) {
  const state = boardState(provider);
  if (column === colOf(provider, state, card)) return;
  const replace = (next: Card) => {
    state.cards = state.cards.map(x => (x.id === card.id ? next : x));
  };
  const moved = { ...withCol(provider, state, card, column), placement: endOf(provider, state, column, card.id) };
  replace(moved);
  state.err = "";
  changed();
  try {
    const placement = await provider.move(ctx(provider), refOf(provider, state), moved, column, state.group || undefined);
    if (placement != null) replace({ ...moved, placement });
  } catch (e) {
    replace(card);
    state.err = t("kb.moveFailed", { e: String(e) });
  }
  changed();
}
export const openBoardCard = (provider: BoardProvider, id: string) =>
  openCard(provider, refOf(provider, boardState(provider)), id);

// ---------- which vault project a board belongs to: a vault project has at most one board
const sameRef = (a: BoardRef | undefined, b: BoardRef) =>
  !!a && a.provider === b.provider && a.project === b.project && a.board === b.board;
export const vaultProjects = (): [string, string][] =>
  vault.snap.projects
    .map((project): [string, string] => [project.name, projectLabel(project.name)])
    .sort((a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], currentLocale()));
export const linkedProject = (provider: BoardProvider) =>
  Object.entries(config.value.boards || {}).find(([, ref]) =>
    sameRef(ref, refOf(provider, boardState(provider))),
  )?.[0] ?? "";
// one board per vault project, and the board shown under one vault project
export function linkBoard(provider: BoardProvider, vaultProject: string) {
  const ref = refOf(provider, boardState(provider));
  const linked = Object.fromEntries(
    Object.entries(config.value.boards || {}).filter(([, other]) => !sameRef(other, ref)),
  );
  if (vaultProject) linked[vaultProject] = ref;
  invoke<Settings>("set_settings", { settings: { ...config.value, boards: linked } })
    .then(settings => {
      config.value = settings;
      changed();
    })
    .catch(e => console.error(e));
}
