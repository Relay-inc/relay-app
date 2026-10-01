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
import { vault, pLabel } from "./vault";
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
};

export const boards = {
  ready: [] as string[], // a board row only shows once its integration is switched on and set up, with a token in the keychain
  states: new Map<string, Board>(), // per provider: what it shows, kept while switching views
};
export const checkBoards = async () => {
  boards.ready = (await Promise.all(PROVIDERS.map(async p => ((await providerReady(p)) ? p.id : "")))).filter(Boolean);
};
export const readyBoards = () => PROVIDERS.filter(p => boards.ready.includes(p.id));

const lsGet = (k: string) => localStorage.getItem(k) || "";
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};
// the Productive keys of before the providers, so the board opens where it was
const lsKey = (p: BoardProvider) => (p.id === "productive" ? "pv" : p.id);
const ctx = (p: BoardProvider) => ctxOf(p, config.value.integrations);
export const refOf = (p: BoardProvider, s: Board): BoardRef => ({ provider: p.id, project: s.project, board: s.board });

/** new credentials or a new language: start over */
export function resetBoard() {
  boards.states.clear();
  PROVIDERS.forEach(p => p.reset?.());
  changed();
}
/** The provider's board, from what is known right away. */
export function boardState(p: BoardProvider): Board {
  if (!boards.states.has(p.id))
    boards.states.set(p.id, {
      projects: null,
      boards: [],
      columns: [],
      cards: [],
      project: lsGet(`${lsKey(p)}Project`),
      board: lsGet(`${lsKey(p)}Board`),
      err: "",
      busy: false,
      gen: 0,
    });
  return boards.states.get(p.id)!;
}

// one load at a time: a newer choice makes the answer of an older one irrelevant
async function run(s: Board, fn: (live: () => boolean) => Promise<void>) {
  const g = ++s.gen,
    live = () => g === s.gen;
  s.busy = true;
  s.err = "";
  changed();
  try {
    await fn(live);
  } catch (x) {
    if (live()) s.err = String(x);
  }
  if (live()) {
    s.busy = false;
    changed();
  }
}
async function loadCards(p: BoardProvider, s: Board, live: () => boolean, b: string) {
  const r = { ...refOf(p, s), board: b };
  const [cols, cs] = b ? await Promise.all([p.columns(ctx(p), r), p.cards(ctx(p), r)]) : [[], []];
  if (!live()) return;
  s.board = b;
  s.columns = cols;
  s.cards = cs;
  lsSet(`${lsKey(p)}Project`, s.project);
  lsSet(`${lsKey(p)}Board`, s.board);
}

/** Show the provider's board fresh from the tracker: the board linked to the vault project last shown when there is one. */
export function showBoard(p: BoardProvider, reload = false) {
  const s = boardState(p),
    prefer = ui.lastP ? config.value.boards?.[ui.lastP] : undefined;
  if (reload) s.projects = null;
  if (prefer?.provider === p.id && (prefer.project !== s.project || prefer.board !== s.board)) {
    s.project = prefer.project;
    s.board = prefer.board;
    s.boards = [];
    s.columns = [];
    s.cards = [];
  }
  run(s, async live => {
    const ps = s.projects ?? (await p.projects(ctx(p)));
    if (!live()) return;
    s.projects = ps;
    if (!ps.some(x => x.id === s.project)) {
      s.project = "";
      s.board = "";
    }
    const bs = s.project ? await p.boards(ctx(p), s.project) : [];
    if (!live()) return;
    s.boards = bs;
    await loadCards(p, s, live, bs.some(b => b.id === s.board) ? s.board : bs[0]?.id || "");
  });
}
export function pickProject(p: BoardProvider, id: string) {
  const s = boardState(p);
  run(s, async live => {
    const bs = id ? await p.boards(ctx(p), id) : [];
    if (!live()) return;
    s.project = id;
    s.boards = bs;
    s.columns = [];
    s.cards = [];
    await loadCards(p, s, live, bs[0]?.id || "");
  });
}
export const pickBoard = (p: BoardProvider, id: string) => {
  const s = boardState(p);
  run(s, live => loadCards(p, s, live, id));
};
// shown in the new column at once, back where it was when the tracker refuses
// (a card is replaced, not changed: the components only redraw for a new object)
export async function moveCard(p: BoardProvider, c: Card, to: string) {
  const s = boardState(p);
  if (to === c.column) return;
  const put = (next: Card) => {
    s.cards = s.cards.map(x => (x.id === c.id ? next : x));
  };
  const moved = {
    ...c,
    column: to,
    placement: Math.max(0, ...s.cards.filter(x => x.column === to && x.id !== c.id).map(x => x.placement)) + 1,
  };
  put(moved);
  s.err = "";
  changed();
  try {
    const placed = await p.move(ctx(p), refOf(p, s), moved, to);
    if (placed != null) put({ ...moved, placement: placed });
  } catch (x) {
    put(c);
    s.err = t("kb.moveFailed", { e: String(x) });
  }
  changed();
}
export const openBoardCard = (p: BoardProvider, id: string) => openCard(p, refOf(p, boardState(p)), id);

// ---------- which vault project a board belongs to: a vault project has at most one board
const sameRef = (a: BoardRef | undefined, b: BoardRef) =>
  !!a && a.provider === b.provider && a.project === b.project && a.board === b.board;
export const vaultProjects = (): [string, string][] =>
  vault.snap.projects
    .map((x: any): [string, string] => [x.name, pLabel(x.name)])
    .sort((a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], currentLocale()));
export const linkedProject = (p: BoardProvider) =>
  Object.entries(config.value.boards || {}).find(([, r]) => sameRef(r, refOf(p, boardState(p))))?.[0] ?? "";
// one board per vault project, and the board shown under one vault project
export function linkBoard(p: BoardProvider, vp: string) {
  const ref = refOf(p, boardState(p));
  const linked = Object.fromEntries(Object.entries(config.value.boards || {}).filter(([, r]) => !sameRef(r, ref)));
  if (vp) linked[vp] = ref;
  invoke<Settings>("set_settings", { settings: { ...config.value, boards: linked } })
    .then(s => {
      config.value = s;
      changed();
    })
    .catch(e => console.error(e));
}
