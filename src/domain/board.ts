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
  type View,
} from "./providers";
import { config, type Settings } from "./config";
import { ui } from "./ui";
import { vault, projectLabel } from "./vault";
import { openCard } from "./panel";
import { NOBODY, matches, parsePresets, savePreset, tidy, type Facet, type Filters, type Preset } from "./board-filter";
export { NOBODY };

// A provider's board as a kanban: pick a project and one of its boards, the columns and cards come from
// the provider (src/domain/providers.ts). Moving a card to another column moves it in the tracker right away,
// it is the user's own action (decided 30/9). The backend holds the token.
// The board can be linked to a vault project (settings.boards): opening the board from that project shows it.
export type Board = {
  projects: Opt[] | null;
  boards: Opt[];
  columns: Column[];
  cards: Card[];
  views: View[]; // the board's saved views in the tracker, shown with the presets
  project: string;
  board: string;
  err: string;
  busy: boolean;
  gen: number;
  group: string; // the provider's grouping shown (Productive: task lists or statuses), "" when it has one
  q: string; // the search over title and number
  filters: Filters; // the facet filters (state, status, assignee, folder, task list, labels), see board-filter.ts
  view: "kanban" | "list";
};

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
const firstGroup = (provider: BoardProvider, state: Pick<Board, "group">) =>
  !provider.groupings || state.group === provider.groupings[0].id;
export const colOf = (provider: BoardProvider, state: Pick<Board, "group">, card: Card) =>
  firstGroup(provider, state) ? card.column : (card.in?.[state.group] ?? "");
const withCol = (provider: BoardProvider, state: Pick<Board, "group">, card: Card, column: string): Card =>
  firstGroup(provider, state) ? { ...card, column } : { ...card, in: { ...card.in, [state.group]: column } };
/** The cards the search and the filters leave, and all of them. A value no card has any more (someone no longer on the board) is dropped from the filters: it would hide every card. */
export function filtered(state: Board) {
  if (state.cards.length) state.filters = tidy(state.filters, state.cards);
  return { all: state.cards, cards: state.cards.filter(card => matches(card, state.q, state.filters)) };
}
export function setFilter(provider: BoardProvider, filter: { q?: string; filters?: Filters }) {
  Object.assign(boardState(provider), filter);
  changed();
}
/** Switch one value of a facet on or off. */
export function toggleFilter(provider: BoardProvider, facet: Facet, value: string) {
  const state = boardState(provider);
  const now = state.filters[facet] ?? [];
  state.filters = { ...state.filters, [facet]: now.includes(value) ? now.filter(v => v !== value) : [...now, value] };
  changed();
}
export const clearFilters = (provider: BoardProvider, facet?: Facet) =>
  setFilter(provider, {
    filters: facet ? { ...boardState(provider).filters, [facet]: [] } : {},
  });
export const setView = (provider: BoardProvider, view: Board["view"]) => {
  boardState(provider).view = view;
  lsSet(`${lsKey(provider)}View`, view);
  changed();
};

// presets: filter sets saved under a name, per board, in this app's storage
const presetsKey = (provider: BoardProvider) => `${lsKey(provider)}Presets:${boardState(provider).board}`;
export const presetsOf = (provider: BoardProvider): Preset[] =>
  parsePresets(localStorage.getItem(presetsKey(provider)));
export function savePresetAs(provider: BoardProvider, name: string) {
  lsSet(
    presetsKey(provider),
    JSON.stringify(savePreset(presetsOf(provider), name.trim(), boardState(provider).filters)),
  );
  changed();
}
export function deletePreset(provider: BoardProvider, name: string) {
  lsSet(presetsKey(provider), JSON.stringify(presetsOf(provider).filter(p => p.name !== name)));
  changed();
}
export const applyPreset = (provider: BoardProvider, preset: Preset) =>
  setFilter(provider, { filters: preset.filters });
/** A saved view of the tracker: its filters, and its layout and grouping when the board has them. */
export function applyView(provider: BoardProvider, view: View) {
  if (!view.filters) return;
  if (view.layout) setView(provider, view.layout);
  setFilter(provider, { filters: view.filters });
  if (view.group && view.group !== boardState(provider).group && provider.groupings?.some(g => g.id === view.group))
    pickGroup(provider, view.group);
}

// folded columns: what the user chose per column id, kept across sessions; a column that is done starts folded
const foldKey = (provider: BoardProvider) => `${lsKey(provider)}Fold`;
const foldChoices = (provider: BoardProvider): Record<string, boolean> => {
  try {
    return JSON.parse(lsGet(foldKey(provider)) || "{}") || {};
  } catch {
    return {};
  }
};
export const isFolded = (provider: BoardProvider, column: Column) =>
  foldChoices(provider)[column.id] ?? column.state === "done";
export function toggleFold(provider: BoardProvider, column: Column) {
  lsSet(foldKey(provider), JSON.stringify({ ...foldChoices(provider), [column.id]: !isFolded(provider, column) }));
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
      views: [],
      project: lsGet(`${lsKey(provider)}Project`),
      board: lsGet(`${lsKey(provider)}Board`),
      err: "",
      busy: false,
      gen: 0,
      group: provider.groupings?.some(x => x.id === group) ? group : (provider.groupings?.[0].id ?? ""),
      q: "",
      filters: {},
      view: lsGet(`${lsKey(provider)}View`) === "list" ? "list" : "kanban",
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
  // the views are extra: a board still shows when they don't load
  const [columns, cards, views] = boardId
    ? await Promise.all([
        provider.columns(ctx(provider), ref, state.group || undefined),
        provider.cards(ctx(provider), ref),
        provider.views?.(ctx(provider), ref).catch(() => []) ?? [],
      ])
    : [[], [], []];
  if (!live()) return;
  state.board = boardId;
  state.columns = columns;
  state.cards = cards;
  state.views = views;
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
  state.views = [];
}

/** Show the provider's board fresh from the tracker: the board linked to the vault project last shown when there is one. */
export function showBoard(provider: BoardProvider, reload = false) {
  const state = boardState(provider);
  if (reload) state.projects = null;
  followLinkedBoard(provider, state);
  run(state, async live => {
    const projects = state.projects ?? (await provider.projects(ctx(provider)));
    if (!live()) return;
    // the board linked to a vault project counts even when the tracker's list leaves its project out (Productive
    // lists only the projects you are a member of): it is listed under the vault project's name
    const linked = ui.lastProject ? config.value.boards?.[ui.lastProject] : undefined;
    const linkedHere = linked?.provider === provider.id && linked.project === state.project;
    state.projects =
      linkedHere && !projects.some(project => project.id === state.project)
        ? [...projects, { id: state.project, name: projectLabel(ui.lastProject!) }]
        : projects;
    if (!state.projects.some(project => project.id === state.project)) {
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
    state.views = [];
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
  Math.max(
    0,
    ...state.cards.filter(x => colOf(provider, state, x) === column && x.id !== except).map(x => x.placement),
  ) + 1;
// Moves of one card reach the tracker in order. Each waiter receives the last confirmed card,
// so a failed move rolls back to that position, even when the preceding move also failed.
const cardMoves = new Map<string, Promise<Card>>();
// The move in flight is shown optimistically; later drags wait their turn. Different cards move independently.
export async function moveCard(provider: BoardProvider, card: Card, column: string) {
  const state = boardState(provider);
  const ref = refOf(provider, state);
  const context = ctx(provider);
  const group = state.group;
  const generation = state.gen;
  const placement = endOf(provider, state, column, card.id);
  const key = JSON.stringify([provider.id, ref.project, ref.board, card.id]);
  const previous = cardMoves.get(key);
  let finish!: (confirmed: Card) => void;
  const done = new Promise<Card>(resolve => {
    finish = resolve;
  });
  cardMoves.set(key, done);
  let confirmed = previous ? await previous : card;
  // Navigation, reloads and settings changes must not let a late answer replace a newer board's data.
  const live = () =>
    boards.states.get(provider.id) === state &&
    state.gen === generation &&
    state.project === ref.project &&
    state.board === ref.board &&
    state.group === group;
  const replace = (next: Card) => {
    if (live()) state.cards = state.cards.map(x => (x.id === card.id ? next : x));
  };
  try {
    if (column === colOf(provider, { group }, confirmed)) return;
    const moved = { ...withCol(provider, { group }, confirmed, column), placement };
    replace(moved);
    if (live()) state.err = "";
    changed();
    const actualPlacement = await provider.move(context, ref, moved, column, group || undefined);
    confirmed = actualPlacement == null ? moved : { ...moved, placement: actualPlacement };
    replace(confirmed);
  } catch (e) {
    replace(confirmed);
    if (live()) state.err = t("kb.moveFailed", { e: String(e) });
  } finally {
    finish(confirmed);
    if (cardMoves.get(key) === done) cardMoves.delete(key);
    changed();
  }
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
