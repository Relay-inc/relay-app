import { t, currentLocale } from "../../shared/i18n";
import { PROVIDERS } from "../../shared/plugins";
import type { BoardProvider, Card, Column, View } from "../../domain/board/types";
import { refOf, colOf, sameRef, storageKey, isFolded, tidied, link, type Board } from "../../domain/board/rules";
import { parsePresets, savePreset, type Facet, type Filters, type Preset } from "../../domain/board/filter";
import { moveCard } from "../../domain/board/moves";
import { storage } from "../../infrastructure/storage";
import { saveMainSettings, settings } from "../settings/settings";
import { useNavigationStore } from "../navigation/store";
import { closeTicket, openCard } from "../navigation/panel";
import { select } from "../navigation/navigation";
import { newChat } from "../conversations/chats";
import { typeInto } from "../conversations/actions";
import { useWorkspaceStore } from "../workspace/store";
import { projectLabel } from "../workspace/vault";
import { storedBoard, useBoardStore } from "./store";
import { ctxOf, providerReady } from "./ctx";

// A provider's board as a kanban or a list (domain/board/rules.ts). The backend holds the token.
const bs = () => useBoardStore.getState();

export const checkBoards = async () => {
  const ids = await Promise.all(PROVIDERS.map(async x => ((await providerReady(x)) ? x.id : "")));
  useBoardStore.setState(draft => {
    draft.ready = ids.filter(Boolean);
  });
};
export const readyBoards = () => PROVIDERS.filter(x => bs().ready.includes(x.id));

/** The provider's board as it is shown (every provider has one from the start, application/board/store.ts). */
const boardState = (provider: BoardProvider): Board => bs().states[provider.id];
const change = (provider: BoardProvider, recipe: (state: Board) => void) =>
  useBoardStore.setState(draft => {
    recipe(draft.states[provider.id]);
  });

// ---------- search, filters, layout and presets
/** The search and the filters; a filter value no card has is dropped, it would hide every card. */
export const setFilter = (provider: BoardProvider, filter: { q?: string; filters?: Filters }) =>
  change(provider, state => {
    if (filter.q !== undefined) state.q = filter.q;
    if (filter.filters) state.filters = tidied(state, filter.filters);
  });
/** Switch one value of a facet on or off. */
export function toggleFilter(provider: BoardProvider, facet: Facet, value: string) {
  const now = boardState(provider).filters[facet] ?? [];
  setFilter(provider, {
    filters: {
      ...boardState(provider).filters,
      [facet]: now.includes(value) ? now.filter(v => v !== value) : [...now, value],
    },
  });
}
/** Clear one facet, or every filter. */
export const clearFilters = (provider: BoardProvider, facet?: Facet) =>
  setFilter(provider, { filters: facet ? { ...boardState(provider).filters, [facet]: [] } : {} });
export function setView(provider: BoardProvider, view: Board["view"]) {
  change(provider, state => {
    state.view = view;
  });
  storage.setRaw(`${storageKey(provider)}View`, view);
}

// presets: filter sets saved under a name, per board, in this app's storage
const presetsKey = (provider: BoardProvider, board = boardState(provider).board) =>
  `${storageKey(provider)}Presets:${board}`;
function savePresets(provider: BoardProvider, presets: Preset[]) {
  storage.setRaw(presetsKey(provider), JSON.stringify(presets));
  change(provider, state => {
    state.presets = presets;
  });
}
export const savePresetAs = (provider: BoardProvider, name: string) =>
  savePresets(provider, savePreset(boardState(provider).presets, name.trim(), boardState(provider).filters));
export const deletePreset = (provider: BoardProvider, name: string) =>
  savePresets(
    provider,
    boardState(provider).presets.filter(p => p.name !== name),
  );
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

/** Fold a column or open it again; the choice is kept per column id across sessions. */
export function toggleFold(provider: BoardProvider, column: Column) {
  const folded = !isFolded(bs().folded[provider.id], column);
  useBoardStore.setState(draft => {
    (draft.folded[provider.id] ??= {})[column.id] = folded;
  });
  storage.setRaw(`${storageKey(provider)}Fold`, JSON.stringify(bs().folded[provider.id]));
}

/** New credentials or a new language: start over. The fresh boards go on counting from the old ones, so a load the
 *  old board started cannot become live again when the reload brings `gen` to the same number. */
export function resetBoard() {
  useBoardStore.setState(draft => {
    for (const provider of PROVIDERS)
      draft.states[provider.id] = storedBoard(provider, draft.states[provider.id].gen + 1);
    draft.resets++;
  });
  PROVIDERS.forEach(provider => provider.reset?.());
}

// ---------- loading
// one load at a time: a newer choice makes the answer of an older one irrelevant
async function run(provider: BoardProvider, load: (live: () => boolean) => Promise<void>) {
  let generation = 0;
  change(provider, state => {
    generation = ++state.gen;
    state.busy = true;
    state.err = "";
  });
  const live = () => generation === boardState(provider).gen;
  try {
    await load(live);
  } catch (e) {
    if (live())
      change(provider, state => {
        state.err = String(e);
      });
  }
  if (live())
    change(provider, state => {
      state.busy = false;
    });
}
async function loadCards(provider: BoardProvider, live: () => boolean, boardId: string) {
  const state = boardState(provider);
  const ref = { ...refOf(provider, state), board: boardId };
  const ctx = ctxOf(provider);
  // the views are extra: a board still shows when they don't load
  const [columns, cards, views] = boardId
    ? await Promise.all([
        provider.columns(ctx, ref, state.group || undefined),
        provider.cards(ctx, ref),
        provider.views?.(ctx, ref).catch(() => []) ?? [],
      ])
    : [[], [], []];
  if (!live()) return;
  change(provider, draft => {
    draft.board = boardId;
    draft.columns = columns;
    draft.cards = cards;
    draft.views = views;
    draft.presets = parsePresets(storage.getRaw(presetsKey(provider, boardId)) || null);
    draft.filters = tidied(draft);
  });
  const key = storageKey(provider);
  storage.setRaw(`${key}Project`, boardState(provider).project);
  storage.setRaw(`${key}Board`, boardId);
}

// the board linked to the vault project last shown, when it is another one than what the state shows: switch to it
function followLinkedBoard(provider: BoardProvider) {
  const lastProject = useNavigationStore.getState().lastProject;
  const linked = lastProject ? settings().boards?.[lastProject] : undefined;
  const state = boardState(provider);
  if (linked?.provider !== provider.id) return;
  if (linked.project === state.project && linked.board === state.board) return;
  change(provider, draft => {
    draft.project = linked.project;
    draft.board = linked.board;
    draft.boards = [];
    draft.columns = [];
    draft.cards = [];
    draft.views = [];
  });
}

/** Show the provider's board fresh from the tracker: the board linked to the vault project last shown when there is one. */
export function showBoard(provider: BoardProvider, reload = false) {
  if (reload)
    change(provider, state => {
      state.projects = null;
    });
  followLinkedBoard(provider);
  run(provider, async live => {
    const projects = boardState(provider).projects ?? (await provider.projects(ctxOf(provider)));
    if (!live()) return;
    change(provider, state => {
      state.projects = projects;
      if (!projects.some(project => project.id === state.project)) {
        state.project = "";
        state.board = "";
      }
    });
    const project = boardState(provider).project;
    const boardList = project ? await provider.boards(ctxOf(provider), project) : [];
    if (!live()) return;
    change(provider, state => {
      state.boards = boardList;
    });
    const keepBoard = boardList.some(board => board.id === boardState(provider).board);
    await loadCards(provider, live, keepBoard ? boardState(provider).board : boardList[0]?.id || "");
  });
}
export function pickProject(provider: BoardProvider, projectId: string) {
  run(provider, async live => {
    const boardList = projectId ? await provider.boards(ctxOf(provider), projectId) : [];
    if (!live()) return;
    change(provider, state => {
      state.project = projectId;
      state.boards = boardList;
      state.columns = [];
      state.cards = [];
      state.views = [];
    });
    await loadCards(provider, live, boardList[0]?.id || "");
  });
}
export const pickBoard = (provider: BoardProvider, boardId: string) =>
  run(provider, live => loadCards(provider, live, boardId));
/** Lay the columns out by another grouping: only the columns load again, the cards carry their column in each. */
export function pickGroup(provider: BoardProvider, group: string) {
  run(provider, async live => {
    const state = boardState(provider);
    const columns = state.board ? await provider.columns(ctxOf(provider), refOf(provider, state), group) : [];
    if (!live()) return;
    change(provider, draft => {
      draft.group = group;
      draft.columns = columns;
    });
    storage.setRaw(`${storageKey(provider)}Group`, group);
  });
}

// ---------- cards
const moves = new Map<string, Promise<Card>>();
/** A card dropped on a column: moved when that is another column than its own (domain/board/moves.ts). */
export function dropCard(provider: BoardProvider, id: string, column: string) {
  const state = boardState(provider);
  const card = state.cards.find(x => x.id === id);
  if (!card || column === colOf(provider, state, card)) return;
  const context = ctxOf(provider);
  moveCard(
    {
      board: () => boardState(provider),
      change: recipe => change(provider, recipe),
      move: (ref, moved, to, group) => provider.move(context, ref, moved, to, group),
      failed: e => t("kb.moveFailed", { e: String(e) }),
      queue: moves,
    },
    provider,
    card,
    column,
  );
}
export const openBoardCard = (provider: BoardProvider, id: string) =>
  openCard(provider, refOf(provider, boardState(provider)), id);
/** "Start conversation" in the ticket window: a new conversation under the board's vault project, with the card's
 *  number, title and link typed in its composer; the draft keeps its title. */
export async function ticketChat(provider: BoardProvider, text: string) {
  const key = newChat(linkedProject(provider) || null);
  closeTicket();
  await select(key);
  typeInto(key, text);
}

// ---------- which vault project a board belongs to: a vault project has at most one board
/** Every vault project as [name, label], by label, for the link picker. */
export const vaultProjects = (): [string, string][] =>
  useWorkspaceStore
    .getState()
    .snap.projects.map((project): [string, string] => [project.name, projectLabel(project.name)])
    .sort((a, b) => a[1].localeCompare(b[1], currentLocale()));
/** The vault project the board is linked to, "" when none. */
export const linkedProject = (provider: BoardProvider) =>
  Object.entries(settings().boards || {}).find(([, ref]) => sameRef(ref, refOf(provider, boardState(provider))))?.[0] ??
  "";
/** Link the board to a vault project, or unlink it (""). A failed save shows on the board. */
export async function linkBoard(provider: BoardProvider, vaultProject: string) {
  const boards = settings().boards || {};
  const next = vaultProject
    ? link(boards, vaultProject, refOf(provider, boardState(provider)))
    : link(boards, linkedProject(provider), null);
  const failed = await saveMainSettings({ ...settings(), boards: next });
  if (failed)
    change(provider, state => {
      state.err = failed;
    });
}
