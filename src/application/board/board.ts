import { t, currentLocale } from "../../shared/i18n";
import { PROVIDERS } from "../../shared/plugins";
import type { BoardProvider, Card } from "../../domain/board/types";
import { refOf, colOf, withCol, endOf, sameRef, storageKey, whoOf, link, type Board } from "../../domain/board/rules";
import { storage } from "../../infrastructure/storage";
import { saveMainSettings, settings } from "../settings/settings";
import { useNavigationStore } from "../navigation/store";
import { openCard } from "../navigation/panel";
import { useWorkspaceStore } from "../workspace/store";
import { projectLabel } from "../workspace/vault";
import { storedBoards, useBoardStore } from "./store";
import { ctxOf, providerReady } from "./ctx";

// A provider's board as a kanban (domain/board/rules.ts). The backend holds the token.
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
export const setFilter = (provider: BoardProvider, filter: { q?: string; who?: string }) =>
  change(provider, state => {
    Object.assign(state, filter);
  });
/** The folded column ids. */
const folded = (provider: BoardProvider) => bs().folded[provider.id] || [];
export function toggleFold(provider: BoardProvider, column: string) {
  const set = new Set(folded(provider));
  if (!set.delete(column)) set.add(column);
  useBoardStore.setState(draft => {
    draft.folded[provider.id] = [...set];
  });
  storage.setRaw(`${storageKey(provider)}Folded`, JSON.stringify([...set]));
}

/** New credentials or a new language: start over. */
export function resetBoard() {
  useBoardStore.setState(draft => {
    draft.states = storedBoards();
    draft.resets++;
  });
  PROVIDERS.forEach(provider => provider.reset?.());
}

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
  const [columns, cards] = boardId
    ? await Promise.all([
        provider.columns(ctxOf(provider), ref, state.group || undefined),
        provider.cards(ctxOf(provider), ref),
      ])
    : [[], []];
  if (!live()) return;
  change(provider, draft => {
    draft.board = boardId;
    draft.columns = columns;
    draft.cards = cards;
    draft.who = whoOf(draft);
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
/** A card to another column: shown there at once (at its end), back where it was when the tracker refuses. */
async function moveCard(provider: BoardProvider, card: Card, column: string) {
  const state = boardState(provider);
  if (column === colOf(provider, state, card)) return;
  const replace = (next: Card) =>
    change(provider, draft => {
      draft.cards = draft.cards.map(x => (x.id === card.id ? next : x));
    });
  const moved = { ...withCol(provider, state, card, column), placement: endOf(provider, state, column, card.id) };
  replace(moved);
  change(provider, draft => {
    draft.err = "";
  });
  try {
    const placement = await provider.move(
      ctxOf(provider),
      refOf(provider, boardState(provider)),
      moved,
      column,
      state.group || undefined,
    );
    if (placement != null) replace({ ...moved, placement });
  } catch (e) {
    replace(card);
    change(provider, draft => {
      draft.err = t("kb.moveFailed", { e: String(e) });
    });
  }
}
/** A card dropped on a column: moved when that is another column than its own. */
export function dropCard(provider: BoardProvider, id: string, column: string) {
  const state = boardState(provider);
  const card = state.cards.find(x => x.id === id);
  if (card && column !== colOf(provider, state, card)) moveCard(provider, card, column);
}
export const openBoardCard = (provider: BoardProvider, id: string) =>
  openCard(provider, refOf(provider, boardState(provider)), id);

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
